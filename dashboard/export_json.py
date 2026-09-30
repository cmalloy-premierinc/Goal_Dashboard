"""Convert the tidy goals DataFrame into docs/data.json for the static site.

One entry per goal with a Chart.js-ready series list (each series is a
13-long array aligned to MONTHS, with null where that series has no value
for a given month - e.g. Forecast is null before the last actual month).
"""
import json
import re

from data_pipeline import build_dataframe
from goal_specs import MONTHS, QUARTER_OF_MONTH

# Short tick labels ('Jul', not 'Jul (Q1)') so the x-axis needs less rotation
# and less vertical space, leaving more room for the plot itself (this is what
# was squeezing Threshold/Target lines flat on some charts). Quarter shading
# already conveys the quarter visually, so the tag moves to its own array
# (MONTH_QUARTERS) instead of being embedded in the displayed label text.
MONTH_LABELS = list(MONTHS)
MONTH_QUARTERS = [None if m == "Base" else QUARTER_OF_MONTH[m] for m in MONTHS]

_TIER_MAGNITUDE_RE = re.compile(r"([\d.]+)\s*([KM]?)", re.IGNORECASE)
_SUFFIX_MULTIPLIER = {"": 1, "K": 1_000, "M": 1_000_000}


def _tier_magnitude(tier):
    """Parse a spend-tier label like '>$500K' or '>=$1M' into a sortable number."""
    m = _TIER_MAGNITUDE_RE.search(tier or "")
    if not m:
        return 0.0
    return float(m.group(1)) * _SUFFIX_MULTIPLIER[m.group(2).upper()]


def _series_name(tier, series_type):
    return series_type if series_type in ("Threshold", "Target") else f"{tier} {series_type}"


def _series_sort_key(s):
    # Actual/Forecast: grouped by tier (highest spend first), Actual before
    # Forecast within a tier. Threshold/Target always come after, in that order.
    if s["type"] in ("Actual", "Forecast"):
        return (0, -_tier_magnitude(s["tier"]), 0 if s["type"] == "Actual" else 1)
    return (1, 0 if s["type"] == "Threshold" else 1, 0)


def build_site_data(csv_path):
    df = build_dataframe(csv_path)
    goals = []
    for goal_name, gdf in df.groupby("Goal", sort=False):
        gdf = gdf.sort_values("GoalOrder")
        first = gdf.iloc[0]
        series_map = {}
        for (tier, series_type), sdf in gdf.groupby(["Tier", "SeriesType"], sort=False):
            values = [None] * len(MONTHS)
            for _, row in sdf.iterrows():
                values[int(row["MonthIndex"])] = None if row["Value"] is None else round(float(row["Value"]), 2)
            name = _series_name(tier, series_type)
            # Keyed by name (not (tier, type)) so Threshold/Target - identical
            # across every tier of a multi-tier goal - collapse into one line
            # instead of one redundant duplicate per tier.
            series_map[name] = dict(
                name=name, tier=tier, type=series_type, data=values,
            )
        series = sorted(series_map.values(), key=_series_sort_key)

        goals.append(dict(
            key=goal_name.lower().replace(" ", "_").replace(".", "").replace(",", ""),
            order=int(first["GoalOrder"]),
            title=goal_name,
            owner=first["Owner"],
            weightPct=float(first["WeightPct"]),
            yLabel=first["YLabel"],
            thresholdText=first["ThresholdText"],
            targetText=first["TargetText"],
            deadlineMonth=first["DeadlineMonth"],
            currentPaceText=first["CurrentPaceText"],
            requiredPaceText=first["RequiredPaceText"],
            months=MONTH_LABELS,
            series=series,
        ))
    goals.sort(key=lambda g: g["order"])
    return dict(generatedFromRows=len(df), monthQuarters=MONTH_QUARTERS, goals=goals)


def write_site_data(csv_path, out_path):
    data = build_site_data(csv_path)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    return data


if __name__ == "__main__":
    import sys

    csv_path = sys.argv[1] if len(sys.argv) > 1 else "../goals.csv"
    out_path = sys.argv[2] if len(sys.argv) > 2 else "../docs/data.json"
    data = write_site_data(csv_path, out_path)
    print(f"Wrote {out_path} with {len(data['goals'])} goals")
