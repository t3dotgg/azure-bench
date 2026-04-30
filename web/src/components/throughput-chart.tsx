import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from "recharts";

type ChartValue = string | number | ReadonlyArray<string | number>;
import type { BenchmarkRecord } from "@/types";

const PROVIDER_COLORS: Record<string, string> = {
  Azure: "#fafafa",
  OpenAI: "#737373",
};

const FALLBACK_COLORS = ["#a3a3a3", "#525252", "#404040"];

const providerName = (record: BenchmarkRecord): string =>
  record.provider ?? "Azure";

const colorFor = (provider: string, index: number): string =>
  PROVIDER_COLORS[provider] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];

const formatTick = (value: number): string =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));

const formatTooltipDate = (value: number): string =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

const formatTps = (value: number): string => value.toFixed(1);

type ChartPoint = {
  time: number;
} & Record<string, number | undefined>;

type ChartShape = {
  data: ChartPoint[];
  providers: string[];
};

const buildChartData = (records: BenchmarkRecord[]): ChartShape => {
  const providerSet = new Set<string>();
  const byTime = new Map<number, ChartPoint>();

  for (const record of records) {
    if (record.runs.length === 0) continue;
    const provider = providerName(record);
    providerSet.add(provider);
    const time = new Date(record.createdAt).getTime();
    const existing = byTime.get(time) ?? { time };
    existing[provider] = record.summary.averageStreamTps;
    byTime.set(time, existing);
  }

  const data = [...byTime.values()].sort((a, b) => a.time - b.time);
  const providers = [...providerSet].sort();

  return { data, providers };
};

const formatValue = (value: ChartValue | undefined): string => {
  if (typeof value === "number") return formatTps(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? formatTps(parsed) : value;
  }
  return "—";
};

function ChartTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;

  const time = typeof label === "number" ? label : Number(label);

  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-muted">
        {formatTooltipDate(time)}
      </div>
      <div className="space-y-0.5">
        {payload.map((entry) => (
          <div
            key={String(entry.dataKey)}
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
              {formatValue(entry.value)}
              <span className="ml-1 text-muted">tps</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ThroughputChart({ records }: { records: BenchmarkRecord[] }) {
  const { data, providers } = useMemo(() => buildChartData(records), [records]);

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

  return (
    <div className="h-[420px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 16, right: 24, bottom: 8, left: 8 }}
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
            tickFormatter={formatTick}
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
            tickFormatter={(v: number) => v.toString()}
            width={36}
          />
          <Tooltip
            content={ChartTooltip}
            cursor={{ stroke: "#262626", strokeWidth: 1 }}
          />
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
                dot={{ r: 2.5, fill: color, strokeWidth: 0 }}
                activeDot={{ r: 4, fill: color, strokeWidth: 0 }}
                connectNulls
                isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export { colorFor, providerName };
