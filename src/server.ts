import { runBench } from "./bench";
import { readBenchmarkHistory, readDashboardResults } from "./storage";

const staticDir = `${process.cwd()}/web/dist`;

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const contentTypeFor = (path: string): string => {
  const extension = path.match(/\.[^.]+$/)?.[0];
  return extension
    ? contentTypes[extension] ?? "application/octet-stream"
    : "text/html";
};

const cacheHeadersFor = (path: string): Record<string, string> =>
  path.startsWith("/assets/")
    ? { "Cache-Control": "public, max-age=31536000, immutable" }
    : { "Cache-Control": "no-cache" };

const isAuthorizedDumpRequest = (request: Request): boolean => {
  const token = Bun.env.DASHBOARD_DUMP_TOKEN;
  if (!token) return false;

  return request.headers.get("Authorization") === `Bearer ${token}`;
};

const server = Bun.serve({
  port: Number(Bun.env.PORT ?? 3000),
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/results.json") {
      const results = await readDashboardResults();
      return Response.json(results, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (url.pathname === "/__benchmark-runs.json") {
      if (!isAuthorizedDumpRequest(request)) {
        return new Response("Not found", { status: 404 });
      }

      const history = await readBenchmarkHistory();
      return Response.json(history, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": 'attachment; filename="benchmark-runs.json"',
        },
      });
    }

    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const safePath = pathname.replaceAll("..", "");
    const file = Bun.file(`${staticDir}${safePath}`);

    if (await file.exists()) {
      return new Response(file, {
        headers: {
          "Content-Type": contentTypeFor(safePath),
          ...cacheHeadersFor(safePath),
        },
      });
    }

    const indexFile = Bun.file(`${staticDir}/index.html`);
    if (await indexFile.exists()) {
      return new Response(indexFile, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Dashboard available at http://localhost:${server.port}`);

const readMinuteSetting = (
  name: string,
  defaultValue: number,
  validate: (value: number) => boolean,
): number => {
  const raw = Bun.env[name];
  if (raw === undefined) return defaultValue;

  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || !validate(value)) {
    console.warn(
      `[cron] invalid ${name}=${raw}; falling back to ${defaultValue}`,
    );
    return defaultValue;
  }

  return value;
};

const cronIntervalMinutes = readMinuteSetting(
  "BENCH_CRON_INTERVAL_MINUTES",
  5,
  (value) => value > 0 && value <= 24 * 60,
);
const cronOffsetMinutes = readMinuteSetting(
  "BENCH_CRON_OFFSET_MINUTES",
  0,
  (value) => value >= 0 && value < cronIntervalMinutes,
);
const cronIntervalMs = cronIntervalMinutes * 60 * 1000;
const cronOffsetMs = cronOffsetMinutes * 60 * 1000;
let cronRunning = false;

const nextScheduledBenchAt = (now = Date.now()): Date => {
  const elapsedSinceOffset = now - cronOffsetMs;
  const nextRun =
    Math.floor(elapsedSinceOffset / cronIntervalMs + 1) * cronIntervalMs +
    cronOffsetMs;
  return new Date(nextRun);
};

const runScheduledBench = async (scheduledFor: Date): Promise<void> => {
  if (cronRunning) {
    console.log(
      `[cron] previous run still in progress at ${new Date().toISOString()}, skipping ${scheduledFor.toISOString()}`,
    );
    return;
  }

  cronRunning = true;
  console.log(
    `[cron] benchmark scheduled for ${scheduledFor.toISOString()} starting at ${new Date().toISOString()}`,
  );
  try {
    await runBench(true);
    console.log(`[cron] benchmark finished at ${new Date().toISOString()}`);
  } catch (error: unknown) {
    console.error(
      "[cron] benchmark failed:",
      error instanceof Error ? error.message : error,
    );
  } finally {
    cronRunning = false;
  }
};

const scheduleNextBench = (): void => {
  const scheduledFor = nextScheduledBenchAt();
  const delayMs = scheduledFor.getTime() - Date.now();
  console.log(`[cron] next benchmark scheduled for ${scheduledFor.toISOString()}`);

  setTimeout(() => {
    void runScheduledBench(scheduledFor).finally(scheduleNextBench);
  }, delayMs);
};

scheduleNextBench();
