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
    return goal.series.map(s => ({
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
    }));
  }

  // Shades each fiscal quarter's column with its own distinct tint, reading
  // the quarter tag ("(Q1)" etc.) straight out of the month label strings.
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
        const q = quarterOf(labels[i]);
        let j = i;
        while (j + 1 < labels.length && quarterOf(labels[j + 1]) === q) j++;
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

  function quarterOf(label) {
    const m = /\((Q\d)\)/.exec(label || "");
    return m ? m[1] : null;
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
          x: { ticks: { font: { size: titleFont }, maxRotation: 45, minRotation: 45 } },
          y: { title: { display: true, text: goal.yLabel, font: { size: titleFont } }, beginAtZero: false },
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

  fetch("data.json")
    .then(r => r.json())
    .then(data => {
      renderGrid(data);
      document.getElementById("status-line").textContent =
        `Loaded ${data.goals.length} goals from ${data.generatedFromRows} data rows.`;
    })
    .catch(err => {
      document.getElementById("status-line").textContent =
        "Failed to load data.json - " + err;
    });
})();
