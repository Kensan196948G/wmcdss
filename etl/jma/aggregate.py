"""Aggregate hourly weather rows into daily / monthly summaries.

Designed to feed both the dashboard and the 50-year-probability analysis.
"""
from __future__ import annotations
import pandas as pd


def daily(df: pd.DataFrame) -> pd.DataFrame:
    """Return per-day max wind, max gust, total precip, mean temp/humidity."""
    g = df.assign(day=df["observed_at"].dt.tz_convert("Asia/Tokyo").dt.date).groupby(["site_code", "day"])
    return g.agg(
        wind_max_ms   =("wind_speed_ms", "max"),
        wind_mean_ms  =("wind_speed_ms", "mean"),
        gust_max_ms   =("wind_gust_ms",  "max"),
        precip_total_mm=("precip_mm",    "sum"),
        temp_min_c    =("temperature_c", "min"),
        temp_max_c    =("temperature_c", "max"),
        temp_mean_c   =("temperature_c", "mean"),
        humid_mean_pct=("humidity_pct",  "mean"),
    ).reset_index()


def monthly(daily_df: pd.DataFrame) -> pd.DataFrame:
    daily_df = daily_df.copy()
    daily_df["month"] = pd.to_datetime(daily_df["day"]).dt.to_period("M").astype(str)
    g = daily_df.groupby(["site_code", "month"])
    return g.agg(
        wind_max_ms   =("wind_max_ms",   "max"),
        wind_mean_ms  =("wind_mean_ms",  "mean"),
        precip_total_mm=("precip_total_mm","sum"),
        temp_mean_c   =("temp_mean_c",   "mean"),
        rainy_days    =("precip_total_mm", lambda s: (s >= 1.0).sum()),
    ).reset_index()


def annual_max(daily_df: pd.DataFrame) -> pd.DataFrame:
    daily_df = daily_df.copy()
    daily_df["year"] = pd.to_datetime(daily_df["day"]).dt.year
    g = daily_df.groupby(["site_code", "year"])
    return g.agg(
        annual_max_wind_ms=("wind_max_ms",   "max"),
        annual_max_gust_ms=("gust_max_ms",   "max"),
        annual_total_precip=("precip_total_mm","sum"),
    ).reset_index()
