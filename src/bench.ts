import { createAzure, type OpenAILanguageModelResponsesOptions } from "@ai-sdk/azure";
import { createOpenAI } from "@ai-sdk/openai";
import { type LanguageModel, streamText } from "ai";
import {
  type BenchResult,
  type BenchmarkRecord,
  type RunFailure,
  type TokenPricing,
  historyPath,
  recordBenchmark,
  summarizeResults,
} from "./storage";

const reasoningEffort = "high";
const reasoningSummary = (() => {
  const value = Bun.env.REASONING_SUMMARY ?? "auto";
  if (value !== "auto" && value !== "detailed") {
    throw new Error(
      `Env var REASONING_SUMMARY must be "auto" or "detailed", received: ${value}`,
    );
  }

  return value;
})();
const defaultModel = "gpt-5.5";

const RUNS_PER_PROMPT = 2;
const MAX_CONCURRENT_PROMPTS_PER_PROVIDER = 4;

const basePrompts = [
  "Write a concise technical explanation of how TCP congestion control works. Use roughly 250 words.",
  "Summarize the tradeoffs between serverless functions and long-running containers for API workloads. Use roughly 250 words.",
  "Create a short implementation plan for adding audit logging to a TypeScript web app. Use roughly 250 words.",
  "Explain retrieval augmented generation to a software engineer who has never built an AI system. Use roughly 250 words.",
  "Draft a pragmatic checklist for evaluating latency in a production LLM application. Use roughly 250 words.",
];

const prompts: string[] = Array.from(
  { length: RUNS_PER_PROMPT },
  () => basePrompts,
).flat();

const requiredEnv = (name: string): string => {
  const value = Bun.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
};

const optionalEnv = (...names: string[]): string | undefined => {
  for (const name of names) {
    const value = Bun.env[name];
    if (value) {
      return value;
    }
  }

  return undefined;
};

const normalizeAzureOpenAIBaseURL = (endpoint: string): string => {
  const trimmed = endpoint.replace(/\/+$/, "");
  return trimmed.endsWith("/openai") ? trimmed : `${trimmed}/openai`;
};

const numberProp = (value: unknown, names: string[]): number | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const name of names) {
    const prop = record[name];
    if (typeof prop === "number" && Number.isFinite(prop)) {
      return prop;
    }
  }

  return undefined;
};

const nestedNumberProp = (
  value: unknown,
  path: readonly string[],
): number | undefined => {
  let current = value;

  for (const segment of path) {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return typeof current === "number" && Number.isFinite(current) ? current : undefined;
};

const envNumber = (name: string, fallback: number): number => {
  const value = Bun.env[name];
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Env var ${name} must be a number, received: ${value}`);
  }

  return parsed;
};

const envNumberFrom = (names: string[], fallback: number): number => {
  for (const name of names) {
    if (Bun.env[name] !== undefined) {
      return envNumber(name, fallback);
    }
  }

  return fallback;
};

const envInteger = (name: string, fallback: number): number => {
  const parsed = envNumber(name, fallback);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Env var ${name} must be a positive integer, received: ${parsed}`);
  }

  return parsed;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const runWithConcurrency = async <T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }

      const item = items[index];
      if (item === undefined) {
        return;
      }

      results[index] = await worker(item, index);
    }
  };

  const poolSize = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: poolSize }, () => runWorker()));
  return results;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const estimateTokens = (text: string): number => {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words * 1.35));
};

const formatNumber = (value: number): string => value.toFixed(2);

const formatUsd = (value: number): string => `$${value.toFixed(6)}`;

const calculateCostUsd = (
  inputTokens: number | undefined,
  outputTokens: number,
  pricing: TokenPricing,
): number =>
  ((inputTokens ?? 0) * pricing.inputPerMillion +
  outputTokens * pricing.outputPerMillion) /
  1_000_000;

type RetryConfig = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

type ProviderProgress = {
  done: number;
  total: number;
  finished: boolean;
};

