/* Renders the goals dashboard grid from data.json using Chart.js. */
(() => {
  // Premier brand palette (see brand guidelines).
  const PREMIER_NAVY = "#103454";
  const PREMIER_BLUE = "#1797D7";
  const PREMIER_TEAL = "#007F91";
  const PREMIER_YELLOW = "#FFC532";
  const PREMIER_ORANGE = "#E24301";
  const ACCENT_GREY = "#82889B";

  const TIER_COLORS = [PREMIER_BLUE, PREMIER_YELLOW, ACCENT_GREY, PREMIER_NAVY, PREMIER_TEAL];
  const THRESHOLD_COLOR = PREMIER_ORANGE;
  const TARGET_COLOR = PREMIER_TEAL;

  Chart.defaults.font.family = "'Inter Tight', 'Roboto', Arial, sans-serif";
  Chart.defaults.color = PREMIER_NAVY;

  const charts = new Map(); // goal key -> Chart instance (grid card)
  let modalChart = null;
  let MONTH_QUARTERS = []; // parallel to each goal's months[], set once data.json loads

  function colorForSeries(series, tierIndex) {
    if (series.type === "Threshold") return THRESHOLD_COLOR;
    if (series.type === "Target") return TARGET_COLOR;
    return TIER_COLORS[tierIndex % TIER_COLORS.length];
  }

  function dashForSeries(series) {
    if (series.type === "Forecast") return [6, 4];
    if (series.type === "Threshold") return [2, 3];
    return [];
  }

  function tierIndexMap(goal) {
    const tiers = [...new Set(goal.series.filter(s => s.type === "Actual" || s.type === "Forecast").map(s => s.tier))];
    const map = {};
    tiers.forEach((t, i) => { map[t] = i; });
    return map;
  }

  function buildDatasets(goal) {
    const tierIdx = tierIndexMap(goal);
    const thresholdIdx = goal.series.findIndex(s => s.type === "Threshold");
    return goal.series.map((s, i) => {
      const dataset = {
        label: s.name,
        data: s.data,
        borderColor: colorForSeries(s, tierIdx[s.tier] ?? 0),
        backgroundColor: colorForSeries(s, tierIdx[s.tier] ?? 0),
        borderDash: dashForSeries(s),
        borderWidth: s.type === "Target" || s.type === "Threshold" ? 2 : 2.25,
        pointRadius: s.type === "Actual" ? 3 : 0,
        pointHoverRadius: 4,
        spanGaps: false,
        tension: 0,
        fill: false,
      };
      // Shade the zone between Threshold and Target so it reads as an
      // obvious band even when the two lines sit numerically close together
      // relative to the rest of the chart's scale.
      if (s.type === "Target" && thresholdIdx !== -1 && i !== thresholdIdx) {
        dataset.fill = {
          target: thresholdIdx,
          above: PREMIER_YELLOW + "2E",
          below: PREMIER_YELLOW + "2E",
        };
      }
      return dataset;
    });
  }

  // Shades each fiscal quarter's column with its own distinct tint, looked up
  // by month index in MONTH_QUARTERS (not parsed from the label text, so the
  // displayed month labels can stay short - long, rotated "Jul (Q1)"-style
  // labels were eating vertical plot space and squeezing Threshold/Target
  // lines flat on some charts).
  // Each month's tick sits in the center of its own band (band edges are the
  // midpoints between it and its neighbors, with the first/last bands
  // extending out to the chart's edges) - this is what makes the last band
  // (June) look "full width" rather than collapsing to nothing, since it
  // still gets a proper half-band-plus-edge-margin region like every other
  // month, just like the outermost band on the left (Base).
  const QUARTER_TINTS = {
    Q1: "#10345429", // Premier Navy
    Q2: "#1797D740", // Premier Blue
    Q3: "#007F9140", // Premier Teal
    Q4: "#82889B40", // Premier (Accent) Grey
  };

  function quarterTint(q) {
    return QUARTER_TINTS[q] || null;
  }

  function quarterBoundaries(chart) {
    const { chartArea, scales } = chart;
    const n = chart.data.labels.length;
    const xPixels = Array.from({ length: n }, (_, i) => scales.x.getPixelForValue(i));
    const boundaries = [chartArea.left];
    for (let i = 0; i < n - 1; i++) boundaries.push((xPixels[i] + xPixels[i + 1]) / 2);
    boundaries.push(chartArea.right);
    return boundaries;
  }

  const quarterBackgroundPlugin = {
    id: "quarterBackground",
    beforeDraw(chart) {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      const labels = chart.data.labels;
      const boundaries = quarterBoundaries(chart);
      ctx.save();
      let i = 0;
      while (i < labels.length) {
        const q = quarterOf(i);
        let j = i;
        while (j + 1 < labels.length && quarterOf(j + 1) === q) j++;
        const tint = quarterTint(q);
        if (tint) {
          ctx.fillStyle = tint;
          ctx.fillRect(boundaries[i], chartArea.top, boundaries[j + 1] - boundaries[i], chartArea.bottom - chartArea.top);
        }
        i = j + 1;
      }
      ctx.restore();
    },
  };

  function quarterOf(idx) {
    return MONTH_QUARTERS[idx] || null;
  }

  let quarterCenterCache = null;

  // One month-index per quarter (its middle month) to label on the secondary
  // top axis, so "Q1"/"Q2"/etc. appears once per shaded block instead of on
  // every tick.
  function quarterCenterIndices() {
    if (quarterCenterCache) return quarterCenterCache;
    const groups = {};
    MONTH_QUARTERS.forEach((q, i) => {
      if (q) (groups[q] = groups[q] || []).push(i);
    });
    const centers = {};
    Object.entries(groups).forEach(([q, idxs]) => {
      centers[idxs[Math.floor(idxs.length / 2)]] = q;
    });
    quarterCenterCache = centers;
    return centers;
  }

  // Rounds up to a "nice" number (1/2/2.5/5/10 x a power of ten) so the Y axis
  // max - and therefore its auto-generated tick values - land on whole,
  // human-friendly numbers instead of an arbitrary padded decimal.
  function niceCeil(value) {
    if (!(value > 0)) return 1;
    const exponent = Math.floor(Math.log10(value));
    const magnitude = Math.pow(10, exponent);
    const residual = value / magnitude;
    let niceResidual;
    if (residual <= 1) niceResidual = 1;
    else if (residual <= 2) niceResidual = 2;
    else if (residual <= 2.5) niceResidual = 2.5;
    else if (residual <= 5) niceResidual = 5;
    else niceResidual = 10;
    return niceResidual * magnitude;
  }

  // The Y axis was auto-scaling to fit runaway diverging Forecast lines (which
  // can shoot up into the hundreds), squeezing the flat Threshold/Target
  // reference lines down near zero. Scale instead to the Actual/Threshold/
  // Target range - a Forecast that blows past it is still drawn, just clipped
  // at the top edge, which is more honest than stretching the whole chart.
  // "Base" (month index 0, last fiscal year's value) is also excluded: it's
  // frequently the single largest number in the series and including it
  // stretches the axis far beyond anything currently happening, squeezing
  // the Threshold/Target gap even further for no benefit - Base is still
  // plotted as a point, just not allowed to dictate the scale.
  function yRange(goal) {
    const values = goal.series
      .filter(s => s.type !== "Forecast")
      .flatMap(s => s.data.slice(1))
      .filter(v => v !== null && v !== undefined);
    if (!values.length) return {};
    const max = Math.max(...values);
    // A hard max (not suggestedMax) so a Forecast line diverging past this
    // range gets visually clipped at the edge instead of stretching the whole
    // axis - suggestedMax only raises the floor, it doesn't cap it. Rounded
    // to a "nice" number so ticks come out as whole numbers, not decimals.
    return { min: 0, max: niceCeil(max * 1.15 || 1), ticks: { precision: 0 } };
  }

  function makeConfig(goal, { legend = true, titleFont = 11 } = {}) {
    return {
      type: "line",
      data: { labels: goal.months, datasets: buildDatasets(goal) },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "nearest", axis: "x", intersect: false },
        scales: {
          x: { ticks: { font: { size: titleFont }, autoSkip: true, maxRotation: 0, minRotation: 0 } },
          xQuarter: {
            type: "category",
            labels: goal.months,
            position: "top",
            offset: false,
            grid: { display: false, drawOnChartArea: false },
            border: { display: false },
            ticks: {
              autoSkip: false,
              font: { size: titleFont, weight: "700" },
              callback: (_value, index) => quarterCenterIndices()[index] || "",
            },
          },
          y: {
            title: { display: true, text: goal.yLabel, font: { size: titleFont } },
            ...yRange(goal),
          },
        },
        plugins: {
          legend: {
            display: legend,
            labels: { boxWidth: 12, font: { size: 10 } },
          },
          tooltip: { mode: "nearest", intersect: false },
        },
      },
      plugins: [quarterBackgroundPlugin],
    };
  }

  function weightLabel(goal) {
    return `Weight: ${goal.weightPct.toFixed(1)}%`;
  }

  function subtitleLine(goal) {
    const bits = [goal.owner, weightLabel(goal)].filter(Boolean);
    return bits.join(" | ");
  }

  function renderGrid(data) {
    const grid = document.getElementById("grid");
    grid.innerHTML = "";
    data.goals.forEach(goal => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <h3>${goal.order}. ${escapeHtml(goal.title)}</h3>
        <div class="card-meta">${escapeHtml(subtitleLine(goal))}</div>
        <div class="canvas-wrap"><canvas></canvas></div>
      `;
      card.addEventListener("click", () => openModal(goal));
      grid.appendChild(card);

      const canvas = card.querySelector("canvas");
      const chart = new Chart(canvas.getContext("2d"), makeConfig(goal, { legend: false, titleFont: 9 }));
      charts.set(goal.key, chart);
    });
  }

  function openModal(goal) {
    const modal = document.getElementById("modal");
    document.getElementById("modal-title").textContent = `${goal.order}. ${goal.title}`;
    document.getElementById("modal-subtitle").textContent = subtitleLine(goal);
    const paceParts = [
      goal.thresholdText ? `Threshold: ${goal.thresholdText}` : "",
      goal.targetText ? `Target: ${goal.targetText}` : "",
      goal.currentPaceText || "",
      goal.requiredPaceText || "",
    ].filter(Boolean);
    document.getElementById("modal-pace").textContent = paceParts.join("   |   ");

    if (modalChart) modalChart.destroy();
    const canvas = document.getElementById("modal-canvas");
    modalChart = new Chart(canvas.getContext("2d"), makeConfig(goal, { legend: true, titleFont: 12 }));

    modal.hidden = false;
  }

  function closeModal() {
    document.getElementById("modal").hidden = true;
    if (modalChart) {
      modalChart.destroy();
      modalChart = null;
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal").addEventListener("click", e => {
    if (e.target.id === "modal") closeModal();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeModal();
  });

  // Cache-bust with the load time so browsers/CDN edges never serve a stale
  // data.json after goals.csv is updated and re-exported.
  fetch(`data.json?v=${Date.now()}`, { cache: "no-store" })
    .then(r => r.json())
    .then(data => {
      MONTH_QUARTERS = data.monthQuarters || [];
      renderGrid(data);
      document.getElementById("status-line").textContent =
        `Loaded ${data.goals.length} goals from ${data.generatedFromRows} data rows.`;
    })
    .catch(err => {
      document.getElementById("status-line").textContent =
        "Failed to load data.json - " + err;
    });
})();
