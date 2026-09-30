/* Renders the goals dashboard grid from data.json using Chart.js. */
(() => {
  const TIER_COLORS = ["#2563eb", "#f59e0b", "#6b7280", "#7c3aed", "#0ea5e9"];
  const THRESHOLD_COLOR = "#dc2626";
  const TARGET_COLOR = "#16a34a";

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

  // Shades each fiscal quarter's column with an alternating tint, reading the
  // quarter tag ("(Q1)" etc.) straight out of the month label strings.
  const quarterBackgroundPlugin = {
    id: "quarterBackground",
    beforeDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea) return;
      const labels = chart.data.labels;
      const colors = { Q1: "#eff6ff", Q2: "#fff7ed", Q3: "#f0fdf4", Q4: "#faf5ff" };
      let start = 0;
      let currentQ = quarterOf(labels[0]);
      ctx.save();
      for (let i = 1; i <= labels.length; i++) {
        const q = i < labels.length ? quarterOf(labels[i]) : null;
        if (q !== currentQ) {
          const x0 = scales.x.getPixelForValue(start);
          const x1 = scales.x.getPixelForValue(i - 1) + (scales.x.getPixelForValue(1) - scales.x.getPixelForValue(0)) / 2;
          if (currentQ && colors[currentQ]) {
            ctx.fillStyle = colors[currentQ];
            ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
          }
          start = i;
          currentQ = q;
        }
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
