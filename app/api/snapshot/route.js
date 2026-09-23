import { handleSnapshotRequest } from "../../../lib/snapshot-api.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  return handleSnapshotRequest(request);
}
