import { test, expect } from "@playwright/test";
import { buildLeagueSnapshot } from "../lib/sleeper.js";
import { fixtureFetch } from "../test/fixtures.js";
import { mockDefaultAccounts } from "./accounts-fixture.js";

const A = "1401373864818192384", B = "1395493939665989632";
test.beforeEach(async ({ page }) => {
  await mockDefaultAccounts(page);
  await page.route("**/api/decision-support?**", route => route.fulfill({ status: 503, json: { error: "Decision provider unavailable in baseline test" } }));
});
async function snapshot(id) {
  const result = await buildLeagueSnapshot(id, { fetchData: fixtureFetch() });
  result.league.name = `League ${id === A ? "Alpha" : "Beta"}`;
  return result;
}

test("full roster sections, empty slots, picks and FAAB render for both teams", async ({ page }) => {
  await page.route("**/api/snapshot?**", async route => {
    expect(new URL(route.request().url()).searchParams.get("compact")).toBe("0");
    await route.fulfill({ json: await snapshot(A) });
  });
  await page.goto("/dashboard/lineup");
  const mine = page.locator(".rosterCard.mine");
  await expect(mine.getByText("Empty slot")).toBeVisible();
  for (const [section, player] of [["Bench (1)", "Player 1"], ["IR (1)", "Player 3"], ["Taxi (1)", "Player 4"]]) {
    await mine.getByText(section, { exact: true }).click();
    await expect(mine.getByText(player, { exact: true })).toBeVisible();
  }
  await page.locator('nav:visible a[href="/dashboard/league"]').click();
  await page.getByRole("button", { name: "Teams", exact: true }).click();
  await page.getByLabel("League team").selectOption("2");
  await expect(page.locator(".rosterCard:not(.mine)").getByText("Taxi (0)")).toBeVisible();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.locator(".activity")).toContainText("2027 round 1 pick");
  await expect(page.locator(".activity")).toContainText("FAAB 15");
  await expect(page.locator(".activity")).toContainText("FAAB 0");
  await page.locator('nav:visible a[href="/dashboard/more"]').click();
  await expect(page.getByRole("link", { name: /Open ChatGPT snapshot/ })).toHaveAttribute("href", `/api/snapshot?league=${A}&user=1395496956687581184&compact=1`);
});

test("rapid league switching hides old data and ignores superseded responses", async ({ page }) => {
  const pending = [];
  await page.route("**/api/snapshot?**", route => { pending.push(route); });
  await page.goto("/");
  await expect.poll(() => pending.length).toBe(1);
  await pending[0].fulfill({ json: await snapshot(A) });
  await expect(page.locator(".summaryGrid")).toContainText("League Alpha");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => pending.length).toBe(2);
  await page.getByLabel("League", { exact: true }).selectOption(B);
  await expect.poll(() => pending.length).toBe(3);
  await expect(page.locator(".summaryGrid")).toHaveCount(0);
  await pending[2].fulfill({ json: await snapshot(B) });
  await expect(page.locator(".summaryGrid")).toContainText("League Beta");
  await pending[1].fulfill({ status: 502, json: { error: "Late failure" } });
  await expect(page.locator(".summaryGrid")).toContainText("League Beta");
  await expect(page.getByText("Late failure")).toHaveCount(0);
  await page.getByLabel("League", { exact: true }).selectOption(A);
  await expect.poll(() => pending.length).toBe(4);
  await pending[3].fulfill({ json: await snapshot(A) });
  await expect(page.locator(".summaryGrid")).toContainText("League Alpha");
});

test("partial data warnings and pending transaction status are visible", async ({ page }) => {
  const data = await snapshot(A);
  data.partial = true;
  data.warnings = [{ message: "Matchups unavailable" }];
  data.recent_transactions[0].status = "pending";
  await page.route("**/api/snapshot?**", route => route.fulfill({ json: data }));
  await page.goto("/dashboard/league");
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.locator('details[role="status"]')).toContainText("Matchups unavailable");
  await expect(page.locator(".activity")).toContainText("trade · pending");
});