type ProgressTracker = {
  state: Map<string, ProviderProgress>;
  startedAt: number;
};

const formatProgressLine = (
  tracker: ProgressTracker,
  names: readonly string[],
): string => {
  const elapsedSeconds = Math.round(
    (performance.now() - tracker.startedAt) / 1000,
  );
  const segments = names.map((name) => {
    const state = tracker.state.get(name);
    if (!state) {
      return name;
    }

    const text = state.finished ? "done" : `${state.done}/${state.total}`;
    const width = Math.max(
      `${state.total}/${state.total}`.length,
      "done".length,
    );
    return `${name} ${text.padEnd(width)}`;
  });
  return `${segments.join(" | ")} | ${elapsedSeconds}s`;
};

const runPrompt = async (
  index: number,
  prompt: string,
  model: LanguageModel,
  pricing: TokenPricing,
  providerOptions: Record<string, OpenAILanguageModelResponsesOptions>,
  attempts: number,
): Promise<BenchResult> => {
  const startedAt = performance.now();
  let firstTokenAt: number | undefined;
  let firstReasoningSummaryAt: number | undefined;
  let reasoningSummaryText = "";
  let text = "";

  const result = streamText({
    model,
    prompt,
    maxOutputTokens: Number(Bun.env.MAX_OUTPUT_TOKENS ?? 500),
    providerOptions,
  });

  for await (const chunk of result.fullStream) {
    if (chunk.type === "reasoning-delta") {
      firstReasoningSummaryAt ??= performance.now();
      reasoningSummaryText += chunk.text;
      continue;
    }

    if (chunk.type === "text-delta") {
      firstTokenAt ??= performance.now();
      text += chunk.text;
      continue;
    }

    if (chunk.type === "error") {
      throw new Error(errorMessage(chunk.error));
    }
  }

  const finishedAt = performance.now();
  const usage = await result.usage;
  const outputTokens =
    numberProp(usage, ["outputTokens", "completionTokens"]) ?? estimateTokens(text);
  const reasoningTokens =
    nestedNumberProp(usage, ["outputTokenDetails", "reasoningTokens"]) ??
    numberProp(usage, ["reasoningTokens"]);
  const inputTokens = numberProp(usage, ["inputTokens", "promptTokens"]);
  const totalTokens = numberProp(usage, ["totalTokens"]);
  const firstOutputAt = [firstReasoningSummaryAt, firstTokenAt]
    .filter((v): v is number => v !== undefined)
    .sort((a, b) => a - b)[0];
  const streamStartedAt = firstOutputAt ?? startedAt;
  const totalSeconds = (finishedAt - startedAt) / 1000;
  const streamSeconds = Math.max((finishedAt - streamStartedAt) / 1000, 0.001);

  return {
    index,
    prompt,
    outputTokens,
    reasoningTokens,
    reasoningSummary: reasoningSummaryText.trim() || undefined,
    inputTokens,
    totalTokens,
    timeToFirstReasoningSummarySeconds:
      firstReasoningSummaryAt === undefined
        ? undefined
        : (firstReasoningSummaryAt - startedAt) / 1000,
    timeToFirstTokenSeconds:
      firstTokenAt === undefined ? undefined : (firstTokenAt - startedAt) / 1000,
    streamSeconds,
    totalSeconds,
    streamTps: outputTokens / streamSeconds,
    endToEndTps: outputTokens / totalSeconds,
    costUsd: calculateCostUsd(inputTokens, outputTokens, pricing),
    attempts,
  };
};

type RunOutcome =
  | { kind: "success"; result: BenchResult }
  | { kind: "failure"; failure: RunFailure };

