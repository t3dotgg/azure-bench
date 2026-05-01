import postgres from "postgres";
import { mkdir, readFile } from "node:fs/promises";

export const historyPath = "data/benchmark-runs.json";

export type BenchResult = {
  index: number;
  prompt: string;
  outputTokens: number;
  reasoningTokens: number | undefined;
  reasoningSummary: string | undefined;
  inputTokens: number | undefined;
  totalTokens: number | undefined;
  timeToFirstReasoningSummarySeconds: number | undefined;
  timeToFirstTokenSeconds: number | undefined;
  streamSeconds: number;
  totalSeconds: number;
  streamTps: number;
  endToEndTps: number;
  costUsd: number;
  attempts: number;
};

export type RunFailure = {
  index: number;
  prompt: string;
  attempts: number;
  message: string;
};

export type TokenPricing = {
  inputPerMillion: number;
  outputPerMillion: number;
};

export type BenchmarkSummary = {
  averageStreamTps: number;
  averageEndToEndTps: number;
  totalCostUsd: number;
  totalOutputTokens: number;
  totalReasoningTokens: number;
};

export type BenchmarkRecord = {
  id: string;
  createdAt: string;
  provider: string;
  deployment: string;
  reasoningEffort: "high";
  reasoningSummary: string | undefined;
  pricing: TokenPricing;
  prompts: number;
  summary: BenchmarkSummary;
  runs: BenchResult[];
  failures: RunFailure[];
};

type BenchmarkRow = {
  id: string;
  created_at: Date;
  provider: string | null;
  deployment: string;
  reasoning_effort: "high";
  reasoning_summary: string | null;
  pricing: TokenPricing;
  prompts: number;
  summary: BenchmarkSummary;
  runs: BenchResult[];
  failures: RunFailure[] | null;
};

export type DashboardResults = {
  generatedAt: string | null;
  history: BenchmarkRecord[];
};

const createSql = () => {
  const databaseUrl = Bun.env.DATABASE_URL;
  return databaseUrl
    ? postgres(databaseUrl, {
        max: 1,
        onnotice: () => undefined,
      })
    : undefined;
};

const toRecord = (row: BenchmarkRow): BenchmarkRecord => ({
  id: row.id,
  createdAt: row.created_at.toISOString(),
  provider: row.provider ?? "Azure",
  deployment: row.deployment,
  reasoningEffort: row.reasoning_effort,
  reasoningSummary: row.reasoning_summary ?? undefined,
  pricing: row.pricing,
  prompts: row.prompts,
  summary: row.summary,
  runs: row.runs.map((run) => ({ ...run, attempts: run.attempts ?? 1 })),
  failures: row.failures ?? [],
});

export const summarizeResults = (results: BenchResult[]): BenchmarkSummary => {
  if (results.length === 0) {
    return {
      averageStreamTps: 0,
      averageEndToEndTps: 0,
      totalCostUsd: 0,
      totalOutputTokens: 0,
      totalReasoningTokens: 0,
    };
  }

  const averageStreamTps =
    results.reduce((sum, result) => sum + result.streamTps, 0) / results.length;
  const averageEndToEndTps =
    results.reduce((sum, result) => sum + result.endToEndTps, 0) / results.length;
  const totalCostUsd = results.reduce((sum, result) => sum + result.costUsd, 0);
  const totalOutputTokens = results.reduce(
    (sum, result) => sum + result.outputTokens,
    0,
  );
  const totalReasoningTokens = results.reduce(
    (sum, result) => sum + (result.reasoningTokens ?? 0),
    0,
  );

  return {
    averageStreamTps,
    averageEndToEndTps,
    totalCostUsd,
    totalOutputTokens,
    totalReasoningTokens,
  };
};

