"""Parse goals.csv into a tidy long-format table (one row per goal/tier/series/month).

Produces one DataFrame with one row per (Goal, Tier, SeriesType, Month):
    Goal, GoalOrder, Owner, WeightPct, Tier, SeriesType, Series,
    Month, MonthIndex, Quarter, Value,
    ThresholdText, TargetText, DeadlineMonth,
    CurrentPaceText, RequiredPaceText

SeriesType is one of Actual / Forecast / Threshold / Target. Threshold/Target
are flat reference lines spanning the whole fiscal year; Actual stops at the
last month with data and Forecast picks up from there through the goal's
deadline month.
"""
import numpy as np
import pandas as pd

from goal_specs import (
    GOAL_SPECS, SUMMARY_GOAL, MONTHS, QUARTER_OF_MONTH, VALUE_KINDS,
    parse_weight_total,
)

THRESHOLD_COL = "Threshold\n50%"
TARGET_COL = "Target\n100%"
BASELINE_COL = "FY26 Baseline"


def load_goals_csv(path):
    return pd.read_csv(path, dtype=str, keep_default_na=False)


def _find_row(df, match_substr):
    mask = (
        df["Core Goal"].str.strip().eq("Core")
        & df["Role Specific Goal"].str.contains(match_substr, regex=False, na=False)
    )
    matches = df[mask]
    if len(matches) != 1:
        raise ValueError(
            f"Expected exactly 1 row matching {match_substr!r}, found {len(matches)}"
        )
    return matches.iloc[0]


def score(baseline, threshold, target, actual):
    """0% at Baseline, 50% at Threshold, 100% at Target; linear between/beyond, clamped [0, 150]."""
    if any(v is None for v in (baseline, threshold, target, actual)):
        return None
    if baseline == target:
        # Degenerate (e.g. a "% complete" goal where Baseline is really last year's
        # closeout, not this year's starting point): fall back to a plain 0->target scale.
        if target == 0:
            return 100.0 if actual == 0 else 0.0
        return max(0.0, min(150.0, (actual / target) * 100.0))

    anchors = sorted([(baseline, 0.0), (threshold, 50.0), (target, 100.0)], key=lambda p: p[0])
    xs = [a[0] for a in anchors]
    ys = [a[1] for a in anchors]
    if actual <= xs[1]:
        x0, x1, y0, y1 = xs[0], xs[1], ys[0], ys[1]
    else:
        x0, x1, y0, y1 = xs[1], xs[2], ys[1], ys[2]
    pct = ys[1] if x1 == x0 else y0 + (actual - x0) / (x1 - x0) * (y1 - y0)
    return max(0.0, min(150.0, pct))


def _trend_points(points):
    """Drop the Base (FY26 prior-year) point from slope-fitting when actual FY27 months
    exist: Base sits a full year before Jul even though it's plotted at adjacent spacing,
    so mixing it into the regression distorts the trend."""
    if len(points) > 1 and points[0][0] == 0:
        return points[1:]
    return points


def _finish_line(baseline, threshold, target):
    """Furthest value in the improving direction, among Threshold and Target.

    A goal can overshoot Target (e.g. 0 beats a Target of 5 when Threshold is 0),
    so a forecast shouldn't stop at Target when Threshold is more ambitious.
    Direction comes from Baseline vs Target, or Threshold vs Target if equal.
    """
    if target is None:
        return None
    if threshold is None:
        return target
    lower_is_better = baseline > target if baseline != target else target < threshold
    return min(threshold, target) if lower_is_better else max(threshold, target)


def _fit_forecast(points, deadline_idx, target_value=None):
    """points: sorted [(month_idx, value), ...] actuals. Returns {month_idx: value} for the
    forecast line, projected at the trailing slope from the last actual point to the deadline,
    clamped so it doesn't overshoot past target_value (the finish line) once it's trending
    toward (not away from) it."""
    if not points:
        return {}
    last_idx, last_val = points[-1]
    if deadline_idx <= last_idx:
        return {last_idx: last_val}
    trend_pts = _trend_points(points)
    if len(trend_pts) < 2:
        slope = 0.0
    else:
        xs = np.array([p[0] for p in trend_pts], dtype=float)
        ys = np.array([p[1] for p in trend_pts], dtype=float)
        slope, _ = np.polyfit(xs, ys, 1)

    target_direction = None if target_value is None else target_value - last_val
    moving_toward_target = (
        target_direction is not None and slope != 0
        and (slope > 0) == (target_direction > 0)
    )

    forecast = {}
    for idx in range(last_idx, deadline_idx + 1):
        val = last_val + slope * (idx - last_idx)
        if moving_toward_target:
            val = min(val, target_value) if target_direction > 0 else max(val, target_value)
        # Every goal metric here is a count or a percentage - never negative.
        val = max(val, 0.0)
        forecast[idx] = val
    return forecast


