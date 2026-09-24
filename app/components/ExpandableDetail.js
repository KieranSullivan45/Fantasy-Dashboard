"use client";
import { useId } from "react";
import { useDashboard, useViewState } from "../dashboard/DashboardShell.js";
export default function ExpandableDetail({ id, label = "Details", children, initial = false, className = "" }) {
  const { selection } = useDashboard(), control = useId();
  const scope = [selection.leagueId, selection.userId, selection.rosterId, selection.season].join(":");
  const [open, setOpen] = useViewState(`disclosure:${scope}:${id}`, initial);
  return <div className={`expandableDetail ${className}`}><button className="detailToggle" aria-expanded={open} aria-controls={control} onClick={() => setOpen(!open)}>{label} {open ? "−" : "+"}</button>{open ? <div id={control} className="detailBody">{children}</div> : null}</div>;
}
