"""Pull Overture Maps places for one bounding box into NDJSON (D-028, D-044).

Reads the GeoParquet release straight from Overture's public S3 bucket with pyarrow, filtered by
the bbox struct so only matching row groups are read, and keeps the categories given. Nothing
here needs an account. The TypeScript loader (src/jobs/seed-venues.ts) writes the rows to
`venues`.

    python scripts/overture_places.py --release 2026-09-23.0 \
        --bbox -74.60,40.30,-73.40,41.10 --categories dance_club,dance_studio --out places.ndjson

Behind an HTTPS proxy (a cloud build container) the proxy and its CA bundle are used; on a
GitHub Actions runner there is none.
"""

import argparse
import json
import os
import sys
import time
import urllib.parse

import pyarrow.compute as pc
import pyarrow.dataset as ds
import pyarrow.fs as pafs

BUCKET = "overturemaps-us-west-2"
COLUMNS = [
    "id",
    "names",
    "taxonomy",
    "confidence",
    "websites",
    "socials",
    "addresses",
    "sources",
    "operating_status",
    "bbox",
]


def filesystem() -> pafs.S3FileSystem:
    options = {"anonymous": True, "region": "us-west-2"}
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if proxy:
        parsed = urllib.parse.urlparse(proxy)
        options["proxy_options"] = {"scheme": "http", "host": parsed.hostname, "port": parsed.port}
        bundle = os.environ.get("OVERTURE_CA_BUNDLE")
        if bundle:
            options["tls_ca_file_path"] = bundle
    return pafs.S3FileSystem(**options)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--release", required=True)
    parser.add_argument("--bbox", required=True, help="xmin,ymin,xmax,ymax")
    parser.add_argument("--categories", required=True)
    parser.add_argument("--min-confidence", type=float, default=0.5)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    xmin, ymin, xmax, ymax = (float(v) for v in args.bbox.split(","))
    categories = {c.strip() for c in args.categories.split(",") if c.strip()}
    started = time.time()
    dataset = ds.dataset(
        f"{BUCKET}/release/{args.release}/theme=places/type=place/",
        filesystem=filesystem(),
        format="parquet",
    )
    in_box = (
        (pc.field("bbox", "xmin") >= xmin)
        & (pc.field("bbox", "xmax") <= xmax)
        & (pc.field("bbox", "ymin") >= ymin)
        & (pc.field("bbox", "ymax") <= ymax)
    )
    table = dataset.to_table(filter=in_box, columns=COLUMNS)
    scanned = table.num_rows
    kept = 0
    with open(args.out, "w", encoding="utf-8") as out:
        for row in table.to_pylist():
            taxonomy = row.get("taxonomy") or {}
            if taxonomy.get("primary") not in categories:
                continue
            if row.get("operating_status") in ("permanently_closed", "temporarily_closed"):
                continue
            if (row.get("confidence") or 0) < args.min_confidence:
                continue
            bbox = row["bbox"]
            sources = row.get("sources") or []
            record = {
                "id": row["id"],
                "name": (row.get("names") or {}).get("primary"),
                "category": taxonomy.get("primary"),
                "lat": (bbox["ymin"] + bbox["ymax"]) / 2,
                "lng": (bbox["xmin"] + bbox["xmax"]) / 2,
                "confidence": row.get("confidence"),
                "websites": row.get("websites") or [],
                "socials": row.get("socials") or [],
                "address": (row.get("addresses") or [None])[0],
                "datasets": sorted({s.get("dataset") for s in sources if s.get("dataset")}),
                "licenses": sorted({s.get("license") for s in sources if s.get("license")}),
                "release": args.release,
            }
            if not record["name"]:
                continue
            out.write(json.dumps(record, ensure_ascii=False) + "\n")
            kept += 1
    print(
        f"scanned {scanned} places in the box, kept {kept}, in {time.time() - started:.0f} s",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
