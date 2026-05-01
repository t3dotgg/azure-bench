import type { BenchmarkRecord, BenchmarkRun } from "@/types";

export type MetricKey = "streamTps" | "endToEndTps" | "ttft";

export type MetricStats = {
  avg: number;
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
  derive: (record: BenchmarkRecord) => number | null;
  stats: (record: BenchmarkRecord) => MetricStats | null;
};

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const formatTps = (v: number): string =>
  v.toLocaleString("en-US", { maximumFractionDigits: 1 });

const formatSeconds = (v: number): string =>
  v.toLocaleString("en-US", { maximumFractionDigits: 2 });

const computeStats = (
  record: BenchmarkRecord,
  pick: (run: BenchmarkRun) => number | null,
): MetricStats | null => {
  const values: number[] = [];
  for (const run of record.runs) {
    const v = pick(run);
    if (isFiniteNumber(v)) values.push(v);
  }
  if (values.length === 0) return null;
  let min = values[0];
  let max = values[0];
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { avg: sum / values.length, min, max };
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
    derive: (r) => computeStats(r, pickStreamTps)?.avg ?? null,
    stats: (r) => computeStats(r, pickStreamTps),
  },
  endToEndTps: {
    key: "endToEndTps",
    label: "End-to-end TPS",
    shortLabel: "End-to-end",
    unit: "tps",
    description: "Output tokens per second including time to first token.",
    better: "higher",
    format: formatTps,
    derive: (r) => computeStats(r, pickEndToEndTps)?.avg ?? null,
    stats: (r) => computeStats(r, pickEndToEndTps),
  },
  ttft: {
    key: "ttft",
    label: "Time to first token",
    shortLabel: "TTFT",
    unit: "s",
    description: "Seconds before the model starts streaming.",
    better: "lower",
    format: formatSeconds,
    derive: (r) => computeStats(r, pickTtft)?.avg ?? null,
    stats: (r) => computeStats(r, pickTtft),
  },
};

export const METRIC_OPTIONS: Metric[] = [
  METRICS.streamTps,
  METRICS.endToEndTps,
  METRICS.ttft,
];
