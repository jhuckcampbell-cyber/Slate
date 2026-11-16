import { readFile } from "node:fs/promises";
import ts from "typescript";

// Development-only comparison tool. Never imported by application code.
// Optional fixture directory makes a previously downloaded ESPN snapshot usable offline:
// node scripts/verify-team-colors.mjs --fixtures path/to/espn-json
const source = await readFile(new URL("../src/lib/teams/registry.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { TEAMS, lookupTeam } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const leagues = [
  ["NFL", "football/nfl", "americanfootball_nfl"],
  ["NBA", "basketball/nba", "basketball_nba"],
  ["NHL", "hockey/nhl", "icehockey_nhl"],
  ["MLB", "baseball/mlb", "baseball_mlb"],
  ["NCAAF", "football/college-football", "americanfootball_ncaaf"],
  ["NCAAB", "basketball/mens-college-basketball", "basketball_ncaab"],
];
const fixtureIndex = process.argv.indexOf("--fixtures");
let mismatches = 0, failures = 0;
for (const [league, endpoint, sportKey] of leagues) {
  try {
    const data = fixtureIndex >= 0
      ? JSON.parse(await readFile(`${process.argv[fixtureIndex + 1]}/${league.toLowerCase()}.json`, "utf8"))
      : await fetch(`https://site.api.espn.com/apis/site/v2/sports/${endpoint}/teams?limit=1000`, { signal: AbortSignal.timeout(20000) }).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
    const teams = data.sports?.[0]?.leagues?.[0]?.teams;
    if (!Array.isArray(teams) || teams.length === 0) throw new Error("missing sports[0].leagues[0].teams");
    const seen = new Set();
    for (const { team } of teams) {
      // ESPN's actual team fields, not colors.primary / secondary.
      if (!team?.displayName) continue;
      const entry = lookupTeam(team.displayName, sportKey);
      if (!/^[0-9a-f]{6}$/i.test(team.color) || !/^[0-9a-f]{6}$/i.test(team.alternateColor)) {
        // ESPN lacks colors for this team; only matters if it's one of ours.
        if (entry) { console.log(`${league} ${entry.name}: ESPN has no usable colors, check by hand`); seen.add(entry.name); }
        continue;
      }
      if (!entry && (league === "NCAAF" || league === "NCAAB")) continue; // Outside the curated Power 4 scope.
      if (!entry) { console.log(`${league}: unmatched ESPN team ${team.displayName}`); mismatches++; continue; }
      seen.add(entry.name);
      const diffs = [["primary", team.color], ["secondary", team.alternateColor]]
        .filter(([field, value]) => entry[field].toLowerCase() !== `#${value}`.toLowerCase())
        .map(([field, value]) => `${field} ${entry[field]} -> ESPN #${value.toUpperCase()}`);
      const swapped = entry.primary.toLowerCase() === `#${team.alternateColor}`.toLowerCase() && entry.secondary.toLowerCase() === `#${team.color}`.toLowerCase();
      if (diffs.length) { console.log(`${league} ${entry.name}: ${diffs.join(", ")}${swapped ? " [PRIMARY/SECONDARY SWAP]" : ""}`); mismatches++; }
    }
    for (const entry of TEAMS.filter(t => t.league === league && !seen.has(t.name))) {
      console.log(`${league}: registry team missing from ESPN: ${entry.name}`); mismatches++;
    }
  } catch (error) {
    failures++;
    console.error(`${league}: verification failed: ${error.message}${error.cause?.code ? ` (${error.cause.code})` : ""}`);
  }
}
console.log(`${mismatches} team mismatches; ${failures} league verification failures. Review manually; registry was not modified.`);
if (failures) process.exitCode = 1;
