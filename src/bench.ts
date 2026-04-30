import { createAzure, type OpenAILanguageModelResponsesOptions } from "@ai-sdk/azure";
import { createOpenAI } from "@ai-sdk/openai";
import { type LanguageModel, streamText } from "ai";
import {
  type BenchResult,
  type BenchmarkRecord,
  type TokenPricing,
  historyPath,
  publicResultsPath,
  recordBenchmark,
  summarizeResults,
} from "./storage";

const reasoningEffort = "high";
const defaultModel = "gpt-5.5";

const prompts = [
  "Write a concise technical explanation of how TCP congestion control works. Use roughly 250 words.",
  "Summarize the tradeoffs between serverless functions and long-running containers for API workloads. Use roughly 250 words.",
  "Create a short implementation plan for adding audit logging to a TypeScript web app. Use roughly 250 words.",
  "Explain retrieval augmented generation to a software engineer who has never built an AI system. Use roughly 250 words.",
  "Draft a pragmatic checklist for evaluating latency in a production LLM application. Use roughly 250 words.",
];

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

const runPrompt = async (
  index: number,
  prompt: string,
  model: LanguageModel,
  pricing: TokenPricing,
  providerOptions: Record<string, OpenAILanguageModelResponsesOptions>,
): Promise<BenchResult> => {
  const startedAt = performance.now();
  let firstTokenAt: number | undefined;
  let text = "";

  const result = streamText({
    model,
    prompt,
    maxOutputTokens: Number(Bun.env.MAX_OUTPUT_TOKENS ?? 500),
    providerOptions,
  });

  for await (const chunk of result.textStream) {
    firstTokenAt ??= performance.now();
    text += chunk;
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
  const streamStartedAt = firstTokenAt ?? startedAt;
  const totalSeconds = (finishedAt - startedAt) / 1000;
  const streamSeconds = Math.max((finishedAt - streamStartedAt) / 1000, 0.001);

  return {
    index,
    prompt,
    outputTokens,
    reasoningTokens,
    inputTokens,
    totalTokens,
    timeToFirstTokenSeconds:
      firstTokenAt === undefined ? undefined : (firstTokenAt - startedAt) / 1000,
    streamSeconds,
    totalSeconds,
    streamTps: outputTokens / streamSeconds,
    endToEndTps: outputTokens / totalSeconds,
    costUsd: calculateCostUsd(inputTokens, outputTokens, pricing),
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
): Promise<BenchmarkRecord> => {
  console.log(`${benchmark.name} GPT TPS benchmark`);
  console.log(`Model: ${benchmark.deployment}`);
  console.log(`Reasoning effort: ${reasoningEffort}`);
  console.log(
    `Pricing: input=${formatUsd(
      benchmark.pricing.inputPerMillion,
    )}/1M output=${formatUsd(benchmark.pricing.outputPerMillion)}/1M`,
  );
  console.log(`Runs: ${prompts.length}`);
  console.log("");

  const results: BenchResult[] = [];

  for (const [promptIndex, prompt] of prompts.entries()) {
    const runNumber = promptIndex + 1;
    console.log(`Run ${runNumber}/${prompts.length}: ${prompt.slice(0, 72)}...`);
    const result = await runPrompt(
      runNumber,
      prompt,
      benchmark.model,
      benchmark.pricing,
      benchmark.providerOptions,
    );
    results.push(result);

    console.log(
      [
        `  outputTokens=${result.outputTokens}`,
        result.reasoningTokens === undefined
          ? "reasoningTokens=n/a"
          : `reasoningTokens=${result.reasoningTokens}`,
        result.inputTokens === undefined ? undefined : `inputTokens=${result.inputTokens}`,
        result.totalTokens === undefined ? undefined : `totalTokens=${result.totalTokens}`,
        result.timeToFirstTokenSeconds === undefined
          ? undefined
          : `ttft=${formatNumber(result.timeToFirstTokenSeconds)}s`,
        `stream=${formatNumber(result.streamSeconds)}s`,
        `total=${formatNumber(result.totalSeconds)}s`,
        `streamTps=${formatNumber(result.streamTps)}`,
        `endToEndTps=${formatNumber(result.endToEndTps)}`,
        `cost=${formatUsd(result.costUsd)}`,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  const summary = summarizeResults(results);

  console.log("");
  console.table(
    results.map((result) => ({
      run: result.index,
      outputTokens: result.outputTokens,
      reasoningTokens: result.reasoningTokens ?? "n/a",
      ttftSeconds:
        result.timeToFirstTokenSeconds === undefined
          ? "n/a"
          : formatNumber(result.timeToFirstTokenSeconds),
      streamSeconds: formatNumber(result.streamSeconds),
      totalSeconds: formatNumber(result.totalSeconds),
      streamTps: formatNumber(result.streamTps),
      endToEndTps: formatNumber(result.endToEndTps),
      costUsd: formatUsd(result.costUsd),
    })),
  );
  console.log(`Average stream TPS: ${formatNumber(summary.averageStreamTps)}`);
  console.log(`Average end-to-end TPS: ${formatNumber(summary.averageEndToEndTps)}`);
  console.log(`Total estimated cost: ${formatUsd(summary.totalCostUsd)}`);
  console.log("");

  return {
    id: `${createdAt}-${benchmark.name.toLowerCase()}`,
    createdAt,
    provider: benchmark.name,
    deployment: benchmark.deployment,
    reasoningEffort,
    pricing: benchmark.pricing,
    prompts: prompts.length,
    summary,
    runs: results,
  };
};

const main = async (): Promise<void> => {
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
        },
      },
    },
  ];

  const createdAt = new Date().toISOString();
  const records: BenchmarkRecord[] = [];
  for (const benchmark of benchmarks) {
    records.push(await runProviderBenchmark(benchmark, createdAt));
  }

  if (process.argv.includes("--record")) {
    let storage: "database" | "json" = "json";
    for (const record of records) {
      storage = await recordBenchmark(record, envInteger("HISTORY_LIMIT", 500));
    }

    if (storage === "database") {
      console.log("Recorded benchmark histories to DATABASE_URL");
      return;
    }

    console.log(`Recorded benchmark histories to ${historyPath}`);
    console.log(`Updated dashboard data at ${publicResultsPath}`);
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
