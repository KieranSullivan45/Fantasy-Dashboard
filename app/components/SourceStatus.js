export default function SourceStatus({ data }) {
  return <details className="card sourceStatus"><summary>Data sources, coverage and limitations</summary>
    <p className="muted">Historical statistics through week {data.coverage.statistics_through_week}. Sleeper supplies league state; nflverse supplies statistics and schedules; DynastyProcess/ffverse supplies player-ID mappings.</p>
    <ul>{data.sources.map(source => <li key={source.source_id}><strong>{source.source_id}</strong>: {source.status}
      {source.fetched_at ? ` · fetched ${new Date(source.fetched_at).toLocaleString()}` : ""}
      {source.warnings.length ? ` · ${source.warnings.join(" ")}` : ""}
      {source.url ? <> · <a href={source.url} target="_blank" rel="noreferrer">Source</a></> : null}</li>)}</ul>
    {data.warnings.map((warning, index) => <p className="muted" key={index}>{warning}</p>)}
    <p className="muted">D/ST and IDP historical scoring are unavailable. No paid providers, scraping, or ownership-history storage are enabled.</p>
  </details>;
}