def _pace_texts(points, target_value, deadline_month, deadline_idx, is_percent):
    if not points:
        return "", ""
    last_idx, last_val = points[-1]
    unit = "%/mo" if is_percent else "/mo"
    trend_pts = _trend_points(points)
    if len(trend_pts) >= 2:
        xs = np.array([p[0] for p in trend_pts], dtype=float)
        ys = np.array([p[1] for p in trend_pts], dtype=float)
        slope, _ = np.polyfit(xs, ys, 1)
        current_pace = f"Current Pace ({slope:+,.1f}{unit})"
    else:
        current_pace = ""
    if deadline_idx > last_idx and target_value is not None:
        required = (target_value - last_val) / (deadline_idx - last_idx)
        required_pace = f"Required {deadline_month} Target Pace ({required:+,.1f}{unit})"
    else:
        required_pace = ""
    return current_pace, required_pace


def _goal_rows(row, spec):
    kind = VALUE_KINDS[spec["value_kind"]]
    weight_pct = parse_weight_total(row["Weight"])
    baseline_raw = kind["parse_baseline"](row[BASELINE_COL])
    is_tiered = isinstance(baseline_raw, dict)
    baseline_by_tier = baseline_raw if is_tiered else {"Total": baseline_raw}
    tiers = list(baseline_by_tier.keys())

    # A single scalar baseline is needed to convert "reduction %" thresholds/targets to counts.
    scalar_baseline = None if is_tiered else baseline_raw
    threshold_value = kind["parse_threshold"](row[THRESHOLD_COL], scalar_baseline)
    target_value = kind["parse_target"](row[TARGET_COL], scalar_baseline)

    monthly_by_month = {}
    for month in MONTHS[1:]:
        cell = row.get(month, "")
        parsed = kind["parse_monthly"](cell)
        if parsed is None:
            continue
        monthly_by_month[month] = parsed if isinstance(parsed, dict) else {"Total": parsed}

    deadline_month = spec["deadline_month"]
    deadline_idx = MONTHS.index(deadline_month)
    is_percent = spec["value_kind"] == "percent"

    records = []
    for tier in tiers:
        points = [(0, baseline_by_tier[tier])]
        for month, values in monthly_by_month.items():
            if tier in values:
                points.append((MONTHS.index(month), values[tier]))
        points.sort()

        forecast_by_idx = _fit_forecast(
            points, deadline_idx,
            _finish_line(baseline_by_tier[tier], threshold_value, target_value),
        )
        current_pace, required_pace = _pace_texts(
            points, target_value, deadline_month, deadline_idx, is_percent
        )

        actual_idx = {idx for idx, _ in points}
        for idx, val in points:
            records.append(_row(spec, weight_pct, tier, "Actual", idx, val,
                                 threshold_value, target_value, deadline_month,
                                 current_pace, required_pace))
        for idx, val in forecast_by_idx.items():
            if idx in actual_idx and idx != max(actual_idx):
                continue
            records.append(_row(spec, weight_pct, tier, "Forecast", idx, val,
                                 threshold_value, target_value, deadline_month,
                                 current_pace, required_pace))
        for idx in range(len(MONTHS)):
            records.append(_row(spec, weight_pct, tier, "Threshold", idx, threshold_value,
                                 threshold_value, target_value, deadline_month,
                                 current_pace, required_pace))
            records.append(_row(spec, weight_pct, tier, "Target", idx, target_value,
                                 threshold_value, target_value, deadline_month,
                                 current_pace, required_pace))

    # Per-goal, per-month achievement % (tiers averaged), used for the chart-10 weighted summary.
    achievement_by_month_idx = {}
    for idx in range(len(MONTHS)):
        tier_pcts = []
        for tier in tiers:
            tier_points = dict([(0, baseline_by_tier[tier])] + [
                (MONTHS.index(m), v[tier]) for m, v in monthly_by_month.items() if tier in v
            ])
            if idx in tier_points:
                pct = score(baseline_by_tier[tier], threshold_value, target_value, tier_points[idx])
                if pct is not None:
                    tier_pcts.append(pct)
        if tier_pcts:
            achievement_by_month_idx[idx] = sum(tier_pcts) / len(tier_pcts)

    return records, weight_pct, achievement_by_month_idx


