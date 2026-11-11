/**
 * Team name forms. PURE TS, no deps (importable by Edge Functions).
 * full "Oklahoma City Thunder" · short "Thunder" · place "Oklahoma City" · abbr "OKC".
 * Unknown teams use a school-name heuristic; multiword mascots are stripped first.
 */
export type Team = { full: string; short: string; place: string; abbr: string };

/** full name → abbreviation (NFL + NBA). */
const ABBR: Record<string, string> = {
  "Arizona Cardinals": "ARI", "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL",
  "Buffalo Bills": "BUF", "Carolina Panthers": "CAR", "Chicago Bears": "CHI",
  "Cincinnati Bengals": "CIN", "Cleveland Browns": "CLE", "Dallas Cowboys": "DAL",
  "Denver Broncos": "DEN", "Detroit Lions": "DET", "Green Bay Packers": "GB",
  "Houston Texans": "HOU", "Indianapolis Colts": "IND", "Jacksonville Jaguars": "JAX",
  "Kansas City Chiefs": "KC", "Las Vegas Raiders": "LV", "Los Angeles Chargers": "LAC",
  "Los Angeles Rams": "LAR", "Miami Dolphins": "MIA", "Minnesota Vikings": "MIN",
  "New England Patriots": "NE", "New Orleans Saints": "NO", "New York Giants": "NYG",
  "New York Jets": "NYJ", "Philadelphia Eagles": "PHI", "Pittsburgh Steelers": "PIT",
  "San Francisco 49ers": "SF", "Seattle Seahawks": "SEA", "Tampa Bay Buccaneers": "TB",
  "Tennessee Titans": "TEN", "Washington Commanders": "WAS",
  "Atlanta Hawks": "ATL", "Boston Celtics": "BOS", "Brooklyn Nets": "BKN",
  "Charlotte Hornets": "CHA", "Chicago Bulls": "CHI", "Cleveland Cavaliers": "CLE",
  "Dallas Mavericks": "DAL", "Denver Nuggets": "DEN", "Detroit Pistons": "DET",
  "Golden State Warriors": "GSW", "Houston Rockets": "HOU", "Indiana Pacers": "IND",
  "Los Angeles Clippers": "LAC", "Los Angeles Lakers": "LAL", "Memphis Grizzlies": "MEM",
  "Miami Heat": "MIA", "Milwaukee Bucks": "MIL", "Minnesota Timberwolves": "MIN",
  "New Orleans Pelicans": "NOP", "New York Knicks": "NYK", "Oklahoma City Thunder": "OKC",
  "Orlando Magic": "ORL", "Philadelphia 76ers": "PHI", "Phoenix Suns": "PHX",
  "Portland Trail Blazers": "POR", "Sacramento Kings": "SAC", "San Antonio Spurs": "SAS",
  "Toronto Raptors": "TOR", "Utah Jazz": "UTA", "Washington Wizards": "WAS",
};

/** Nicknames that are more than the last word. */
const NICKNAME: Record<string, string> = {
  "Portland Trail Blazers": "Trail Blazers",
};

export function getTeam(full: string): Team {
  if (!ABBR[full]) {
    // Odds API college names end in a mascot. Keep the school, including State/St.
    const school = full.trim().replace(/\s+(?:(?:Crimson|Golden|Fighting|Nittany|Scarlet|Blue|Red|Demon|Ragin'|Rainbow)\s+)?\S+$/, "").trim() || full;
    const short = school.replace(/\bState\b/g, "St");
    return { full, short, place: school, abbr: school.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() };
  }
  const nick = NICKNAME[full] ?? full.split(" ").pop() ?? full;
  const place = full.endsWith(nick) ? full.slice(0, full.length - nick.length).trim() : "";
  const abbr = ABBR[full] ?? (place || full).replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase();
  return { full, short: nick, place: place || full, abbr };
}

export type TeamForm = "full" | "short" | "place" | "abbr";

export function teamLabel(full: string, form: TeamForm = "short"): string {
  return getTeam(full)[form];
}

/** "BOS @ NYK" for tight rows. */
export function compactMatchup(away: string, home: string): string {
  return `${getTeam(away).abbr} @ ${getTeam(home).abbr}`;
}
