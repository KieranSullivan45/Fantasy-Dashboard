import { handlePrivateLeagueRequest } from "../../../lib/private-league-api.js";
export const dynamic = "force-dynamic";
export async function GET(request) { return handlePrivateLeagueRequest(request); }
