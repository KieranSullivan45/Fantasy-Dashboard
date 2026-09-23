const DEFAULT_USERNAME = "Ksullz";
const DEFAULT_LEAGUE_IDS = [
  "1401373864818192384",
  "1395493939665989632",
];

export function getConfiguredUsername() {
  return (process.env.SLEEPER_USERNAME || DEFAULT_USERNAME).replace(/^@/, "").trim();
}

export function getConfiguredLeagueIds() {
  const raw = process.env.SLEEPER_LEAGUE_IDS;
  if (!raw) return DEFAULT_LEAGUE_IDS;
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function isConfiguredLeagueId(leagueId) {
  return getConfiguredLeagueIds().includes(String(leagueId));
}
