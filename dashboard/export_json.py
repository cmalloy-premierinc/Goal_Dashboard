"""Convert the tidy goals DataFrame into docs/data.json for the static site.

One entry per goal with a Chart.js-ready series list (each series is a
13-long array aligned to MONTHS, with null where that series has no value
for a given month - e.g. Forecast is null before the last actual month).
"""
import json

from data_pipeline import build_dataframe
from goal_specs import MONTHS, QUARTER_OF_MONTH

MONTH_LABELS = [m if m == "Base" else f"{m} ({QUARTER_OF_MONTH[m]})" for m in MONTHS]

SERIES_ORDER = {"Actual": 0, "Forecast": 1, "Threshold": 2, "Target": 3}


def _series_name(tier, series_type):
    return series_type if series_type in ("Threshold", "Target") else f"{tier} {series_type}"


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
            series_map[(tier, series_type)] = dict(
                name=name, tier=tier, type=series_type, data=values,
                order=SERIES_ORDER.get(series_type, 9),
            )
        series = sorted(series_map.values(), key=lambda s: (s["order"], s["name"]))

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
    return dict(generatedFromRows=len(df), goals=goals)


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
