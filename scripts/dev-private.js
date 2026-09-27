// Local private mode launcher (ADR 0005): `pnpm dev:private`. Runs the Next.js dev server behind a Node HTTP server that
// listens on 127.0.0.1 only and proves loopback per connection (lib/private/loopback.js). Never used in production.
import { createServer } from "node:http";
import next from "next";
import { TOKEN_ENV, newLoopbackToken, tagLoopbackRequest, isLoopbackAddress } from "../lib/private/loopback.js";

if (process.env.VERCEL) throw new Error("Local private mode never runs on Vercel.");
const hostname = "127.0.0.1", port = Number(process.env.PORT || 3000);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid port.");
// A fresh token per launch; it overrides any value from the environment or .env files and is never sent to clients.
process.env[TOKEN_ENV] = newLoopbackToken();
const app = next({ dev: true, hostname, port });
const handle = app.getRequestHandler();
await app.prepare();
const upgrade = typeof app.getUpgradeHandler === "function" ? app.getUpgradeHandler() : null;
const server = createServer((req, res) => { tagLoopbackRequest(req, process.env[TOKEN_ENV]); handle(req, res); });
server.on("upgrade", (req, socket, head) => {
  if (!isLoopbackAddress(req.socket?.remoteAddress) || !upgrade) { socket.destroy(); return; }
  tagLoopbackRequest(req, process.env[TOKEN_ENV]); upgrade(req, socket, head);
});
server.listen(port, hostname, () => console.log(`Local private mode: http://${hostname}:${port} (loopback connections only)`));
