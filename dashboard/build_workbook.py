"""Generate goals_dashboard.twb: one worksheet per goal (line chart of Value by
Month, colored by Series = Tier/SeriesType) plus an Overview dashboard tiling
all 10 in the same 5x2 grid as example.png. Each worksheet is also its own
tab, so "viewing a chart separately" is just clicking its tab.

The datasource block below mirrors a real Tableau-Desktop-generated workbook
connected to goals_data.hyper (confirmed against the user's own Tableau
2025.1 install), rather than a hand-guessed schema.

Run via --init only: this file is not touched by routine data refreshes, so
any manual formatting/navigation-button polish done afterwards in Tableau
Desktop is preserved. NOTE: the datasource connection stores the *absolute*
path to goals_data.hyper (matching what Tableau itself writes for an external
file connection), so moving the "Goals Tableau" folder requires an --init
rebuild to refresh that path.
"""
import os
import uuid
from xml.sax.saxutils import quoteattr, escape

from goal_specs import GOAL_SPECS, SUMMARY_GOAL, MONTHS, QUARTER_OF_MONTH

DATASOURCE_NAME = "goalseries"
HYPER_FILENAME = "goals_data.hyper"
TABLE_NAME = "GoalSeries"

ALL_GOALS = GOAL_SPECS + [SUMMARY_GOAL]

# (name, datatype, type, role) - role mirrors what Tableau itself assigned when
# connecting live to this same extract (numeric "index"/id-like fields still
# default to role="dimension" despite a quantitative type).
DATASOURCE_COLUMNS = [
    ("Goal", "string", "nominal", "dimension"),
    ("GoalOrder", "integer", "quantitative", "measure"),
    ("Owner", "string", "nominal", "dimension"),
    ("WeightPct", "real", "quantitative", "measure"),
    ("Tier", "string", "nominal", "dimension"),
    ("SeriesType", "string", "nominal", "dimension"),
    ("Series", "string", "nominal", "dimension"),
    ("Month", "string", "nominal", "dimension"),
    ("MonthIndex", "integer", "quantitative", "dimension"),
    ("Quarter", "string", "nominal", "dimension"),
    ("Value", "real", "quantitative", "measure"),
    ("ThresholdText", "string", "nominal", "dimension"),
    ("TargetText", "string", "nominal", "dimension"),
    ("DeadlineMonth", "string", "nominal", "dimension"),
    ("YLabel", "string", "nominal", "dimension"),
    ("CurrentPaceText", "string", "nominal", "dimension"),
    ("RequiredPaceText", "string", "nominal", "dimension"),
]

# Tableau's remote-type codes for a Hyper extract, confirmed from a real
# connected workbook: string=129, integer=20, real=5.
_REMOTE_TYPE = {"string": 129, "integer": 20, "real": 5}
_AGGREGATION = {"string": "Count", "integer": "Sum", "real": "Sum"}


def _random_id():
    return uuid.uuid4().hex[:24]


def _uuid():
    return f"{{{str(uuid.uuid4()).upper()}}}"


def _month_aliases():
    parts = []
    for idx, month in enumerate(MONTHS):
        label = month if month == "Base" else f"{month} ({QUARTER_OF_MONTH[month]})"
        parts.append(f'          <alias key="{idx}" value={quoteattr(label)} />')
    return "\n".join(parts)


def _metadata_record(name, dtype, ordinal, object_id):
    parts = [
        '          <metadata-record class="column">',
        f"            <remote-name>{escape(name)}</remote-name>",
        f"            <remote-type>{_REMOTE_TYPE[dtype]}</remote-type>",
        f"            <local-name>[{name}]</local-name>",
        f"            <parent-name>[{TABLE_NAME}]</parent-name>",
        f"            <remote-alias>{escape(name)}</remote-alias>",
        f"            <ordinal>{ordinal}</ordinal>",
        f"            <local-type>{dtype}</local-type>",
        f"            <aggregation>{_AGGREGATION[dtype]}</aggregation>",
        "            <contains-null>true</contains-null>",
    ]
    if dtype == "string":
        parts.append('            <collation flag="0" name="binary" />')
    parts.append(f"            <object-id>[{object_id}]</object-id>")
    parts.append("          </metadata-record>")
    return "\n".join(parts)


