"use client";
import { useDashboard, useViewState, DataRequired, DecisionPending } from "../DashboardShell.js";
import SignalFeed from "../../components/SignalFeed.js";
export default function SignalsView() {
  const { data, decision } = useDashboard(), [filters, setFilters] = useViewState("signalFilters", { group: "ALL", page: 0 });
  return <><h1>Signals</h1>{!data ? <DataRequired /> : <><DecisionPending />{decision ? <SignalFeed data={decision} filters={filters} onFilters={setFilters} /> : null}</>}</>;
}
