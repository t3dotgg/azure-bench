# GPT TPS Benchmark

Small Bun benchmark for comparing streamed output tokens per second from Azure OpenAI and OpenAI's official API through the Vercel AI SDK.

## Setup

Required `.env` values:

```sh
AZURE_OAI_ENDPOINT="https://your-resource.openai.azure.com/"
AZURE_KEY="..."
OPENAI_API_KEY="..."
```

Optional values:

```sh
AZURE_DEPLOYMENT="gpt-5.5"
OPENAI_MODEL="gpt-5.5"
AZURE_API_VERSION="v1"
MAX_OUTPUT_TOKENS="500"
AZURE_USE_DEPLOYMENT_URLS="false"
INPUT_PRICE_PER_1M_TOKENS_USD="5"
OUTPUT_PRICE_PER_1M_TOKENS_USD="30"
AZURE_INPUT_PRICE_PER_1M_TOKENS_USD="5"
AZURE_OUTPUT_PRICE_PER_1M_TOKENS_USD="30"
OPENAI_INPUT_PRICE_PER_1M_TOKENS_USD="5"
OPENAI_OUTPUT_PRICE_PER_1M_TOKENS_USD="30"
```

`AZURE_DEPLOYMENT` must match the Azure OpenAI deployment name, not just the model family name. If it is not set, the script defaults to `gpt-5.5`. `OPENAI_MODEL` defaults to the Azure deployment value so both providers compare the same model name unless you override it.

The default pricing values are for GPT-5.5 public token pricing found on April 30, 2026: `$5 / 1M` input tokens and `$30 / 1M` output tokens. Override the global pricing values or the provider-specific values if your Azure region, OpenAI account, contract, or deployment uses different pricing. Reasoning tokens are logged separately when providers return them, but cost is calculated from total output tokens so reasoning tokens are not double-counted.

## Run

```sh
bun install
bun run bench
```

The benchmark runs five prompts sequentially for each provider and logs output tokens, reasoning tokens, time to first text chunk, streamed TPS, end-to-end TPS, and estimated cost for each run.

## Record History

```sh
bun run bench:record
```

This appends a timestamped benchmark sample to:

- `data/benchmark-runs.json`, the raw committed history
- `public/results.json`, the dashboard data file

Each provider sample stores the provider name, deployment or model, reasoning effort, pricing, per-run metrics, averages, total output tokens, total reasoning tokens, and total estimated cost.

## Dashboard

```sh
bun run site
```

Open `http://localhost:3000` to view the static dashboard. It charts average streamed output TPS by provider over time and shows the min-to-max run range for each provider sample.

The dashboard is fully static and reads `public/results.json`, so `public/` can be deployed to Vercel static hosting, GitHub Pages, or any static host.

## Scheduled Runs

`.github/workflows/benchmark.yml` runs the benchmark every 6 hours and can also be started manually with `workflow_dispatch`.

Configure these GitHub repository secrets:

```sh
AZURE_OAI_ENDPOINT
AZURE_KEY
OPENAI_API_KEY
```

Optional GitHub repository variables:

```sh
AZURE_DEPLOYMENT
OPENAI_MODEL
AZURE_API_VERSION
INPUT_PRICE_PER_1M_TOKENS_USD
OUTPUT_PRICE_PER_1M_TOKENS_USD
AZURE_INPUT_PRICE_PER_1M_TOKENS_USD
AZURE_OUTPUT_PRICE_PER_1M_TOKENS_USD
OPENAI_INPUT_PRICE_PER_1M_TOKENS_USD
OPENAI_OUTPUT_PRICE_PER_1M_TOKENS_USD
MAX_OUTPUT_TOKENS
HISTORY_LIMIT
```

The workflow commits updated `data/benchmark-runs.json` and `public/results.json` back to the branch, which keeps storage simple and auditable.

## Railway Deployment

Railway should use Postgres for benchmark history. Repo file writes are not the right storage layer on Railway because the benchmark cron service and web service run as separate deployments.

Create a Railway project with three services:

1. A Postgres database.
2. A web service from this repo.
3. A cron service from this repo.

The web service can use the checked-in `railway.json`:

```json
{
  "deploy": {
    "startCommand": "bun run site",
    "healthcheckPath": "/"
  }
}
```

Set these variables on both the web service and cron service:

```sh
DATABASE_URL="${{Postgres.DATABASE_URL}}"
AZURE_OAI_ENDPOINT="https://your-resource.openai.azure.com/"
AZURE_KEY="..."
AZURE_DEPLOYMENT="gpt-5.5"
OPENAI_API_KEY="..."
OPENAI_MODEL="gpt-5.5"
AZURE_API_VERSION="v1"
INPUT_PRICE_PER_1M_TOKENS_USD="5"
OUTPUT_PRICE_PER_1M_TOKENS_USD="30"
MAX_OUTPUT_TOKENS="500"
HISTORY_LIMIT="500"
```

For the cron service, override the start command:

```sh
bun run bench:record
```

Then set the Railway cron schedule in the cron service settings. Example, every 6 hours in UTC:

```cron
17 */6 * * *
```

With `DATABASE_URL` present, `bun run bench:record` creates the `benchmark_runs` table automatically, stores each scheduled result in Postgres, and the web service serves `/results.json` from Postgres for the dashboard.
