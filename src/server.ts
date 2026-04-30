const publicDir = `${process.cwd()}/public`;

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const contentTypeFor = (path: string): string => {
  const extension = path.match(/\.[^.]+$/)?.[0];
  return extension ? contentTypes[extension] ?? "application/octet-stream" : "text/html";
};

const server = Bun.serve({
  port: Number(Bun.env.PORT ?? 3000),
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const normalizedPath = pathname.replaceAll("..", "");
    const file = Bun.file(`${publicDir}${normalizedPath}`);

    if (await file.exists()) {
      return new Response(file, {
        headers: {
          "Content-Type": contentTypeFor(normalizedPath),
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Dashboard available at http://localhost:${server.port}`);
