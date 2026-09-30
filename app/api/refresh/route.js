import { handleRefreshRequest } from "../../../lib/refresh-api.js";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
// POST only: a refresh changes in-memory provider state, so it is never reachable through GET.
export async function POST(request) { return handleRefreshRequest(request); }
