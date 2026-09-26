import { handleTradeRequest } from "../../../lib/trade-api.js";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request) { return handleTradeRequest(request); }
