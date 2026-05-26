import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 240_000,
  use: { baseURL: "http://127.0.0.1:5176" },
  webServer: {
    command: "bun run dev:all",
    url: "http://127.0.0.1:5176",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
