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
```

`AZURE_DEPLOYMENT` must match the Azure OpenAI deployment name, not just the model family name. If it is not set, the script defaults to `gpt-5.5`.

## Run

```sh
bun install
bun run bench
```

The benchmark runs five prompts sequentially and logs output tokens, time to first text chunk, streamed TPS, and end-to-end TPS for each run.
