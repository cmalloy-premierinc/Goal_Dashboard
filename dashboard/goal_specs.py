"""Per-goal parsing configuration for goals.csv.

goals.csv packs several different cell "shapes" into the same Baseline /
Threshold / Target / monthly columns (plain numbers, multi-tier "label = value"
blocks, "N reviewed of M (NN%)" text, "count (delta%)" text, and
"NN% by end of <month>" text). Each of the 9 quantitative Core goals below
declares which shape it uses (`value_kind`) so data_pipeline.py can parse all
of them with one generic routine instead of one-off code per row.
"""
import re

MONTHS = ["Base", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
          "Jan", "Feb", "Mar", "Apr", "May", "Jun"]

QUARTER_OF_MONTH = {
    "Base": "Base",
    "Jul": "Q1", "Aug": "Q1", "Sep": "Q1",
    "Oct": "Q2", "Nov": "Q2", "Dec": "Q2",
    "Jan": "Q3", "Feb": "Q3", "Mar": "Q3",
    "Apr": "Q4", "May": "Q4", "Jun": "Q4",
}

_NUM = r"[\d,]+(?:\.\d+)?"


def _to_float(text):
    return float(text.replace(",", ""))


def parse_weight_total(cell):
    """Sum every percentage in a Weight cell (handles split-owner cells like '10%/5%' or 'CM-10%')."""
    pieces = re.findall(rf"({_NUM})\s*%", str(cell))
    return sum(_to_float(p) for p in pieces)


def parse_tiered(cell):
    """Split a multi-line 'label - value' / 'label = value' cell into an ordered {label: value} dict."""
    if cell is None or not str(cell).strip():
        return {}
    result = {}
    for line in str(cell).splitlines():
        line = line.strip()
        if not line:
            continue
        m = re.match(rf"^(?P<label>.+?)\s*[-=]\s*({_NUM})", line)
        if m:
            result[m.group("label").strip()] = _to_float(m.group(2))
    return result


def parse_plain(cell):
    """A cell holding a single, possibly comma-formatted or prefixed, number."""
    if cell is None or not str(cell).strip():
        return None
    m = re.search(rf"({_NUM})", str(cell))
    return _to_float(m.group(1)) if m else None


def parse_leading_count(cell):
    """The count sits at the very start of the cell, e.g. '2,014 (-8.2%)' -> 2014."""
    if cell is None or not str(cell).strip():
        return None
    m = re.match(rf"^\s*({_NUM})", str(cell))
    return _to_float(m.group(1)) if m else None


def parse_percent_paren(cell):
    """Pull the percentage out of the first '(NN.NN%)' found in the cell."""
    if cell is None or not str(cell).strip():
        return None
    m = re.search(rf"\(({_NUM})\s*%\)", str(cell))
    if m:
        return _to_float(m.group(1))
    m = re.match(rf"^\s*({_NUM})\s*%", str(cell))
    return _to_float(m.group(1)) if m else None


def parse_pct_number(cell):
    """A cell that is essentially 'NN%', optionally with trailing text like 'by end of Dec'."""
    if cell is None or not str(cell).strip():
        return None
    m = re.search(rf"({_NUM})\s*%", str(cell))
    return _to_float(m.group(1)) if m else None


# Threshold/Target parsers take (cell, baseline_value) so the "reduction %"
# goals can convert a percentage into an absolute count relative to Baseline.
def _threshold_target_tiered_or_plain(cell, _baseline):
    return parse_plain(cell)


def _threshold_target_percent(cell, _baseline):
    return parse_pct_number(cell)


def _threshold_target_reduction(cell, baseline):
    pct = parse_pct_number(cell)
    if pct is None or baseline is None:
        return None
    return baseline * (1 - pct / 100.0)


