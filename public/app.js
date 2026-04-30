const numberFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const byId = (id) => document.getElementById(id);

const providerColors = {
  Azure: "#2f9bff",
  OpenAI: "#f4f7fb",
};

const fallbackColors = ["#34d399", "#f59e0b", "#f472b6", "#a78bfa"];

const providerName = (record) => record.provider || "Azure";

const colorForProvider = (provider, index) =>
  providerColors[provider] || fallbackColors[index % fallbackColors.length];

const formatDate = (value) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));

const formatDateTime = (value) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const metricPoint = (record) => {
  const values = (record.runs || [])
    .map((run) => run.streamTps)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const average = record.summary.averageStreamTps;

  return {
    average,
    createdAt: record.createdAt,
    deployment: record.deployment,
    max: values.length === 0 ? average : Math.max(...values),
    min: values.length === 0 ? average : Math.min(...values),
    provider: providerName(record),
  };
};

const groupByProvider = (records) => {
  const groups = new Map();

  records.forEach((record) => {
    const provider = providerName(record);
    const group = groups.get(provider) || [];
    group.push(metricPoint(record));
    groups.set(provider, group);
  });

  return [...groups.entries()]
    .map(([provider, points], index) => ({
      color: colorForProvider(provider, index),
      points: points.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
      provider,
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
};

const drawRangeBars = (context, series, plot, offset) => {
  context.save();
  context.strokeStyle = series.color;
  context.globalAlpha = 0.26;
  context.lineWidth = 10;
  context.lineCap = "round";

  series.points.forEach((point) => {
    const x = plot.xFor(point.createdAt) + offset;
    context.beginPath();
    context.moveTo(x, plot.yFor(point.min));
    context.lineTo(x, plot.yFor(point.max));
    context.stroke();
  });

  context.restore();
};

const drawSeries = (context, series, plot) => {
  if (series.points.length === 0) {
    return;
  }

  context.beginPath();
  series.points.forEach((point, index) => {
    const x = plot.xFor(point.createdAt);
    const y = plot.yFor(point.average);
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });

  context.lineWidth = 3;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.strokeStyle = series.color;
  context.stroke();

  series.points.forEach((point) => {
    context.beginPath();
    context.arc(plot.xFor(point.createdAt), plot.yFor(point.average), 4.5, 0, Math.PI * 2);
    context.fillStyle = "#0f131b";
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = series.color;
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
  const padding = { bottom: 54, left: 66, right: 34, top: 30 };
  const series = groupByProvider(records);
  const points = series.flatMap((item) => item.points);
  const values = points.flatMap((point) => [point.min, point.max]);
  const times = points.map((point) => new Date(point.createdAt).getTime());
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const maxValue = Math.max(10, ...values) * 1.16;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#0f131b";
  context.fillRect(0, 0, width, height);

  if (points.length === 0) {
    context.fillStyle = "#9aa6b5";
    context.font = "15px Avenir Next, sans-serif";
    context.textAlign = "center";
    context.fillText("No benchmark results yet", width / 2, height / 2);
    return;
  }

  const plot = {
    xFor: (createdAt) => {
      if (minTime === maxTime) {
        return padding.left + plotWidth / 2;
      }

      const time = new Date(createdAt).getTime();
      return padding.left + ((time - minTime) / (maxTime - minTime)) * plotWidth;
    },
    yFor: (value) => padding.top + plotHeight - (value / maxValue) * plotHeight,
  };

  context.strokeStyle = "rgba(148, 163, 184, 0.15)";
  context.fillStyle = "#9aa6b5";
  context.font = "12px Avenir Next, sans-serif";
  context.textAlign = "right";
  context.textBaseline = "middle";

  for (let tick = 0; tick <= 6; tick += 1) {
    const value = (maxValue * tick) / 6;
    const y = plot.yFor(value);
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillText(numberFormat.format(value), padding.left - 12, y);
  }

  const labelCount = Math.min(7, Math.max(2, records.length));
  context.textAlign = "center";
  context.textBaseline = "top";
  for (let index = 0; index < labelCount; index += 1) {
    const ratioAt = labelCount === 1 ? 0 : index / (labelCount - 1);
    const time = minTime + (maxTime - minTime) * ratioAt;
    const x = padding.left + plotWidth * ratioAt;
    context.fillText(formatDate(time), x, height - padding.bottom + 18);
    context.beginPath();
    context.moveTo(x, padding.top);
    context.lineTo(x, height - padding.bottom);
    context.stroke();
  }

  context.strokeStyle = "rgba(244, 247, 251, 0.42)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(padding.left, padding.top);
  context.lineTo(padding.left, height - padding.bottom);
  context.lineTo(width - padding.right, height - padding.bottom);
  context.stroke();

  series.forEach((item, index) => {
    const offset = (index - (series.length - 1) / 2) * 12;
    drawRangeBars(context, item, plot, offset);
  });
  series.forEach((item) => drawSeries(context, item, plot));
};

const renderLegend = (series) => {
  byId("legend").innerHTML = series
    .map(
      (item) =>
        `<span><i style="background:${item.color}"></i>${item.provider}</span>`,
    )
    .join("");
};

const renderProviderSummary = (series) => {
  const cards = series
    .map((item) => {
      const latest = item.points.at(-1);
      if (!latest) {
        return "";
      }

      return `
        <article class="provider-card">
          <span>${item.provider}</span>
          <strong>${numberFormat.format(latest.average)}</strong>
          <small>${numberFormat.format(latest.min)}-${numberFormat.format(
            latest.max,
          )} TPS range · ${latest.deployment}</small>
        </article>
      `;
    })
    .join("");

  byId("providerSummary").innerHTML = cards;
};

const render = (records, generatedAt) => {
  const latest = records.at(-1);
  const series = groupByProvider(records);
  const sampleLabel = records.length === 1 ? "sample" : "samples";
  const providerLabel = series.length === 1 ? "provider" : "providers";

  byId("sampleCount").textContent = `${records.length} scheduled ${sampleLabel}`;
  byId("providerCount").textContent = `${series.length} of ${series.length} ${providerLabel}`;
  renderLegend(series);
  renderProviderSummary(series);

  if (!latest) {
    byId("updatedAt").textContent = "No samples recorded";
    drawChart([]);
    return;
  }

  byId("updatedAt").textContent = `Updated ${formatDateTime(
    generatedAt || latest.createdAt,
  )}`;
  drawChart(records);
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
    byId("providerCount").textContent = "0 of 0 providers";
    byId("providerSummary").innerHTML = "";
    drawChart([]);
  });

window.addEventListener("resize", () => {
  loadResults()
    .then((data) => drawChart(data.history || []))
    .catch(() => undefined);
});
