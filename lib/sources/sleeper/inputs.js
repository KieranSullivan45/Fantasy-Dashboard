// Sleeper resource-refresh coordinator (SLEEPER-REFRESH-01, ADR 0008).
//
// Owns the committed ("last-known-good") Sleeper resources of each league, per-resource freshness/attempt metadata, and a
// single in-flight refresh per league. Every guarantee here is PROCESS-LOCAL: a warm server instance coalesces and
// remembers; another instance has its own state. No persistence, no cross-instance locking.
//
// Promotion policy: a fetched value replaces the committed one only after it validates. Fetched values are SOURCE
// evidence (per-league slots and process-wide shared slots with their own single flight). Each league has its own
// committed CORE (league, users, rosters, NFL state, player catalog) that advances atomically: only when every core source
// holds a valid value and none has an unresolved failed attempt; otherwise the league keeps exactly its previous core,
// whatever another league's refresh did to the shared sources. Optional
// activity (transactions, matchups, trending) keeps its own previous valid value when a refresh of it fails. A value that
// never loaded stays missing (null) and the snapshot says so; nothing is invented.
import { createHash } from "node:crypto";

const API = "https://api.sleeper.app/v1";
export const TRENDING_PATH = "/players/nfl/trending/add?lookback_hours=24&limit=100";

export const REFRESH_POLICY = Object.freeze({
  guarantee: "process-local",
  // A resource is "stale" (and due for a non-forced refresh) once its last success is this old.
  stale_after_seconds: Object.freeze({ dynamic: 300, slow: 900, catalog: 86400 }),
  // Manual refresh re-fetches dynamic resources, but never the same resource twice within this window (abuse bound).
  min_force_interval_seconds: 10,
  // After a failed attempt, a non-forced read does not retry that resource for this long.
  failure_backoff_seconds: 30,
  // Bounded memory for arbitrary (unpinned) leagues: at most this many are tracked. Only idle ones are evicted (least
  // recently used first); when all are busy a new league is refused. Installation (pinned) leagues sit outside this bound
  // and are never eviction victims.
  max_leagues: 16,
});

// NFL state follows the dynamic cadence because it selects the matchup week and transaction rounds.
const CLASSES = Object.freeze({ state: "dynamic", rosters: "dynamic", matchups: "dynamic", transactions: "dynamic", league: "slow", users: "slow", trending: "slow", players: "catalog" });
export const resourceClass = name => CLASSES[name.split("/")[0]];

const MESSAGES = Object.freeze({
  TIMEOUT: "Sleeper did not respond in time.",
  RATE_LIMITED: "Sleeper rate-limited the request.",
  HTTP_ERROR: "Sleeper returned an error status.",
  MALFORMED_RESPONSE: "Sleeper returned a response that is not valid JSON.",
  INVALID_DATA: "Sleeper returned data that failed validation.",
  NOT_FOUND: "Sleeper did not return this league.",
  NOT_PROMOTED: "Fetched, but not promoted: another core league resource has not refreshed successfully.",
  CAPACITY: "The server is already refreshing its maximum number of leagues; try again shortly.",
  UPSTREAM_UNAVAILABLE: "Sleeper could not be reached.",
});

/** Sanitized upstream failure: a fixed code and message, an HTTP status and a fixed validation reason at most. Never a payload. */
export class SleeperResourceError extends Error {
  constructor(code, { status = null, retryAfter = null, reason = null, resource = null } = {}) {
    const known = Object.hasOwn(MESSAGES, code) ? code : "UPSTREAM_UNAVAILABLE";
    super(resource ? `Sleeper ${resource} data is unavailable. ${MESSAGES[known]}${reason ? ` (${reason})` : ""}` : MESSAGES[known]);
    this.name = "SleeperResourceError"; this.code = known; this.status = status; this.retryAfter = retryAfter; this.reason = reason; this.resource = resource;
  }
}
const sanitize = error => error instanceof SleeperResourceError ? error : new SleeperResourceError("UPSTREAM_UNAVAILABLE");
const retryAfterSeconds = value => { const n = Number(value); return value != null && value !== "" && Number.isFinite(n) && n >= 0 ? Math.min(Math.ceil(n), 3600) : null; };

