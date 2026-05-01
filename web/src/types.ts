export type BenchmarkRun = {
  index: number;
  outputTokens: number;
  reasoningTokens?: number;
  reasoningSummary?: string;
  inputTokens?: number;
  totalTokens?: number;
  timeToFirstReasoningSummarySeconds?: number;
  timeToFirstTokenSeconds?: number;
  streamSeconds: number;
  totalSeconds: number;
  streamTps: number;
  endToEndTps: number;
  costUsd: number;
  attempts?: number;
};

export type RunFailure = {
  index: number;
  prompt: string;
  attempts: number;
  message: string;
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
  provider?: string;
  deployment: string;
  reasoningEffort: string;
  reasoningSummary?: string;
  pricing: { inputPerMillion: number; outputPerMillion: number };
  prompts: number;
  summary: BenchmarkSummary;
  runs: BenchmarkRun[];
  failures?: RunFailure[];
};

export type DashboardResults = {
  generatedAt: string | null;
  history: BenchmarkRecord[];
};
