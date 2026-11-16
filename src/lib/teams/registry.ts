/** Team identity data only: no runtime, framework, network, or logo dependencies.
 * College coverage: SEC, Big Ten, Big 12, ACC football members plus Notre Dame.
 * ESPN is a comparison source, not an automatic authority for alternate colors.
 */
export type League = "NFL" | "NBA" | "NHL" | "MLB" | "NCAAF" | "NCAAB";
export type Conference = "SEC" | "Big Ten" | "Big 12" | "ACC" | "Independent";
export type TeamIdentity = { conference?: Conference; league: League; name: string; aliases: readonly string[]; abbr: string; primary: string; secondary: string };
const COLLEGE_TEAMS = [
  {
    "conference": "SEC",
    "name": "Alabama Crimson Tide",
    "aliases": [
      "Alabama"
    ],
    "abbr": "ALA",
    "primary": "#9E1B32",
    "secondary": "#FFFFFF"
  },
  {
    "conference": "SEC",
    "name": "Arkansas Razorbacks",
    "aliases": [
      "Arkansas"
    ],
    "abbr": "ARK",
    "primary": "#9D2235",
    "secondary": "#FFFFFF"
  },
  {
    "conference": "SEC",
    "name": "Auburn Tigers",
    "aliases": [
      "Auburn"
    ],
    "abbr": "AUB",
    "primary": "#0C2340",
    "secondary": "#E87722"
  },
  {
    "conference": "SEC",
    "name": "Florida Gators",
    "aliases": [
      "Florida"
    ],
    "abbr": "FLA",
    "primary": "#0021A5",
    "secondary": "#FA4616"
  },
  {
    "conference": "SEC",
    "name": "Georgia Bulldogs",
    "aliases": [
      "Georgia"
    ],
    "abbr": "UGA",
    "primary": "#BA0C2F",
    "secondary": "#000000"
  },
  {
    "conference": "SEC",
    "name": "Kentucky Wildcats",
    "aliases": [
      "Kentucky"
    ],
    "abbr": "UKY",
    "primary": "#0033A0",
    "secondary": "#FFFFFF"
  },
  {
    "conference": "SEC",
    "name": "LSU Tigers",
    "aliases": [
      "Louisiana State Tigers",
      "Louisiana State"
    ],
    "abbr": "LSU",
    "primary": "#461D7C",
    "secondary": "#FDD023"
  },
  {
    "conference": "SEC",
    "name": "Mississippi State Bulldogs",
    "aliases": [
      "Mississippi State",
      "Miss State Bulldogs"
    ],
    "abbr": "MSST",
    "primary": "#660000",
    "secondary": "#FFFFFF"
  },
  {
    "conference": "SEC",
    "name": "Missouri Tigers",
    "aliases": [
      "Missouri",
      "Mizzou Tigers",
      "Mizzou"
    ],
    "abbr": "MIZ",
    "primary": "#F1B82D",
    "secondary": "#000000"
  },
  {
    "conference": "SEC",
    "name": "Oklahoma Sooners",
    "aliases": [
      "Oklahoma"
    ],
    "abbr": "OKLA",
    "primary": "#841617",
    "secondary": "#FDF9D8"
  },
  {
    "conference": "SEC",
    "name": "Ole Miss Rebels",
    "aliases": [
      "Mississippi Rebels",
      "Mississippi",
      "Ole Miss"
    ],
    "abbr": "MISS",
    "primary": "#CE1126",
    "secondary": "#14213D"
  },
  {
    "conference": "SEC",
    "name": "South Carolina Gamecocks",
    "aliases": [
      "South Carolina"
    ],
    "abbr": "SCAR",
    "primary": "#73000A",
    "secondary": "#000000"
  },
  {
    "conference": "SEC",
    "name": "Tennessee Volunteers",
    "aliases": [
      "Tennessee"
    ],
    "abbr": "TENN",
    "primary": "#FF8200",
    "secondary": "#FFFFFF"
  },
  {
    "conference": "SEC",
    "name": "Texas Longhorns",
    "aliases": [
      "Texas"
    ],
    "abbr": "TEX",
    "primary": "#BF5700",
    "secondary": "#FFFFFF"
  },
  {
    "conference": "SEC",
    "name": "Texas A&M Aggies",
    "aliases": [
      "Texas A&M",
      "Texas AM Aggies"
    ],
    "abbr": "TAMU",
    "primary": "#500000",
    "secondary": "#FFFFFF"
  },
  {
    "conference": "SEC",
    "name": "Vanderbilt Commodores",
    "aliases": [
      "Vanderbilt"
    ],
    "abbr": "VAN",
    "primary": "#866D4B",
    "secondary": "#000000"
  },
  {
    "conference": "Big Ten",
    "name": "Illinois Fighting Illini",
    "aliases": [
      "Illinois"
    ],
    "abbr": "ILL",
    "primary": "#E84A27",
    "secondary": "#13294B"
  },
  {
    "conference": "Big Ten",
    "name": "Indiana Hoosiers",
    "aliases": [
      "Indiana"
    ],
    "abbr": "IND",
    "primary": "#990000",
    "secondary": "#EEEDEB"
  },
  {
    "conference": "Big Ten",
    "name": "Iowa Hawkeyes",
    "aliases": [
      "Iowa"
    ],
    "abbr": "IOWA",
    "primary": "#000000",
    "secondary": "#FFCD00"
  },
  {
    "conference": "Big Ten",
    "name": "Maryland Terrapins",
    "aliases": [
      "Maryland"
    ],
    "abbr": "UMD",
    "primary": "#E03A3E",
    "secondary": "#FFD520"
  },
  {
    "conference": "Big Ten",
    "name": "Michigan Wolverines",
    "aliases": [
      "Michigan"
    ],
    "abbr": "MICH",
    "primary": "#00274C",
    "secondary": "#FFCB05"
  },
  {
    "conference": "Big Ten",
    "name": "Michigan State Spartans",
    "aliases": [
      "Michigan State"
    ],
    "abbr": "MSU",
    "primary": "#18453B",
    "secondary": "#FFFFFF"
  },
  {
    "conference": "Big Ten",
    "name": "Minnesota Golden Gophers",
    "aliases": [
      "Minnesota"
    ],
    "abbr": "MINN",
    "primary": "#7A0019",
    "secondary": "#FFCC33"
  },
  {
    "conference": "Big Ten",
    "name": "Nebraska Cornhuskers",
    "aliases": [
      "Nebraska"
    ],
    "abbr": "NEB",
    "primary": "#E41C38",
    "secondary": "#FFFFFF"
  },
  {
    "conference": "Big Ten",
    "name": "Northwestern Wildcats",
    "aliases": [
      "Northwestern"
    ],
    "abbr": "NWU",
    "primary": "#4E2A84",
    "secondary": "#FFFFFF"
  },
  {
    "conference": "Big Ten",
    "name": "Ohio State Buckeyes",
    "aliases": [
      "Ohio State"
    ],
    "abbr": "OSU",
    "primary": "#BA0C2F",
    "secondary": "#A7B1B7"
  },
  {
    "conference": "Big Ten",
    "name": "Oregon Ducks",
    "aliases": [
      "Oregon"
    ],
    "abbr": "ORE",
    "primary": "#154733",
    "secondary": "#FEE123"
  },
  {
    "conference": "Big Ten",
    "name": "Penn State Nittany Lions",
    "aliases": [
      "Penn State",
      "Pennsylvania State Nittany Lions"
    ],
    "abbr": "PSU",
    "primary": "#041E42",
    "secondary": "#FFFFFF"
  },
  {
    "conference": "Big Ten",
    "name": "Purdue Boilermakers",
    "aliases": [
      "Purdue"
    ],
    "abbr": "PUR",
    "primary": "#CEB888",
    "secondary": "#000000"
  },
  {
    "conference": "Big Ten",
    "name": "Rutgers Scarlet Knights",
    "aliases": [
      "Rutgers"
    ],
    "abbr": "RUTG",
    "primary": "#CC0033",
    "secondary": "#FFFFFF"
  },
  {
    "conference": "Big Ten",
    "name": "UCLA Bruins",
    "aliases": [
      "UCLA",
      "California Los Angeles Bruins"
    ],
    "abbr": "UCLA",
    "primary": "#2D68C4",
    "secondary": "#F2A900"
  },
  {
    "conference": "Big Ten",
    "name": "USC Trojans",
    "aliases": [
      "USC",
      "Southern California Trojans",
      "Southern California"
    ],
    "abbr": "USC",
    "primary": "#990000",
    "secondary": "#FFC72C"
  },
  {
    "conference": "Big Ten",
    "name": "Washington Huskies",
    "aliases": [
      "Washington"
    ],
    "abbr": "WASH",
    "primary": "#4B2E83",
    "secondary": "#B7A57A"
  },
  {
    "conference": "Big Ten",
    "name": "Wisconsin Badgers",
    "aliases": [
      "Wisconsin"
    ],
    "abbr": "WIS",
    "primary": "#C5050C",
    "secondary": "#FFFFFF"
  },
  {
    "conference": "Big 12",
    "name": "Arizona Wildcats",
    "aliases": [
      "Arizona"
    ],
    "abbr": "ARIZ",
    "primary": "#AB0520",
    "secondary": "#0C234B"
  },
  {
    "conference": "Big 12",
    "name": "Arizona State Sun Devils",
    "aliases": [
      "Arizona State"
    ],
    "abbr": "ASU",
    "primary": "#8C1D40",
    "secondary": "#FFC627"
  },
  {
    "conference": "Big 12",
    "name": "Baylor Bears",
    "aliases": [
      "Baylor"
    ],
    "abbr": "BAY",
    "primary": "#154734",
    "secondary": "#FFB81C"
  },
  {
    "conference": "Big 12",
    "name": "Brigham Young Cougars",
    "aliases": [
      "BYU Cougars",
      "BYU",
      "Brigham Young"
    ],
    "abbr": "BYU",
    "primary": "#002E5D",
    "secondary": "#FFFFFF"
  },
  {
    "conference": "Big 12",
    "name": "Cincinnati Bearcats",
    "aliases": [
      "Cincinnati"
    ],
    "abbr": "CIN",
    "primary": "#E00122",
    "secondary": "#000000"
  },
  {
    "conference": "Big 12",
    "name": "Colorado Buffaloes",
    "aliases": [
      "Colorado"
    ],
    "abbr": "COLO",
    "primary": "#CFB87C",
    "secondary": "#000000"
  },
  {
    "conference": "Big 12",
    "name": "Houston Cougars",
    "aliases": [
      "Houston"
    ],
    "abbr": "HOU",
    "primary": "#C8102E",
    "secondary": "#FFFFFF"
  },
  {
    "conference": "Big 12",
    "name": "Iowa State Cyclones",
    "aliases": [
      "Iowa State"
    ],
    "abbr": "ISU",
    "primary": "#C8102E",
    "secondary": "#F1BE48"
  },
  {
    "conference": "Big 12",
    "name": "Kansas Jayhawks",
    "aliases": [
      "Kansas"
    ],
    "abbr": "KAN",
    "primary": "#0051BA",
    "secondary": "#E8000D"
  },
  {
    "conference": "Big 12",
    "name": "Kansas State Wildcats",
    "aliases": [
      "Kansas State"
    ],
    "abbr": "KSU",
    "primary": "#512888",
    "secondary": "#D1D1D1"
  },
  {
    "conference": "Big 12",
    "name": "Oklahoma State Cowboys",
    "aliases": [
      "Oklahoma State"
    ],
    "abbr": "OKST",
    "primary": "#FF7300",
    "secondary": "#000000"
  },
  {
    "conference": "Big 12",
    "name": "Texas Christian Horned Frogs",
    "aliases": [
      "TCU Horned Frogs",
      "TCU",
      "Texas Christian"
    ],
    "abbr": "TCU",
    "primary": "#4D1979",
    "secondary": "#A3A9AC"
  },
  {
    "conference": "Big 12",
    "name": "Texas Tech Red Raiders",
    "aliases": [
      "Texas Tech"
    ],
    "abbr": "TTU",
    "primary": "#CC0000",
    "secondary": "#000000"
  },
  {
    "conference": "Big 12",
    "name": "UCF Knights",
    "aliases": [
      "UCF",
      "Central Florida Knights",
      "Central Florida"
    ],
    "abbr": "UCF",
    "primary": "#BA9B37",
    "secondary": "#000000"
  },
  {
    "conference": "Big 12",
    "name": "Utah Utes",
    "aliases": [
      "Utah"
    ],
    "abbr": "UTAH",
    "primary": "#CC0000",
    "secondary": "#FFFFFF"
  },
  {
    "conference": "Big 12",
    "name": "West Virginia Mountaineers",
    "aliases": [
      "West Virginia"
    ],
    "abbr": "WVU",
    "primary": "#002855",
    "secondary": "#EAAA00"
  },
  {
    "conference": "ACC",
    "name": "Boston College Eagles",
    "aliases": [
      "Boston College"
    ],
    "abbr": "BCOL",
    "primary": "#98002E",
    "secondary": "#BC9B6A"
  },
  {
    "conference": "ACC",
    "name": "California Golden Bears",
    "aliases": [
      "Cal Golden Bears",
      "Cal",
      "California"
    ],
    "abbr": "CAL",
    "primary": "#003262",
    "secondary": "#FDB515"
  },
  {
    "conference": "ACC",
    "name": "Clemson Tigers",
    "aliases": [
      "Clemson"
    ],
    "abbr": "CLEM",
    "primary": "#F56600",
    "secondary": "#522D80"
  },
  {
    "conference": "ACC",
    "name": "Duke Blue Devils",
    "aliases": [
      "Duke"
    ],
    "abbr": "DUKE",
    "primary": "#003087",
    "secondary": "#FFFFFF"
  },
  {
    "conference": "ACC",
    "name": "Florida State Seminoles",
    "aliases": [
      "Florida State"
    ],
    "abbr": "FSU",
    "primary": "#782F40",
    "secondary": "#CEB888"
  },
  {
    "conference": "ACC",
    "name": "Georgia Tech Yellow Jackets",
    "aliases": [
      "Georgia Tech"
    ],
    "abbr": "GTCH",
    "primary": "#B3A369",
    "secondary": "#003057"
  },
  {
    "conference": "ACC",
    "name": "Louisville Cardinals",
    "aliases": [
      "Louisville"
    ],
    "abbr": "LOU",
    "primary": "#AD0000",
    "secondary": "#000000"
  },
  {
    "conference": "ACC",
    "name": "Miami Hurricanes",
    "aliases": [
      "Miami (FL) Hurricanes",
      "Miami (FL)",
      "Miami Florida Hurricanes"
    ],
    "abbr": "MIA",
    "primary": "#F47321",
    "secondary": "#005030"
  },
  {
    "conference": "ACC",
    "name": "NC State Wolfpack",
    "aliases": [
      "North Carolina State Wolfpack",
      "NC State",
      "North Carolina State"
    ],
    "abbr": "NCSU",
    "primary": "#CC0000",
    "secondary": "#000000"
  },
  {
    "conference": "ACC",
    "name": "North Carolina Tar Heels",
    "aliases": [
      "North Carolina"
    ],
    "abbr": "UNC",
    "primary": "#7BAFD4",
    "secondary": "#FFFFFF"
  },
  {
    "conference": "ACC",
    "name": "Pittsburgh Panthers",
    "aliases": [
      "Pitt Panthers",
      "Pitt",
      "Pittsburgh"
    ],
    "abbr": "PITT",
    "primary": "#003594",
    "secondary": "#FFB81C"
  },
  {
    "conference": "ACC",
    "name": "SMU Mustangs",
    "aliases": [
      "Southern Methodist Mustangs",
      "Southern Methodist",
      "SMU"
    ],
    "abbr": "SMU",
    "primary": "#C8102E",
    "secondary": "#0033A0"
  },
  {
    "conference": "ACC",
    "name": "Stanford Cardinal",
    "aliases": [
      "Stanford"
    ],
    "abbr": "STAN",
    "primary": "#8C1515",
    "secondary": "#FFFFFF"
  },
  {
    "conference": "ACC",
    "name": "Syracuse Orange",
    "aliases": [
      "Syracuse"
    ],
    "abbr": "SYR",
    "primary": "#F76900",
    "secondary": "#000E54"
  },
  {
    "conference": "ACC",
    "name": "Virginia Cavaliers",
    "aliases": [
      "Virginia"
    ],
    "abbr": "UVA",
    "primary": "#232D4B",
    "secondary": "#F84C1E"
  },
  {
    "conference": "ACC",
    "name": "Virginia Tech Hokies",
    "aliases": [
      "Virginia Tech"
    ],
    "abbr": "VTCH",
    "primary": "#630031",
    "secondary": "#CF4420"
  },
  {
    "conference": "ACC",
    "name": "Wake Forest Demon Deacons",
    "aliases": [
      "Wake Forest"
    ],
    "abbr": "WAKE",
    "primary": "#9E7E38",
    "secondary": "#000000"
  },
  {
    "conference": "Independent",
    "name": "Notre Dame Fighting Irish",
    "aliases": [
      "Notre Dame"
    ],
    "abbr": "NDAM",
    "primary": "#0C2340",
    "secondary": "#C99700"
  }
] as const satisfies readonly Omit<TeamIdentity, "league">[];

