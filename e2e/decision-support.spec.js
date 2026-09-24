import { test, expect } from "@playwright/test";
import { buildDecisionContext } from "../lib/decision/build-context.js";
import { decisionFixtureOptions } from "../test/decision-fixtures.js";
import { mockDefaultAccounts } from "./accounts-fixture.js";
test.beforeEach(async ({ page }) => { await mockDefaultAccounts(page); });
const A = "1401373864818192384", B = "1395493939665989632";
async function fixture(id) {
  const options = decisionFixtureOptions();
  const snapshot = await options.loadLeague(id);
  snapshot.league.name = id === A ? "Alpha" : "Beta";
  snapshot.current_matchups.push({ roster_id: 2, matchup_id: 1, starters: ["6", "0"], starters_points: [0, 0], points: 0, custom_points: null });
  const decision = await buildDecisionContext(id, { ...options, loadLeague: async () => snapshot });
  return { snapshot, decision };
}

test("weekly actuals, player history, source limits and explainable waivers render", async ({ page }) => {
  const data = await fixture(A);
  await page.route("**/api/snapshot?**", route => route.fulfill({ json: data.snapshot }));
  await page.route("**/api/decision-support?**", route => route.fulfill({ json: data.decision }));
  await page.goto("/");
  const matchup = page.getByRole("region", { name: "Weekly matchup", exact: true });
  await expect(matchup.getByText("CURRENT OPPONENT")).toBeVisible();
  await expect(matchup).toContainText("actual points");
  await expect(matchup).toContainText("projections unavailable");
  const recommendations = page.getByRole("region", { name: "Waiver recommendations", exact: true });
  await expect(recommendations).toContainText("60 eligible players evaluated before truncation");
  await page.getByLabel("Recommendation type", { exact: true }).selectOption("best_overall");
  await expect(recommendations).toContainText("Player 65");
  await recommendations.getByText("Score components", { exact: true }).first().click();
  await expect(recommendations).toContainText("football acquisition:");
  await recommendations.getByText("Player context", { exact: true }).first().click();
  await expect(recommendations).toContainText("Rostered: unavailable");
  await expect(recommendations).toContainText("W2 vs NE");
  await expect(recommendations).toContainText("most RB points allowed");
  await page.getByText("Data sources, coverage and limitations").click();
  await expect(page.locator(".sourceStatus")).toContainText("ownership: unsupported");
});

test("late decision responses cannot overwrite a newly selected league", async ({ page }) => {
  const a = await fixture(A), b = await fixture(B), pending = [];
  await page.route("**/api/snapshot?**", route => route.fulfill({ json: new URL(route.request().url()).searchParams.get("league") === A ? a.snapshot : b.snapshot }));
  await page.route("**/api/decision-support?**", route => { pending.push(route); });
  await page.goto("/");
  await expect.poll(() => pending.length).toBe(1);
  await page.getByLabel("League", { exact: true }).selectOption(B);
  await expect.poll(() => pending.length).toBe(2);
  await pending[1].fulfill({ json: b.decision });
  await expect(page.locator(".waiverRecommendations")).toBeVisible();
  await pending[0].fulfill({ status: 502, json: { error: "Old decision failure" } });
  await expect(page.locator(".summaryGrid")).toContainText("Beta");
  await expect(page.getByText("Old decision failure")).toHaveCount(0);
});

test("mobile layout retains actual matchup when optional decision data fails", async ({ page }) => {
  const data = await fixture(A);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/snapshot?**", route => route.fulfill({ json: data.snapshot }));
  await page.route("**/api/decision-support?**", route => route.fulfill({ status: 502, json: { error: "Weekly metrics unavailable" } }));
  await page.goto("/");
  await expect(page.getByText("Weekly metrics unavailable")).toBeVisible();
  await expect(page.getByText("CURRENT OPPONENT")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("dual-position recommendations and injury stashes remain separate on mobile", async ({ page }) => {
  const options = decisionFixtureOptions(), snapshot = await options.loadLeague(A);
  const dual = snapshot.free_agents.RB.find(p => p.player_id === "65");
  dual.fantasy_positions = ["RB", "WR"];
  snapshot.free_agents.WR.push(dual);
  snapshot.free_agents.RB.find(p => p.player_id === "64").injury_status = "IR";
  const decision = await buildDecisionContext(A, { ...options, loadLeague: async () => snapshot });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/snapshot?**", route => route.fulfill({ json: snapshot }));
  await page.route("**/api/decision-support?**", route => route.fulfill({ json: decision }));
  await page.goto("/");
  const recommendations = page.locator(".waiverRecommendations");
  await expect(recommendations).toContainText("60 eligible players");
  await page.getByLabel("Recommendation position", { exact: true }).selectOption("WR");
  await page.getByLabel("Recommendation type", { exact: true }).selectOption("best_overall");
  await expect(recommendations).toContainText("Player 65");
  await expect(recommendations).toContainText("RB/WR");
  await expect(recommendations).toContainText("Pickup Rating");
  await page.getByLabel("Recommendation position", { exact: true }).selectOption("ALL");
  await page.getByLabel("Recommendation type", { exact: true }).selectOption("injury_stashes");
  await expect(recommendations).toContainText("Player 64");
  await expect(recommendations).toContainText("Injured assets");
  await expect(recommendations).not.toContainText("Player 65");
  await recommendations.getByText("Player context", { exact: true }).first().click();
  await recommendations.getByText("Usage history and advanced analytics", { exact: true }).first().click();
  await expect(recommendations).toContainText("No qualifying role signals");
  await expect(recommendations).toContainText("Weekly role and opportunity");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("rostered and available player summaries are visible without expanding context", async ({ page }) => {
  const data = await fixture(A);
  await page.route("**/api/snapshot?**", route => route.fulfill({ json: data.snapshot }));
  await page.route("**/api/decision-support?**", route => route.fulfill({ json: data.decision }));
  await page.goto("/");
  await expect(page.locator(".playerQuickContext").first()).toBeVisible();
  await expect(page.locator(".playerQuickContext").first()).toContainText("Season PPG");
  await expect(page.locator(".playerQuickContext").first()).toContainText("Recent");
  await expect(page.locator(".playerQuickContext").first()).toContainText("small sample");
  await expect(page.locator(".playerContext[open]")).toHaveCount(0);
});

test("calibrated model distinguishes add/drop evidence, start value and acquisition on mobile", async ({ page }) => {
  const data = await fixture(A);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/snapshot?**", route => route.fulfill({ json: data.snapshot }));
  await page.route("**/api/decision-support?**", route => route.fulfill({ json: data.decision }));
  await page.goto("/");
  const region = page.locator(".waiverRecommendations");
  await expect(region).toContainText("No ALL candidates with qualifying evidence");
  await page.getByLabel("Recommendation type", { exact: true }).selectOption("best_overall");
  await expect(region).toContainText("ADD Player 65");
  await region.getByText("Lineup replacement evidence", { exact: true }).first().click();
  await expect(region).toContainText("net_roster_improvement");
  await region.getByText("Player context", { exact: true }).first().click();
  await region.getByText("Decision model · decision-0.3.2", { exact: true }).first().click();
  await expect(region).toContainText("Start Value:");
  await expect(region).toContainText("Football acquisition estimate:");
  await expect(region).toContainText("prior contribution");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
