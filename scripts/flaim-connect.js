// One-time Flaim connection for local private mode (ESPN-LIVE-01, ADR 0013):
//   pnpm --silent flaim:connect --config <private config path> [--no-open]
// Registers a local public OAuth client with Flaim, runs Authorization Code + PKCE S256 through a 127.0.0.1 loopback callback,
// stores the tokens in the private config's `facts_source.auth_path` (outside the repository, owner-only, atomic), then loads
// the configured league once through Flaim to verify. Prints only redacted results: never tokens, codes, paths, ids or names.
// Re-run it any time to reconnect (for example after Flaim reports that the stored authorization is no longer valid).
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { readPrivateJson, validatePrivateConfig, MAX_PRIVATE_CONFIG_BYTES } from "../lib/private/config.js";
import { FLAIM_CALLBACK_PATH, authorizationUrl, discoverFlaim, exchangeCode, pkcePair, registerClient, stateMatches } from "../lib/providers/flaim/oauth.js";
import { newAuthorizationGeneration, writeFlaimAuth } from "../lib/providers/flaim/auth-store.js";
import { createFlaimMcpClient } from "../lib/providers/flaim/mcp-client.js";
import { loadFlaimLiveFacts } from "../lib/providers/flaim/live-source.js";

const WAIT_MS = 10 * 60 * 1000;
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const say = line => process.stdout.write(`${line}\n`);
const fail = (message, code = 1) => { process.stderr.write(`Flaim connection failed: ${message}\n`); process.exit(code); };
const safe = error => (error && typeof error.message === "string" && error.name !== "Error" ? error.message : "unexpected error");

const configArg = flag("--config") ?? process.env.ESPN_PRIVATE_CONFIG;
if (!configArg) fail("pass --config <private config path> (or set ESPN_PRIVATE_CONFIG).", 2);
const configPath = isAbsolute(configArg) ? configArg : resolve(configArg);
const root = process.cwd();
let config;
try {
  const { value } = readPrivateJson(configPath, { root, maxBytes: MAX_PRIVATE_CONFIG_BYTES, label: "configuration" });
  config = validatePrivateConfig(value, { configPath, root });
} catch (error) { fail(safe(error), 2); }
if (config.facts_kind !== "flaim_live") fail('the private configuration must use facts_source.kind "flaim_live" with an auth_path.', 2);

let meta;
try { meta = await discoverFlaim(); } catch (error) { fail(safe(error)); }
say("Flaim OAuth metadata: OK (PKCE S256, client registration)");

const { verifier, challenge, state } = pkcePair();
let settle;
const outcome = new Promise(r => (settle = r));
const server = createServer((req, res) => {
  let url;
  try { url = new URL(req.url, "http://127.0.0.1"); } catch { res.writeHead(400).end(); return; }
  if (req.method !== "GET" || url.pathname !== FLAIM_CALLBACK_PATH) { res.writeHead(404).end(); return; }
  const headers = { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" };
  // A wrong or missing state is ignored (it cannot end or hijack this flow); only the matching callback completes it.
  if (!stateMatches(url.searchParams.get("state"), state)) { res.writeHead(400, headers).end("This authorization response does not belong to the current connection attempt."); return; }
  const code = url.searchParams.get("code"), error = url.searchParams.get("error");
  res.writeHead(200, headers).end(code && !error ? "Fantasy Dashboard is connected to Flaim. You can close this tab." : "Flaim authorization was not granted. You can close this tab.");
  settle({ code: code && !error ? code : null, error: error ? String(error).replace(/[^a-z_]/gi, "").slice(0, 40) || "denied" : null });
});
await new Promise((ok, bad) => { server.once("error", bad); server.listen(0, "127.0.0.1", ok); }).catch(() => fail("could not open the local 127.0.0.1 callback listener."));
const redirectUri = `http://127.0.0.1:${server.address().port}${FLAIM_CALLBACK_PATH}`;
const close = () => new Promise(r => server.close(() => r()));

let client;
try { client = await registerClient(meta, redirectUri); } catch (error) { await close(); fail(safe(error)); }
say("Local public client registered with Flaim (no client secret).");

const url = authorizationUrl(meta, { clientId: client.client_id, redirectUri, challenge, state });
say("\nApprove Fantasy Dashboard in your browser. If no tab opens, paste this URL into your browser");
say("(it carries only OAuth protocol parameters; no secret or token):\n");
say(url);
say("\nWaiting for Flaim (up to 10 minutes)…");
if (!args.includes("--no-open")) {
  const [cmd, cmdArgs] = process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : [process.platform === "darwin" ? "open" : "xdg-open", [url]];
  try { const child = spawn(cmd, cmdArgs, { detached: true, stdio: "ignore", windowsHide: true }); child.on("error", () => {}); child.unref(); } catch { /* URL already printed */ }
}
const timer = setTimeout(() => settle({ code: null, error: "timeout" }), WAIT_MS);
const result = await outcome;
clearTimeout(timer);
await close();
if (!result.code) fail(result.error === "timeout" ? "no authorization arrived within 10 minutes; run the command again." : `Flaim did not grant authorization (${result.error}).`);
say("Authorization received; state verified.");

let tokens;
try { tokens = await exchangeCode(meta, { clientId: client.client_id, code: result.code, redirectUri, verifier }); } catch (error) { fail(safe(error)); }
result.code = null;
try { writeFlaimAuth(config.auth_path, { client_id: client.client_id, token_endpoint: meta.token_endpoint, ...tokens, authorization_generation: newAuthorizationGeneration() }, { root }); } catch (error) { fail(safe(error)); }
say("Flaim authorization saved to the private auth file (outside the repository).");

try {
  const { facts } = await loadFlaimLiveFacts(createFlaimMcpClient({ authPath: config.auth_path, root }), { leagueId: config.league_id, season: config.season, teamId: config.team_id });
  const unavailable = facts.warnings.filter(w => w.code === "PROVIDER_UNAVAILABLE").length;
  say(`Verified through Flaim: configured ESPN league found; ${facts.teams.length} team rosters loaded; your team ${facts.user_team_id != null ? "recognized from the Flaim session" : "not identified by the session (spectator)"}; ${unavailable ? `${unavailable} optional resource(s) unavailable this time` : "standings, matchups, available players and transactions loaded"}.`);
} catch (error) { fail(`authorization was saved, but loading the configured league failed: ${safe(error)}`); }
say("\nDone. Start the dashboard with `pnpm dev:private`; it now loads this league live through Flaim.");
