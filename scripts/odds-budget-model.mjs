#!/usr/bin/env node
// Offline planning model. No dependencies, environment secrets, DB, or network.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const migrations = readdirSync(resolve(root, 'supabase/migrations')).filter(x => x.endsWith('.sql')).sort();
const sql = migrations.map(x => read(`supabase/migrations/${x}`)).join('\n');
const match = (s, re) => {
  const m = s.match(re);
  if (!m) throw new Error(`Source format changed; review extractor: ${re}`);
  return m[1];
};
const latestFunction = (name) => {
  const blocks = [...sql.matchAll(new RegExp(`create (?:or replace )?function private\\.${name}\\([^]*?\\$\\$;`, 'gi'))];
  assert.ok(blocks.length, `Missing SQL function ${name}`);
  return blocks.at(-1)[0];
};
const budget = read('supabase/migrations/20261103000007_odds_budget.sql');
const quota = Number(match(budget, /set value = '(\d+)' where key = 'odds_monthly_quota'/));
const cap = Number(match(budget, /\('odds_monthly_cap', '(\d+)'\)/));
const tiers = JSON.parse(match(sql, /\('odds_refresh_tiers', '([^']+)'\)/));
const pacedTiers = JSON.parse(match(sql, /\('odds_pacing_tiers','([^']+)'\)/));
const minutes = (s) => {
  const m = s.match(/^(\d+) (minute|hour|day)s?$/);
  assert.ok(m, `Unsupported interval: ${s}`);
  return Number(m[1]) * ({ minute: 1, hour: 60, day: 1440 }[m[2]]);
};
const refresh = latestFunction('odds_refresh_interval');
const thresholds = [...refresh.matchAll(/p_commence - now\(\) > interval '([^']+)'/g)].map(m => minutes(m[1]));
assert.equal(thresholds.length, 2);
const scoreEvery = minutes(JSON.parse(match(sql, /\('scores_refresh', '([^']+)'\)/)));
const scoreCost = Number(match(read('supabase/functions/_shared/scores.ts'), /SCORES_CALL_COST = (\d+)/));
const index = read('supabase/functions/odds-sync/index.ts');
const books = match(index, /ODDS_BOOKMAKERS"\) \?\? "([^"]+)"/).split(',');
// Execute only the pure arithmetic body, avoiding Node/TypeScript version requirements.
const costBody = match(read('supabase/functions/_shared/budget.ts'), /export function oddsCallCost\([^]*?\): number \{([^]*?)\n\}/);
const cost = new Function('markets', 'bookmakers', costBody);
const lines = JSON.parse(match(read('supabase/migrations/20261103000001_core_schema.sql'), /'(\{"markets":\[[^']+)'/)).markets;
const propsSql = latestFunction('prop_markets');
const props = (prefix) => [...match(propsSql, new RegExp(`when p_sport_key like '${prefix}%' then array\\[([^]*?)\\]`)).matchAll(/'([^']+)'/g)].map(m => m[1]);
const nflProps = props('americanfootball');
const nbaProps = props('basketball');

// Explicit workload assumptions (not provider constants): minutes relative to first kickoff.
// 12 NFL Sunday games in three windows; 6 NBA games across a 3-hour start spread.
const nfl = [0,0,0,0,0,0,0,185,185,185,185,440].map(start => ({ start, end: start + 210 }));
const nba = [0,0,60,120,180,180].map(start => ({ start, end: start + 150 }));
function sportModel(games, markets, { lead = 48 * 60, propMode = 'off', every = tiers,
  scores = scoreEvery, snapshots = false, stagger = 0 } = {}) {
  let lastLine = -Infinity, lastScore = -Infinity;
  const lastProp = games.map(() => -Infinity);
  let lineCredits = 0, propCredits = 0, scoreCredits = 0;
  const cadence = (until) => minutes(every[until > thresholds[0] ? 'far' : until > thresholds[1] ? 'day' : 'close']);
  for (let t = -lead; t <= Math.max(...games.map(g => g.end)); t++) {
    // Shared tournament lock at first kickoff. Additional creations force a refresh.
    const creation = t === -lead || (stagger && t > -lead && t <= -lead + stagger && (t + lead) % 60 === 0);
    if (t < 0 && (snapshots ? creation : creation || t - lastLine >= cadence(-t))) {
      lineCredits += cost(lines, books); lastLine = t;
    }
    games.forEach((g, i) => {
      const enabled = propMode === 'all' || (propMode === 'one' && i === 0);
      if (enabled && t < 0 && (snapshots ? creation : creation || t - lastProp[i] >= cadence(g.start - t))) {
        propCredits += cost(markets, books); lastProp[i] = t;
      }
    });
    // Final arrives at assumed end; include one terminal poll, then stop completed games.
    if (games.some(g => g.start <= t && t <= g.end) && t - lastScore >= scores) {
      scoreCredits += scoreCost; lastScore = t;
    }
  }
  return { lineCredits, propCredits, scoreCredits };
}
const scenarios = [
  ['Current: shared slates, props OFF', {}],
  ['Current: props on 1 game/sport', { propMode: 'one' }],
  ['Current: props on every game', { propMode: 'all' }],
  ['Current: OFF, opens 7 days ahead', { lead: 7 * 1440 }],
  ['Current: OFF, 5 groups create hourly', { stagger: 4 * 60 }],
  ['Proposed: OFF, 12h/6h/1h + scores 60m', { every: { far: '12 hours', day: '6 hours', close: '1 hour' }, scores: 60 }],
  ['Proposed: OFF, one snapshot + scores 30m', { snapshots: true, scores: 30 }],
  ['Proposed: all props, one snapshot + scores 60m', { snapshots: true, scores: 60, propMode: 'all' }],
  ['Beta: 6 NBA games, normal cadence', { nbaOnly: true, every: pacedTiers.normal, scores: minutes(pacedTiers.normal.scores) }],
  ['Beta: 6 NBA games, tight cadence', { nbaOnly: true, every: pacedTiers.tight, scores: minutes(pacedTiers.tight.scores) }],
  ['Beta: 6 NBA games, critical cadence', { nbaOnly: true, every: pacedTiers.critical, scores: minutes(pacedTiers.critical.scores) }],
];
console.log(`Offline source-derived budget: cap ${cap}, quota ${quota}, reserve ${quota-cap}.`);
console.log(`Cadence ${JSON.stringify(tiers)}, thresholds ${thresholds.join('/')} minutes; scores ${scoreEvery}m @ ${scoreCost}.`);
console.log(`Books: ${books.join(',')}; lines ${cost(lines, books)}, NFL props ${cost(nflProps, books)}, NBA props ${cost(nbaProps, books)} credits/call.`);
console.log('Assumptions: 3-5 groups share 12 NFL + 6 NBA games; open 48h, lock earliest kickoff; NFL 210m/game, NBA 150m/game.');
console.log('Monthly = week * 52/12; five-week column is conservative calendar planning. Uncapped demand; no retries or other traffic.');
const rows = scenarios.map(([scenario, options]) => {
  const a = options.nbaOnly ? { lineCredits: 0, propCredits: 0, scoreCredits: 0 } : sportModel(nfl, nflProps, options);
  const b = sportModel(nba, nbaProps, options);
  const line = a.lineCredits+b.lineCredits, prop = a.propCredits+b.propCredits, score = a.scoreCredits+b.scoreCredits;
  const week = line+prop+score;
  assert.ok(Number.isInteger(week) && week > 0);
  return { scenario, lines: line, props: prop, scores: score, week, month: +(week*52/12).toFixed(1), '5 weeks': week*5, 'fits cap (5w)': week*5 <= cap };
});
console.table(rows);
assert.equal(cost(lines, books), lines.length);
assert.ok(rows[2].week > rows[1].week && rows[1].week > rows[0].week);
assert.ok(rows[5]['5 weeks'] <= cap);
assert.ok(rows[8]['5 weeks'] <= cap);
assert.ok(rows[8].week > rows[9].week && rows[9].week > rows[10].week);
console.log('Group count does not multiply shared jobs. Different game selections expand props and score windows; staggered creation adds refreshes.');
console.log('Snapshot rows require scheduler AND freshness-policy changes; these are proposals, not current settings.');
