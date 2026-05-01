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
  formatPercent,
  type Aggregation,
  type Metric,
  type MetricKey,
  type ProviderComparison,
} from "@/lib/metrics";
import type { BenchmarkRecord, DashboardResults } from "@/types";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: DashboardResults }
  | { status: "error"; message: string };

type ProviderLatest = {
  provider: string;
  color: string;
  latest: BenchmarkRecord;
};

const DEFAULT_METRIC_KEY: MetricKey = "ttft";
const DEFAULT_AGGREGATION: Aggregation = "mean";

const isMetricKey = (value: string | null): value is MetricKey =>
  value !== null && value in METRICS;

const isAggregation = (value: string | null): value is Aggregation =>
  value === "mean" || value === "p90";

const selectedQueryParam = <T extends string>(
  key: string,
  isValid: (value: string | null) => value is T,
  fallback: T,
): T => {
  const value = new URLSearchParams(window.location.search).get(key);
  return isValid(value) ? value : fallback;
};

const directionLabel = (metric: Metric): string =>
  metric.better === "higher" ? "↑ Higher is better" : "↓ Lower is better";

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

function ProviderStat({
  provider,
  color,
  latest,
  metric,
  aggregation,
  comparison,
}: ProviderLatest & {
  metric: Metric;
  aggregation: Aggregation;
  comparison?: ProviderComparison | null;
}) {
  const failures = latest.failures?.length ?? 0;
  const value = metric.stats(latest)?.[aggregation] ?? null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-xs text-muted uppercase tracking-wider">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: color }}
        />
        {provider}
      </div>
      <div className="font-mono text-2xl tabular-nums text-foreground">
        {value === null ? "—" : metric.format(value)}
        <span className="ml-1 text-sm text-muted">{metric.unit}</span>
      </div>
      <div className="text-xs text-muted">{latest.deployment}</div>
      {comparison && (
        <div className="w-fit rounded-sm bg-red-500/15 px-1.5 py-0.5 text-xs font-medium text-red-300">
          {comparison.label}
        </div>
      )}
      {failures > 0 && (
        <div className="text-xs text-muted">
          {failures} of {latest.prompts} failed
        </div>
      )}
    </div>
  );
}

function App() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [metricKey, setMetricKey] = useState<MetricKey>(() =>
    selectedQueryParam("metric", isMetricKey, DEFAULT_METRIC_KEY),
  );
  const [aggregation, setAggregation] = useState<Aggregation>(() =>
    selectedQueryParam("aggregation", isAggregation, DEFAULT_AGGREGATION),
  );
  const hasUserSelectedOption = useRef(false);
  const [hoveredProvider, setHoveredProvider] = useState<string | null>(null);
  const metric = METRICS[metricKey];
  const metricOptions = useMemo(
    () =>
      METRIC_OPTIONS.map((m) => ({ value: m.key, label: m.shortLabel })),
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
    window.history.replaceState(null, "", url);
  }, [metricKey, aggregation]);

  const history =
    state.status === "ready" ? state.data.history : ([] as BenchmarkRecord[]);
  const latestByProvider = useMemo(() => summarizeLatest(history), [history]);
  const latestFailures = latestByProvider.reduce(
    (sum, entry) => sum + (entry.latest.failures?.length ?? 0),
    0,
  );
  const latestComparisons = useMemo(() => {
    const azure = latestByProvider.find((entry) => entry.provider === "Azure");
    const openAI = latestByProvider.find(
      (entry) => entry.provider === "OpenAI",
    );
    if (!azure || !openAI) return null;
    const azureStats = metric.stats(azure.latest);
    const openAIStats = metric.stats(openAI.latest);
    return {
      mean: compareAgainstOpenAI(metric, azureStats?.mean, openAIStats?.mean),
      p90: compareAgainstOpenAI(metric, azureStats?.p90, openAIStats?.p90),
    };
  }, [latestByProvider, metric]);

  return (
    <div className="min-h-dvh bg-background">
      <main className="mx-auto w-full max-w-5xl px-6 py-12 md:py-20">
        <header className="mb-10 flex flex-col gap-1.5">
          <h1 className="text-2xl font-medium tracking-tight md:text-3xl">
            Azure sucks (at hosting OpenAI models)
          </h1>
          <p className="text-sm text-muted">
            We{" "}
            <a
              className="underline decoration-muted/60 underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground"
              href="https://x.com/theo/status/2014863266888233193"
              rel="noreferrer"
              target="_blank"
            >
              wanted to use Azure
            </a>{" "}
            for inference. We can't do it until they fix their performance.
          </p>
        </header>

        <Card className="overflow-hidden">
          {(latestComparisons?.mean || latestComparisons?.p90) && (
            <div className="border-b border-red-500/20 bg-red-500/10 px-5 py-4 text-red-200">
              <p className="text-lg leading-snug md:text-xl">
                Azure is{" "}
                {latestComparisons.mean && (
                  <>
                    <span className="font-mono font-medium tabular-nums text-red-100">
                      {formatPercent(latestComparisons.mean.percentSlower)}%
                    </span>{" "}
                    slower on average
                  </>
                )}
                {latestComparisons.mean && latestComparisons.p90 && ", "}
                {latestComparisons.p90 && (
                  <>
                    <span className="font-mono font-medium tabular-nums text-red-100">
                      {formatPercent(latestComparisons.p90.percentSlower)}%
                    </span>{" "}
                    worst case
                  </>
                )}
              </p>
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
                options={AGGREGATION_OPTIONS}
              />
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
            <ThroughputChart
              records={history}
              metric={metric}
              aggregation={aggregation}
              hoveredProvider={hoveredProvider}
              onHoverChange={setHoveredProvider}
            />
          </div>
        </Card>

        {latestByProvider.length > 0 && (
          <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 md:grid-cols-4">
            {latestByProvider.map((entry) => (
              <ProviderStat
                key={entry.provider}
                {...entry}
                metric={metric}
                aggregation={aggregation}
                comparison={
                  entry.provider === "Azure"
                    ? latestComparisons?.[aggregation] ?? null
                    : null
                }
              />
            ))}
            <div className="flex flex-col gap-1.5">
              <div className="text-xs text-muted uppercase tracking-wider">
                Errors
              </div>
              <div className="font-mono text-2xl tabular-nums text-foreground">
                {latestFailures}
              </div>
              <div className="text-xs text-muted">in latest samples</div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
