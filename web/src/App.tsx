import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { ToggleGroup } from "@/components/ui/toggle-group";
import {
  ThroughputChart,
  colorFor,
  providerName,
} from "@/components/throughput-chart";
import {
  AGGREGATION_OPTIONS,
  METRIC_OPTIONS,
  METRICS,
  compareAgainstOpenAI,
  formatRatio,
  type Aggregation,
  type Metric,
  type MetricKey,
  type ProviderComparison,
} from "@/lib/metrics";
import type { BenchmarkRecord, BenchmarkRun, DashboardResults } from "@/types";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: DashboardResults }
  | { status: "error"; message: string };

type ProviderLatest = {
  provider: string;
  color: string;
  latest: BenchmarkRecord;
};

type DeploymentCallout = {
  provider: string;
  model: string;
  reasoningEffort: string;
  region?: string;
};

type ProviderAggregate = {
  provider: string;
  record: BenchmarkRecord;
};

type ProviderComparisons = Record<Aggregation, ProviderComparison | null>;
type ChartRange = "24h" | "4h" | "custom";
type CustomChartRange = {
  start: string;
  end: string;
};

type RunRow = {
  id: string;
  createdAt: string;
  provider: string;
  deployment: string;
  run: BenchmarkRun;
  prompt?: string;
  status: "ok";
};

type FailureRow = {
  id: string;
  createdAt: string;
  provider: string;
  deployment: string;
  failure: NonNullable<BenchmarkRecord["failures"]>[number];
  prompt: string;
  status: "failed";
};

type DebugRow = RunRow | FailureRow;

const DEFAULT_METRIC_KEY: MetricKey = "endToEndTps";
const DEFAULT_AGGREGATION: Aggregation = "p90";
const DEFAULT_CHART_RANGE: ChartRange = "4h";
const PRIORITY_PROVIDER = "Azure Priority";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const CHART_WINDOW_MS: Record<Exclude<ChartRange, "custom">, number> = {
  "24h": DAY_MS,
  "4h": 4 * HOUR_MS,
};

const isMetricKey = (value: string | null): value is MetricKey =>
  value !== null && value in METRICS;

const isAggregation = (value: string | null): value is Aggregation =>
  value === "mean" || value === "p90";

const isChartRange = (value: string | null): value is ChartRange =>
  value === "24h" || value === "4h" || value === "custom";

const selectedAggregationQueryParam = (): Aggregation => {
  const value = new URLSearchParams(window.location.search).get("aggregation");
  if (value === "p99") return "p90";
  return isAggregation(value) ? value : DEFAULT_AGGREGATION;
};

const selectedChartRangeQueryParam = (): ChartRange => {
  const value = new URLSearchParams(window.location.search).get("range");
  return isChartRange(value) ? value : DEFAULT_CHART_RANGE;
};

const selectedQueryParam = <T extends string>(
  key: string,
  isValid: (value: string | null) => value is T,
  fallback: T,
): T => {
  const value = new URLSearchParams(window.location.search).get(key);
  return isValid(value) ? value : fallback;
};

const priorityEnabledQueryParam = (): boolean => {
  const value = new URLSearchParams(window.location.search).get("priority");
  return value === "1" || value === "true";
};

const filterPriorityHistory = (
  history: BenchmarkRecord[],
  showPriority: boolean,
): BenchmarkRecord[] => {
  if (!showPriority) {
    return history.filter((record) => providerName(record) !== PRIORITY_PROVIDER);
  }

  const batchesWithPriority = new Set(
    history
      .filter((record) => providerName(record) === PRIORITY_PROVIDER)
      .map((record) => record.createdAt),
  );

  return history.filter((record) => batchesWithPriority.has(record.createdAt));
};

