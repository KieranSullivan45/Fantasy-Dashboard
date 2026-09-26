// POST /api/trade (V04-04): lazy, evaluation-only trade endpoint. No persistence, no provider writes.
// The client sends league identity and a TradeProposal of player ids only; every evaluation input (snapshot, values,
// replacement levels, protection evidence, capabilities) comes from the server's own decision state for one basis.
import { getConfiguredLeagueIds } from "./config.js";
import { decisionStateService } from "./decision-service.js";
import { acceptedLeague, requestIdentity } from "./accounts/query.js";
import { requestProvider } from "./providers/index.js";
import { ProviderError, providerErrorResponse } from "./providers/contracts.js";
import { dropProtections } from "./decision/add-drop.js";
import { decisionBasis } from "./decision/basis.js";
import { evaluateTradeFromInputs } from "./trade/evaluate.js";
import { PROTECTION_POPULATION, createTradeEvaluation, tradeError, validateTradeProposal } from "./trade/contracts.js";

export const TRADE_REQUEST_KEYS = Object.freeze(["provider", "league", "user", "roster", "season", "basis", "proposal"]);
export const PROTECTION_PRODUCER = "lib/decision/add-drop.js dropProtections";
const MAX_BODY_BYTES = 16384;
const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const isObject = v => v !== null && typeof v === "object" && !Array.isArray(v);
const reject = (error, status = 400) => Response.json({ error }, { status, headers: NO_STORE });
/** invalid/unsupported evaluations are 422 (STALE_BASIS 409); evaluated, blocked and withheld are 200. */
const statusCode = evaluation => evaluation.errors.some(e => e.code === "STALE_BASIS") ? 409 : ["invalid", "unsupported"].includes(evaluation.status) ? 422 : 200;
const evaluationResponse = evaluation => Response.json(evaluation, { status: statusCode(evaluation), headers: NO_STORE });
const requestedHorizon = proposal => (typeof proposal?.horizon === "string" && proposal.horizon ? proposal.horizon : null);

/**
 * Trade-engine inputs from one server-internal decision state. Protection evidence is `dropProtections` run on the
 * FULL internal contexts population, exactly as add/drop runs it; nothing is read from the public player_context subset.
 * Value-source metadata is read from the decision result, not copied from the snapshot, so the engine's cross-source
 * check stays meaningful. Placement eligibility is not supplied: no normalized source verifies it (unknown by contract).
 */
export function tradeInputsFromState({ decision, snapshot, contexts, levels, capabilities }) {
  const rostered = snapshot.rosters.flatMap(r => r.all_players || []);
  const versions = { model_version: decision.model_version, feature_version: decision.feature_version };
  const valueMetadata = { provider: decision.identity?.provider ?? null, league_id: decision.league.league_id, season: decision.league.season,
    week: decision.league.week, roster_positions: decision.league.roster_positions, roster_ids: (decision.team_strength_v2 || []).map(t => t.roster_id),
    identity_mode: decision.identity?.mode ?? null, selected_roster_id: decision.identity?.selected_roster_id ?? null, ...versions };
  const protectionMetadata = { provider: valueMetadata.provider, league_id: valueMetadata.league_id, season: valueMetadata.season, week: valueMetadata.week,
    roster_positions: decision.league.roster_positions, roster_ids: valueMetadata.roster_ids, ...versions };
  return {
    snapshot, capabilities,
    valueSource: { basis: decision.basis, metadata: valueMetadata, contexts, levels },
    protectionEvidence: { producer: PROTECTION_PRODUCER, population: PROTECTION_POPULATION, metadata: protectionMetadata,
      players: dropProtections(rostered, decision.league.roster_positions, contexts) },
  };
}

/** Reads and checks the request envelope. Returns `{ params, body }` or `{ response }`. */
async function readRequest(request) {
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return { response: reject("Content-Type must be application/json", 415) };
  let text;
  try { text = await request.text(); } catch { return { response: reject("Request body could not be read") }; }
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return { response: reject("Request body is too large", 413) };
  let body;
  try { body = JSON.parse(text); } catch { return { response: reject("Request body must be JSON") }; }
  if (!isObject(body)) return { response: reject("Request body must be a JSON object") };
  const unknown = Object.keys(body).filter(k => !TRADE_REQUEST_KEYS.includes(k)).sort();
  if (unknown.length) return { response: reject(`Unknown trade request field(s): ${unknown.join(", ")}. Only league identity and a proposal of player ids are accepted.`) };
  const params = new URLSearchParams();
  for (const key of ["provider", "league", "user", "roster", "season"]) {
    const value = body[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "string" || (["roster", "season"].includes(key) && Number.isSafeInteger(value))) params.set(key, String(value));
    else return { response: reject(`${key} must be a string`) };
  }
  if (body.basis !== undefined && (typeof body.basis !== "string" || !body.basis)) return { response: reject("basis must be a non-empty string") };
  if (!isObject(body.proposal)) return { response: reject("proposal is required") };
  return { params, body };
}

export async function handleTradeRequest(request, { leagueIds = getConfiguredLeagueIds(), build = decisionStateService } = {}) {
  const read = await readRequest(request);
  if (read.response) return read.response;
  const { params, body } = read;
  let provider; try { provider = requestProvider(params); } catch (e) { return providerErrorResponse(e); }
  const league = params.get("league");
  if (!league || !acceptedLeague(league, leagueIds)) return reject("Invalid or missing league id");
  let identity;
  try { identity = requestIdentity(params, league, leagueIds); } catch (e) { return reject(e.message); }

  // Whole-package structural validation before any league data is loaded (shape, horizon, assets, extra fields).
  const horizon = requestedHorizon(body.proposal);
  const structural = validateTradeProposal(body.proposal);
  if (!structural.ok) return evaluationResponse(createTradeEvaluation({ horizon, errors: structural.errors }));

  let state;
  try { state = await build(league, { identity, provider: provider.providerId }); }
  catch (e) {
    if (e instanceof ProviderError) return providerErrorResponse(e);
    return Response.json({ error: "Trade evaluation could not load league data. The league snapshot remains available.", league_id: league }, { status: 502, headers: NO_STORE });
  }
  if (!isObject(state?.decision) || !isObject(state.snapshot) || !isObject(state.contexts))
    return Response.json({ error: "Trade evaluation needs the complete internal decision context, which this provider did not supply.", league_id: league }, { status: 422, headers: NO_STORE });
  // Depth/VOR and forced drops need replacement levels, which need a complete available pool: refuse rather than withhold per side.
  if (state.capabilities?.tradeAnalysis?.status === "unsupported" || state.snapshot.coverage?.available_players?.complete === false)
    return providerErrorResponse(new ProviderError("UNSUPPORTED_FEATURE", state.snapshot.identity?.provider ?? provider.providerId,
      "Trade analysis needs replacement levels from a complete available-player pool; this league's available list is a provider-capped subset."));
  if (body.basis !== undefined && body.basis !== decisionBasis(state.snapshot))
    return evaluationResponse(createTradeEvaluation({ horizon, errors: [tradeError("STALE_BASIS", { field: "basis",
      message: "League state changed since this proposal was built. Refresh the league and rebuild the trade." })] }));
  return evaluationResponse(evaluateTradeFromInputs(tradeInputsFromState(state), body.proposal));
}