def _datasource_xml(hyper_abs_path):
    hyper_id = _random_id()
    object_id = f"{TABLE_NAME} (public.{TABLE_NAME})_{uuid.uuid4().hex.upper()}"
    dbname = hyper_abs_path.replace("\\", "/")

    metadata_records = "\n".join(
        _metadata_record(name, dtype, ordinal, object_id)
        for ordinal, (name, dtype, _ctype, _role) in enumerate(DATASOURCE_COLUMNS)
    )

    cols = []
    for name, dtype, ctype, role in DATASOURCE_COLUMNS:
        if name == "MonthIndex":
            cols.append(
                f'''      <column caption="Month" datatype="{dtype}" name="[{name}]" role="{role}" type="{ctype}">
        <aliases>
{_month_aliases()}
        </aliases>
      </column>'''
            )
        else:
            cols.append(f'      <column datatype="{dtype}" name="[{name}]" role="{role}" type="{ctype}" />')
    cols.append(
        f'      <column caption="{TABLE_NAME}" datatype="table" '
        f'name="[__tableau_internal_object_id__].[{object_id}]" role="measure" type="quantitative" />'
    )
    columns_xml = "\n".join(cols)

    return f'''  <datasource caption="{TABLE_NAME} Extract" inline="true" name="{DATASOURCE_NAME}" version="18.1">
    <connection class="federated">
      <named-connections>
        <named-connection caption="{TABLE_NAME.lower()}" name="hyper.{hyper_id}">
          <connection authentication="auth-none" author-locale="en_US" class="hyper" dbname={quoteattr(dbname)} default-settings="yes" server="" sslmode="" username="tableau_internal_user" />
        </named-connection>
      </named-connections>
      <relation connection="hyper.{hyper_id}" name="{TABLE_NAME}" table="[public].[{TABLE_NAME}]" type="table" />
      <metadata-records>
{metadata_records}
      </metadata-records>
    </connection>
    <aliases enabled="yes" />
{columns_xml}
    <layout dim-ordering="alphabetic" measure-ordering="alphabetic" show-structure="true" />
    <object-graph>
      <objects>
        <object caption="{TABLE_NAME}" id={quoteattr(object_id)}>
          <properties context="">
            <relation connection="hyper.{hyper_id}" name="{TABLE_NAME}" table="[public].[{TABLE_NAME}]" type="table" />
          </properties>
        </object>
      </objects>
    </object-graph>
  </datasource>'''


def _worksheet_xml(goal):
    title = escape(goal["title"])
    sheet_name = f'{goal["order"]:02d}. {goal["title"]}'
    goal_filter_member = escape(goal["title"]).replace('"', '&quot;')
    return f'''  <worksheet name={quoteattr(sheet_name)}>
    <layout-options>
      <title>
        <formatted-text>
          <run>{title}</run>
        </formatted-text>
      </title>
    </layout-options>
    <table>
      <view>
        <datasources>
          <datasource name="{DATASOURCE_NAME}" />
        </datasources>
        <datasource-dependencies datasource="{DATASOURCE_NAME}">
          <column datatype="string" name="[Goal]" role="dimension" type="nominal" />
          <column caption="Month" datatype="integer" name="[MonthIndex]" role="dimension" type="quantitative" />
          <column datatype="string" name="[Series]" role="dimension" type="nominal" />
          <column datatype="real" name="[Value]" role="measure" type="quantitative" />
          <column-instance column="[Value]" derivation="Avg" name="[avg:Value:qk]" pivot="key" type="quantitative" />
        </datasource-dependencies>
        <filter class="categorical" column="[{DATASOURCE_NAME}].[Goal]">
          <groupfilter function="member" level="[{DATASOURCE_NAME}].[Goal]" member="&quot;{goal_filter_member}&quot;" />
        </filter>
        <aggregation value="true" />
      </view>
      <style />
      <panes>
        <pane selection-relaxation-option="selection-relaxation-allow">
          <view>
            <breakdown value="auto" />
          </view>
          <mark class="Line" />
          <encodings>
            <color column="[{DATASOURCE_NAME}].[Series]" />
          </encodings>
        </pane>
      </panes>
      <rows>[{DATASOURCE_NAME}].[avg:Value:qk]</rows>
      <cols>[{DATASOURCE_NAME}].[MonthIndex]</cols>
    </table>
    <simple-id uuid={quoteattr(_uuid())} />
  </worksheet>'''


