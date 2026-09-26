// V04-04 Trade Analyzer. SYNTHETIC league; /api/trade requests from the page run through the real route handler and
// Trade Engine in the test process (no live provider).
import { test, expect } from "@playwright/test";
import { buildDecisionContext } from "../lib/decision/build-context.js";
import { handleTradeRequest } from "../lib/trade-api.js";
import { mockDefaultAccounts } from "./accounts-fixture.js";
import { TRADE_LEAGUE, ME, tradeFixtureBuild, tradeFixtureOptions } from "../test/trade-api-fixtures.js";

async function setup(page, { build = tradeFixtureBuild(), tradeRoute } = {}) {
  await mockDefaultAccounts(page);
  const options = tradeFixtureOptions(), snapshot = await options.loadLeague(TRADE_LEAGUE, { userId: ME });
  snapshot.league.name = "Synthetic Trade League";
  const decision = await buildDecisionContext(TRADE_LEAGUE, { ...options, loadLeague: async () => snapshot });
  const requests = [];
  await page.route("**/api/snapshot?**", route => route.fulfill({ json: snapshot }));
  await page.route("**/api/decision-support?**", route => route.fulfill({ json: decision }));
  await page.route("**/api/trade", tradeRoute || (async route => {
    const request = route.request(), body = request.postData();
    requests.push(JSON.parse(body));
    const response = await handleTradeRequest(new Request("http://localhost/api/trade", { method: "POST", headers: { "content-type": request.headers()["content-type"] }, body }),
      { leagueIds: [TRADE_LEAGUE], build });
    await route.fulfill({ status: response.status, json: await response.json() });
  }));
  return { requests };
}
const teamA = page => page.getByRole("region", { name: "Team A" });
const teamB = page => page.getByRole("region", { name: "Team B" });
const pick = (region, name) => region.getByRole("checkbox", { name: new RegExp(`^${name}\\b`) });
async function build(page, a, b) {
  await teamB(page).getByLabel("Team B").selectOption({ label: "Rival team" });
  for (const name of a) await pick(teamA(page), name).check();
  for (const name of b) await pick(teamB(page), name).check();
}

