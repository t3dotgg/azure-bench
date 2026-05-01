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
  axisLabel: string;
  description: string;
  better: "higher" | "lower";
  format: (value: number) => string;
  stats: (record: BenchmarkRecord) => MetricStats | null;
};

export type ProviderComparison = {
  ratio: number;
  percentDifference: number;
  label: string;
  outcome: "slower" | "same" | "faster";
};

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const formatTps = (v: number): string =>
  v.toLocaleString("en-US", { maximumFractionDigits: 1 });

const formatSeconds = (v: number): string =>
  v.toLocaleString("en-US", { maximumFractionDigits: 2 });

export const formatRatio = (ratio: number): string =>
  ratio.toLocaleString("en-US", {
    maximumFractionDigits: ratio < 10 ? 1 : 0,
  });

export const formatPercent = (percent: number): string =>
  percent.toLocaleString("en-US", { maximumFractionDigits: 0 });

export const SAME_PERFORMANCE_RATIO_THRESHOLD = 1.1;

// P90 here means the cutoff into the worst 10% of observed runs: for
// higher-is-better metrics the worst end is low; for lower-is-better metrics
// the worst end is high.
const worstP90 = (sorted: number[], better: "higher" | "lower"): number => {
  const tailSize = Math.max(1, Math.ceil(sorted.length * 0.1));
  return better === "higher"
    ? sorted[tailSize - 1]
    : sorted[sorted.length - tailSize];
};

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
    label: "Tokens Per Second",
    shortLabel: "TPS",
    unit: "tps",
    axisLabel: "tokens / sec",
    description:
      "Tokens Per Second: streamed output tokens per second after the first output event arrives.",
    better: "higher",
    format: formatTps,
    stats: (r) => computeStats(r, pickStreamTps, "higher"),
  },
  endToEndTps: {
    key: "endToEndTps",
    label: "End-to-end Tokens Per Second",
    shortLabel: "E2E TPS",
    unit: "tps",
    axisLabel: "tokens / sec",
    description: "End-to-end Tokens Per Second: output tokens per second including time to first token.",
    better: "higher",
    format: formatTps,
    stats: (r) => computeStats(r, pickEndToEndTps, "higher"),
  },
  ttft: {
    key: "ttft",
    label: "Time to first token",
    shortLabel: "TTFT",
    unit: "s",
    axisLabel: "seconds",
    description: "Time to first token: seconds before the model starts streaming.",
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

export const AGGREGATION_OPTIONS: {
  value: Aggregation;
  label: string;
  description: string;
}[] = [
  {
    value: "mean",
    label: "Mean",
    description: "Mean: average value across benchmark runs.",
  },
  {
    value: "p90",
    label: "P90",
    description: "P90: worst 10% cutoff for the selected metric.",
  },
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

  const openAIAdvantageRatio =
    metric.better === "higher"
      ? openAIValue / azureValue
      : azureValue / openAIValue;

  if (openAIAdvantageRatio >= SAME_PERFORMANCE_RATIO_THRESHOLD) {
    return {
      ratio: openAIAdvantageRatio,
      percentDifference: (openAIAdvantageRatio - 1) * 100,
      label: `${formatRatio(openAIAdvantageRatio)}× slower`,
      outcome: "slower",
    };
  }

  if (openAIAdvantageRatio <= 1 / SAME_PERFORMANCE_RATIO_THRESHOLD) {
    const azureAdvantageRatio = 1 / openAIAdvantageRatio;
    return {
      ratio: azureAdvantageRatio,
      percentDifference: (azureAdvantageRatio - 1) * 100,
      label: `${formatRatio(azureAdvantageRatio)}× faster`,
      outcome: "faster",
    };
  }

  return {
    ratio: 1,
    percentDifference: 0,
    label: "performance is the same",
    outcome: "same",
  };
};
