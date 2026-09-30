// SLEEPER-REFRESH-01: dashboard self-service refresh over SYNTHETIC fixtures (no live provider).
import { test, expect } from "@playwright/test";
import { buildLeagueSnapshot } from "../lib/sleeper.js";
import { createSleeperInputs } from "../lib/sources/sleeper/inputs.js";
import { buildDecisionContext } from "../lib/decision/build-context.js";
import { fixtureFetch } from "../test/fixtures.js";
import { mockDefaultAccounts } from "./accounts-fixture.js";
import { TRADE_LEAGUE, TRADE_ROSTERS, ME, tradeFixtureFetch, tradeFixtureOptions } from "../test/trade-api-fixtures.js";

const A = "1401373864818192384";
/** A snapshot as the server builds it: through the coordinator, so it carries the input revision and freshness. */
async function coordinated(id, { at = Date.now(), fetchData = fixtureFetch(), name } = {}) {
  const inputs = await createSleeperInputs({ fetchData, now: () => at }).ensure(id);
  const snapshot = await buildLeagueSnapshot(id, { inputs, userId: null });
  if (name) snapshot.league.name = name;
  return snapshot;
}
const refreshBody = snapshot => ({ schema_version: "refresh-1", provider: "sleeper", league_id: snapshot.league.league_id, mode: "manual", status: "ok", served: "refreshed",
  guarantee: "process-local", input_revision: snapshot.coverage.input_revision, previous_input_revision: null, revision_changed: false, attempted: ["rosters"], failed: [], snapshot });

test("refresh keeps league data visible, shows progress, keeps last-known-good on failure and updates on retry", async ({ page }) => {
  await mockDefaultAccounts(page);
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  const initial = await coordinated(A, { at: Date.now() - 10 * 60 * 1000, name: "League Alpha" });
  const updated = await coordinated(A, { name: "League Alpha refreshed" });
  const refreshes = [];
  await page.route("**/api/snapshot?**", route => route.fulfill({ json: initial }));
  await page.route("**/api/decision-support?**", route => route.fulfill({ status: 503, json: { error: "Decision provider unavailable in this test" } }));
  await page.route("**/api/refresh", route => { refreshes.push(route); });
  await page.goto("/dashboard/home");
  await expect(page.locator(".summaryGrid")).toBeVisible();
  const freshness = page.getByLabel("Data freshness");
  await expect(freshness).toContainText("League synced");
  await expect(freshness).toContainText("Older than its refresh window: rosters, state");
  expect(refreshes).toHaveLength(0); // loading a league never triggers a refresh (GET only reads)

  const button = page.locator(".shellHeader button");
  await button.click();
  await expect.poll(() => refreshes.length).toBe(1);
  expect(JSON.parse(refreshes[0].request().postData())).toEqual({ league: A, user: "1395496956687581184", season: "2026", mode: "manual" });
  await expect(page.getByRole("status").filter({ hasText: "Refreshing Sleeper data" })).toBeVisible();
  await expect(button).toBeDisabled(); await expect(button).toHaveAttribute("aria-busy", "true"); await expect(button).toHaveText("Refreshing…");
  await expect(page.locator(".summaryGrid")).toBeVisible();

  await refreshes[0].fulfill({ status: 502, json: { error: "Sleeper rosters data is unavailable. Sleeper returned an error status.", code: "HTTP_ERROR" } });
  const alert = page.getByRole("alert").filter({ hasText: "Refresh failed" });
  await expect(alert).toContainText("Showing the last good league data");
  await expect(page.locator(".summaryGrid")).toBeVisible();
  await expect(button).toBeEnabled();

  await alert.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => refreshes.length).toBe(2);
  await refreshes[1].fulfill({ json: refreshBody(updated) });
  await expect(alert).toHaveCount(0);
  await expect(freshness).not.toContainText("Older than its refresh window");
  await expect(freshness).toContainText("just now");
  await expect(page.locator(".summaryGrid")).toContainText("League Alpha refreshed");
  expect(errors).toEqual([]);
});

test("a refresh that moves a traded player drops the stale pick and a late evaluation of the old basis", async ({ page }) => {
  await mockDefaultAccounts(page);
  const options = tradeFixtureOptions();
  const r1 = await options.loadLeague(TRADE_LEAGUE, { userId: ME });
  const rosters = structuredClone(TRADE_ROSTERS);
  rosters[1].players = rosters[1].players.filter(p => p !== "23"); rosters[1].starters = rosters[1].starters.map(p => p === "23" ? "0" : p); rosters[0].players.push("23");
  const r2 = await buildLeagueSnapshot(TRADE_LEAGUE, { fetchData: tradeFixtureFetch({ rosters }), freeAgentLimit: 100, userId: ME });
  for (const s of [r1, r2]) s.league.name = "Synthetic Trade League";
  expect(r2.coverage.input_revision).not.toBe(r1.coverage.input_revision);
  const decisions = {};
  for (const s of [r1, r2]) decisions[s.coverage.input_revision] = await buildDecisionContext(TRADE_LEAGUE, { ...options, loadLeague: async () => s });
  const trades = [];
  await page.route("**/api/snapshot?**", route => route.fulfill({ json: r1 }));
  await page.route("**/api/decision-support?**", route => route.fulfill({ json: decisions[new URL(route.request().url()).searchParams.get("rev")] }));
  await page.route("**/api/trade", route => { trades.push(route); });
  await page.route("**/api/refresh", route => route.fulfill({ json: { ...refreshBody(r2), revision_changed: true } }));
  await page.goto("/dashboard/trade");
  await page.getByRole("region", { name: "Team B" }).getByLabel("Team B").selectOption({ label: "Rival team" });
  await page.getByRole("region", { name: "Team A" }).getByRole("checkbox", { name: /^Player 12\b/ }).check();
  await page.getByRole("region", { name: "Team B" }).getByRole("checkbox", { name: /^Player 23\b/ }).check();
  await page.getByRole("button", { name: "Analyze trade" }).click();
  await expect.poll(() => trades.length).toBe(1);
  await page.locator(".shellHeader button").click();
  // Player 23 now belongs to Team A: the Team B pick is ejected and analysis needs a new selection.
  await expect(page.getByRole("region", { name: "Team B" })).toContainText("Sends 0 of 2 max");
  await expect(page.getByRole("button", { name: "Analyze trade" })).toBeDisabled();
  const body = JSON.parse(trades[0].request().postData());
  await trades[0].fulfill({ json: { schema_version: "trade-1", status: "evaluated", basis: body.basis, sides: [], errors: [], warnings: [] } }).catch(() => {});
  await expect(page.getByRole("region", { name: "Trade evaluation" })).toHaveCount(0);
  expect(trades).toHaveLength(1); // the refresh itself never runs a trade
});
