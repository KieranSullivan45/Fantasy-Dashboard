import { importObservations } from "../import.js";
export const importOwnership = (rows, scope) => importObservations(rows, "ownership", scope);
// Persistent history intentionally deferred. An absent baseline must not become 0% change.
export const ownershipContext = observation => ({ percent: observation?.value ?? null,
  platform: observation?.source_id ?? null, observed_at: observation?.published_at ?? null, change_percentage_points: null });
