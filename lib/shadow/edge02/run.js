import { approvedContextProblem, buildEdge02Capture, appendEdge02Capture } from "./capture.js";
import { buildEdge02LineupCapture, appendEdge02LineupCapture } from "./lineup.js";

/**
 * Capture-worker entry for EDGE-02 (ADR 0014). Runs only for approved public Sleeper archive contexts, after the production
 * capture and the H9 shadow are written. It never throws: a failure is returned for logging and never fails production capture.
 */
export async function captureEdge02Shadow({ directory, decision, internals, h9, linkedCaptureId, approvedLeagueIds, classification = "prospective", clock = Date.now, env = process.env }) {
  const skipped = approvedContextProblem(decision, approvedLeagueIds);
  if (skipped) return { status: "skipped", reason: skipped };
  try {
    const capture = await buildEdge02Capture({ decision, internals, h9, classification, approvedLeagueIds, clock, env, linkedCaptureId });
    const candidates = await appendEdge02Capture(directory, capture, { approvedLeagueIds, wallClock: clock() });
    let lineup;
    try { lineup = await appendEdge02LineupCapture(directory, await buildEdge02LineupCapture({ decision, internals, candidateCapture: capture, classification, approvedLeagueIds, clock }), { approvedLeagueIds, wallClock: clock() }); }
    catch (error) { lineup = { status: "failed", error: error.message }; }
    return { status: "ok", candidates, lineup };
  } catch (error) { return { status: "failed", error: error.message }; }
}
