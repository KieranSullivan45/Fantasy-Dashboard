import { discoverSleeper, publicSleeper, resolveSeason } from "../../../lib/accounts/sleeper.js";
import { getConfiguredLeagueIds, getConfiguredUsername } from "../../../lib/config.js";
import { getProvider, requestProvider } from "../../../lib/providers/index.js";
import { providerErrorResponse } from "../../../lib/providers/contracts.js";
export async function GET(request) {
  const p = new URL(request.url).searchParams;
  if ([...p.keys()].some(k => !["provider", "username", "user", "league", "season"].includes(k) || p.getAll(k).length !== 1)) return Response.json({ error: "Unknown or repeated discovery parameter" }, { status: 400 });
  let provider; try { provider = requestProvider(p); } catch(e) { return providerErrorResponse(e); }
  try {
    const hasQuery = p.has("username") || p.has("user") || p.has("league");
    const defaultUser = !hasQuery && getConfiguredUsername() ? await publicSleeper(`/user/${encodeURIComponent(getConfiguredUsername())}`).catch(() => null) : null;
    const result = hasQuery ? await provider.discoverLeagues({ username: p.get("username"), userId: p.get("user"), season: p.get("season"), leagueId: p.get("league") }) : {
      provider: "sleeper", season: resolveSeason(p.get("season"), await publicSleeper("/state/nfl")), defaults: { user: defaultUser?.user_id || null, leagues: getConfiguredLeagueIds() } };
    return Response.json({ schema_version: "accounts-1", ...result }, { headers: { "Cache-Control": "public, s-maxage=300", "X-Content-Type-Options": "nosniff" } });
  } catch (e) { return Response.json({ error: e.message }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
}
