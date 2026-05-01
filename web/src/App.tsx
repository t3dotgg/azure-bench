import { useEffect, useMemo, useState } from "react";
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
          {comparison.label} · {comparison.detail}
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
  const [metricKey, setMetricKey] = useState<MetricKey>("streamTps");
  const [aggregation, setAggregation] = useState<Aggregation>("mean");
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

  const history =
    state.status === "ready" ? state.data.history : ([] as BenchmarkRecord[]);
  const latestByProvider = useMemo(() => summarizeLatest(history), [history]);
  const latestFailures = latestByProvider.reduce(
    (sum, entry) => sum + (entry.latest.failures?.length ?? 0),
    0,
  );
  const latestComparison = useMemo(() => {
    const azure = latestByProvider.find((entry) => entry.provider === "Azure");
    const openAI = latestByProvider.find((entry) => entry.provider === "OpenAI");
    const azureValue = azure ? metric.stats(azure.latest)?.[aggregation] : null;
    const openAIValue = openAI
      ? metric.stats(openAI.latest)?.[aggregation]
      : null;

    return compareAgainstOpenAI(metric, azureValue, openAIValue);
  }, [latestByProvider, metric, aggregation]);

  return (
    <div className="min-h-dvh bg-background">
      <main className="mx-auto w-full max-w-5xl px-6 py-12 md:py-20">
        <header className="mb-10 flex flex-col gap-1.5">
          <h1 className="text-2xl font-medium tracking-tight md:text-3xl">
            Azure sucks (at hosting OpenAI models)
          </h1>
          <p className="text-sm text-muted">
            We wanted to use Azure for inference. We can't do it until they fix
            their performance.
          </p>
        </header>

        <Card className="overflow-hidden">
          {latestComparison && (
            <div className="border-b border-red-500/20 bg-red-500/10 px-5 py-3">
              <div className="text-xs uppercase tracking-wider text-red-300/80">
                Latest Azure vs OpenAI
              </div>
              <div className="mt-1 font-mono text-2xl tabular-nums text-red-200">
                {latestComparison.label}
                <span className="ml-3 text-base text-red-300">
                  {latestComparison.detail}
                </span>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup
                ariaLabel="Metric"
                value={metricKey}
                onValueChange={setMetricKey}
                options={metricOptions}
              />
              <ToggleGroup
                ariaLabel="Aggregation"
                value={aggregation}
                onValueChange={setAggregation}
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
                  entry.provider === "Azure" ? latestComparison : null
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
