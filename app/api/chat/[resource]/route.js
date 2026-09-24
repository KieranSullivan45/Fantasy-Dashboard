import { handleChatRequest } from "../../../../lib/chat-api.js";
export async function GET(request, { params }) { return handleChatRequest(request, (await params).resource); }