VALUE_KINDS = {
    # Multi-tier goals: Baseline/monthly cells hold several "label = value" lines.
    "tiered": dict(
        parse_baseline=parse_tiered,
        parse_monthly=parse_tiered,
        parse_threshold=_threshold_target_tiered_or_plain,
        parse_target=_threshold_target_tiered_or_plain,
    ),
    # Single plain-number series (Baseline/Threshold/Target/monthly all plain numbers).
    "plain": dict(
        parse_baseline=parse_plain,
        parse_monthly=parse_plain,
        parse_threshold=_threshold_target_tiered_or_plain,
        parse_target=_threshold_target_tiered_or_plain,
    ),
    # Monthly cells like "13 reviewed of 22 (59.09%)"; Baseline/Threshold/Target are percentages.
    "percent": dict(
        parse_baseline=parse_percent_paren,
        parse_monthly=parse_percent_paren,
        parse_threshold=_threshold_target_percent,
        parse_target=_threshold_target_percent,
    ),
    # Monthly cells like "13 (74%)"; Baseline plain, Threshold may be "<100".
    "leading_count": dict(
        parse_baseline=parse_plain,
        parse_monthly=parse_leading_count,
        parse_threshold=_threshold_target_tiered_or_plain,
        parse_target=_threshold_target_tiered_or_plain,
    ),
    # Monthly cells like "2,094 (-11.7%)"; Threshold/Target given as "NN% by end of <month>"
    # reduction targets off of Baseline, so they must be converted to absolute counts.
    "reduction_count": dict(
        parse_baseline=parse_plain,
        parse_monthly=parse_leading_count,
        parse_threshold=_threshold_target_reduction,
        parse_target=_threshold_target_reduction,
    ),
}

# Order mirrors the example dashboard (1-9); GoalOrder 10 is the computed
# weighted summary built in data_pipeline.py, not parsed from a CSV row.
GOAL_SPECS = [
    dict(
        order=1, key="food_distributor_nii", title="Food Distributor NII",
        owner="Chris", match="Food Distributor NII",
        value_kind="tiered", deadline_month="Jun",
        y_label="Unmatched Spend Tier Count",
    ),
    dict(
        order=2, key="pharmacy_wholesaler_nii", title="Pharmacy Wholesaler NII",
        owner="Chris", match="Pharmacy Wholesaler NII",
        value_kind="tiered", deadline_month="Jun",
        y_label="Unmatched Vendors Count",
    ),
    dict(
        order=3, key="medsurg_dist_nii", title="MedSurg Dist. NII",
        owner="Chris/Conner", match="MedSurg Dist. NII",
        value_kind="tiered", deadline_month="Jun",
        y_label="Unmatched Spend Vendors",
    ),
    dict(
        order=4, key="dist_data_mismatch", title="DIST_DATA_MISMATCH",
        owner="Chris/Conner", match="DIST_DATA_MISMATCH",
        value_kind="plain", deadline_month="Jun",
        y_label="Unresolved Mismatch Records",
    ),
    dict(
        order=5, key="po_spend_uom", title="PO Spend UOM",
        owner="Chris/Conner", match="PO spend UOM",
        value_kind="plain", deadline_month="Jun",
        y_label="Unresolved UOM Records",
    ),
    dict(
        order=6, key="pkg_string_uom_reconcile", title="PKG String UOM Reconcile",
        owner="Conner", match="Records with UOM from PKG String",
        value_kind="plain", deadline_month="Jun",
        y_label="Records to Reconcile",
    ),
    dict(
        order=7, key="process_pcrs", title="Process PCRs",
        owner="Conner", match="Process PCRs",
        value_kind="percent", deadline_month="Jun",
        y_label="% Categories Reviewed",
    ),
    dict(
        order=8, key="obsolete_dates_with_spend", title="Obsolete Dates with Spend",
        owner="Conner", match="Obsolete Dates with Spend",
        value_kind="leading_count", deadline_month="Jun",
        y_label="Records Remaining",
    ),
    dict(
        order=9, key="blocked_pin_items", title="BLOCKED PIN ITEMS",
        owner="Conner", match="BLOCKED PIN ITEMS",
        value_kind="reduction_count", deadline_month="Dec",
        y_label="Blocked PINs Count",
    ),
]

SUMMARY_GOAL = dict(
    order=10, key="core_portfolio_weighted_summary",
    title="Core Portfolio Weighted Summary",
    y_label="Weighted Completion %",
)