const runPromptWithRetries = async (
  index: number,
  prompt: string,
  model: LanguageModel,
  pricing: TokenPricing,
  providerOptions: Record<string, OpenAILanguageModelResponsesOptions>,
  retry: RetryConfig,
): Promise<RunOutcome> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
    try {
      const result = await runPrompt(
        index,
        prompt,
        model,
        pricing,
        providerOptions,
        attempt,
      );
      return { kind: "success", result };
    } catch (error: unknown) {
      lastError = error;

      if (attempt < retry.maxAttempts) {
        const delay = Math.min(
          retry.baseDelayMs * 2 ** (attempt - 1),
          retry.maxDelayMs,
        );
        await sleep(delay);
      }
    }
  }

  return {
    kind: "failure",
    failure: {
      index,
      prompt,
      attempts: retry.maxAttempts,
      message: errorMessage(lastError),
    },
  };
};

type ProviderBenchmark = {
  deployment: string;
  model: LanguageModel;
  name: string;
  pricing: TokenPricing;
  providerOptions: Record<string, OpenAILanguageModelResponsesOptions>;
};

const runProviderBenchmark = async (
  benchmark: ProviderBenchmark,
  createdAt: string,
  retry: RetryConfig,
  tracker: ProgressTracker,
): Promise<BenchmarkRecord> => {
  const progress = tracker.state.get(benchmark.name);

  const outcomes = await runWithConcurrency(
    prompts,
    MAX_CONCURRENT_PROMPTS_PER_PROVIDER,
    async (prompt, promptIndex) => {
      const runNumber = promptIndex + 1;
      const outcome = await runPromptWithRetries(
        runNumber,
        prompt,
        benchmark.model,
        benchmark.pricing,
        benchmark.providerOptions,
        retry,
      );

      if (progress) {
        progress.done += 1;
      }

      return outcome;
    },
  );

  const successes: BenchResult[] = [];
  const failures: RunFailure[] = [];
  for (const outcome of outcomes) {
    if (outcome.kind === "success") {
      successes.push(outcome.result);
    } else {
      failures.push(outcome.failure);
    }
  }

  if (progress) {
    progress.finished = true;
  }

  const summary = summarizeResults(successes);

  return {
    id: `${createdAt}-${benchmark.name.toLowerCase()}`,
    createdAt,
    provider: benchmark.name,
    deployment: benchmark.deployment,
    reasoningEffort,
    reasoningSummary,
    pricing: benchmark.pricing,
    prompts: prompts.length,
    summary,
    runs: successes,
    failures,
  };
};

