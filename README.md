# GPT TPS Benchmark

Bun benchmark that compares streamed output tokens per second from Azure OpenAI and the OpenAI API through the Vercel AI SDK, plus a minimal dark-mode dashboard for charting samples over time.

The dashboard is a React + Vite + Tailwind v4 app that ships with the same package and is served by a tiny Bun static server. Results are read from Postgres when `DATABASE_URL` is set, or from `data/benchmark-runs.json` otherwise.

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
DATABASE_URL="postgres://..."
```

## Run

```sh
bun install
bun run bench
```

## Record History

```sh
bun run bench:record
```

When `DATABASE_URL` is set the sample is written to the `benchmark_runs` Postgres table (created on first run). Otherwise it is appended to `data/benchmark-runs.json`.

## Dashboard

```sh
bun run build      # builds the web app into web/dist
bun run site       # serves web/dist + /results.json on http://localhost:3000
```

For frontend hot-reload during development, run the API server and the Vite dev server side by side:

```sh
bun run site       # API + static fallback on :3000
bun run dev:web    # Vite dev server on :5173, proxies /results.json -> :3000
```

The frontend is in `web/`, the Bun server and benchmark scripts are in `src/`. The Bun server reads benchmark history from Postgres when `DATABASE_URL` is set, or from `data/benchmark-runs.json` otherwise.

## Scheduled Runs (GitHub)

`.github/workflows/benchmark.yml` runs the benchmark every 6 hours and commits new samples back to `data/benchmark-runs.json`.

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

## Railway Deployment

Create a Railway project with three services:

1. A Postgres database.
2. A web service from this repo.
3. A cron service from this repo.

The web service uses the checked-in `railway.json`. Build runs `bun install --frozen-lockfile && bun run typecheck && bun run build` (which produces `web/dist/`), and start runs `bun run site`.

Set these variables on both the web and cron services:

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

For the cron service override the start command to `bun run bench:record` and set the Railway cron schedule, e.g. every 6 hours:

```cron
17 */6 * * *
```

With `DATABASE_URL` set, `bun run bench:record` creates the `benchmark_runs` table on first run and the web service serves `/results.json` directly from Postgres.