test("desktop: open from navigation, choose teams, submit a 1-for-1 and see both rosters", async ({ page }) => {
  const { requests } = await setup(page); const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/dashboard/home");
  await page.locator('nav:visible a[href="/dashboard/trade"]').click();
  await expect(page).toHaveURL(/\/dashboard\/trade$/);
  await expect(page.locator("main h1")).toHaveText("Trade");
  // Team A defaults to the resolved roster; the same team cannot be chosen twice.
  await expect(teamA(page).getByLabel("Team A")).toHaveValue("1");
  const analyze = page.getByRole("button", { name: "Analyze trade" });
  await expect(analyze).toBeDisabled();
  await expect(teamB(page).getByLabel("Team B").locator('option[value="1"]')).toHaveAttribute("disabled", "");
  await build(page, ["Player 12"], ["Player 23"]);
  await expect(teamA(page).getByLabel("Team A").locator('option[value="2"]')).toHaveAttribute("disabled", "");
  await expect(analyze).toBeEnabled();
  await analyze.click();
  const result = page.getByRole("region", { name: "Trade evaluation" });
  await expect(result.getByTestId("trade-status")).toHaveText("Evaluated");
  await expect(result).toContainText("Next game");
  await expect(result).toContainText("Conditional under known roster rules");
  await expect(result).toContainText("Not modeled");
  const mine = result.getByRole("article", { name: "My team result" }), rival = result.getByRole("article", { name: "Rival team result" });
  await expect(mine.getByTestId("starter-change")).toHaveText("+11.0");
  await expect(rival.getByTestId("starter-change")).toHaveText("−3.0");
  await expect(mine).toContainText("Receives");
  await expect(mine).toContainText("Player 23");
  await expect(mine).toContainText("Reserve / taxi placement");
  await expect(mine).toContainText("reserve eligibility unverified");
  // The client sent ids only; no verdict vocabulary is rendered.
  expect(requests).toHaveLength(1);
  expect(Object.keys(requests[0]).sort()).toEqual(["basis", "league", "proposal", "user"]);
  expect(requests[0].proposal).toEqual({ horizon: "next_game", sides: [{ roster_id: 1, sends: [{ type: "player", id: "12" }] }, { roster_id: 2, sends: [{ type: "player", id: "23" }] }] });
  await expect(result).not.toContainText(/(winner|loser|fairness score|trade score|accept this|reject this|acceptance probability)/i);
  // Changing the proposal hides the stale result.
  await pick(teamA(page), "Player 11").check();
  await expect(result).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("uneven package enforces two per side and shows the selected forced drop", async ({ page }) => {
  await setup(page); await page.goto("/dashboard/trade");
  await build(page, ["Player 11", "Player 12"], ["Player 23"]);
  await expect(teamA(page)).toContainText("Maximum of two players from this team.");
  await expect(pick(teamA(page), "Player 10")).toBeDisabled();
  await expect(pick(teamA(page), "Player 12")).toBeEnabled();
  await teamA(page).getByRole("button", { name: "Remove Player 12" }).click();
  await expect(pick(teamA(page), "Player 10")).toBeEnabled();
  await pick(teamA(page), "Player 12").check();
  await page.getByRole("button", { name: "Analyze trade" }).click();
  const rival = page.getByRole("article", { name: "Rival team result" });
  await expect(rival).toContainText("Forced drops required · 1 required");
  await expect(rival).toContainText("Would drop: Player 11");
  await rival.getByText(/Not eligible to be dropped/).click();
  await expect(rival.locator("li", { hasText: "Kicker 66:" })).toContainText("K/DST/IDP advanced value unsupported");
});

test("unknown and unavailable values never render as zero; withheld lineups show the engine reason", async ({ page }) => {
  const withheld = async (league, options) => { const state = await tradeFixtureBuild()(league, options);
    for (const id of ["6", "11", "12", "21", "22", "23"]) state.contexts[id].model.start_value.central = null; return state; };
  await setup(page, { build: withheld }); await page.goto("/dashboard/trade");
  await build(page, ["Player 11", "Player 12"], ["Player 23"]);
  await page.getByRole("button", { name: "Analyze trade" }).click();
  await expect(page.getByTestId("trade-status")).toHaveText("Withheld");
  const rival = page.getByRole("article", { name: "Rival team result" });
  await expect(rival.getByTestId("starter-change")).toHaveText("Unknown");
  await expect(rival.getByTestId("depth-change")).toHaveText("Unknown");
  await expect(rival).toContainText("Lineup valuation withheld: Lineup-relevant player with unknown next_game value");
  await expect(rival).toContainText("Starter total: Unavailable");
  await expect(rival).toContainText("Forced drops undetermined");
  await expect(rival.getByTestId("starter-change")).not.toHaveText(/^[+−]?0/);
});

test("K slots show unavailable value; unsupported assets are disabled; route errors are visible", async ({ page }) => {
  let fail = false;
  await setup(page, { tradeRoute: async route => {
    if (fail) return route.fulfill({ status: 502, json: { error: "Trade evaluation could not load league data. The league snapshot remains available." } });
    const request = route.request(), body = request.postData();
    const response = await handleTradeRequest(new Request("http://localhost/api/trade", { method: "POST", headers: { "content-type": "application/json" }, body }), { leagueIds: [TRADE_LEAGUE], build: tradeFixtureBuild() });
    return route.fulfill({ status: response.status, json: await response.json() });
  } });
  await page.goto("/dashboard/trade");
  await teamB(page).getByLabel("Team B").selectOption({ label: "Rival team" });
  await expect(pick(teamB(page), "Kicker 66")).toBeDisabled();
  await expect(teamB(page)).toContainText("No modeled football value (K/DEF/IDP)");
  await pick(teamA(page), "Player 12").check(); await pick(teamB(page), "Player 23").check();
  await page.getByRole("button", { name: "Analyze trade" }).click();
  const rival = page.getByRole("article", { name: "Rival team result" });
  const kRow = rival.locator(".tradeLineupList li", { hasText: "Kicker 66" }).first();
  await expect(kRow).toContainText("Value unavailable");
  await expect(rival).toContainText("K slots count for legality only; their value is unavailable.");
  await expect(rival).toContainText("excluded from football-value totals");
  fail = true;
  await pick(teamA(page), "Player 11").check();
  await page.getByRole("button", { name: "Analyze trade" }).click();
  await expect(page.locator('main [role="alert"]')).toContainText("Trade evaluation could not load league data.");
  await expect(page.getByRole("region", { name: "Trade evaluation" })).toHaveCount(0);
});

test("engine unsupported response renders without roster valuation", async ({ page }) => {
  await setup(page, { tradeRoute: route => route.fulfill({ status: 422, json: { schema_version: "trade-1", model_version: null, feature_version: null, basis: null,
    horizon: { id: "next_game", supported: true, limitations: [] }, status: "unsupported", legality: "conditional_known_rules", legality_limitations: [], market_value: null, sides: [],
    errors: [{ code: "UNSUPPORTED_ASSET", status: "unsupported", roster_id: "2", asset_id: "23", field: "sends", message: "Football value for this player is not supported by the current model (K/DEF/IDP or unmodeled); it is never valued as zero." }] } }) });
  await page.goto("/dashboard/trade");
  await build(page, ["Player 12"], ["Player 23"]);
  await page.getByRole("button", { name: "Analyze trade" }).click();
  const result = page.getByRole("region", { name: "Trade evaluation" });
  await expect(result.getByTestId("trade-status")).toHaveText("Unsupported");
  await expect(result).toContainText("Rival team: Player 23 — Football value for this player is not supported");
  await expect(result).toContainText("No roster valuation was performed.");
});

for (const width of [320, 390]) test(`mobile ${width}px: reachable from More, stacked, tappable, no horizontal scroll`, async ({ page }) => {
  await setup(page); await page.setViewportSize({ width, height: 844 });
  await page.goto("/dashboard/home");
  await page.locator('nav:visible a[href="/dashboard/more"]').click();
  await page.locator('main a[href="/dashboard/trade"]').click();
  await expect(page.locator("main h1")).toHaveText("Trade");
  await expect(page.locator('nav:visible a[href="/dashboard/more"]')).toHaveClass(/active/);
  await build(page, ["Player 11", "Player 12"], ["Player 23"]);
  const a = await teamA(page).boundingBox(), b = await teamB(page).boundingBox();
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 1);
  const row = await teamA(page).locator(".tradePlayer").first().boundingBox();
  expect(row.height).toBeGreaterThanOrEqual(44);
  await page.getByRole("button", { name: "Analyze trade" }).click();
  await expect(page.getByTestId("trade-status").first()).toHaveText("Evaluated");
  const mine = await page.getByRole("article", { name: "My team result" }).boundingBox(), rival = await page.getByRole("article", { name: "Rival team result" }).boundingBox();
  expect(rival.y).toBeGreaterThanOrEqual(mine.y + mine.height - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect.poll(async () => page.evaluate(async () => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return document.querySelector("main").getBoundingClientRect().bottom - document.querySelector(".mobileNav").getBoundingClientRect().top;
  })).toBeLessThanOrEqual(0);
});