export const runBench = async (record: boolean): Promise<void> => {
  const endpoint = requiredEnv("AZURE_OAI_ENDPOINT");
  const apiKey = requiredEnv("AZURE_KEY");
  const deployment = optionalEnv(
    "AZURE_DEPLOYMENT",
    "AZURE_OPENAI_DEPLOYMENT",
    "AZURE_MODEL",
    "MODEL",
  ) ?? defaultModel;
  const azurePricing: TokenPricing = {
    inputPerMillion: envNumberFrom(
      ["AZURE_INPUT_PRICE_PER_1M_TOKENS_USD", "INPUT_PRICE_PER_1M_TOKENS_USD"],
      5,
    ),
    outputPerMillion: envNumberFrom(
      ["AZURE_OUTPUT_PRICE_PER_1M_TOKENS_USD", "OUTPUT_PRICE_PER_1M_TOKENS_USD"],
      30,
    ),
  };
  const openAiModel = optionalEnv("OPENAI_MODEL", "MODEL") ?? deployment;
  const openAiPricing: TokenPricing = {
    inputPerMillion: envNumberFrom(
      ["OPENAI_INPUT_PRICE_PER_1M_TOKENS_USD", "INPUT_PRICE_PER_1M_TOKENS_USD"],
      5,
    ),
    outputPerMillion: envNumberFrom(
      ["OPENAI_OUTPUT_PRICE_PER_1M_TOKENS_USD", "OUTPUT_PRICE_PER_1M_TOKENS_USD"],
      30,
    ),
  };

  const retry: RetryConfig = {
    maxAttempts: envInteger("MAX_PROMPT_ATTEMPTS", 3),
    baseDelayMs: envInteger("RETRY_BASE_DELAY_MS", 1000),
    maxDelayMs: envInteger("RETRY_MAX_DELAY_MS", 10_000),
  };

  const azure = createAzure({
    apiKey,
    apiVersion: Bun.env.AZURE_API_VERSION ?? "v1",
    baseURL: normalizeAzureOpenAIBaseURL(endpoint),
    useDeploymentBasedUrls: Bun.env.AZURE_USE_DEPLOYMENT_URLS === "true",
  });
  const openai = createOpenAI({
    apiKey: requiredEnv("OPENAI_API_KEY"),
  });

  const benchmarks: ProviderBenchmark[] = [
    {
      deployment,
      model: azure(deployment),
      name: "Azure",
      pricing: azurePricing,
      providerOptions: {
        azure: {
          store: false,
          reasoningEffort,
          reasoningSummary,
        },
      },
    },
    {
      deployment: openAiModel,
      model: openai(openAiModel),
      name: "OpenAI",
      pricing: openAiPricing,
      providerOptions: {
        openai: {
          store: false,
          reasoningEffort,
          reasoningSummary,
        },
      },
    },
  ];

  const createdAt = new Date().toISOString();
  const startedAt = performance.now();

  const tracker: ProgressTracker = {
    state: new Map(
      benchmarks.map((b) => [
        b.name,
        { done: 0, total: prompts.length, finished: false },
      ]),
    ),
    startedAt,
  };
  const providerNames = benchmarks.map((b) => b.name);

  console.log(
    `Running ${benchmarks.length} providers: ${benchmarks
      .map((b) => `${b.name} (${b.deployment})`)
      .join(", ")} · ${prompts.length} prompts each, concurrency=${MAX_CONCURRENT_PROMPTS_PER_PROVIDER}`,
  );
  console.log(formatProgressLine(tracker, providerNames));

  const heartbeat = setInterval(() => {
    console.log(formatProgressLine(tracker, providerNames));
  }, 5000);

  let records: BenchmarkRecord[];
  try {
    records = await Promise.all(
      benchmarks.map((benchmark) =>
        runProviderBenchmark(benchmark, createdAt, retry, tracker),
      ),
    );
  } finally {
    clearInterval(heartbeat);
  }

  console.log(formatProgressLine(tracker, providerNames));

  const elapsed = (performance.now() - startedAt) / 1000;

  console.log("");
  console.log(`All providers finished in ${formatNumber(elapsed)}s`);
  console.table(
    records.map((record) => ({
      provider: record.provider,
      deployment: record.deployment,
      success: `${record.runs.length}/${record.prompts}`,
      failed: record.failures.length,
      avgStreamTps: formatNumber(record.summary.averageStreamTps),
      avgEndToEndTps: formatNumber(record.summary.averageEndToEndTps),
      cost: formatUsd(record.summary.totalCostUsd),
    })),
  );

  const totalFailures = records.reduce(
    (sum, record) => sum + record.failures.length,
    0,
  );
  if (totalFailures > 0) {
    console.log("");
    console.log(`Failures (${totalFailures}):`);
    for (const record of records) {
      for (const failure of record.failures) {
        console.log(
          `  [${record.provider}] run ${failure.index} (after ${failure.attempts} attempts): ${failure.message}`,
        );
      }
    }
  }

  if (record) {
    let storage: "database" | "json" = "json";
    for (const benchmarkRecord of records) {
      storage = await recordBenchmark(
        benchmarkRecord,
        envInteger("HISTORY_LIMIT", 500),
      );
    }

    if (storage === "database") {
      console.log("");
      console.log("Recorded benchmark histories to DATABASE_URL");
      return;
    }

    console.log("");
    console.log(`Recorded benchmark histories to ${historyPath}`);
  }
};

if (import.meta.main) {
  runBench(process.argv.includes("--record")).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
