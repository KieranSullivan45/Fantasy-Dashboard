# Projection experiment / ESPN pool study: ESPN-wide rostered rate per player per weekly scrape from the same archive.
# Same sealing rule as extract-ecr.py (rows scraped on/after 2026-03-01 are dropped first).
# Usage: python3 -I scripts/research/projexp/extract-ownership.py <db_fpecr.parquet> <out.csv>
import sys, csv
import pyarrow.parquet as pq
PAGES = {"/nfl/rankings/qb.php": "QB", "/nfl/rankings/ppr-rb.php": "RB", "/nfl/rankings/ppr-wr.php": "WR", "/nfl/rankings/ppr-te.php": "TE"}
t = pq.read_table(sys.argv[1], columns=["fp_page", "id", "player_owned_espn", "scrape_date"]).to_pylist()
n = 0
with open(sys.argv[2], "w", newline="") as f:
    w = csv.writer(f); w.writerow(["position", "fantasypros_id", "owned_espn", "scrape_date"])
    for r in t:
        d = str(r["scrape_date"])[:10]
        if d >= "2026-03-01" or r["fp_page"] not in PAGES or r["player_owned_espn"] is None:
            continue
        w.writerow([PAGES[r["fp_page"]], r["id"], r["player_owned_espn"], d]); n += 1
print({"rows": n})
