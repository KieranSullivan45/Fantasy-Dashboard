export default function UsageTrend({ analytics, metric = "snap_share", label = "Snap %" }) {
  if (!analytics) return null;
  const history = analytics.history.slice(-6), isShare = metric.includes("share");
  const formatted = history.map(h => h[metric] == null ? "?" : (h[metric] * (isShare ? 100 : 1)).toFixed(isShare ? 0 : 1));
  return <span className="usageTrend" title={`Through week ${analytics.through_week}; recorded games only`}>
    {label}: {history.map((h, i) => <span key={h.game_id}>{i ? " → " : ""}<span title={`Week ${h.week}`}>{formatted[i]}</span></span>)}
    <span className="muted"> ({history.length} games{analytics.small_sample ? "; small sample" : ""})</span>
  </span>;
}
