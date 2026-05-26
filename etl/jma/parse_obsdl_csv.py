"""Parse a JMA past-weather CSV exported from data.jma.go.jp/risk/obsdl/.

The CSV has a multi-line Japanese header (3-5 rows) and uses `--` / `///`
as missing-value sentinels. This module returns a tidy DataFrame ready for
loading into `weather_observations`.

Usage
-----
    python -m etl.jma.parse_obsdl_csv input.csv --site TYO-01 --out cleaned.csv
"""
from __future__ import annotations
import argparse
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

MISSING_TOKENS = {"--", "///", "", " ", "×"}

COLMAP = {
    "気温(℃)":     "temperature_c",
    "湿度(％)":    "humidity_pct",
    "現地気圧(hPa)":"pressure_hpa",
    "降水量(mm)":  "precip_mm",
    "風速(m/s)":   "wind_speed_ms",
    "風向":         "wind_dir_label",
    "日照時間(時間)":"sunshine_h",
}

# 16-point compass to degrees (clockwise from north)
DIR16 = {
    "北":0, "北北東":22.5, "北東":45, "東北東":67.5,
    "東":90, "東南東":112.5,"南東":135,"南南東":157.5,
    "南":180,"南南西":202.5,"南西":225,"西南西":247.5,
    "西":270,"西北西":292.5,"北西":315,"北北西":337.5,
}


def _detect_header_row(path: Path) -> int:
    """Find the row index where '年月日時' first appears in column 0."""
    with open(path, encoding="cp932", errors="replace") as f:
        for i, line in enumerate(f):
            if "年月日時" in line:
                return i
    raise ValueError("could not locate JMA header row")


def parse(path: str | Path) -> pd.DataFrame:
    path = Path(path)
    header_row = _detect_header_row(path)
    df = pd.read_csv(path, encoding="cp932", skiprows=header_row, header=0, low_memory=False)

    # Drop quality/symbol columns starting with '品質' or '均質番号' typically
    keep = [c for c in df.columns if not any(s in c for s in ("品質", "均質"))]
    df = df[keep]

    # Rename the timestamp column robustly: contains '年月日時'
    ts_col = next((c for c in df.columns if "年月日時" in c), None)
    if ts_col is None:
        raise ValueError("timestamp column not found")
    df = df.rename(columns={ts_col: "observed_at"})

    # Translate Japanese measurement columns
    rename = {c: COLMAP[c] for c in df.columns if c in COLMAP}
    df = df.rename(columns=rename)

    # Coerce timestamps; JST naive -> UTC tz-aware
    df["observed_at"] = pd.to_datetime(df["observed_at"], errors="coerce")
    df["observed_at"] = (
        df["observed_at"].dt.tz_localize("Asia/Tokyo", nonexistent="shift_forward",
                                          ambiguous="NaT").dt.tz_convert("UTC")
    )

    # Replace missing sentinels and coerce numerics
    numeric_cols = [v for v in COLMAP.values() if v != "wind_dir_label"]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = df[col].replace(list(MISSING_TOKENS), np.nan)
            df[col] = pd.to_numeric(df[col], errors="coerce")

    if "wind_dir_label" in df.columns:
        df["wind_dir_deg"] = df["wind_dir_label"].map(DIR16)
        df = df.drop(columns=["wind_dir_label"])

    df = df.dropna(subset=["observed_at"])
    df = df.sort_values("observed_at").reset_index(drop=True)
    df["fetched_at"]   = datetime.utcnow()
    df["data_version"] = 1
    df["source"]       = "jma"
    return df


def main() -> int:
    ap = argparse.ArgumentParser(description="Parse JMA obsdl CSV")
    ap.add_argument("path", help="input CSV path")
    ap.add_argument("--site", required=True, help="site code (e.g. TYO-01)")
    ap.add_argument("--out", default="-", help="output CSV path or '-' for stdout")
    args = ap.parse_args()

    df = parse(args.path)
    df.insert(0, "site_code", args.site)
    if args.out == "-":
        df.to_csv(sys.stdout, index=False)
    else:
        df.to_csv(args.out, index=False)
        print(f"wrote {len(df)} rows → {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
