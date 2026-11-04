// One-time production wiring for the odds updater. Run it yourself:
//   node scripts/prod-odds-secrets.mjs <project-ref>
// It (1) stores ODDS_API_KEY (copied from supabase/functions/.env), ODDS_PROVIDER, ODDS_BOOKMAKERS and a
// fresh random ODDS_SYNC_SECRET as Edge Function secrets, and (2) stores the function URL + the same sync
// secret in the database Vault, so pg_cron can call the function. Values are never printed; the temp files
// holding them are deleted even on failure. Re-running rotates the sync secret safely.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ref = process.argv[2];
if (!ref || !/^[a-z0-9]{20}$/.test(ref)) {
  console.error("Usage: node scripts/prod-odds-secrets.mjs <project-ref>");
  process.exit(1);
}

const local = Object.fromEntries(
  readFileSync("supabase/functions/.env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
if (!local.ODDS_API_KEY) {
  console.error("No ODDS_API_KEY in supabase/functions/.env");
  process.exit(1);
}

const syncSecret = randomBytes(32).toString("hex");
const fnUrl = `https://${ref}.supabase.co/functions/v1/odds-sync`;
const sqlString = (s) => `'${s.replaceAll("'", "''")}'`;

const dir = mkdtempSync(join(tmpdir(), "squadbets-"));
const envFile = join(dir, "secrets.env");
const sqlFile = join(dir, "vault.sql");

function run(args) {
  const r = spawnSync("npx", ["supabase", ...args], { stdio: ["inherit", "pipe", "pipe"], shell: true, encoding: "utf8" });
  if (r.status !== 0) {
    // CLI errors never contain the values (they're only in the temp files), but trim anyway.
    console.error((r.stderr || r.stdout || "").slice(-600));
    throw new Error(`supabase ${args[0]} ${args[1]} failed`);
  }
}

try {
  writeFileSync(
    envFile,
    [
      "ODDS_PROVIDER=the-odds-api",
      `ODDS_API_KEY=${local.ODDS_API_KEY}`,
      `ODDS_BOOKMAKERS=${local.ODDS_BOOKMAKERS || "draftkings"}`,
      `ODDS_SYNC_SECRET=${syncSecret}`,
    ].join("\n") + "\n",
    { mode: 0o600 },
  );
  writeFileSync(
    sqlFile,
    `do $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'odds_sync_url';
  if v_id is null then perform vault.create_secret(${sqlString(fnUrl)}, 'odds_sync_url');
  else perform vault.update_secret(v_id, ${sqlString(fnUrl)}); end if;
  select id into v_id from vault.secrets where name = 'odds_sync_secret';
  if v_id is null then perform vault.create_secret(${sqlString(syncSecret)}, 'odds_sync_secret');
  else perform vault.update_secret(v_id, ${sqlString(syncSecret)}); end if;
end $$;
`,
    { mode: 0o600 },
  );

  console.log("1/2 Saving Edge Function secrets (values hidden)...");
  run(["secrets", "set", "--env-file", envFile, `--remote=${ref}`, "--yes"]);
  console.log("2/2 Saving the function address + sync secret in the database Vault...");
  run(["db", "query", `--remote=${ref}`, "-f", sqlFile, "--yes"]);
  console.log("Done. Paid odds calls are still OFF (the database switch is unchanged).");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
