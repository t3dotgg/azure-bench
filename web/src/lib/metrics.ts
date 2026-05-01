import type { BenchmarkRecord, BenchmarkRun } from "@/types";

export type MetricKey = "streamTps" | "endToEndTps" | "ttft";

export type Aggregation = "mean" | "p90";

export type MetricStats = {
  mean: number;
  p90: number;
  min: number;
  max: number;
};

export type Metric = {
  key: MetricKey;
  label: string;
  shortLabel: string;
  unit: string;
  description: string;
  better: "higher" | "lower";
  format: (value: number) => string;
  stats: (record: BenchmarkRecord) => MetricStats | null;
};

export type ProviderComparison = {
  ratio: number;
  percentSlower: number;
  label: string;
  detail: string;
};

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const formatTps = (v: number): string =>
  v.toLocaleString("en-US", { maximumFractionDigits: 1 });

const formatSeconds = (v: number): string =>
  v.toLocaleString("en-US", { maximumFractionDigits: 2 });

const formatRatio = (ratio: number): string =>
  ratio.toLocaleString("en-US", {
    maximumFractionDigits: ratio < 10 ? 1 : 0,
  });

const formatPercent = (percent: number): string =>
  percent.toLocaleString("en-US", { maximumFractionDigits: 0 });

// p90 here means the observed worst-side sample across the runs: for
// higher-is-better metrics the worst end is low; for lower-is-better metrics
// the worst end is high.
const worstP90 = (sorted: number[], better: "higher" | "lower"): number =>
  better === "higher" ? sorted[0] : sorted[sorted.length - 1];

const computeStats = (
  record: BenchmarkRecord,
  pick: (run: BenchmarkRun) => number | null,
  better: "higher" | "lower",
): MetricStats | null => {
  const values: number[] = [];
  for (const run of record.runs) {
    const v = pick(run);
    if (isFiniteNumber(v)) values.push(v);
  }
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((acc, v) => acc + v, 0);
  return {
    mean: sum / values.length,
    p90: worstP90(sorted, better),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
};

const pickStreamTps = (run: BenchmarkRun) =>
  isFiniteNumber(run.streamTps) ? run.streamTps : null;

const pickEndToEndTps = (run: BenchmarkRun) =>
  isFiniteNumber(run.endToEndTps) ? run.endToEndTps : null;

const pickTtft = (run: BenchmarkRun) =>
  isFiniteNumber(run.timeToFirstTokenSeconds)
    ? run.timeToFirstTokenSeconds
    : null;

export const METRICS: Record<MetricKey, Metric> = {
  streamTps: {
    key: "streamTps",
    label: "Stream TPS",
    shortLabel: "Stream TPS",
    unit: "tps",
    description: "Streamed output tokens per second.",
    better: "higher",
    format: formatTps,
    stats: (r) => computeStats(r, pickStreamTps, "higher"),
  },
  endToEndTps: {
    key: "endToEndTps",
    label: "End-to-end TPS",
    shortLabel: "End-to-end",
    unit: "tps",
    description: "Output tokens per second including time to first token.",
    better: "higher",
    format: formatTps,
    stats: (r) => computeStats(r, pickEndToEndTps, "higher"),
  },
  ttft: {
    key: "ttft",
    label: "Time to first token",
    shortLabel: "TTFT",
    unit: "s",
    description: "Seconds before the model starts streaming.",
    better: "lower",
    format: formatSeconds,
    stats: (r) => computeStats(r, pickTtft, "lower"),
  },
};

export const METRIC_OPTIONS: Metric[] = [
  METRICS.streamTps,
  METRICS.endToEndTps,
  METRICS.ttft,
];

export const AGGREGATION_OPTIONS: { value: Aggregation; label: string }[] = [
  { value: "mean", label: "Mean" },
  { value: "p90", label: "P90" },
];

export const compareAgainstOpenAI = (
  metric: Metric,
  azureValue: number | null | undefined,
  openAIValue: number | null | undefined,
): ProviderComparison | null => {
  if (
    !isFiniteNumber(azureValue) ||
    !isFiniteNumber(openAIValue) ||
    azureValue <= 0 ||
    openAIValue <= 0
  ) {
    return null;
  }

  const ratio =
    metric.better === "higher"
      ? openAIValue / azureValue
      : azureValue / openAIValue;

  if (ratio <= 1) return null;

  const percentSlower =
    metric.better === "higher"
      ? (1 - azureValue / openAIValue) * 100
      : (azureValue / openAIValue - 1) * 100;

  const label = `${formatRatio(ratio)}x worse`;
  const detail = `${formatPercent(percentSlower)}% slower`;

  return {
    ratio,
    percentSlower,
    label,
    detail,
  };
};