def _dashboard_zone_grid(goals, cols=5):
    """Tiled grid layout: child sheet zones nested inside one root 'layout-basic'
    container zone, matching the structure Tableau itself emits for dashboards."""
    grid_w = 100000
    grid_h = 100000
    rows = (len(goals) + cols - 1) // cols
    cell_w = grid_w // cols
    cell_h = grid_h // rows
    zones = []
    for i, goal in enumerate(goals):
        r, c = divmod(i, cols)
        sheet_name = f'{goal["order"]:02d}. {goal["title"]}'
        zones.append(
            f'        <zone h="{cell_h}" id="{i + 1}" name={quoteattr(sheet_name)} w="{cell_w}" '
            f'x="{c * cell_w}" y="{r * cell_h}" />'
        )
    return "\n".join(zones)


def _dashboard_xml(goals):
    zones = _dashboard_zone_grid(goals)
    root_id = len(goals) + 1
    return f'''  <dashboard name="Overview">
    <style />
    <size maxheight="1600" maxwidth="3200" minheight="1600" minwidth="3200" />
    <datasources>
      <datasource name="{DATASOURCE_NAME}" />
    </datasources>
    <zones>
      <zone h="100000" id="{root_id}" type-v2="layout-basic" w="100000" x="0" y="0">
{zones}
        <zone-style>
          <format attr="border-color" value="#000000" />
          <format attr="border-style" value="none" />
          <format attr="border-width" value="0" />
          <format attr="margin" value="8" />
        </zone-style>
      </zone>
    </zones>
    <devicelayouts>
      <devicelayout name="Phone">
        <size maxheight="700" minheight="700" sizing-mode="vscroll" />
        <zones>
          <zone h="100000" id="{root_id + 1}" type-v2="layout-basic" w="100000" x="0" y="0">
            <zone h="84000" id="{root_id + 2}" param="vert" type-v2="layout-flow" w="84000" x="8000" y="8000" />
            <zone-style>
              <format attr="border-color" value="#000000" />
              <format attr="border-style" value="none" />
              <format attr="border-width" value="0" />
              <format attr="margin" value="8" />
            </zone-style>
          </zone>
        </zones>
      </devicelayout>
    </devicelayouts>
  </dashboard>'''


def build_workbook_xml(hyper_abs_path):
    worksheets = "\n".join(_worksheet_xml(g) for g in ALL_GOALS)
    dashboard = _dashboard_xml(ALL_GOALS)
    return f'''<?xml version='1.0' encoding='utf-8' ?>
<workbook original-version='18.1' source-build='2025.1.19' source-platform='win' version='18.1' xmlns:user='http://www.tableausoftware.com/xml/user'>
  <document-format-change-manifest>
    <AnimationOnByDefault />
    <MarkAnimation />
    <ObjectModelEncapsulateLegacy />
    <ObjectModelTableType />
    <SchemaViewerObjectModel />
    <SheetIdentifierTracking />
    <WindowsPersistSimpleIdentifiers />
  </document-format-change-manifest>
  <preferences>
    <preference name="ui.encoding.shelf.height" value="24" />
  </preferences>
  <datasources>
{_datasource_xml(hyper_abs_path)}
  </datasources>
  <worksheets>
{worksheets}
  </worksheets>
  <dashboards>
{dashboard}
  </dashboards>
</workbook>
'''


def write_workbook(path):
    hyper_abs_path = os.path.join(os.path.dirname(os.path.abspath(path)), HYPER_FILENAME)
    xml_text = build_workbook_xml(hyper_abs_path)
    with open(path, "w", encoding="utf-8") as f:
        f.write(xml_text)
    return xml_text


if __name__ == "__main__":
    import sys

    out_path = sys.argv[1] if len(sys.argv) > 1 else "output/goals_dashboard.twb"
    write_workbook(out_path)
    print(f"Wrote {out_path}")