const normalizeRun = (run: BenchResult): BenchResult => {
  const firstOutputSeconds = [
    run.timeToFirstReasoningSummarySeconds,
    run.timeToFirstTokenSeconds,
  ]
    .filter((v): v is number => v !== undefined)
    .sort((a, b) => a - b)[0];
  const streamSeconds =
    firstOutputSeconds === undefined
      ? run.streamSeconds
      : Math.max(run.totalSeconds - firstOutputSeconds, 0.001);

  return {
    ...run,
    attempts: run.attempts ?? 1,
    reasoningSummary: run.reasoningSummary ?? undefined,
    timeToFirstReasoningSummarySeconds:
      run.timeToFirstReasoningSummarySeconds ?? undefined,
    streamSeconds,
    streamTps: run.outputTokens / streamSeconds,
  };
};

const normalizeRecord = (record: BenchmarkRecord): BenchmarkRecord => ({
  ...record,
  reasoningSummary: record.reasoningSummary ?? undefined,
  runs: record.runs.map(normalizeRun),
  failures: record.failures ?? [],
});

const readJsonHistory = async (): Promise<BenchmarkRecord[]> => {
  try {
    const content = await readFile(historyPath, "utf8");
    const parsed: unknown = JSON.parse(content);

    if (!Array.isArray(parsed)) {
      throw new Error(`${historyPath} must contain a JSON array`);
    }

    return (parsed as BenchmarkRecord[]).map(normalizeRecord);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
};

const writeJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`);
};

const ensureDatabase = async (sql: postgres.Sql): Promise<void> => {
  await sql`
    create table if not exists benchmark_runs (
      id text primary key,
      created_at timestamptz not null,
      provider text,
      deployment text not null,
      reasoning_effort text not null,
      pricing jsonb not null,
      prompts integer not null,
      summary jsonb not null,
      runs jsonb not null
    )
  `;
  await sql`
    alter table benchmark_runs
    add column if not exists provider text
  `;
  await sql`
    alter table benchmark_runs
    add column if not exists failures jsonb not null default '[]'::jsonb
  `;
  await sql`
    alter table benchmark_runs
    add column if not exists reasoning_summary text
  `;
};

export const readDashboardResults = async (): Promise<DashboardResults> => {
  const sql = createSql();

  if (!sql) {
    const history = await readJsonHistory();
    return {
      generatedAt: history.at(-1)?.createdAt ?? null,
      history,
    };
  }

  try {
    await ensureDatabase(sql);
    const rows = await sql<BenchmarkRow[]>`
      select id, created_at, provider, deployment, reasoning_effort, reasoning_summary, pricing, prompts, summary, runs, failures
      from benchmark_runs
      order by created_at asc
      limit 500
    `;
    const history = rows.map(toRecord);

    return {
      generatedAt: history.at(-1)?.createdAt ?? null,
      history,
    };
  } finally {
    await sql.end();
  }
};

export const recordBenchmark = async (
  record: BenchmarkRecord,
  historyLimit: number,
): Promise<"database" | "json"> => {
  const normalized = normalizeRecord(record);
  const sql = createSql();

  if (!sql) {
    const existingHistory = await readJsonHistory();
    const history = [...existingHistory, normalized].slice(-historyLimit);

    await writeJson(historyPath, history);
    return "json";
  }

  try {
    await ensureDatabase(sql);
    await sql`
      insert into benchmark_runs (
        id,
        created_at,
        provider,
        deployment,
        reasoning_effort,
        reasoning_summary,
        pricing,
        prompts,
        summary,
        runs,
        failures
      )
      values (
        ${normalized.id},
        ${normalized.createdAt},
        ${normalized.provider},
        ${normalized.deployment},
        ${normalized.reasoningEffort},
        ${normalized.reasoningSummary ?? null},
        ${sql.json(normalized.pricing)},
        ${normalized.prompts},
        ${sql.json(normalized.summary)},
        ${sql.json(normalized.runs)},
        ${sql.json(normalized.failures)}
      )
      on conflict (id) do nothing
    `;
    await sql`
      delete from benchmark_runs
      where id in (
        select id
        from benchmark_runs
        order by created_at desc
        offset ${historyLimit}
      )
    `;

    return "database";
  } finally {
    await sql.end();
  }
};
