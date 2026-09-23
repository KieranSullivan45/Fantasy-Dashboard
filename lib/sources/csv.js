// RFC 4180 fields (including quoted commas/newlines), with strict row widths.
export function parseCsv(text) {
  const rows = []; let row = [], field = "", quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === "," || char === "\n" || char === "\r")) {
      row.push(field); field = "";
      if (char !== ",") { if (row.some(value => value !== "")) rows.push(row); row = []; if (char === "\r" && text[i + 1] === "\n") i++; }
    } else field += char;
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  if (field || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift();
  if (!headers?.length || new Set(headers).size !== headers.length) throw new Error("Invalid CSV header");
  return { headers, rows: rows.map(values => {
    if (values.length !== headers.length) throw new Error("CSV row width mismatch");
    return Object.fromEntries(headers.map((key, index) => [key, values[index]]));
  }) };
}
