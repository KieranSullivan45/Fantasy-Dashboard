import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3100", channel: process.env.PLAYWRIGHT_CHANNEL || undefined },
  webServer: {
    command: "node node_modules/next/dist/bin/next start -p 3100",
    url: "http://127.0.0.1:3100", reuseExistingServer: false,
  },
});