export const TEAMS: readonly TeamIdentity[] = [
  {
    "league": "NFL",
    "name": "Arizona Cardinals",
    "aliases": [],
    "abbr": "ARI",
    "primary": "#97233F",
    "secondary": "#FFB612"
  },
  {
    "league": "NFL",
    "name": "Atlanta Falcons",
    "aliases": [],
    "abbr": "ATL",
    "primary": "#A71930",
    "secondary": "#000000"
  },
  {
    "league": "NFL",
    "name": "Baltimore Ravens",
    "aliases": [],
    "abbr": "BAL",
    "primary": "#241773",
    "secondary": "#9E7C0C"
  },
  {
    "league": "NFL",
    "name": "Buffalo Bills",
    "aliases": [],
    "abbr": "BUF",
    "primary": "#00338D",
    "secondary": "#C60C30"
  },
  {
    "league": "NFL",
    "name": "Carolina Panthers",
    "aliases": [],
    "abbr": "CAR",
    "primary": "#0085CA",
    "secondary": "#101820"
  },
  {
    "league": "NFL",
    "name": "Chicago Bears",
    "aliases": [],
    "abbr": "CHI",
    "primary": "#0B162A",
    "secondary": "#C83803"
  },
  {
    "league": "NFL",
    "name": "Cincinnati Bengals",
    "aliases": [],
    "abbr": "CIN",
    "primary": "#FB4F14",
    "secondary": "#000000"
  },
  {
    "league": "NFL",
    "name": "Cleveland Browns",
    "aliases": [],
    "abbr": "CLE",
    "primary": "#311D00",
    "secondary": "#FF3C00"
  },
  {
    "league": "NFL",
    "name": "Dallas Cowboys",
    "aliases": [],
    "abbr": "DAL",
    "primary": "#003594",
    "secondary": "#869397"
  },
  {
    "league": "NFL",
    "name": "Denver Broncos",
    "aliases": [],
    "abbr": "DEN",
    "primary": "#FB4F14",
    "secondary": "#002244"
  },
  {
    "league": "NFL",
    "name": "Detroit Lions",
    "aliases": [],
    "abbr": "DET",
    "primary": "#0076B6",
    "secondary": "#B0B7BC"
  },
  {
    "league": "NFL",
    "name": "Green Bay Packers",
    "aliases": [],
    "abbr": "GB",
    "primary": "#203731",
    "secondary": "#FFB612"
  },
  {
    "league": "NFL",
    "name": "Houston Texans",
    "aliases": [],
    "abbr": "HOU",
    "primary": "#03202F",
    "secondary": "#A71930"
  },
  {
    "league": "NFL",
    "name": "Indianapolis Colts",
    "aliases": [],
    "abbr": "IND",
    "primary": "#002C5F",
    "secondary": "#A2AAAD"
  },
  {
    "league": "NFL",
    "name": "Jacksonville Jaguars",
    "aliases": [],
    "abbr": "JAX",
    "primary": "#006778",
    "secondary": "#D7A22A"
  },
  {
    "league": "NFL",
    "name": "Kansas City Chiefs",
    "aliases": [],
    "abbr": "KC",
    "primary": "#E31837",
    "secondary": "#FFB81C"
  },
  {
    "league": "NFL",
    "name": "Las Vegas Raiders",
    "aliases": [],
    "abbr": "LV",
    "primary": "#000000",
    "secondary": "#A5ACAF"
  },
  {
    "league": "NFL",
    "name": "Los Angeles Chargers",
    "aliases": [
      "LA Chargers"
    ],
    "abbr": "LAC",
    "primary": "#0080C6",
    "secondary": "#FFC20E"
  },
  {
    "league": "NFL",
    "name": "Los Angeles Rams",
    "aliases": [
      "LA Rams"
    ],
    "abbr": "LAR",
    "primary": "#003594",
    "secondary": "#FFA300"
  },
  {
    "league": "NFL",
    "name": "Miami Dolphins",
    "aliases": [],
    "abbr": "MIA",
    "primary": "#008E97",
    "secondary": "#FC4C02"
  },
  {
    "league": "NFL",
    "name": "Minnesota Vikings",
    "aliases": [],
    "abbr": "MIN",
    "primary": "#4F2683",
    "secondary": "#FFC62F"
  },
  {
    "league": "NFL",
    "name": "New England Patriots",
    "aliases": [],
    "abbr": "NE",
    "primary": "#002244",
    "secondary": "#C60C30"
  },
  {
    "league": "NFL",
    "name": "New Orleans Saints",
    "aliases": [],
    "abbr": "NO",
    "primary": "#D3BC8D",
    "secondary": "#101820"
  },
  {
    "league": "NFL",
    "name": "New York Giants",
    "aliases": [],
    "abbr": "NYG",
    "primary": "#0B2265",
    "secondary": "#A71930"
  },
  {
    "league": "NFL",
    "name": "New York Jets",
    "aliases": [],
    "abbr": "NYJ",
    "primary": "#125740",
    "secondary": "#FFFFFF"
  },
  {
    "league": "NFL",
    "name": "Philadelphia Eagles",
    "aliases": [],
    "abbr": "PHI",
    "primary": "#004C54",
    "secondary": "#A5ACAF"
  },
  {
    "league": "NFL",
    "name": "Pittsburgh Steelers",
    "aliases": [],
    "abbr": "PIT",
    "primary": "#101820",
    "secondary": "#FFB612"
  },
  {
    "league": "NFL",
    "name": "San Francisco 49ers",
    "aliases": [],
    "abbr": "SF",
    "primary": "#AA0000",
    "secondary": "#B3995D"
  },
  {
    "league": "NFL",
    "name": "Seattle Seahawks",
    "aliases": [],
    "abbr": "SEA",
    "primary": "#002244",
    "secondary": "#69BE28"
  },
  {
    "league": "NFL",
    "name": "Tampa Bay Buccaneers",
    "aliases": [],
    "abbr": "TB",
    "primary": "#D50A0A",
    "secondary": "#34302B"
  },
  {
    "league": "NFL",
    "name": "Tennessee Titans",
    "aliases": [],
    "abbr": "TEN",
    "primary": "#0C2340",
    "secondary": "#4B92DB"
  },
  {
    "league": "NFL",
    "name": "Washington Commanders",
    "aliases": [],
    "abbr": "WAS",
    "primary": "#5A1414",
    "secondary": "#FFB612"
  },
  {
    "league": "NBA",
    "name": "Atlanta Hawks",
    "aliases": [],
    "abbr": "ATL",
    "primary": "#E03A3E",
    "secondary": "#FDB927"
  },
  {
    "league": "NBA",
    "name": "Boston Celtics",
    "aliases": [],
    "abbr": "BOS",
    "primary": "#007A33",
    "secondary": "#BA9653"
  },
  {
    "league": "NBA",
    "name": "Brooklyn Nets",
    "aliases": [],
    "abbr": "BKN",
    "primary": "#000000",
    "secondary": "#FFFFFF"
  },
  {
    "league": "NBA",
    "name": "Charlotte Hornets",
    "aliases": [],
    "abbr": "CHA",
    "primary": "#1D1160",
    "secondary": "#00788C"
  },
  {
    "league": "NBA",
    "name": "Chicago Bulls",
    "aliases": [],
    "abbr": "CHI",
    "primary": "#CE1141",
    "secondary": "#000000"
  },
  {
    "league": "NBA",
    "name": "Cleveland Cavaliers",
    "aliases": [],
    "abbr": "CLE",
    "primary": "#860038",
    "secondary": "#FDBB30"
  },
  {
    "league": "NBA",
    "name": "Dallas Mavericks",
    "aliases": [],
    "abbr": "DAL",
    "primary": "#00538C",
    "secondary": "#B8C4CA"
  },
  {
    "league": "NBA",
    "name": "Denver Nuggets",
    "aliases": [],
    "abbr": "DEN",
    "primary": "#0E2240",
    "secondary": "#FEC524"
  },
  {
    "league": "NBA",
    "name": "Detroit Pistons",
    "aliases": [],
    "abbr": "DET",
    "primary": "#C8102E",
    "secondary": "#1D42BA"
  },
  {
    "league": "NBA",
    "name": "Golden State Warriors",
    "aliases": [],
    "abbr": "GSW",
    "primary": "#1D428A",
    "secondary": "#FFC72C"
  },
  {
    "league": "NBA",
    "name": "Houston Rockets",
    "aliases": [],
    "abbr": "HOU",
    "primary": "#CE1141",
    "secondary": "#000000"
  },
  {
    "league": "NBA",
    "name": "Indiana Pacers",
    "aliases": [],
    "abbr": "IND",
    "primary": "#002D62",
    "secondary": "#FDBB30"
  },
  {
    "league": "NBA",
    "name": "Los Angeles Clippers",
    "aliases": [
      "LA Clippers"
    ],
    "abbr": "LAC",
    "primary": "#1D428A",
    "secondary": "#C8102E"
  },
  {
    "league": "NBA",
    "name": "Los Angeles Lakers",
    "aliases": [
      "LA Lakers"
    ],
    "abbr": "LAL",
    "primary": "#552583",
    "secondary": "#FDB927"
  },
  {
    "league": "NBA",
    "name": "Memphis Grizzlies",
    "aliases": [],
    "abbr": "MEM",
    "primary": "#5D76A9",
    "secondary": "#12173F"
  },
  {
    "league": "NBA",
    "name": "Miami Heat",
    "aliases": [],
    "abbr": "MIA",
    "primary": "#98002E",
    "secondary": "#F9A01B"
  },
  {
    "league": "NBA",
    "name": "Milwaukee Bucks",
    "aliases": [],
    "abbr": "MIL",
    "primary": "#00471B",
    "secondary": "#EEE1C6"
  },
  {
    "league": "NBA",
    "name": "Minnesota Timberwolves",
    "aliases": [],
    "abbr": "MIN",
    "primary": "#0C2340",
    "secondary": "#78BE20"
  },
  {
    "league": "NBA",
    "name": "New Orleans Pelicans",
    "aliases": [],
    "abbr": "NOP",
    "primary": "#0C2340",
    "secondary": "#C8102E"
  },
  {
    "league": "NBA",
    "name": "New York Knicks",
    "aliases": [],
    "abbr": "NYK",
    "primary": "#006BB6",
    "secondary": "#F58426"
  },
  {
    "league": "NBA",
    "name": "Oklahoma City Thunder",
    "aliases": [],
    "abbr": "OKC",
    "primary": "#007AC1",
    "secondary": "#EF3B24"
  },
  {
    "league": "NBA",
    "name": "Orlando Magic",
    "aliases": [],
    "abbr": "ORL",
    "primary": "#0077C0",
    "secondary": "#C4CED4"
  },
  {
    "league": "NBA",
    "name": "Philadelphia 76ers",
    "aliases": [],
    "abbr": "PHI",
    "primary": "#006BB6",
    "secondary": "#ED174C"
  },
  {
    "league": "NBA",
    "name": "Phoenix Suns",
    "aliases": [],
    "abbr": "PHX",
    "primary": "#1D1160",
    "secondary": "#E56020"
  },
  {
    "league": "NBA",
    "name": "Portland Trail Blazers",
    "aliases": [],
    "abbr": "POR",
    "primary": "#E03A3E",
    "secondary": "#000000"
  },
  {
    "league": "NBA",
    "name": "Sacramento Kings",
    "aliases": [],
    "abbr": "SAC",
    "primary": "#5A2D81",
    "secondary": "#63727A"
  },
  {
    "league": "NBA",
    "name": "San Antonio Spurs",
    "aliases": [],
    "abbr": "SAS",
    "primary": "#000000",
    "secondary": "#C4CED4"
  },
  {
    "league": "NBA",
    "name": "Toronto Raptors",
    "aliases": [],
    "abbr": "TOR",
    "primary": "#CE1141",
    "secondary": "#000000"
  },
  {
    "league": "NBA",
    "name": "Utah Jazz",
    "aliases": [],
    "abbr": "UTA",
    "primary": "#4E008E",
    "secondary": "#71C5E8"
  },
  {
    "league": "NBA",
    "name": "Washington Wizards",
    "aliases": [],
    "abbr": "WAS",
    "primary": "#002B5C",
    "secondary": "#E31837"
  },
  {
    "league": "NHL",
    "name": "Anaheim Ducks",
    "aliases": [],
    "abbr": "ANA",
    "primary": "#F47A38",
    "secondary": "#B9975B"
  },
  {
    "league": "NHL",
    "name": "Boston Bruins",
    "aliases": [],
    "abbr": "BOS",
    "primary": "#000000",
    "secondary": "#FFB81C"
  },
  {
    "league": "NHL",
    "name": "Buffalo Sabres",
    "aliases": [],
    "abbr": "BUF",
    "primary": "#003087",
    "secondary": "#FFB81C"
  },
  {
    "league": "NHL",
    "name": "Calgary Flames",
    "aliases": [],
    "abbr": "CGY",
    "primary": "#D2001C",
    "secondary": "#FAAF19"
  },
  {
    "league": "NHL",
    "name": "Carolina Hurricanes",
    "aliases": [],
    "abbr": "CAR",
    "primary": "#CC0000",
    "secondary": "#000000"
  },
  {
    "league": "NHL",
    "name": "Chicago Blackhawks",
    "aliases": [],
    "abbr": "CHI",
    "primary": "#CF0A2C",
    "secondary": "#000000"
  },
  {
    "league": "NHL",
    "name": "Colorado Avalanche",
    "aliases": [],
    "abbr": "COL",
    "primary": "#6F263D",
    "secondary": "#236192"
  },
  {
    "league": "NHL",
    "name": "Columbus Blue Jackets",
    "aliases": [],
    "abbr": "CBJ",
    "primary": "#002654",
    "secondary": "#CE1126"
  },
  {
    "league": "NHL",
    "name": "Dallas Stars",
    "aliases": [],
    "abbr": "DAL",
    "primary": "#006847",
    "secondary": "#8F8F8C"
  },
  {
    "league": "NHL",
    "name": "Detroit Red Wings",
    "aliases": [],
    "abbr": "DET",
    "primary": "#CE1126",
    "secondary": "#FFFFFF"
  },
  {
    "league": "NHL",
    "name": "Edmonton Oilers",
    "aliases": [],
    "abbr": "EDM",
    "primary": "#041E42",
    "secondary": "#FF4C00"
  },
  {
    "league": "NHL",
    "name": "Florida Panthers",
    "aliases": [],
    "abbr": "FLA",
    "primary": "#C8102E",
    "secondary": "#041E42"
  },
  {
    "league": "NHL",
    "name": "Los Angeles Kings",
    "aliases": [
      "LA Kings"
    ],
    "abbr": "LA",
    "primary": "#111111",
    "secondary": "#A2AAAD"
  },
  {
    "league": "NHL",
    "name": "Minnesota Wild",
    "aliases": [],
    "abbr": "MIN",
    "primary": "#154734",
    "secondary": "#A6192E"
  },
  {
    "league": "NHL",
    "name": "Montreal Canadiens",
    "aliases": [],
    "abbr": "MTL",
    "primary": "#AF1E2D",
    "secondary": "#192168"
  },
  {
    "league": "NHL",
    "name": "Nashville Predators",
    "aliases": [],
    "abbr": "NSH",
    "primary": "#FFB81C",
    "secondary": "#041E42"
  },
  {
    "league": "NHL",
    "name": "New Jersey Devils",
    "aliases": [],
    "abbr": "NJ",
    "primary": "#CE1126",
    "secondary": "#000000"
  },
  {
    "league": "NHL",
    "name": "New York Islanders",
    "aliases": [],
    "abbr": "NYI",
    "primary": "#00539B",
    "secondary": "#F47D30"
  },
  {
    "league": "NHL",
    "name": "New York Rangers",
    "aliases": [],
    "abbr": "NYR",
    "primary": "#0038A8",
    "secondary": "#CE1126"
  },
  {
    "league": "NHL",
    "name": "Ottawa Senators",
    "aliases": [],
    "abbr": "OTT",
    "primary": "#C52032",
    "secondary": "#C2912C"
  },
  {
    "league": "NHL",
    "name": "Philadelphia Flyers",
    "aliases": [],
    "abbr": "PHI",
    "primary": "#F74902",
    "secondary": "#000000"
  },
  {
    "league": "NHL",
    "name": "Pittsburgh Penguins",
    "aliases": [],
    "abbr": "PIT",
    "primary": "#000000",
    "secondary": "#FCB514"
  },
  {
    "league": "NHL",
    "name": "San Jose Sharks",
    "aliases": [],
    "abbr": "SJ",
    "primary": "#006D75",
    "secondary": "#EA7200"
  },
  {
    "league": "NHL",
    "name": "Seattle Kraken",
    "aliases": [],
    "abbr": "SEA",
    "primary": "#001628",
    "secondary": "#99D9D9"
  },
  {
    "league": "NHL",
    "name": "St. Louis Blues",
    "aliases": [],
    "abbr": "STL",
    "primary": "#002F87",
    "secondary": "#FCB514"
  },
  {
    "league": "NHL",
    "name": "Tampa Bay Lightning",
    "aliases": [],
    "abbr": "TB",
    "primary": "#002868",
    "secondary": "#FFFFFF"
  },
  {
    "league": "NHL",
    "name": "Toronto Maple Leafs",
    "aliases": [],
    "abbr": "TOR",
    "primary": "#00205B",
    "secondary": "#FFFFFF"
  },
  {
    "league": "NHL",
    "name": "Utah Mammoth",
    "aliases": [
      "Utah Hockey Club"
    ],
    "abbr": "UTA",
    "primary": "#6CACE4",
    "secondary": "#000000"
  },
  {
    "league": "NHL",
    "name": "Vancouver Canucks",
    "aliases": [],
    "abbr": "VAN",
    "primary": "#00205B",
    "secondary": "#00843D"
  },
  {
    "league": "NHL",
    "name": "Vegas Golden Knights",
    "aliases": [],
    "abbr": "VGK",
    "primary": "#B4975A",
    "secondary": "#333F42"
  },
  {
    "league": "NHL",
    "name": "Washington Capitals",
    "aliases": [],
    "abbr": "WSH",
    "primary": "#C8102E",
    "secondary": "#041E42"
  },
  {
    "league": "NHL",
    "name": "Winnipeg Jets",
    "aliases": [],
    "abbr": "WPG",
    "primary": "#041E42",
    "secondary": "#004C97"
  },
  {
    "league": "MLB",
    "name": "Arizona Diamondbacks",
    "aliases": [],
    "abbr": "ARI",
    "primary": "#A71930",
    "secondary": "#30CED8"
  },
  {
    "league": "MLB",
    "name": "Atlanta Braves",
    "aliases": [],
    "abbr": "ATL",
    "primary": "#13274F",
    "secondary": "#CE1141"
  },
  {
    "league": "MLB",
    "name": "Baltimore Orioles",
    "aliases": [],
    "abbr": "BAL",
    "primary": "#DF4601",
    "secondary": "#000000"
  },
  {
    "league": "MLB",
    "name": "Boston Red Sox",
    "aliases": [],
    "abbr": "BOS",
    "primary": "#0C2340",
    "secondary": "#BD3039"
  },
  {
    "league": "MLB",
    "name": "Chicago Cubs",
    "aliases": [],
    "abbr": "CHC",
    "primary": "#0E3386",
    "secondary": "#CC3433"
  },
  {
    "league": "MLB",
    "name": "Chicago White Sox",
    "aliases": [],
    "abbr": "CHW",
    "primary": "#27251F",
    "secondary": "#C4CED4"
  },
  {
    "league": "MLB",
    "name": "Cincinnati Reds",
    "aliases": [],
    "abbr": "CIN",
    "primary": "#C6011F",
    "secondary": "#000000"
  },
  {
    "league": "MLB",
    "name": "Cleveland Guardians",
    "aliases": [],
    "abbr": "CLE",
    "primary": "#00385D",
    "secondary": "#E50022"
  },
  {
    "league": "MLB",
    "name": "Colorado Rockies",
    "aliases": [],
    "abbr": "COL",
    "primary": "#33006F",
    "secondary": "#C4CED4"
  },
  {
    "league": "MLB",
    "name": "Detroit Tigers",
    "aliases": [],
    "abbr": "DET",
    "primary": "#0C2340",
    "secondary": "#FA4616"
  },
  {
    "league": "MLB",
    "name": "Houston Astros",
    "aliases": [],
    "abbr": "HOU",
    "primary": "#002D62",
    "secondary": "#EB6E1F"
  },
  {
    "league": "MLB",
    "name": "Kansas City Royals",
    "aliases": [],
    "abbr": "KC",
    "primary": "#004687",
    "secondary": "#BD9B60"
  },
  {
    "league": "MLB",
    "name": "Los Angeles Angels",
    "aliases": [
      "LA Angels"
    ],
    "abbr": "LAA",
    "primary": "#BA0021",
    "secondary": "#003263"
  },
  {
    "league": "MLB",
    "name": "Los Angeles Dodgers",
    "aliases": [
      "LA Dodgers"
    ],
    "abbr": "LAD",
    "primary": "#005A9C",
    "secondary": "#EF3E42"
  },
  {
    "league": "MLB",
    "name": "Miami Marlins",
    "aliases": [],
    "abbr": "MIA",
    "primary": "#00A3E0",
    "secondary": "#EF3340"
  },
  {
    "league": "MLB",
    "name": "Milwaukee Brewers",
    "aliases": [],
    "abbr": "MIL",
    "primary": "#12284B",
    "secondary": "#FFC52F"
  },
  {
    "league": "MLB",
    "name": "Minnesota Twins",
    "aliases": [],
    "abbr": "MIN",
    "primary": "#002B5C",
    "secondary": "#D31145"
  },
  {
    "league": "MLB",
    "name": "New York Mets",
    "aliases": [],
    "abbr": "NYM",
    "primary": "#002D72",
    "secondary": "#FF5910"
  },
  {
    "league": "MLB",
    "name": "New York Yankees",
    "aliases": [],
    "abbr": "NYY",
    "primary": "#003087",
    "secondary": "#C4CED3"
  },
  {
    "league": "MLB",
    "name": "Athletics",
    "aliases": [
      "Oakland Athletics",
      "Sacramento Athletics"
    ],
    "abbr": "ATH",
    "primary": "#003831",
    "secondary": "#EFB21E"
  },
  {
    "league": "MLB",
    "name": "Philadelphia Phillies",
    "aliases": [],
    "abbr": "PHI",
    "primary": "#E81828",
    "secondary": "#002D72"
  },
  {
    "league": "MLB",
    "name": "Pittsburgh Pirates",
    "aliases": [],
    "abbr": "PIT",
    "primary": "#27251F",
    "secondary": "#FDB827"
  },
  {
    "league": "MLB",
    "name": "San Diego Padres",
    "aliases": [],
    "abbr": "SD",
    "primary": "#2F241D",
    "secondary": "#FFC425"
  },
  {
    "league": "MLB",
    "name": "San Francisco Giants",
    "aliases": [],
    "abbr": "SF",
    "primary": "#27251F",
    "secondary": "#FD5A1E"
  },
  {
    "league": "MLB",
    "name": "Seattle Mariners",
    "aliases": [],
    "abbr": "SEA",
    "primary": "#0C2C56",
    "secondary": "#005C5C"
  },
  {
    "league": "MLB",
    "name": "St. Louis Cardinals",
    "aliases": [],
    "abbr": "STL",
    "primary": "#C41E3A",
    "secondary": "#0C2340"
  },
  {
    "league": "MLB",
    "name": "Tampa Bay Rays",
    "aliases": [],
    "abbr": "TB",
    "primary": "#092C5C",
    "secondary": "#8FBCE6"
  },
  {
    "league": "MLB",
    "name": "Texas Rangers",
    "aliases": [],
    "abbr": "TEX",
    "primary": "#003278",
    "secondary": "#C0111F"
  },
  {
    "league": "MLB",
    "name": "Toronto Blue Jays",
    "aliases": [],
    "abbr": "TOR",
    "primary": "#134A8E",
    "secondary": "#E8291C"
  },
  {
    "league": "MLB",
    "name": "Washington Nationals",
    "aliases": [],
    "abbr": "WSH",
    "primary": "#AB0003",
    "secondary": "#14225A"
  },
  ...(["NCAAF", "NCAAB"] as const).flatMap(league => COLLEGE_TEAMS.map(team => ({
    ...team, league, conference: team.conference === "Independent" && league === "NCAAB" ? "ACC" as const : team.conference,
  })))
];

export const SPORT_LEAGUES: Readonly<Record<string, League>> = {
  americanfootball_nfl: "NFL", basketball_nba: "NBA", icehockey_nhl: "NHL",
  baseball_mlb: "MLB", americanfootball_ncaaf: "NCAAF", basketball_ncaab: "NCAAB",
};
export function normalizeTeamName(name: string): string {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
const index = new Map<string, TeamIdentity[]>();
for (const team of TEAMS) {
  for (const key of new Set([team.name, ...team.aliases, team.abbr].map(normalizeTeamName))) {
    index.set(key, [...(index.get(key) ?? []), team]);
  }
}
/** Unscoped ambiguous abbreviations intentionally do not resolve. */
export function lookupTeam(name: string, sportKey?: string): TeamIdentity | undefined {
  const candidates = index.get(normalizeTeamName(name)) ?? [];
  if (sportKey !== undefined) return candidates.find(t => t.league === SPORT_LEAGUES[sportKey]);
  return candidates.length === 1 ? candidates[0] : undefined;
}
