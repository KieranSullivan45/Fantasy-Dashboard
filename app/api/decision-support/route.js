import { handleDecisionRequest } from "../../../lib/decision-api.js";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request) { return handleDecisionRequest(request); }
