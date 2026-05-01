import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from "recharts";
import type { Metric } from "@/lib/metrics";
import type { BenchmarkRecord } from "@/types";

type ChartValue = string | number | ReadonlyArray<string | number>;

const PROVIDER_COLORS: Record<string, string> = {
  Azure: "#60A5FA",
  OpenAI: "#34D399",
};

const FALLBACK_COLORS = ["#a3a3a3", "#525252", "#404040"];

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

const providerName = (record: BenchmarkRecord): string =>
  record.provider ?? "Azure";

const colorFor = (provider: string, index: number): string =>
  PROVIDER_COLORS[provider] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];

const formatXTick =
  (spanMs: number) =>
  (value: number): string => {
    const date = new Date(value);
    if (spanMs < DAY_MS) {
      return new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
    }
    if (spanMs < WEEK_MS) {
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
      }).format(date);
    }
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(date);
  };

const formatTooltipDate = (value: number): string =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

type ChartPoint = {
  time: number;
} & Record<string, number | undefined>;

type ChartShape = {
  data: ChartPoint[];
  providers: string[];
};

const minKey = (provider: string) => `${provider}__min`;
const maxKey = (provider: string) => `${provider}__max`;

const buildChartData = (
  records: BenchmarkRecord[],
  metric: Metric,
): ChartShape => {
  const providerSet = new Set<string>();
  const byTime = new Map<number, ChartPoint>();

  for (const record of records) {
    const stats = metric.stats(record);
    if (!stats) continue;
    const provider = providerName(record);
    providerSet.add(provider);
    const time = new Date(record.createdAt).getTime();
    const existing = byTime.get(time) ?? { time };
    existing[provider] = stats.avg;
    existing[minKey(provider)] = stats.min;
    existing[maxKey(provider)] = stats.max;
    byTime.set(time, existing);
  }

  const data = [...byTime.values()].sort((a, b) => a.time - b.time);
  const providers = [...providerSet].sort();

  return { data, providers };
};

const formatChartValue = (
  value: ChartValue | undefined,
  metric: Metric,
): string => {
  if (typeof value === "number") return metric.format(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? metric.format(parsed) : value;
  }
  return "—";
};

function ChartTooltip({
  active,
  payload,
  label,
  metric,
}: TooltipContentProps & { metric: Metric }) {
  if (!active || !payload || payload.length === 0) return null;

  const time = typeof label === "number" ? label : Number(label);
  const seen = new Set<string>();
  const lineEntries = payload.filter((entry) => {
    if (typeof entry.dataKey !== "string") return false;
    if (entry.dataKey.includes("__")) return false;
    if (seen.has(entry.dataKey)) return false;
    seen.add(entry.dataKey);
    return true;
  });

  if (lineEntries.length === 0) return null;

  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-muted">
        {formatTooltipDate(time)}
      </div>
      <div className="space-y-1">
        {lineEntries.map((entry) => {
          const provider = String(entry.dataKey);
          const raw = entry.payload as ChartPoint | undefined;
          const min = raw?.[minKey(provider)];
          const max = raw?.[maxKey(provider)];
          const showRange =
            typeof min === "number" &&
            typeof max === "number" &&
            Math.abs(max - min) > 1e-6;

          return (
            <div
              key={provider}
              className="flex items-center justify-between gap-4"
            >
              <span className="flex items-center gap-2 text-foreground">
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: entry.color }}
                />
                {entry.name}
              </span>
              <span className="font-mono tabular-nums">
                {formatChartValue(entry.value, metric)}
                <span className="ml-1 text-muted">{metric.unit}</span>
                {showRange && (
                  <span className="ml-2 text-muted">
                    {metric.format(min as number)}–
                    {metric.format(max as number)}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ThroughputChart({
  records,
  metric,
  hoveredProvider,
  onHoverChange,
}: {
  records: BenchmarkRecord[];
  metric: Metric;
  hoveredProvider?: string | null;
  onHoverChange?: (provider: string | null) => void;
}) {
  const { data, providers } = useMemo(
    () => buildChartData(records, metric),
    [records, metric],
  );

  const [internalHover, setInternalHover] = useState<string | null>(null);
  const hovered =
    hoveredProvider !== undefined ? hoveredProvider : internalHover;
  const setHovered = onHoverChange ?? setInternalHover;

  const xTickFormatter = useMemo(() => {
    if (data.length < 2) return formatXTick(0);
    const span = data[data.length - 1].time - data[0].time;
    return formatXTick(span);
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="flex h-[420px] items-center justify-center text-sm text-muted">
        No samples yet
      </div>
    );
  }

  const tickStyle = {
    fill: "#737373",
    fontSize: 11,
    fontFamily: "var(--font-mono)",
  } as const;

  const bandOpacity = (provider: string): number => {
    if (hovered === provider) return 0.22;
    if (hovered !== null) return 0.02;
    return 0.05;
  };

  const lineOpacity = (provider: string): number => {
    if (hovered === null) return 1;
    return hovered === provider ? 1 : 0.35;
  };

  return (
    <div className="relative h-[420px] w-full">
      <div className="pointer-events-none absolute left-3 top-1 z-10 text-[10px] uppercase tracking-wider text-muted">
        {metric.unit}
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 24, right: 24, bottom: 8, left: 8 }}
        >
          <CartesianGrid
            stroke="#1a1a1a"
            strokeDasharray="0"
            vertical={false}
          />
          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={xTickFormatter}
            tick={tickStyle}
            tickLine={false}
            axisLine={{ stroke: "#1a1a1a" }}
            minTickGap={48}
            padding={{ left: 12, right: 12 }}
          />
          <YAxis
            tick={tickStyle}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => metric.format(v)}
            width={44}
          />
          <Tooltip
            content={(props) => <ChartTooltip {...props} metric={metric} />}
            cursor={{ stroke: "#262626", strokeWidth: 1 }}
          />
          {providers.map((provider, index) => {
            const color = colorFor(provider, index);
            return (
              <Area
                key={`${provider}-band`}
                type="linear"
                dataKey={(d: ChartPoint): [number, number] | null => {
                  const min = d[minKey(provider)];
                  const max = d[maxKey(provider)];
                  if (typeof min !== "number" || typeof max !== "number") {
                    return null;
                  }
                  return [min, max];
                }}
                stroke="none"
                fill={color}
                fillOpacity={bandOpacity(provider)}
                activeDot={false}
                legendType="none"
                connectNulls={false}
                isAnimationActive={false}
              />
            );
          })}
          {providers.map((provider, index) => {
            const color = colorFor(provider, index);
            return (
              <Line
                key={provider}
                type="monotone"
                dataKey={provider}
                name={provider}
                stroke={color}
                strokeWidth={1.5}
                strokeOpacity={lineOpacity(provider)}
                dot={{ r: 2.5, fill: color, strokeWidth: 0 }}
                activeDot={{ r: 4, fill: color, strokeWidth: 0 }}
                connectNulls
                isAnimationActive={false}
                onMouseEnter={() => setHovered(provider)}
                onMouseLeave={() => setHovered(null)}
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export { colorFor, providerName };
