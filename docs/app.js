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

  function lastNonNull(arr) {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] !== null && arr[i] !== undefined) return arr[i];
    }
    return null;
  }

  // At risk if any tier's projected value at the deadline misses Target.
  // Direction is inferred per tier from Base vs Target (Target below Base
  // means lower is better), falling back to Threshold vs Target.
  function isAtRisk(goal) {
    const target = goal.series.find(s => s.type === "Target");
    const threshold = goal.series.find(s => s.type === "Threshold");
    if (!target) return false;
    const targetValue = lastNonNull(target.data);
    const thresholdValue = threshold ? lastNonNull(threshold.data) : null;
    if (targetValue === null) return false;
    const deadlineIdx = goal.months.indexOf(goal.deadlineMonth);

    const tiers = [...new Set(goal.series.filter(s => s.type === "Actual" || s.type === "Forecast").map(s => s.tier))];
    return tiers.some(tier => {
      const actual = goal.series.find(s => s.tier === tier && s.type === "Actual");
      const forecast = goal.series.find(s => s.tier === tier && s.type === "Forecast");
      const reference = actual?.data[0] ?? thresholdValue;
      const higherIsBetter = reference === null || reference === undefined || targetValue >= reference;
      const projected =
        (deadlineIdx >= 0 ? (forecast?.data[deadlineIdx] ?? actual?.data[deadlineIdx]) : null) ??
        lastNonNull(forecast ? forecast.data : []) ??
        lastNonNull(actual ? actual.data : []);
      if (projected === null || projected === undefined) return false;
      return higherIsBetter ? projected < targetValue : projected > targetValue;
    });
  }

  function buildDatasets(goal, forward = v => v) {
    const tierIdx = tierIndexMap(goal);
    const thresholdIdx = goal.series.findIndex(s => s.type === "Threshold");
    return goal.series.map((s, i) => {
      const dataset = {
        label: s.name,
        data: s.data.map((v, x) => ({ x, y: v === null || v === undefined ? null : forward(v) })),
        rawData: s.data,
        seriesType: s.type,
        tier: s.tier,
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
    const n = MONTH_QUARTERS.length;
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
      const count = MONTH_QUARTERS.length;
      const boundaries = quarterBoundaries(chart);
      ctx.save();
      let i = 0;
      while (i < count) {
        const q = quarterOf(i);
        let j = i;
        while (j + 1 < count && quarterOf(j + 1) === q) j++;
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

  // Round up to a 1/1.2/1.5/2/2.5/3/4/5/6/8/10 x 10^n value. Finer than a
  // 1-2-5 ladder so the axis max never overshoots the data by nearly 2x
  // (which would squeeze the Threshold/Target gap against the bottom).
  const NICE_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  function niceCeil(value) {
    if (!(value > 0)) return 1;
    const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
    const residual = value / magnitude;
    return NICE_STEPS.find(s => s >= residual - 1e-9) * magnitude;
  }

  // Below this Threshold-to-Target gap (as a share of the axis height) a
  // linear zero-based axis squeezes the two lines together, so the axis is
  // switched to a square-root scale (labelled, zero-based) that gives small
  // values more room.
  const MIN_REFERENCE_GAP_SHARE = 0.2;

  // "Nice" 1/2/5 x 10^n tick values (largest first) that fit under max.
  function sqrtTickValues(max, gapShare) {
    const candidates = [];
    for (let e = Math.floor(Math.log10(max)); e >= 0; e--) {
      [5, 2, 1].forEach(m => {
        const v = m * Math.pow(10, e);
        if (v <= max) candidates.push(v);
      });
    }
    const gap = gapShare * Math.sqrt(max);
    const ticks = [];
    let last = Infinity;
    candidates.forEach(c => {
      if (last - Math.sqrt(c) >= gap) {
        ticks.push(c);
        last = Math.sqrt(c);
      }
    });
    while (ticks.length && Math.sqrt(ticks[ticks.length - 1]) < gap) ticks.pop();
    ticks.push(0);
    return ticks;
  }

  // Returns the Y-axis transform plus Chart.js scale options for a goal.
  // Scales to the non-Forecast data (Base included) so a diverging Forecast is
  // clipped at the top edge instead of stretching the axis (a hard max, since
  // suggestedMax only raises the floor).
  function yAxis(goal, compact) {
    const identity = { forward: v => v, inverse: v => v, sqrt: false };
    const values = goal.series
      .filter(s => s.type !== "Forecast")
      .flatMap(s => s.data)
      .filter(v => v !== null && v !== undefined);
    if (!values.length) return { ...identity, scale: {} };
    const lo = Math.min(...values);
    const hi = Math.max(...values);

    // Values all far from zero (e.g. a 56-100% completion goal): crop the
    // baseline so Threshold and Target spread across the plot.
    if (hi > 0 && lo / hi > 0.4) {
      const range = hi - lo;
      const step = Math.pow(10, Math.floor(Math.log10(range)));
      const min = Math.max(0, Math.floor((lo - 0.08 * range) / step) * step);
      const max = Math.ceil((hi + 0.08 * range) / step) * step;
      return { ...identity, scale: { min, max, ticks: { precision: 0 } } };
    }

    const max = niceCeil(hi * 1.08);
    const threshold = goal.series.find(s => s.type === "Threshold");
    const target = goal.series.find(s => s.type === "Target");
    const t = threshold ? lastNonNull(threshold.data) : null;
    const g = target ? lastNonNull(target.data) : null;
    const gapShare = t !== null && g !== null ? Math.abs(g - t) / max : 1;

    if (gapShare >= MIN_REFERENCE_GAP_SHARE) {
      return { ...identity, scale: { min: 0, max, ticks: { precision: 0 } } };
    }

    const forward = v => Math.sqrt(Math.max(v, 0));
    const tickValues = sqrtTickValues(max, compact ? 0.17 : 0.1);
    return {
      forward,
      inverse: v => v * v,
      sqrt: true,
      scale: {
        min: 0,
        max: forward(max),
        afterBuildTicks: axis => { axis.ticks = tickValues.map(v => ({ value: forward(v) })); },
        ticks: { callback: v => formatValue(v * v) },
      },
    };
  }

  function formatValue(v) {
    return Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 });
  }

  function makeConfig(goal, { legend = true, titleFont = 11 } = {}) {
    const axis = yAxis(goal, titleFont <= 9);
    const lastIdx = goal.months.length - 1;
    // Numeric X axis (months are 0..12) so it can extend half a month past the
    // last month; that gives Q4's shaded band the same width as Q1-Q3.
    const xRange = { type: "linear", min: 0, max: lastIdx + 0.5 };
    return {
      type: "line",
      data: { datasets: buildDatasets(goal, axis.forward) },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "nearest", axis: "x", intersect: false },
        scales: {
          x: {
            ...xRange,
            afterBuildTicks: scale => { scale.ticks = goal.months.map((_, i) => ({ value: i })); },
            ticks: {
              font: { size: titleFont },
              autoSkip: true,
              maxRotation: 0,
              minRotation: 0,
              callback: value => goal.months[value] ?? "",
            },
          },
          xQuarter: {
            ...xRange,
            position: "top",
            grid: { display: false, drawOnChartArea: false },
            border: { display: false },
            afterBuildTicks: scale => {
              scale.ticks = Object.keys(quarterCenterIndices()).map(i => ({ value: Number(i) }));
            },
            ticks: {
              autoSkip: false,
              font: { size: titleFont, weight: "700" },
              callback: value => quarterCenterIndices()[value] || "",
            },
          },
          y: {
            title: { display: true, text: goal.yLabel, font: { size: titleFont } },
            ...axis.scale,
          },
        },
        plugins: {
          legend: {
            display: legend,
            labels: { boxWidth: 12, font: { size: 10 } },
          },
          tooltip: {
            mode: "nearest",
            intersect: false,
            // The Forecast line is seeded with the last Actual value so the
            // lines connect; don't repeat that point in the tooltip.
            filter: item => {
              if (item.dataset.seriesType !== "Forecast") return true;
              const actual = item.chart.data.datasets.find(
                d => d.seriesType === "Actual" && d.tier === item.dataset.tier
              );
              const actualValue = actual ? actual.rawData[item.dataIndex] : null;
              return actualValue === null || actualValue === undefined;
            },
            callbacks: {
              title: items => (items.length ? goal.months[items[0].parsed.x] : ""),
              label: ctx => `${ctx.dataset.label}: ${formatValue(ctx.dataset.rawData[ctx.dataIndex])}`,
            },
          },
        },
      },
      plugins: [quarterBackgroundPlugin],
    };
  }

  function weightLabel(goal) {
    return `Weight: ${goal.weightPct.toFixed(1)}%`;
  }

  function subtitleLine(goal) {
    const bits = [goal.owner, weightLabel(goal), yAxis(goal, true).sqrt ? "\u221a scale" : ""].filter(Boolean);
    return bits.join(" | ");
  }

  function renderGrid(data) {
    const grid = document.getElementById("grid");
    grid.innerHTML = "";
    data.goals.forEach(goal => {
      const card = document.createElement("div");
      card.className = isAtRisk(goal) ? "card at-risk" : "card";
      card.innerHTML = `
        <h3>${goal.order}. ${escapeHtml(goal.title)}</h3>
        <div class="card-meta">${escapeHtml(subtitleLine(goal))}</div>
        <div class="canvas-wrap"><canvas></canvas></div>
      `;
      card.addEventListener("click", () => openModal(goal));
      grid.appendChild(card);

      const canvas = card.querySelector("canvas");
      new Chart(canvas.getContext("2d"), makeConfig(goal, { legend: false, titleFont: 9 }));
    });
  }

  const isSummaryGoal = goal => goal.series.some(s => s.tier === "Weighted Avg");

  function renderSummary(data) {
    const tracked = data.goals.filter(g => !isSummaryGoal(g));
    const atRisk = tracked.filter(isAtRisk).length;
    const summaryGoal = data.goals.find(isSummaryGoal);
    const actual = summaryGoal && summaryGoal.series.find(s => s.type === "Actual");
    const score = actual ? lastNonNull(actual.data) : null;

    const pills = [
      [tracked.length, "goals tracked", ""],
      [atRisk, "at risk", atRisk > 0 ? "risk" : ""],
      [tracked.length - atRisk, "on track", ""],
    ];
    if (score !== null) pills.push([`${Math.round(score)}%`, "weighted score", ""]);

    document.getElementById("summary").innerHTML = pills
      .map(([value, label, cls]) => `<div class="summary-pill ${cls}"><strong>${value}</strong>${label}</div>`)
      .join("");
  }

  function statusText(data) {
    const parts = [];
    if (data.dataThrough) parts.push(`Data through ${data.dataThrough}`);
    if (data.generatedAt) {
      const updated = new Date(data.generatedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
      parts.push(`Updated ${updated}`);
    }
    return parts.join(" \u00b7 ");
  }

  function openModal(goal) {
    const modal = document.getElementById("modal");
    modal.querySelector(".modal-content").classList.toggle("at-risk", isAtRisk(goal));
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
      renderSummary(data);
      document.getElementById("status-line").textContent = statusText(data);
    })
    .catch(err => {
      document.getElementById("status-line").textContent =
        "Failed to load data.json - " + err;
    });
})();