/** Read-only Sleeper transport. Uncached: the coordinator is the cache, so a forced refresh really reaches Sleeper. */
export function createSleeperTransport(fetcher = fetch) {
  return async path => {
    let response;
    try {
      response = await fetcher(`${API}${path}`, { cache: "no-store", signal: AbortSignal.timeout(path === "/players/nfl" ? 20000 : 10000), headers: { Accept: "application/json" } });
    } catch (error) {
      throw new SleeperResourceError(error?.name === "TimeoutError" || error?.name === "AbortError" ? "TIMEOUT" : "UPSTREAM_UNAVAILABLE");
    }
    if (response.status === 429) throw new SleeperResourceError("RATE_LIMITED", { status: 429, retryAfter: retryAfterSeconds(response.headers.get("retry-after")) });
    if (!response.ok) throw new SleeperResourceError("HTTP_ERROR", { status: response.status });
    try { return await response.json(); } catch { throw new SleeperResourceError("MALFORMED_RESPONSE"); }
  };
}

// Canonical JSON (sorted object keys) so identical evidence always hashes identically. Array order is kept: it can be meaningful.
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value !== null && typeof value === "object" ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`
  : JSON.stringify(value ?? null);
export const contentDigest = value => createHash("sha256").update(canonical(value)).digest("hex");

const isObject = v => v !== null && typeof v === "object" && !Array.isArray(v);
const invalid = reason => { throw new SleeperResourceError("INVALID_DATA", { reason }); };
const idList = (value, label) => {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some(id => typeof id !== "string" && typeof id !== "number")) invalid(`${label} is not a list of player ids`);
  return value.map(String).filter(id => id !== "0");
};

export const validators = Object.freeze({
  state(v) { if (!isObject(v) || !/^\d{4}$/.test(String(v.season ?? ""))) invalid("NFL state has no season"); },
  players(v) { if (!isObject(v) || !Object.keys(v).length) invalid("player catalog is empty or not an object"); },
  trending(v) { if (!Array.isArray(v) || v.some(item => !isObject(item) || item.player_id == null)) invalid("trending list is malformed"); },
  league(v, { leagueId, previous }) {
    if (v == null) throw new SleeperResourceError("NOT_FOUND");
    if (!isObject(v) || v.league_id == null) invalid("league has no id");
    if (String(v.league_id) !== String(leagueId)) invalid("league id does not match the request");
    if (v.sport && v.sport !== "nfl") invalid("only NFL leagues are supported");
    if (!/^\d{4}$/.test(String(v.season ?? ""))) invalid("league has no season");
    if (!Array.isArray(v.roster_positions)) invalid("league has no roster positions");
    if (previous && String(previous.season) !== String(v.season)) invalid("league season changed");
  },
  users(v) {
    if (!Array.isArray(v) || v.some(u => !isObject(u) || u.user_id == null)) invalid("league members are malformed");
    if (new Set(v.map(u => String(u.user_id))).size !== v.length) invalid("duplicate league members");
  },
  rosters(v, { leagueId }) {
    if (!Array.isArray(v) || !v.length) invalid("rosters are missing");
    const ids = new Set(), owned = new Set();
    for (const roster of v) {
      if (!isObject(roster) || !Number.isSafeInteger(roster.roster_id) || roster.roster_id < 1) invalid("roster has no valid id");
      if (ids.has(roster.roster_id)) invalid("duplicate roster id");
      ids.add(roster.roster_id);
      if (roster.league_id != null && String(roster.league_id) !== String(leagueId)) invalid("roster belongs to another league");
      for (const key of ["starters", "reserve", "taxi"]) idList(roster[key], key);
      for (const id of idList(roster.players, "players")) { if (owned.has(id)) invalid("player appears on more than one roster"); owned.add(id); }
    }
  },
  transactions(v) { if (!Array.isArray(v) || v.some(tx => !isObject(tx))) invalid("transactions are malformed"); },
  matchups(v, { rosterIds }) {
    if (!Array.isArray(v) || v.some(m => !isObject(m))) invalid("matchups are malformed");
    if (v.some(m => !rosterIds.has(m.roster_id))) invalid("matchup references an unknown roster");
  },
});

const iso = t => t == null ? null : new Date(t).toISOString();
const CORE = Object.freeze(["league", "users", "rosters", "state", "players"]);
const CORE_ORDER = CORE;
const slot = () => ({ has: false, value: null, digest: null, last_success_at: null, last_attempt_at: null, last_attempt_status: null, error: null, retry_until: 0, inflight: null });

/**
 * Creates a coordinator. `ensure(leagueId, { force })` returns `{ league_id, revision, bundle, freshness, report }` for the
 * committed bundle after refreshing due resources (force: also the dynamic ones, bounded by min_force_interval).
 * `bundle` is immutable; `revision` is a deterministic digest of exactly its committed evidence.
 */
export function createSleeperInputs({ fetchData = createSleeperTransport(), now = Date.now, policy = REFRESH_POLICY, isPinned = () => false } = {}) {
  const globals = new Map([["state", slot()], ["players", slot()], ["trending", slot()]]);
  const leagues = new Map();
  const ttl = name => policy.stale_after_seconds[resourceClass(name)] * 1000;

  function shouldFetch(s, name, force, t) {
    if (s.inflight || t < s.retry_until) return false;
    if (force && resourceClass(name) === "dynamic") return s.last_attempt_at == null || t - s.last_attempt_at >= policy.min_force_interval_seconds * 1000;
    if (s.has && t - s.last_success_at < ttl(name)) return false;
    return !(s.last_attempt_status === "failed" && t - s.last_attempt_at < policy.failure_backoff_seconds * 1000);
  }
  async function fetchValidated(path, validate) {
    try { const value = await fetchData(path); validate(value); return { ok: true, value }; }
    catch (error) { return { ok: false, error: sanitize(error) }; }
  }
  function commit(s, value, t) {
    Object.assign(s, { has: true, value, digest: contentDigest(value), last_success_at: t, last_attempt_status: "success", error: null });
  }
  function fail(s, error, t) {
    s.last_attempt_status = "failed";
    s.error = { code: error.code, message: error.message, ...(error.status ? { http_status: error.status } : {}), ...(error.reason ? { reason: error.reason } : {}), ...(error.retryAfter != null ? { retry_after_seconds: error.retryAfter } : {}) };
    if (error.retryAfter != null) s.retry_until = t + error.retryAfter * 1000;
  }

  // Shared resources (NFL state, player catalog, trending) have their own single flight across leagues. A shared refresh
  // only updates source evidence; it never changes any league's committed core.
  function refreshGlobal(name, path, validate, force, report) {
    const s = globals.get(name);
    if (s.inflight) return s.inflight;
    const t = now();
    if (!shouldFetch(s, name, force, t)) return Promise.resolve();
    s.last_attempt_at = t; report.attempted.push(name);
    s.inflight = fetchValidated(path, validate).then(r => { if (r.ok) commit(s, r.value, t); else { fail(s, r.error, t); report.failed.push(name); } })
      .finally(() => { s.inflight = null; });
    return s.inflight;
  }

  // League sources are fetched and validated individually; they enter the committed core only through promoteCore.
  async function refreshLeagueSources(entry, force, report) {
    const t = now();
    const specs = [
      ["league", `/league/${entry.id}`, v => validators.league(v, { leagueId: entry.id, previous: entry.core?.league.value ?? null })],
      ["users", `/league/${entry.id}/users`, validators.users],
      ["rosters", `/league/${entry.id}/rosters`, v => validators.rosters(v, { leagueId: entry.id })],
    ];
    await Promise.all(specs.map(async ([name, path, validate]) => {
      const s = entry.slots.get(name) ?? entry.slots.set(name, slot()).get(name);
      if (!shouldFetch(s, name, force, t)) return;
      s.last_attempt_at = t; report.attempted.push(name);
      const r = await fetchValidated(path, validate);
      if (r.ok) commit(s, r.value, t); else { fail(s, r.error, t); report.failed.push(name); }
    }));
  }

  const source = (entry, name) => globals.get(name) ?? entry.slots.get(name);
  const unresolvedSource = s => !s?.has || s.last_attempt_status === "failed";

  // Atomic core promotion: all five sources must hold a valid value with no unresolved failed attempt, else nothing moves.
  function promoteCore(entry) {
    const sources = Object.fromEntries(CORE.map(n => [n, source(entry, n)]));
    if (CORE.some(n => unresolvedSource(sources[n]))) return false;
    entry.core = Object.freeze(Object.fromEntries(CORE.map(n => [n, Object.freeze({ value: sources[n].value, digest: sources[n].digest, fetched_at: sources[n].last_success_at })])));
    return true;
  }

  // The root cause of a first-load failure: a core source that is missing or failed.
  function unavailable(entry) {
    const bad = CORE.map(n => [n, source(entry, n)]).filter(([, s]) => unresolvedSource(s));
    const [name, s] = bad.find(([, s]) => s?.error) ?? bad[0] ?? ["rosters", null];
    return new SleeperResourceError(s?.error?.code || "UPSTREAM_UNAVAILABLE", { status: s?.error?.http_status ?? null, reason: s?.error?.reason ?? null, resource: name });
  }

  async function refreshOptional(entry, names, force, report, rosterIds) {
    const t = now();
    await Promise.all(names.map(async ({ name, path, validate }) => {
      const s = entry.slots.get(name) ?? entry.slots.set(name, slot()).get(name);
      if (!shouldFetch(s, name, force, t)) return;
      s.last_attempt_at = t; report.attempted.push(name);
      const r = await fetchValidated(path, value => validate(value, { rosterIds }));
      if (r.ok) commit(s, r.value, t); else { fail(s, r.error, t); report.failed.push(name); }
    }));
  }

  async function cycle(entry, force) {
    const report = { forced: force, previous_revision: entry.committed?.revision ?? null, attempted: [], failed: [] };
    await Promise.all([
      refreshGlobal("state", "/state/nfl", validators.state, force, report),
      refreshGlobal("players", "/players/nfl", validators.players, false, report),
      refreshGlobal("trending", TRENDING_PATH, validators.trending, false, report),
      refreshLeagueSources(entry, force, report),
    ]);
    promoteCore(entry);
    if (!entry.core) {
      // First load failed: nothing valid to serve, and nothing retained for an arbitrary league id.
      if (leagues.get(entry.id) === entry) leagues.delete(entry.id);
      throw unavailable(entry);
    }
    // Activity paths are chosen from the COMMITTED core (never from an unpromoted NFL-state candidate).
    const league = entry.core.league.value, state = entry.core.state.value;
    const week = Math.max(1, Number(state.leg || state.week || 1)), sameSeason = String(league.season) === String(state.season);
    const rounds = sameSeason ? [...new Set([Math.max(1, week - 1), week])] : [];
    const optional = [
      ...rounds.map(round => ({ name: `transactions/week/${round}`, path: `/league/${entry.id}/transactions/${round}`, validate: validators.transactions })),
      ...(sameSeason ? [{ name: `matchups/week/${week}`, path: `/league/${entry.id}/matchups/${week}`, validate: validators.matchups }] : []),
    ];
    for (const name of [...entry.slots.keys()]) if (!["league", "users", "rosters"].includes(name) && !optional.some(o => o.name === name)) entry.slots.delete(name);
    await refreshOptional(entry, optional, force, report, new Set(entry.core.rosters.value.map(r => r.roster_id)));
    promote(entry, { rounds, week: sameSeason ? week : null });
    return result(entry, report);
  }

  function promote(entry, { rounds, week }) {
    const core = entry.core, slotOf = name => entry.slots.get(name), trending = globals.get("trending");
    const value = s => s?.has ? s.value : null, digest = s => s?.has ? s.digest : null;
    const transactionSlots = rounds.map(round => [round, slotOf(`transactions/week/${round}`)]);
    const matchupSlot = week == null ? null : slotOf(`matchups/week/${week}`);
    const material = [...CORE_ORDER.map(n => [n, core[n].digest]), ["trending", digest(trending)],
      ...transactionSlots.map(([round, s]) => [`transactions/week/${round}`, digest(s)]), ...(week == null ? [] : [[`matchups/week/${week}`, digest(matchupSlot)]])];
    const revision = `sleeper:${contentDigest(material)}`;
    if (entry.committed?.revision === revision) return;
    entry.committed = Object.freeze({ league_id: entry.id, revision, bundle: Object.freeze({
      league: core.league.value, users: core.users.value, rosters: core.rosters.value,
      state: core.state.value, players: core.players.value, trending: value(trending),
      transactions: Object.freeze(transactionSlots.map(([round, s]) => Object.freeze({ round, value: value(s) }))),
      matchup_week: week, matchups: week == null ? null : value(matchupSlot),
      resources: Object.freeze(material.map(([name]) => name)),
    }) });
  }

  function freshness(entry, names) {
    const t = now(), resources = {};
    for (const name of names) {
      const s = source(entry, name);
      if (!s) continue;
      // Core rows describe the COMMITTED value; a newer fetched source that was not promoted is reported as such.
      const committedAt = CORE.includes(name) ? entry.core[name].fetched_at : (s.has ? s.last_success_at : null);
      const pending = CORE.includes(name) && s.last_attempt_status === "success" && s.last_success_at !== committedAt;
      const limit = ttl(name), age = committedAt == null ? null : t - committedAt;
      resources[name] = { class: resourceClass(name), stale_after_seconds: limit / 1000,
        status: committedAt == null ? "missing" : age >= limit ? "stale" : "fresh", age_seconds: age == null ? null : Math.max(0, Math.floor(age / 1000)),
        last_success_at: iso(committedAt), last_attempt_at: iso(s.last_attempt_at),
        last_attempt_status: pending ? "not_promoted" : s.last_attempt_status,
        error: pending ? { code: "NOT_PROMOTED", message: MESSAGES.NOT_PROMOTED } : s.error };
    }
    return { guarantee: policy.guarantee, checked_at: iso(t), resources };
  }

  // Unresolved = committed-bundle resources whose latest attempt failed (or was not promoted), whether or not this call
  // attempted them. Deferred = unresolved ones this call did not re-attempt (cooldown, backoff or Retry-After).
  function result(entry, report) {
    const view = freshness(entry, entry.committed.bundle.resources), t = now();
    const unresolved = Object.entries(view.resources).filter(([, r]) => ["failed", "not_promoted"].includes(r.last_attempt_status)).map(([name]) => name);
    const deferred = unresolved.filter(name => !report.attempted.includes(name));
    const waits = deferred.map(name => { const s = source(entry, name); return Math.max(s.retry_until, (s.last_attempt_at ?? t) + policy.min_force_interval_seconds * 1000) - t; });
    return { ...entry.committed, freshness: view,
      report: { ...report, unresolved, deferred, retry_after_seconds: waits.length ? Math.max(0, Math.ceil(Math.min(...waits) / 1000)) : null } };
  }

  // Admission happens BEFORE any upstream work and before the entry is tracked: never evict a busy or pinned entry, and
  // refuse a new arbitrary league when every tracked arbitrary league is busy.
  function admit(id) {
    if (isPinned(id)) return true;
    for (;;) {
      const unpinned = [...leagues.values()].filter(e => !isPinned(e.id));
      if (unpinned.length < policy.max_leagues) return true;
      const victim = unpinned.find(e => !e.inflight && !e.waiting);
      if (!victim) return false;
      leagues.delete(victim.id);
    }
  }

  async function ensure(leagueId, { force = false } = {}) {
    const id = String(leagueId);
    let entry = leagues.get(id);
    if (entry) { leagues.delete(id); leagues.set(id, entry); }
    else {
      if (!admit(id)) throw new SleeperResourceError("CAPACITY");
      entry = { id, slots: new Map(), core: null, committed: null, inflight: null, force: false, waiting: 0 };
      leagues.set(id, entry);
    }
    for (;;) {
      if (entry.inflight) {
        const joined = entry.inflight;
        if (!force || entry.force) return joined;
        // A forced caller waiting behind a non-forced cycle keeps the entry busy, so it cannot be evicted meanwhile.
        entry.waiting++;
        try { await joined.catch(() => {}); } finally { entry.waiting--; }
        // A first load that failed dropped the entry: start over through admission rather than refresh an untracked entry.
        if (leagues.get(id) !== entry) return ensure(id, { force });
        continue;
      }
      entry.force = force;
      entry.inflight = cycle(entry, force).finally(() => { entry.inflight = null; });
      return entry.inflight;
    }
  }

  return { ensure, stats: () => ({ leagues: leagues.size, league_ids: [...leagues.keys()], unpinned: [...leagues.keys()].filter(id => !isPinned(id)).length }) };
}
