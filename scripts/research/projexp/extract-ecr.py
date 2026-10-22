# Projection experiment: extract the FantasyPros weekly/ROS ECR archive (DynastyProcess db_fpecr.parquet) to a small CSV.
# Benchmark only (owner decision 2026-09-29: consensus projections are a benchmark, never a model input).
# Drops every row scraped on/after 2026-03-01 before anything else is looked at (2026 is the sealed season).
# Usage: python3 -I scripts/research/projexp/extract-ecr.py <db_fpecr.parquet> <out.csv>   (needs pyarrow; not a repo dependency)
import sys, csv
import pyarrow.parquet as pq

PAGES = {
    "/nfl/rankings/qb.php": ("week", "QB"), "/nfl/rankings/ppr-rb.php": ("week", "RB"),
    "/nfl/rankings/ppr-wr.php": ("week", "WR"), "/nfl/rankings/ppr-te.php": ("week", "TE"),
    "/nfl/rankings/ros-qb.php": ("ros", "QB"), "/nfl/rankings/ros-ppr-rb.php": ("ros", "RB"),
    "/nfl/rankings/ros-ppr-wr.php": ("ros", "WR"), "/nfl/rankings/ros-ppr-te.php": ("ros", "TE"),
}
src, out = sys.argv[1], sys.argv[2]
t = pq.read_table(src, columns=["fp_page", "id", "pos", "team", "ecr", "sd", "best", "worst", "scrape_date"]).to_pylist()
kept = dropped_sealed = 0
with open(out, "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["kind", "position", "fantasypros_id", "team", "ecr", "sd", "best", "worst", "scrape_date"])
    for r in t:
        d = str(r["scrape_date"])[:10]
        if d >= "2026-03-01":
            dropped_sealed += 1
            continue
        page = PAGES.get(r["fp_page"])
        if not page:
            continue
        w.writerow([page[0], page[1], r["id"], r["team"], r["ecr"], r["sd"], r["best"], r["worst"], d])
        kept += 1
print({"kept": kept, "dropped_sealed_rows": dropped_sealed})
