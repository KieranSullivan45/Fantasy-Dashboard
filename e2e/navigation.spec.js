import { test, expect } from "@playwright/test";
import { buildDecisionContext } from "../lib/decision/build-context.js";
import { decisionFixtureOptions } from "../test/decision-fixtures.js";
import { mockDefaultAccounts } from "./accounts-fixture.js";
const A = "1401373864818192384", B = "1395493939665989632";
async function setup(page) {
  await mockDefaultAccounts(page);
  const options = decisionFixtureOptions(), snapshots = {}, decisions = {}, counts = { snapshot:0, decision:0 };
  for (const id of [A,B]) { const s = await options.loadLeague(id); s.league.name = id === A ? "Alpha" : "Beta"; snapshots[id] = s; decisions[id] = await buildDecisionContext(id,{...options,loadLeague:async()=>s}); }
  await page.route("**/api/snapshot?**", route => { counts.snapshot++; return route.fulfill({json:snapshots[new URL(route.request().url()).searchParams.get("league")]}); });
  await page.route("**/api/decision-support?**", route => { counts.decision++; return route.fulfill({json:decisions[new URL(route.request().url()).searchParams.get("league")]}); });
  return { counts, decisions };
}
const nav = (page, name) => page.locator(`nav:visible a[href="/dashboard/${name.toLowerCase()}"]`);
test("mobile routes, active state, history, shared data and preserved filters", async ({page}) => {
  const {counts}=await setup(page), errors=[]; page.on("pageerror",e=>errors.push(e.message));
  await page.setViewportSize({width:390,height:844}); await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard\/home$/);
  await expect(page.getByRole("navigation",{name:"Mobile navigation"})).toBeVisible();
  await expect(nav(page,"Home")).toHaveAttribute("aria-current","page");
  await expect(page.getByRole("region",{name:"Top waiver"})).toContainText("Player 65");
  await expect(page.locator(".waiverRecommendations")).toHaveCount(0);
  await expect(page.locator(".rosterCard")).toHaveCount(0);
  await nav(page,"Waivers").click(); await expect(nav(page,"Waivers")).toHaveClass(/active/);
  await page.getByLabel("Recommendation type").selectOption("injury_stashes");
  await nav(page,"Signals").click(); await expect(page).toHaveURL(/\/signals$/);
  await page.getByLabel("Signal group").selectOption("FALLERS");
  await nav(page,"Lineup").click(); await expect(page.locator(".rosterCard.mine")).toBeVisible();
  await page.goBack(); await expect(page).toHaveURL(/\/signals$/); await expect(page.getByLabel("Signal group")).toHaveValue("FALLERS");
  await page.goForward(); await expect(page).toHaveURL(/\/lineup$/);
  await nav(page,"Waivers").click(); await expect(page.getByLabel("Recommendation type")).toHaveValue("injury_stashes");
  expect(counts).toEqual({snapshot:1,decision:1});
  await nav(page,"Signals").click(); await page.getByLabel("League",{exact:true}).selectOption(B);
  await expect(page.locator(".accountToolbar")).toContainText("Beta"); await expect(page).toHaveURL(/\/signals$/);
  await expect(page.getByLabel("Signal group")).toHaveValue("FALLERS");
  await page.reload(); await expect(page).toHaveURL(/\/signals$/); await expect(page.getByRole("region",{name:"Signal Feed",exact:true})).toBeVisible();
  await expect(page.getByLabel("League",{exact:true})).toHaveValue(B);
  expect(errors).toEqual([]);
});

for (const width of [320,375,390,414]) test(`all views fit ${width}px and bottom navigation clears final content`, async ({page}) => {
  await setup(page); await page.setViewportSize({width,height:844}); await page.goto("/dashboard/home");
  await expect(page.getByRole("region",{name:"Top waiver"})).toContainText("Player 65");
  for (const name of ["Home","Waivers","Lineup","Signals","More","League","Players"]) {
    if (["League","Players"].includes(name)) { await nav(page,"More").click(); await page.locator(`main a[href="/dashboard/${name.toLowerCase()}"]`).click(); }
    else await nav(page,name).click();
    await expect(page.locator("main h1")).toHaveText(name);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name).toBe(true);
    // Next restores route scroll after commit. Check the settled end-of-page
    // geometry, rather than racing that restoration with a one-shot scroll.
    await expect.poll(async () => page.evaluate(async () => {
      window.scrollTo(0,document.documentElement.scrollHeight);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return document.querySelector("main").getBoundingClientRect().bottom - document.querySelector(".mobileNav").getBoundingClientRect().top;
    }), { message: `${name}: final content must clear bottom navigation` }).toBeLessThanOrEqual(0);
    expect(await page.locator(".appWorkspace").evaluate(el=>parseFloat(getComputedStyle(el).paddingBottom))).toBeGreaterThanOrEqual(88);
    await expect(page.getByRole("navigation",{name:"Mobile navigation"})).toBeVisible();
  }
  const css=await page.evaluate(()=>[...document.styleSheets].flatMap(s=>{try{return [...s.cssRules].map(r=>r.cssText)}catch{return[]}}).join("\n"));
  expect(css).toContain("safe-area-inset-bottom");
});

test("desktop destinations, player search, bounded results and bookmarkable details", async ({page}) => {
  await setup(page); await page.setViewportSize({width:1280,height:900}); await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard\/home$/);
  await expect(page.getByRole("navigation",{name:"Desktop navigation"})).toBeVisible();
  await expect(page.getByRole("navigation",{name:"Mobile navigation"})).toBeHidden();
  await nav(page,"Players").click();
  await expect(page.locator(".playerResults article")).toHaveCount(15);
  await page.getByLabel("Search players").fill("Player 65"); await expect(page.locator(".playerResults article")).toHaveCount(1);
  await page.locator(".playerResults a").click(); await expect(page).toHaveURL(/players\?player=65$/);
  await expect(page.locator(".playerDetail h2")).toHaveText("Player 65");
  await page.reload(); await expect(page.locator(".playerDetail h2")).toHaveText("Player 65");
  await nav(page,"League").click(); await page.getByRole("button",{name:"Format",exact:true}).click();
  await expect(page.getByText("League format and scoring",{exact:true})).toBeVisible();
  await nav(page,"More").click(); const endpoint=await page.request.get("/api/chat/model-meta?unexpected=1");
  expect(endpoint.status()).toBe(400); expect(endpoint.headers()["content-type"]).toContain("application/json");
});

test("valid season discovery preserves section; direct routes do not require visiting Home", async ({page}) => {
  await setup(page);
  await page.route("**/api/accounts?**", route=>route.fulfill({json:{season:2027,account:{provider_user_id:"1395496956687581184",username:"Friend"},leagues:[{league_id:B,name:"Next season",season:2027}]}}));
  await page.goto("/dashboard/lineup"); await expect(page.locator(".rosterCard.mine")).toBeVisible();
  await page.getByLabel("NFL season",{exact:true}).fill("2027"); await page.getByRole("button",{name:"Discover season",exact:true}).click();
  await expect(page.getByLabel("League",{exact:true})).toHaveValue(B); await expect(page).toHaveURL(/\/lineup$/);
  await expect(page.getByLabel("NFL season",{exact:true})).toHaveValue("2027");
  await expect(page.locator(".rosterCard.mine")).toBeVisible();
});
