import { importObservations } from "../import.js";
export const importProjections = (rows, scope) => importObservations(rows, "projections", scope);
