import installation from "../config/installation.json" with { type: "json" };

export function getConfiguredUsername() {
  return (process.env.SLEEPER_USER_ID || process.env.SLEEPER_USERNAME || installation.provider_user_id || "").replace(/^@/, "").trim();
}

export function getConfiguredLeagueIds() {
  const raw = process.env.SLEEPER_LEAGUE_IDS;
  if (raw == null) return installation.league_ids || [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function archiveConfig() { return { repository: process.env.ARCHIVE_REPOSITORY || installation.archive_repository, branch: installation.archive_branch }; }

export function isConfiguredLeagueId(leagueId) {
  return getConfiguredLeagueIds().includes(String(leagueId));
}
