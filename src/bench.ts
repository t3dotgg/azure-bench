import { createAzure, type OpenAILanguageModelResponsesOptions } from "@ai-sdk/azure";
import { streamText } from "ai";

const prompts = [
  "Write a concise technical explanation of how TCP congestion control works. Use roughly 250 words.",
  "Summarize the tradeoffs between serverless functions and long-running containers for API workloads. Use roughly 250 words.",
  "Create a short implementation plan for adding audit logging to a TypeScript web app. Use roughly 250 words.",
  "Explain retrieval augmented generation to a software engineer who has never built an AI system. Use roughly 250 words.",
  "Draft a pragmatic checklist for evaluating latency in a production LLM application. Use roughly 250 words.",
];

type BenchResult = {
  index: number;
  prompt: string;
  outputTokens: number;
  inputTokens: number | undefined;
  totalTokens: number | undefined;
  timeToFirstTokenSeconds: number | undefined;
  streamSeconds: number;
  totalSeconds: number;
  streamTps: number;
  endToEndTps: number;
};

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

const estimateTokens = (text: string): number => {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words * 1.35));
};

const formatNumber = (value: number): string => value.toFixed(2);

const runPrompt = async (
  index: number,
  prompt: string,
  model: ReturnType<ReturnType<typeof createAzure>>,
): Promise<BenchResult> => {
  const startedAt = performance.now();
  let firstTokenAt: number | undefined;
  let text = "";

  const result = streamText({
    model,
    prompt,
    maxOutputTokens: Number(Bun.env.MAX_OUTPUT_TOKENS ?? 500),
    providerOptions: {
      azure: {
        store: false,
        reasoningEffort: "low",
      } satisfies OpenAILanguageModelResponsesOptions,
    },
  });

  for await (const chunk of result.textStream) {
    firstTokenAt ??= performance.now();
    text += chunk;
  }

  const finishedAt = performance.now();
  const usage = await result.usage;
  const outputTokens =
    numberProp(usage, ["outputTokens", "completionTokens"]) ?? estimateTokens(text);
  const inputTokens = numberProp(usage, ["inputTokens", "promptTokens"]);
  const totalTokens = numberProp(usage, ["totalTokens"]);
  const streamStartedAt = firstTokenAt ?? startedAt;
  const totalSeconds = (finishedAt - startedAt) / 1000;
  const streamSeconds = Math.max((finishedAt - streamStartedAt) / 1000, 0.001);

  return {
    index,
    prompt,
    outputTokens,
    inputTokens,
    totalTokens,
    timeToFirstTokenSeconds:
      firstTokenAt === undefined ? undefined : (firstTokenAt - startedAt) / 1000,
    streamSeconds,
    totalSeconds,
    streamTps: outputTokens / streamSeconds,
    endToEndTps: outputTokens / totalSeconds,
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
  ) ?? "gpt-5.5";

  const azure = createAzure({
    apiKey,
    apiVersion: Bun.env.AZURE_API_VERSION ?? "v1",
    baseURL: normalizeAzureOpenAIBaseURL(endpoint),
    useDeploymentBasedUrls: Bun.env.AZURE_USE_DEPLOYMENT_URLS === "true",
  });

  console.log(`Azure GPT TPS benchmark`);
  console.log(`Deployment: ${deployment}`);
  console.log(`Runs: ${prompts.length}`);
  console.log("");

  const results: BenchResult[] = [];

  for (const [promptIndex, prompt] of prompts.entries()) {
    const runNumber = promptIndex + 1;
    console.log(`Run ${runNumber}/${prompts.length}: ${prompt.slice(0, 72)}...`);
    const result = await runPrompt(runNumber, prompt, azure(deployment));
    results.push(result);

    console.log(
      [
        `  outputTokens=${result.outputTokens}`,
        result.inputTokens === undefined ? undefined : `inputTokens=${result.inputTokens}`,
        result.totalTokens === undefined ? undefined : `totalTokens=${result.totalTokens}`,
        result.timeToFirstTokenSeconds === undefined
          ? undefined
          : `ttft=${formatNumber(result.timeToFirstTokenSeconds)}s`,
        `stream=${formatNumber(result.streamSeconds)}s`,
        `total=${formatNumber(result.totalSeconds)}s`,
        `streamTps=${formatNumber(result.streamTps)}`,
        `endToEndTps=${formatNumber(result.endToEndTps)}`,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  const averageStreamTps =
    results.reduce((sum, result) => sum + result.streamTps, 0) / results.length;
  const averageEndToEndTps =
    results.reduce((sum, result) => sum + result.endToEndTps, 0) / results.length;

  console.log("");
  console.table(
    results.map((result) => ({
      run: result.index,
      outputTokens: result.outputTokens,
      ttftSeconds:
        result.timeToFirstTokenSeconds === undefined
          ? "n/a"
          : formatNumber(result.timeToFirstTokenSeconds),
      streamSeconds: formatNumber(result.streamSeconds),
      totalSeconds: formatNumber(result.totalSeconds),
      streamTps: formatNumber(result.streamTps),
      endToEndTps: formatNumber(result.endToEndTps),
    })),
  );
  console.log(`Average stream TPS: ${formatNumber(averageStreamTps)}`);
  console.log(`Average end-to-end TPS: ${formatNumber(averageEndToEndTps)}`);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
