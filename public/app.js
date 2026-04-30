const numberFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const currencyFormat = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 4,
  minimumFractionDigits: 4,
  style: "currency",
});

const byId = (id) => document.getElementById(id);

const formatDate = (value) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const drawSeries = (context, points, color, plot) => {
  if (points.length === 0) {
    return;
  }

  context.beginPath();
  points.forEach((point, index) => {
    const x = plot.xFor(index);
    const y = plot.yFor(point);
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.lineWidth = 4;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.strokeStyle = color;
  context.stroke();

  points.forEach((point, index) => {
    context.beginPath();
    context.arc(plot.xFor(index), plot.yFor(point), 4.5, 0, Math.PI * 2);
    context.fillStyle = "#fffaf0";
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = color;
    context.stroke();
  });
};

const drawChart = (records) => {
  const canvas = byId("tpsChart");
  const context = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  context.scale(ratio, ratio);

  const width = rect.width;
  const height = rect.height;
  const padding = { bottom: 46, left: 58, right: 26, top: 28 };
  const stream = records.map((record) => record.summary.averageStreamTps);
  const endToEnd = records.map((record) => record.summary.averageEndToEndTps);
  const values = [...stream, ...endToEnd];
  const maxValue = Math.max(10, ...values) * 1.18;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#fffaf0";
  context.fillRect(0, 0, width, height);

  const plot = {
    xFor: (index) =>
      padding.left +
      (records.length <= 1 ? plotWidth / 2 : (plotWidth * index) / (records.length - 1)),
    yFor: (value) => padding.top + plotHeight - (value / maxValue) * plotHeight,
  };

  context.strokeStyle = "rgba(23, 21, 18, 0.12)";
  context.fillStyle = "#6c665e";
  context.font = "12px Avenir Next, sans-serif";
  context.textAlign = "right";
  context.textBaseline = "middle";

  for (let tick = 0; tick <= 4; tick += 1) {
    const value = (maxValue * tick) / 4;
    const y = plot.yFor(value);
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillText(numberFormat.format(value), padding.left - 10, y);
  }

  context.strokeStyle = "#171512";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(padding.left, padding.top);
  context.lineTo(padding.left, height - padding.bottom);
  context.lineTo(width - padding.right, height - padding.bottom);
  context.stroke();

  drawSeries(context, stream, "#1d69a8", plot);
  drawSeries(context, endToEnd, "#b9831f", plot);

  context.fillStyle = "#6c665e";
  context.textAlign = "center";
  context.textBaseline = "top";

  const labelEvery = Math.max(1, Math.ceil(records.length / 6));
  records.forEach((record, index) => {
    if (index % labelEvery !== 0 && index !== records.length - 1) {
      return;
    }

    const date = new Date(record.createdAt);
    context.fillText(
      `${date.getMonth() + 1}/${date.getDate()}`,
      plot.xFor(index),
      height - padding.bottom + 16,
    );
  });
};

const renderTable = (records) => {
  const rows = records
    .slice()
    .reverse()
    .slice(0, 20)
    .map(
      (record) => `
        <tr>
          <td>${formatDate(record.createdAt)}</td>
          <td>${record.deployment}</td>
          <td>${numberFormat.format(record.summary.averageStreamTps)}</td>
          <td>${numberFormat.format(record.summary.averageEndToEndTps)}</td>
          <td>${numberFormat.format(record.summary.totalOutputTokens)}</td>
          <td>${numberFormat.format(record.summary.totalReasoningTokens)}</td>
          <td>${currencyFormat.format(record.summary.totalCostUsd)}</td>
        </tr>
      `,
    )
    .join("");

  byId("historyTable").innerHTML =
    rows ||
    `<tr><td colspan="7">No benchmark history has been recorded yet.</td></tr>`;
};

const render = (records, generatedAt) => {
  const latest = records.at(-1);
  byId("sampleCount").textContent = `${records.length} scheduled samples`;

  if (!latest) {
    byId("updatedAt").textContent = "No samples recorded";
    renderTable([]);
    drawChart([]);
    return;
  }

  byId("updatedAt").textContent = `Updated ${formatDate(generatedAt || latest.createdAt)}`;
  byId("latestStreamTps").textContent = numberFormat.format(
    latest.summary.averageStreamTps,
  );
  byId("latestEndToEndTps").textContent = numberFormat.format(
    latest.summary.averageEndToEndTps,
  );
  byId("latestReasoningTokens").textContent = numberFormat.format(
    latest.summary.totalReasoningTokens,
  );
  byId("latestCost").textContent = currencyFormat.format(latest.summary.totalCostUsd);

  drawChart(records);
  renderTable(records);
};

const loadResults = async () => {
  const response = await fetch("/results.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load benchmark results: ${response.status}`);
  }

  return response.json();
};

loadResults()
  .then((data) => render(data.history || [], data.generatedAt))
  .catch((error) => {
    console.error(error);
    byId("updatedAt").textContent = "Results unavailable";
    byId("sampleCount").textContent = "No results.json found";
    renderTable([]);
  });

window.addEventListener("resize", () => {
  loadResults()
    .then((data) => drawChart(data.history || []))
    .catch(() => undefined);
});
