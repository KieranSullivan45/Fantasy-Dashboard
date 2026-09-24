async function controls(page) { if (!await page.getByLabel("League", {exact:true}).isVisible()) await page.getByText("Switch league or season", {exact:true}).click(); }
import { test, expect } from "@playwright/test";
import { buildLeagueSnapshot } from "../lib/sleeper.js";
import { fixtureFetch } from "../test/fixtures.js";
import { buildDecisionContext } from "../lib/decision/build-context.js";
import { decisionFixtureOptions } from "../test/decision-fixtures.js";
import { playerSignals } from "../lib/signals/engine.js";
const alice = "111111", bob = "222222", leagues = ["333333", "444444", "555555"];
test("clean friend onboarding, multiple accounts, leagues, future seasons and direct spectator selection", async ({ page }) => {
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  const observed = [];
  await page.route("**/api/accounts**", route => {
    const p = new URL(route.request().url()).searchParams;
    if (!p.size) return route.fulfill({ json: { season: 2026, defaults: { user: null, leagues: [] } } });
    const user = p.get("user") || (p.get("username") === "Alice" ? alice : bob), season = Number(p.get("season") || 2026);
    return route.fulfill({ json: { season, account: p.has("league") ? null : { provider_user_id: user, username: user === alice ? "Alice" : "Bob" },
      leagues: (p.has("league") ? [p.get("league")] : season === 2027 ? [] : leagues).map((id, i) => ({ league_id: id, season, name: `Friend league ${i + 1}` })) } });
  });
  const make = async p => {
    const f = fixtureFetch();
    return buildLeagueSnapshot(p.get("league"), { userId: p.get("user") === "spectator" ? null : p.get("user"), rosterId: Number(p.get("roster")) || null,
      fetchData: async path => { const value = await f(path); if (path.startsWith("/user/")) return { user_id: path.split("/").at(-1) };
        if (path.endsWith("/rosters")) return value.map((r, i) => ({ ...r, owner_id: i ? bob : alice })); return value; } });
  };
  await page.route("**/api/snapshot?**", async route => { const p = new URL(route.request().url()).searchParams; observed.push(Object.fromEntries(p)); await route.fulfill({ json: await make(p) }); });
  await page.route("**/api/decision-support?**", async route => { const s = await make(new URL(route.request().url()).searchParams); await route.fulfill({ json: await buildDecisionContext(s.league.league_id, { ...decisionFixtureOptions(), loadLeague: async () => s }) }); });
  await page.goto("/dashboard/lineup");
  const icon = page.locator('link[rel="icon"]').first();
  await expect(icon).toHaveAttribute("href", /icon\.svg/);
  expect((await page.request.get(await icon.getAttribute("href"))).status()).toBe(200);
  await controls(page); await page.getByText("Accounts, leagues and season", { exact: true }).click();
  await page.getByLabel("Sleeper username", { exact: true }).fill("Alice"); await page.getByRole("button", { name: "Add account" }).click();
  await expect(page.locator(".rosterCard.mine")).toHaveCount(1);
  await controls(page); await page.getByLabel("League", { exact: true }).selectOption(leagues[1]);
  await expect.poll(() => observed.at(-1)?.league).toBe(leagues[1]);
  await page.getByLabel("Sleeper username", { exact: true }).fill("Bob"); await page.getByRole("button", { name: "Add account" }).click();
  await expect.poll(() => observed.at(-1)?.user).toBe(bob);
  await page.getByLabel("Sleeper account", { exact: true }).selectOption(alice);
  await expect.poll(() => observed.at(-1)?.league).toBe(leagues[1]);
  await expect.poll(() => observed.at(-1)?.user).toBe(alice);
  await controls(page); await page.getByLabel("NFL season", { exact: true }).fill("2027"); await page.getByRole("button", { name: "Discover season" }).click();
  await expect(page.locator(".summaryGrid")).toHaveCount(0);
  await expect(page.getByLabel("League", { exact: true })).toBeDisabled();
  await page.getByLabel("Direct league ID", { exact: true }).fill(leagues[2]); await page.getByRole("button", { name: "Open league" }).click();
  await expect(page.getByLabel("Analyze roster", { exact: true })).toBeVisible();
  await expect(page.locator(".rosterCard.mine")).toHaveCount(0);
  await page.getByLabel("Analyze roster", { exact: true }).selectOption("2");
  await expect(page.locator(".rosterCard.mine")).toHaveCount(1);
  await expect.poll(() => observed.at(-1)?.roster).toBe("2");
  await page.reload(); await expect(page.locator(".rosterCard.mine")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("Signal Feed renders engine evidence, confidence and filters on mobile", async ({ page }) => {
  const options = decisionFixtureOptions(), snapshot = await options.loadLeague(leagues[0]), d = await buildDecisionContext(leagues[0], options);
  const context = d.player_context["65"];
  context.analytics = { ...context.analytics, history: [0, 1, 2].map((i) => ({ season: 2026, week: i + 1, game_id: `g${i}`, team: "BUF", snap_share: [.45, .61, .79][i], target_share: [.12, .18, .25][i] })) };
  d.signals = { records: playerSignals(context, { leagueId: leagues[0], season: 2026, week: 4, throughWeek: 3, generatedAt: "2026-09-30", modelVersion: d.model_version }), omitted: 0 };
  d.signals.total = d.signals.records.length;
  await page.route("**/api/accounts", route => route.fulfill({ json: { season: 2026, defaults: { user: alice, leagues: [leagues[0]] } } }));
  await page.route("**/api/snapshot?**", route => route.fulfill({ json: snapshot }));
  await page.route("**/api/decision-support?**", route => route.fulfill({ json: d }));
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/dashboard/signals");
  const feed = page.getByRole("region", { name: "Signal Feed", exact: true });
  await expect(feed).toContainText(/ROLE EXPANSION|SHARE SPIKE/); await expect(feed).toContainText("moderate confidence");
  await expect(feed).toContainText("Small sample");
  await feed.getByRole("button",{name:/View .* signals?/}).first().click();
  await feed.getByText("Signal evidence", { exact: true }).first().click(); await expect(feed.locator("pre").first()).toContainText("0.79");
  await page.getByLabel("Signal group").selectOption("SCHEDULE"); await expect(feed).toContainText("No qualifying changes");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
