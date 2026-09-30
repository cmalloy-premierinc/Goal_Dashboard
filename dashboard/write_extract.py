"""Write the tidy goals DataFrame to a Tableau .hyper extract (table 'GoalSeries')."""
import pantab


def write_extract(df, hyper_path, table_name="GoalSeries"):
    pantab.frame_to_hyper(df, hyper_path, table=table_name)


if __name__ == "__main__":
    import sys

    from data_pipeline import build_dataframe

    csv_path = sys.argv[1] if len(sys.argv) > 1 else "../goals.csv"
    out_path = sys.argv[2] if len(sys.argv) > 2 else "output/goals_data.hyper"
    frame = build_dataframe(csv_path)
    write_extract(frame, out_path)
    print(f"Wrote {len(frame)} rows to {out_path}")
