import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import {
  ThroughputChart,
  colorFor,
  providerName,
} from "@/components/throughput-chart";
import type { BenchmarkRecord, DashboardResults } from "@/types";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: DashboardResults }
  | { status: "error"; message: string };

const formatDateTime = (value: string): string =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const formatTps = (value: number): string => value.toFixed(1);

type ProviderLatest = {
  provider: string;
  color: string;
  latest: BenchmarkRecord;
};

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

function ProviderStat({ provider, color, latest }: ProviderLatest) {
  const failures = latest.failures?.length ?? 0;
  const succeeded = latest.runs.length > 0;

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
        {succeeded ? formatTps(latest.summary.averageStreamTps) : "—"}
        <span className="ml-1 text-sm text-muted">tps</span>
      </div>
      <div className="text-xs text-muted">{latest.deployment}</div>
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
  const generatedAt =
    state.status === "ready"
      ? state.data.generatedAt ?? history.at(-1)?.createdAt ?? null
      : null;
  const latestFailures = latestByProvider.reduce(
    (sum, entry) => sum + (entry.latest.failures?.length ?? 0),
    0,
  );

  return (
    <div className="min-h-dvh bg-background">
      <main className="mx-auto w-full max-w-5xl px-6 py-12 md:py-20">
        <header className="mb-10 flex flex-col gap-1.5">
          <h1 className="text-2xl font-medium tracking-tight md:text-3xl">
            GPT Output Speed
          </h1>
          <p className="text-sm text-muted">
            Streamed output tokens per second. Higher is better.
          </p>
        </header>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              {latestByProvider.length === 0 ? (
                <span className="text-xs text-muted">No providers yet</span>
              ) : (
                latestByProvider.map((entry) => (
                  <span
                    key={entry.provider}
                    className="flex items-center gap-2 text-xs text-foreground"
                  >
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{ background: entry.color }}
                    />
                    {entry.provider}
                  </span>
                ))
              )}
            </div>
            <span className="text-xs text-muted">
              {state.status === "loading" && "Loading…"}
              {state.status === "error" && "Results unavailable"}
              {state.status === "ready" &&
                (generatedAt
                  ? `Updated ${formatDateTime(generatedAt)}`
                  : "No samples")}
            </span>
          </div>
          <div className="px-2 pt-2 pb-3">
            <ThroughputChart records={history} />
          </div>
        </Card>

        {latestByProvider.length > 0 && (
          <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 md:grid-cols-4">
            {latestByProvider.map((entry) => (
              <ProviderStat key={entry.provider} {...entry} />
            ))}
            <div className="flex flex-col gap-1.5">
              <div className="text-xs text-muted uppercase tracking-wider">
                Samples
              </div>
              <div className="font-mono text-2xl tabular-nums text-foreground">
                {history.length}
              </div>
              <div className="text-xs text-muted">scheduled runs</div>
            </div>
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
