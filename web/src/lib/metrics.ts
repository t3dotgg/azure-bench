import type { BenchmarkRecord, BenchmarkRun } from "@/types";

export type MetricKey = "streamTps" | "endToEndTps" | "ttft";

export type Metric = {
  key: MetricKey;
  label: string;
  shortLabel: string;
  unit: string;
  description: string;
  better: "higher" | "lower";
  format: (value: number) => string;
  derive: (record: BenchmarkRecord) => number | null;
};

const formatTps = (v: number): string => v.toFixed(1);
const formatSeconds = (v: number): string => v.toFixed(2);

const averageRunValue = (
  record: BenchmarkRecord,
  pick: (run: BenchmarkRun) => number | undefined,
): number | null => {
  const values = record.runs
    .map(pick)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
};

export const METRICS: Record<MetricKey, Metric> = {
  streamTps: {
    key: "streamTps",
    label: "Stream TPS",
    shortLabel: "Stream TPS",
    unit: "tps",
    description: "Streamed output tokens per second. Higher is better.",
    better: "higher",
    format: formatTps,
    derive: (r) => (r.runs.length === 0 ? null : r.summary.averageStreamTps),
  },
  endToEndTps: {
    key: "endToEndTps",
    label: "End-to-end TPS",
    shortLabel: "End-to-end",
    unit: "tps",
    description:
      "Output tokens per second including time to first token. Higher is better.",
    better: "higher",
    format: formatTps,
    derive: (r) =>
      r.runs.length === 0 ? null : r.summary.averageEndToEndTps,
  },
  ttft: {
    key: "ttft",
    label: "Time to first token",
    shortLabel: "TTFT",
    unit: "s",
    description: "Seconds before the model starts streaming. Lower is better.",
    better: "lower",
    format: formatSeconds,
    derive: (r) => averageRunValue(r, (run) => run.timeToFirstTokenSeconds),
  },
};

export const METRIC_OPTIONS: Metric[] = [
  METRICS.streamTps,
  METRICS.endToEndTps,
  METRICS.ttft,
];