def _fmt_number(value):
    """1849.0 -> '1,849'; 184.89999999999995 -> '184.9' (display text only)."""
    if value is None:
        return ""
    return f"{value:,.2f}".rstrip("0").rstrip(".")


def _row(spec, weight_pct, tier, series_type, month_idx, value,
         threshold_value, target_value, deadline_month, current_pace, required_pace):
    month = MONTHS[month_idx]
    return dict(
        Goal=spec["title"], GoalOrder=spec["order"], Owner=spec.get("owner", ""),
        WeightPct=weight_pct, Tier=tier, SeriesType=series_type,
        Series=series_type if series_type in ("Threshold", "Target") else f"{tier} {series_type}",
        Month=month, MonthIndex=month_idx, Quarter=QUARTER_OF_MONTH[month],
        Value=value,
        ThresholdText=_fmt_number(threshold_value),
        TargetText=_fmt_number(target_value),
        DeadlineMonth=deadline_month, YLabel=spec["y_label"],
        CurrentPaceText=current_pace, RequiredPaceText=required_pace,
    )


def _summary_rows(achievement_by_goal, weight_by_goal):
    weighted_avg_by_idx = {}
    for idx in range(len(MONTHS)):
        num, denom = 0.0, 0.0
        for goal_key, achievement_by_idx in achievement_by_goal.items():
            if idx in achievement_by_idx:
                w = weight_by_goal[goal_key]
                num += w * achievement_by_idx[idx]
                denom += w
        if denom > 0:
            weighted_avg_by_idx[idx] = num / denom

    points = sorted(weighted_avg_by_idx.items())
    deadline_month = "Jun"
    deadline_idx = MONTHS.index(deadline_month)
    forecast_by_idx = _fit_forecast(points, deadline_idx, 100.0)
    current_pace, required_pace = _pace_texts(points, 100.0, deadline_month, deadline_idx, True)

    records = []
    actual_idx = {idx for idx, _ in points}
    for idx, val in points:
        records.append(_row(SUMMARY_GOAL, 100.0, "Weighted Avg", "Actual", idx, val,
                             50.0, 100.0, deadline_month, current_pace, required_pace))
    for idx, val in forecast_by_idx.items():
        if idx in actual_idx and idx != max(actual_idx):
            continue
        records.append(_row(SUMMARY_GOAL, 100.0, "Weighted Avg", "Forecast", idx, val,
                             50.0, 100.0, deadline_month, current_pace, required_pace))
    for idx in range(len(MONTHS)):
        records.append(_row(SUMMARY_GOAL, 100.0, "Weighted Avg", "Threshold", idx, 50.0,
                             50.0, 100.0, deadline_month, current_pace, required_pace))
        records.append(_row(SUMMARY_GOAL, 100.0, "Weighted Avg", "Target", idx, 100.0,
                             50.0, 100.0, deadline_month, current_pace, required_pace))
    return records


def build_dataframe(csv_path):
    df = load_goals_csv(csv_path)
    all_records = []
    achievement_by_goal = {}
    weight_by_goal = {}
    for spec in GOAL_SPECS:
        row = _find_row(df, spec["match"])
        records, weight_pct, achievement_by_idx = _goal_rows(row, spec)
        all_records.extend(records)
        achievement_by_goal[spec["key"]] = achievement_by_idx
        weight_by_goal[spec["key"]] = weight_pct

    all_records.extend(_summary_rows(achievement_by_goal, weight_by_goal))

    out = pd.DataFrame.from_records(all_records)
    out = out.sort_values(["GoalOrder", "Tier", "SeriesType", "MonthIndex"]).reset_index(drop=True)
    return out


if __name__ == "__main__":
    import sys

    csv_path = sys.argv[1] if len(sys.argv) > 1 else "../goals.csv"
    frame = build_dataframe(csv_path)
    pd.set_option("display.max_rows", 200)
    pd.set_option("display.width", 200)
    print(frame[frame["Goal"] == "Food Distributor NII"])
    print(frame[frame["Goal"] == "Core Portfolio Weighted Summary"])
    print(f"\nTotal rows: {len(frame)}")
