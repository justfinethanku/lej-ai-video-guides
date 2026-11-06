// Serves demo-app/ at http://localhost:4400 so the example guide has something to film. pnpm demo
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { staticFile } from "./static-files.mjs";

const ROOT = fileURLToPath(new URL("../demo-app/", import.meta.url));

export function createDemoServer(root = ROOT) {
  return createServer(async (req, res) => {
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(req.headers.host ?? "")) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
      return;
    }
    const file = await staticFile(root, req.url);
    res.writeHead(file.status, { "Content-Type": file.contentType ?? "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
    res.end(req.method === "HEAD" ? undefined : file.body);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4400);
  const server = createDemoServer();
  server.listen(port, "127.0.0.1", () => console.log(`Relay Desk demo at http://localhost:${server.address().port}`));
}
