# FY27 Goals Dashboard

Interactive dashboard (static site) tracking the 9 quantitative Core goals
plus a weighted portfolio summary, built from `goals.csv`.

## Live site

`docs/` is a self-contained static site (HTML/CSS/JS, Chart.js via CDN, no
build step) meant to be served by GitHub Pages from this repo.

## Update the dashboard with new monthly numbers

1. Add this month's columns/values to `goals.csv`.
2. Regenerate the data file:
   ```
   cd dashboard
   ..\.venv\Scripts\python.exe main.py
   ```
   This rewrites `docs/data.json` from the latest `goals.csv`. Nothing else
   needs to change.
3. Commit and push `goals.csv` and `docs/data.json`. GitHub Pages picks up
   the update automatically within a minute or two.

## Preview locally before pushing

```
cd docs
..\.venv\Scripts\python.exe -m http.server 8765
```
Then open http://localhost:8765/index.html in a browser.

## One-time setup: publish to GitHub Pages

Git is not installed on this machine, so these steps are manual:

1. Install Git for Windows: https://git-scm.com/download/win
2. Create a new repository on GitHub (public, so Pages can serve it for free).
3. From the `Goals Tableau` folder:
   ```
   git init
   git add .
   git commit -m "Initial goals dashboard"
   git branch -M main
   git remote add origin <your-repo-url>
   git push -u origin main
   ```
4. On GitHub: **Settings > Pages > Build and deployment > Deploy from a
   branch > Branch: `main`, folder: `/docs`** > Save.
5. The site goes live at `https://<your-username>.github.io/<repo-name>/`
   within a minute or two. Re-running step 4 is a one-time setup only -
   future updates are just "Update the dashboard" above.

## Project layout

- `goals.csv` - source data you maintain by hand.
- `docs/` - the static site GitHub Pages serves (`index.html`, `styles.css`,
  `app.js`, generated `data.json`).
- `dashboard/` - the Python pipeline: `goal_specs.py` (per-goal parsing
  rules), `data_pipeline.py` (parsing/scoring/forecasting), `export_json.py`
  (writes `docs/data.json`), `main.py` (CLI entry point).
- `dashboard/output/`, `dashboard/_tableau_validator/`, `write_extract.py`,
  `build_workbook.py` - an earlier Tableau-workbook approach that's no
  longer used (kept in case it's useful later); not needed for the site.
