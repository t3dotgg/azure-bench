import { runBench } from "./bench";
import { readDashboardResults } from "./storage";

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

const cronIntervalMs = 5 * 60 * 1000;
let cronRunning = false;

const runScheduledBench = async (): Promise<void> => {
  if (cronRunning) {
    console.log(
      `[cron] previous run still in progress at ${new Date().toISOString()}, skipping`,
    );
    return;
  }

  cronRunning = true;
  console.log(`[cron] benchmark starting at ${new Date().toISOString()}`);
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

setInterval(runScheduledBench, cronIntervalMs);
