# Azure GPT TPS Benchmark

Small Bun benchmark for measuring streamed tokens per second from an Azure OpenAI deployment through the Vercel AI SDK.

## Setup

Required `.env` values:

```sh
AZURE_OAI_ENDPOINT="https://your-resource.openai.azure.com/"
AZURE_KEY="..."
```

Optional values:

```sh
AZURE_DEPLOYMENT="gpt-5.5"
AZURE_API_VERSION="v1"
MAX_OUTPUT_TOKENS="500"
AZURE_USE_DEPLOYMENT_URLS="false"
INPUT_PRICE_PER_1M_TOKENS_USD="5"
OUTPUT_PRICE_PER_1M_TOKENS_USD="30"
```

`AZURE_DEPLOYMENT` must match the Azure OpenAI deployment name, not just the model family name. If it is not set, the script defaults to `gpt-5.5`.

The default pricing values are for GPT-5.5 public token pricing found on April 30, 2026: `$5 / 1M` input tokens and `$30 / 1M` output tokens. Override them if your Azure region, contract, or deployment uses different pricing. Reasoning tokens are logged separately when Azure returns them, but cost is calculated from total output tokens so reasoning tokens are not double-counted.

## Run

```sh
bun install
bun run bench
```

The benchmark runs five prompts sequentially and logs output tokens, reasoning tokens, time to first text chunk, streamed TPS, end-to-end TPS, and estimated cost for each run.

## Record History

```sh
bun run bench:record
```

This appends a timestamped benchmark sample to:

- `data/benchmark-runs.json`, the raw committed history
- `public/results.json`, the dashboard data file

Each sample stores the deployment, reasoning effort, pricing, per-run metrics, averages, total output tokens, total reasoning tokens, and total estimated cost.

## Dashboard

```sh
bun run site
```

Open `http://localhost:3000` to view the static dashboard. It charts average streamed TPS and end-to-end TPS over time, with recent run details below the chart.

The dashboard is fully static and reads `public/results.json`, so `public/` can be deployed to Vercel static hosting, GitHub Pages, or any static host.

## Scheduled Runs

`.github/workflows/benchmark.yml` runs the benchmark every 6 hours and can also be started manually with `workflow_dispatch`.

Configure these GitHub repository secrets:

```sh
AZURE_OAI_ENDPOINT
AZURE_KEY
```

Optional GitHub repository variables:

```sh
AZURE_DEPLOYMENT
AZURE_API_VERSION
INPUT_PRICE_PER_1M_TOKENS_USD
OUTPUT_PRICE_PER_1M_TOKENS_USD
MAX_OUTPUT_TOKENS
HISTORY_LIMIT
```

The workflow commits updated `data/benchmark-runs.json` and `public/results.json` back to the branch, which keeps storage simple and auditable.
