export async function mockDefaultAccounts(page) {
  await page.route("**/api/accounts", route => route.fulfill({ json: { schema_version: "accounts-1", season: 2026, defaults: { user: "1395496956687581184", leagues: ["1401373864818192384", "1395493939665989632"] } } }));
}
