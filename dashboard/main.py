"""CLI entry point for the static-site dashboard.

    python main.py    Parse goals.csv and (re)write docs/data.json, the data
                       file the GitHub Pages site (docs/index.html) reads.
                       Run this every time you add this month's numbers to
                       goals.csv, then commit + push docs/data.json.
"""
import argparse
import os

from export_json import write_site_data

CSV_PATH = os.path.join(os.path.dirname(__file__), "..", "goals.csv")
DATA_JSON_PATH = os.path.join(os.path.dirname(__file__), "..", "docs", "data.json")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", default=CSV_PATH, help="Path to goals.csv")
    parser.add_argument("--out", default=DATA_JSON_PATH, help="Path to write data.json")
    args = parser.parse_args()

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    data = write_site_data(args.csv, args.out)
    print(f"Wrote {args.out} ({len(data['goals'])} goals, {data['generatedFromRows']} rows)")


if __name__ == "__main__":
    main()

