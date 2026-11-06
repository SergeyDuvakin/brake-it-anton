import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test",
  testMatch: "*.spec.js",
  timeout: 90000,
  expect: { timeout: 20000 },
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: "node tools/serve.js",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 20000,
  },
});