const filterChartRange = (
  history: BenchmarkRecord[],
  range: ChartRange,
  customRange: CustomChartRange,
): BenchmarkRecord[] => {
  if (history.length === 0) return history;

  if (range === "custom") {
    const startTime = parseDateTimeInput(customRange.start);
    const endTime = parseDateTimeInput(customRange.end);
    if (startTime === null && endTime === null) return history;

    return history.filter((record) => {
      const time = new Date(record.createdAt).getTime();
      if (!Number.isFinite(time)) return false;
      if (startTime !== null && time < startTime) return false;
      if (endTime !== null && time > endTime) return false;
      return true;
    });
  }

  const latestTime = history.reduce((latest, record) => {
    const time = new Date(record.createdAt).getTime();
    return Number.isFinite(time) ? Math.max(latest, time) : latest;
  }, Number.NEGATIVE_INFINITY);
  if (!Number.isFinite(latestTime)) return history;

  const cutoff = latestTime - CHART_WINDOW_MS[range];
  return history.filter((record) => new Date(record.createdAt).getTime() >= cutoff);
};

const padDatePart = (value: number): string => value.toString().padStart(2, "0");

const toDateTimeInputValue = (time: number): string => {
  const date = new Date(time);
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join("-") + `T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
};

const parseDateTimeInput = (value: string): number | null => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

const selectedCustomChartRangeQueryParam = (): CustomChartRange => {
  const params = new URLSearchParams(window.location.search);
  const start = params.get("start");
  const end = params.get("end");
  return {
    start: start && parseDateTimeInput(start) !== null ? start : "",
    end: end && parseDateTimeInput(end) !== null ? end : "",
  };
};

const latestHistoryTime = (history: BenchmarkRecord[]): number | null => {
  const latestTime = history.reduce((latest, record) => {
    const time = new Date(record.createdAt).getTime();
    return Number.isFinite(time) ? Math.max(latest, time) : latest;
  }, Number.NEGATIVE_INFINITY);
  return Number.isFinite(latestTime) ? latestTime : null;
};

const defaultCustomRangeForHistory = (
  history: BenchmarkRecord[],
): CustomChartRange => {
  const latestTime = latestHistoryTime(history) ?? Date.now();
  return {
    start: toDateTimeInputValue(latestTime - CHART_WINDOW_MS["4h"]),
    end: toDateTimeInputValue(latestTime),
  };
};

const directionLabel = (metric: Metric): string =>
  metric.better === "higher" ? "↑ Higher is better" : "↓ Lower is better";

const formatOptionalNumber = (
  value: number | undefined,
  digits = 2,
): string =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";

const formatOptionalUnit = (
  value: number | undefined,
  unit: string,
  digits = 2,
): string => {
  const formatted = formatOptionalNumber(value, digits);
  return formatted === "—" ? formatted : `${formatted} ${unit}`;
};

const formatOptionalInteger = (value: number | undefined): string =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US")
    : "—";

const formatDateTime = (value: string): string =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));

const flattenDebugRows = (history: BenchmarkRecord[]): DebugRow[] =>
  history
    .flatMap((record) => {
      const provider = providerName(record);
      const runRows: DebugRow[] = record.runs.map((run) => ({
        id: record.id,
        createdAt: record.createdAt,
        provider,
        deployment: record.deployment,
        run,
        prompt: run.prompt,
        status: "ok",
      }));
      const failureRows: DebugRow[] = (record.failures ?? []).map((failure) => ({
        id: record.id,
        createdAt: record.createdAt,
        provider,
        deployment: record.deployment,
        failure,
        prompt: failure.prompt,
        status: "failed",
      }));

      return [...runRows, ...failureRows];
    })
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
        a.provider.localeCompare(b.provider),
    );

const summarizeLatest = (history: BenchmarkRecord[]): ProviderLatest[] => {
  const byProvider = new Map<string, BenchmarkRecord>();
  for (const record of history) {
    const provider = providerName(record);
    const existing = byProvider.get(provider);
    if (
      !existing ||
      new Date(record.createdAt).getTime() >
        new Date(existing.createdAt).getTime()
    ) {
      byProvider.set(provider, record);
    }
  }

  return [...byProvider.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([provider, latest], index) => ({
      provider,
      color: colorFor(provider, index),
      latest,
    }));
};

const regionFromDeployment = (deployment: string): string | undefined => {
  const normalized = deployment.toLowerCase().replace(/[_\s]+/g, "-");
  if (normalized.includes("southcentral-us") || normalized.includes("southcentralus")) {
    return "southcentral";
  }
  if (normalized.includes("us-east2") || normalized.includes("us-east-2")) {
    return "us-east2";
  }
  if (normalized.includes("eastus2") || normalized.includes("east-us-2")) {
    return "East US 2";
  }
  if (normalized.includes("eastus") || normalized.includes("east-us")) {
    return "East US";
  }
  if (normalized.includes("westus3") || normalized.includes("west-us-3")) {
    return "West US 3";
  }
  if (normalized.includes("westus2") || normalized.includes("west-us-2")) {
    return "West US 2";
  }
  if (normalized.includes("westus") || normalized.includes("west-us")) {
    return "West US";
  }

  return undefined;
};

const regionForRecord = (record: BenchmarkRecord): string => {
  const provider = providerName(record);
  if (provider === "OpenAI") return "OpenAI default";
  if (provider === "Azure") return regionFromDeployment(record.deployment) ?? "us-east2";
  if (provider === PRIORITY_PROVIDER) {
    return regionFromDeployment(record.deployment) ?? "southcentral";
  }
  return regionFromDeployment(record.deployment) ?? "unknown region";
};

const summarizeDeploymentCallouts = (
  latestByProvider: ProviderLatest[],
): DeploymentCallout[] =>
  latestByProvider.map(({ provider, latest }) => ({
    provider,
    model: latest.deployment,
    reasoningEffort: latest.reasoningEffort,
    region: provider === "OpenAI" ? undefined : regionForRecord(latest),
  }));

const formatDeploymentCallout = (item: DeploymentCallout): string =>
  [
    `${item.provider}: ${item.model}`,
    `${item.reasoningEffort} reasoning`,
    item.region,
  ]
    .filter(Boolean)
    .join(", ");

const summarizeByProvider = (history: BenchmarkRecord[]): ProviderAggregate[] => {
  const byProvider = new Map<string, BenchmarkRecord>();
  for (const record of history) {
    const provider = providerName(record);
    const existing = byProvider.get(provider);
    byProvider.set(provider, {
      ...record,
      provider,
      runs: [...(existing?.runs ?? []), ...record.runs],
      failures: [...(existing?.failures ?? []), ...(record.failures ?? [])],
      prompts: (existing?.prompts ?? 0) + record.prompts,
    });
  }

  return [...byProvider.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([provider, record]) => ({ provider, record }));
};

const compareProviders = (
  metric: Metric,
  azureRecord?: BenchmarkRecord,
  openAIRecord?: BenchmarkRecord,
): ProviderComparisons | null => {
  if (!azureRecord || !openAIRecord) return null;
  const azureStats = metric.stats(azureRecord);
  const openAIStats = metric.stats(openAIRecord);
  return {
    mean: compareAgainstOpenAI(metric, azureStats?.mean, openAIStats?.mean),
    p90: compareAgainstOpenAI(metric, azureStats?.p90, openAIStats?.p90),
  };
};

function SeverityBlock({
  label,
  comparison,
}: {
  label: string;
  comparison: ProviderComparison;
}) {
  const isSlower = comparison.outcome === "slower";
  const value =
    comparison.outcome === "same"
      ? "Same"
      : `${formatRatio(comparison.ratio)}×`;
  const description =
    comparison.outcome === "same"
      ? "within 10% of OpenAI"
      : `${comparison.outcome} than OpenAI`;

  return (
    <div className="flex flex-col gap-2">
      <div
        className={`text-[11px] font-medium uppercase tracking-[0.14em] ${
          isSlower ? "text-red-200" : "text-muted"
        }`}
      >
        {label}
      </div>
      <div
        className={`font-mono text-4xl font-semibold leading-none tabular-nums md:text-5xl ${
          isSlower ? "text-red-100" : "text-foreground"
        }`}
      >
        {value}
      </div>
      <div className={`text-sm ${isSlower ? "text-red-200/80" : "text-muted"}`}>
        {description}
      </div>
    </div>
  );
}

function ExpandableDebugText({
  expanded,
  id,
  onToggle,
  text,
  tone = "muted",
}: {
  expanded: boolean;
  id: string;
  onToggle: (id: string) => void;
  text: string | undefined;
  tone?: "muted" | "error";
}) {
  if (!text) {
    return <span className="text-muted">—</span>;
  }

  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={() => onToggle(id)}
      title={expanded ? "Click to collapse" : text}
      className={`block w-full text-left transition-colors hover:text-foreground ${
        expanded
          ? "cursor-zoom-out whitespace-pre-wrap break-words leading-relaxed"
          : "cursor-zoom-in truncate"
      } ${tone === "error" ? "text-red-200" : "text-muted"}`}
    >
      {text}
    </button>
  );
}

function RunsDebugView({
  history,
  state,
}: {
  history: BenchmarkRecord[];
  state: LoadState;
}) {
  const [expandedCells, setExpandedCells] = useState<Set<string>>(
    () => new Set(),
  );
  const rows = useMemo(
    () => (state.status === "ready" ? flattenDebugRows(history) : []),
    [history, state.status],
  );
  const toggleCell = (id: string): void => {
    setExpandedCells((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="min-h-dvh bg-background">
      <main className="mx-auto w-full max-w-[1500px] px-4 py-8 md:px-6">
        <header className="mb-6 flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 text-xs uppercase tracking-wider text-muted">
              Database View
            </div>
            <h1 className="text-2xl font-medium tracking-tight">
              Benchmark Runs
            </h1>
            <p className="mt-1 text-sm text-muted">
              One row per prompt attempt result, ordered newest first.
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <a
              className="rounded border border-border px-3 py-1.5 text-muted transition-colors hover:border-neutral-600 hover:text-foreground"
              href="/"
            >
              Dashboard
            </a>
            <a
              className="rounded border border-border px-3 py-1.5 text-muted transition-colors hover:border-neutral-600 hover:text-foreground"
              href="/results.json"
            >
              Raw JSON
            </a>
          </div>
        </header>

        {state.status === "loading" && (
          <div className="text-sm text-muted">Loading runs…</div>
        )}

        {state.status === "error" && (
          <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            Failed to load results: {state.message}
          </div>
        )}

        {state.status === "ready" && (
          <div className="overflow-x-auto border border-border">
            <table className="w-full min-w-[1520px] border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-card text-[11px] uppercase tracking-wider text-muted">
                <tr className="[&>th]:whitespace-nowrap [&>th]:border-b [&>th]:border-border [&>th]:px-2.5 [&>th]:py-2">
                  <th>Time</th>
                  <th>Provider</th>
                  <th>Deployment</th>
                  <th>Run</th>
                  <th>Status</th>
                  <th>Out</th>
                  <th>Reason</th>
                  <th>In</th>
                  <th>Total</th>
                  <th>TTFRS</th>
                  <th>TTFT</th>
                  <th>Stream</th>
                  <th>Total</th>
                  <th>Stream</th>
                  <th>E2E</th>
                  <th>Cost</th>
                  <th>Attempts</th>
                  <th>Prompt / Error</th>
                  <th>Reasoning Summary</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {rows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-muted" colSpan={19}>
                      No benchmark rows found.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, index) => {
                    const isFailure = row.status === "failed";
                    const rowIndex =
                      row.status === "failed" ? row.failure.index : row.run.index;
                    const promptCellId = `${row.id}-${row.provider}-${rowIndex}-${index}-prompt`;
                    const summaryCellId = `${row.id}-${row.provider}-${rowIndex}-${index}-summary`;
                    const promptText =
                      row.status === "failed"
                        ? `${row.failure.message}\n${row.failure.prompt}`
                        : row.prompt;
                    return (
                      <tr
                        key={`${row.id}-${row.provider}-${row.status}-${rowIndex}-${index}`}
                        className={`border-b border-border/70 align-top ${
                          isFailure ? "bg-red-500/[0.06]" : "odd:bg-white/[0.015]"
                        }`}
                      >
                        <td className="whitespace-nowrap px-2.5 py-2 text-muted">
                          {formatDateTime(row.createdAt)}
                        </td>
                        <td className="px-2.5 py-2 text-foreground">
                          {row.provider}
                        </td>
                        <td className="px-2.5 py-2 text-muted">
                          {row.deployment}
                        </td>
                        <td className="px-2.5 py-2">
                          {row.status === "failed" ? row.failure.index : row.run.index}
                        </td>
                        <td
                          className={`px-2.5 py-2 ${
                            isFailure ? "text-red-200" : "text-emerald-200"
                          }`}
                        >
                          {row.status}
                        </td>
                        <td className="px-2.5 py-2">
                          {row.status === "ok"
                            ? formatOptionalInteger(row.run.outputTokens)
                            : "—"}
                        </td>
                        <td className="px-2.5 py-2">
                          {row.status === "ok"
                            ? formatOptionalInteger(row.run.reasoningTokens)
                            : "—"}
                        </td>
                        <td className="px-2.5 py-2">
                          {row.status === "ok"
                            ? formatOptionalInteger(row.run.inputTokens)
                            : "—"}
                        </td>
                        <td className="px-2.5 py-2">
                          {row.status === "ok"
                            ? formatOptionalInteger(row.run.totalTokens)
                            : "—"}
                        </td>
                        <td className="px-2.5 py-2">
                          {row.status === "ok"
                            ? formatOptionalUnit(
                                row.run.timeToFirstReasoningSummarySeconds,
                                "s",
                              )
                            : "—"}
                        </td>
                        <td className="px-2.5 py-2">
                          {row.status === "ok"
                            ? formatOptionalUnit(
                                row.run.timeToFirstTokenSeconds,
                                "s",
                              )
                            : "—"}
                        </td>
                        <td className="px-2.5 py-2">
                          {row.status === "ok"
                            ? formatOptionalUnit(row.run.streamSeconds, "s")
                            : "—"}
                        </td>
                        <td className="px-2.5 py-2">
                          {row.status === "ok"
                            ? formatOptionalUnit(row.run.totalSeconds, "s")
                            : "—"}
                        </td>
                        <td className="px-2.5 py-2">
                          {row.status === "ok"
                            ? formatOptionalUnit(row.run.streamTps, "tps")
                            : "—"}
                        </td>
                        <td className="px-2.5 py-2">
                          {row.status === "ok"
                            ? formatOptionalUnit(row.run.endToEndTps, "tps")
                            : "—"}
                        </td>
                        <td className="px-2.5 py-2">
                          {row.status === "ok"
                            ? `$${row.run.costUsd.toFixed(6)}`
                            : "—"}
                        </td>
                        <td className="px-2.5 py-2">
                          {row.status === "failed"
                            ? row.failure.attempts
                            : (row.run.attempts ?? 1)}
                        </td>
                        <td className="w-[360px] max-w-[360px] px-2.5 py-2 font-sans">
                          <ExpandableDebugText
                            expanded={expandedCells.has(promptCellId)}
                            id={promptCellId}
                            onToggle={toggleCell}
                            text={promptText}
                            tone={row.status === "failed" ? "error" : "muted"}
                          />
                        </td>
                        <td className="w-[420px] max-w-[420px] px-2.5 py-2 font-sans">
                          <ExpandableDebugText
                            expanded={expandedCells.has(summaryCellId)}
                            id={summaryCellId}
                            onToggle={toggleCell}
                            text={
                              row.status === "ok"
                                ? row.run.reasoningSummary
                                : undefined
                            }
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

function App() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [metricKey, setMetricKey] = useState<MetricKey>(() =>
    selectedQueryParam("metric", isMetricKey, DEFAULT_METRIC_KEY),
  );
  const [aggregation, setAggregation] = useState<Aggregation>(() =>
    selectedAggregationQueryParam(),
  );
  const [chartRange, setChartRange] = useState<ChartRange>(
    selectedChartRangeQueryParam,
  );
  const [customChartRange, setCustomChartRange] = useState<CustomChartRange>(
    selectedCustomChartRangeQueryParam,
  );
  const showPriority = useMemo(() => priorityEnabledQueryParam(), []);
  const hasUserSelectedOption = useRef(false);
  const [hoveredProvider, setHoveredProvider] = useState<string | null>(null);
  const metric = METRICS[metricKey];
  const metricOptions = useMemo(
    () =>
      METRIC_OPTIONS.map((m) => ({
        value: m.key,
        label: m.shortLabel,
        tooltip: m.description,
      })),
    [],
  );
  const aggregationOptions = useMemo(
    () =>
      AGGREGATION_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
        tooltip: option.description,
      })),
    [],
  );
  const chartRangeOptions = useMemo(
    () => [
      {
        value: "24h" as const,
        label: "1 day",
        tooltip: "Show the latest 24 hours of benchmark history.",
      },
      {
        value: "4h" as const,
        label: "4 hours",
        tooltip: "Show the latest 4 hours of benchmark history.",
      },
      {
        value: "custom" as const,
        label: "Custom",
        tooltip: "Show a custom benchmark time range.",
      },
    ],
    [],
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/results.json", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Status ${response.status}`);
        }
        return (await response.json()) as DashboardResults;
      })
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Unknown";
          setState({ status: "error", message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasUserSelectedOption.current) return;
    const url = new URL(window.location.href);
    url.searchParams.set("metric", metricKey);
    url.searchParams.set("aggregation", aggregation);
    url.searchParams.set("range", chartRange);
    if (chartRange === "custom") {
      if (customChartRange.start) {
        url.searchParams.set("start", customChartRange.start);
      } else {
        url.searchParams.delete("start");
      }
      if (customChartRange.end) {
        url.searchParams.set("end", customChartRange.end);
      } else {
        url.searchParams.delete("end");
      }
    } else {
      url.searchParams.delete("start");
      url.searchParams.delete("end");
    }
    window.history.replaceState(null, "", url);
  }, [metricKey, aggregation, chartRange, customChartRange]);

  const rawHistory =
    state.status === "ready" ? state.data.history : ([] as BenchmarkRecord[]);
  const history = useMemo(
    () => filterPriorityHistory(rawHistory, showPriority),
    [rawHistory, showPriority],
  );
  const chartHistory = useMemo(
    () => filterChartRange(history, chartRange, customChartRange),
    [history, chartRange, customChartRange],
  );
  const latestByProvider = useMemo(
    () => summarizeLatest(chartHistory),
    [chartHistory],
  );
  const deploymentCallout = useMemo(
    () =>
      summarizeDeploymentCallouts(latestByProvider)
        .map(formatDeploymentCallout)
        .join(" | "),
    [latestByProvider],
  );
  const headlineComparisons = useMemo(() => {
    const providerHistory = summarizeByProvider(chartHistory);
    const azure = providerHistory.find((entry) => entry.provider === "Azure");
    const openAI = providerHistory.find(
      (entry) => entry.provider === "OpenAI",
    );
    return compareProviders(metric, azure?.record, openAI?.record);
  }, [chartHistory, metric]);
  const headlineIsSlower =
    headlineComparisons?.mean?.outcome === "slower" ||
    headlineComparisons?.p90?.outcome === "slower";
  const headlineClassName = headlineIsSlower
    ? "relative border-b border-red-500/25 bg-gradient-to-b from-red-500/[0.13] to-red-500/[0.06] px-5 py-5 md:px-6 md:py-6"
    : "relative border-b border-border bg-neutral-950/50 px-5 py-5 md:px-6 md:py-6";

  if (window.location.pathname === "/runs") {
    return <RunsDebugView history={history} state={state} />;
  }

  return (
    <div className="min-h-dvh bg-background">
      <main className="mx-auto w-full max-w-5xl px-6 py-12 md:py-20">
        <header className="mb-10 flex flex-col gap-1.5">
          <h1 className="text-2xl font-medium tracking-tight md:text-3xl">
            Azure Sucked* (at hosting OpenAI models)
          </h1>
          <div className="flex flex-col gap-2 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
            <p>
              * We{" "}
              <a
                className="underline decoration-muted/60 underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground"
                href="https://x.com/theo/status/2014863266888233193"
                rel="noreferrer"
                target="_blank"
              >
                wanted to use Azure
              </a>{" "}
              for inference. This benchmark lit some fires and{" "}
              <a
                className="underline decoration-muted/60 underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground"
                href="https://x.com/theo/status/2050305813894648289"
                rel="noreferrer"
                target="_blank"
              >
                now you can!
              </a>
            </p>
          </div>
        </header>

        <Card className="overflow-hidden">
          {(headlineComparisons?.mean || headlineComparisons?.p90) && (
            <div className={headlineClassName}>
              <div
                className={`grid gap-y-6 gap-x-10 ${
                  headlineComparisons.mean && headlineComparisons.p90
                    ? "grid-cols-1 sm:grid-cols-2"
                    : "grid-cols-1"
                }`}
              >
                {headlineComparisons.mean && (
                  <SeverityBlock
                    label="On average"
                    comparison={headlineComparisons.mean}
                  />
                )}
                {headlineComparisons.p90 && (
                  <SeverityBlock
                    label="Worst 10% (P90)"
                    comparison={headlineComparisons.p90}
                  />
                )}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup
                ariaLabel="Metric"
                value={metricKey}
                onValueChange={(value) => {
                  hasUserSelectedOption.current = true;
                  setMetricKey(value);
                }}
                options={metricOptions}
              />
              <ToggleGroup
                ariaLabel="Aggregation"
                value={aggregation}
                onValueChange={(value) => {
                  hasUserSelectedOption.current = true;
                  setAggregation(value);
                }}
                options={aggregationOptions}
              />
              <ToggleGroup
                ariaLabel="Chart range"
                value={chartRange}
                onValueChange={(value) => {
                  hasUserSelectedOption.current = true;
                  if (
                    value === "custom" &&
                    !customChartRange.start &&
                    !customChartRange.end
                  ) {
                    setCustomChartRange(defaultCustomRangeForHistory(history));
                  }
                  setChartRange(value);
                }}
                options={chartRangeOptions}
              />
              {chartRange === "custom" && (
                <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-card p-1">
                  <label className="flex items-center gap-1.5">
                    <span className="px-1 text-[11px] text-muted">From</span>
                    <input
                      type="datetime-local"
                      value={customChartRange.start}
                      onChange={(event) => {
                        hasUserSelectedOption.current = true;
                        setCustomChartRange((current) => ({
                          ...current,
                          start: event.target.value,
                        }));
                      }}
                      className="h-7 rounded border border-border bg-background px-2 font-mono text-xs text-foreground outline-none transition-colors [color-scheme:dark] focus:border-neutral-500"
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    <span className="px-1 text-[11px] text-muted">To</span>
                    <input
                      type="datetime-local"
                      value={customChartRange.end}
                      onChange={(event) => {
                        hasUserSelectedOption.current = true;
                        setCustomChartRange((current) => ({
                          ...current,
                          end: event.target.value,
                        }));
                      }}
                      className="h-7 rounded border border-border bg-background px-2 font-mono text-xs text-foreground outline-none transition-colors [color-scheme:dark] focus:border-neutral-500"
                    />
                  </label>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 sm:justify-end">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {latestByProvider.length === 0 ? (
                  <span className="text-xs text-muted">No providers yet</span>
                ) : (
                  latestByProvider.map((entry) => {
                    const dim =
                      hoveredProvider !== null &&
                      hoveredProvider !== entry.provider;
                    return (
                      <button
                        type="button"
                        key={entry.provider}
                        onMouseEnter={() =>
                          setHoveredProvider(entry.provider)
                        }
                        onMouseLeave={() => setHoveredProvider(null)}
                        onFocus={() => setHoveredProvider(entry.provider)}
                        onBlur={() => setHoveredProvider(null)}
                        className={`flex items-center gap-2 rounded px-1.5 py-0.5 text-xs text-foreground transition-opacity hover:bg-neutral-900 ${
                          dim ? "opacity-40" : "opacity-100"
                        }`}
                      >
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full"
                          style={{ background: entry.color }}
                        />
                        {entry.provider}
                      </button>
                    );
                  })
                )}
              </div>
              <span className="text-xs text-muted">{directionLabel(metric)}</span>
            </div>
          </div>
          <div className="px-2 pt-2 pb-3">
            {state.status === "loading" ? (
              <div className="flex h-[420px] items-center justify-center text-sm text-muted">
                Loading…
              </div>
            ) : state.status === "error" ? (
              <div className="flex h-[420px] items-center justify-center text-sm text-red-200">
                Failed to load results: {state.message}
              </div>
            ) : (
              <ThroughputChart
                records={chartHistory}
                metric={metric}
                aggregation={aggregation}
                hoveredProvider={hoveredProvider}
                onHoverChange={setHoveredProvider}
              />
            )}
          </div>
        </Card>

        {deploymentCallout && (
          <p className="mt-3 text-center text-xs leading-relaxed text-muted">
            {deploymentCallout}
          </p>
        )}
      </main>
    </div>
  );
}

export default App;
