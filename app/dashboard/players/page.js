import { Suspense } from "react";
import PlayersView from "./PlayersView.js";
export default function PlayersPage() { return <Suspense fallback={<p>Loading player view…</p>}><PlayersView /></Suspense>; }
