import { defineConfig } from "@playwright/test";

const baseURL = process.env.BASE_URL || "http://127.0.0.1:4173";
const external = Boolean(process.env.BASE_URL);

export default defineConfig({
  testDir: "test",
  testMatch: "*.spec.js",
  timeout: 90000,
  expect: { timeout: 20000 },
  use: {
    baseURL,
    viewport: { width: 1280, height: 720 },
  },
  ...(external
    ? {}
    : {
        webServer: {
          command: "node tools/serve.js",
          url: "http://127.0.0.1:4173",
          reuseExistingServer: !process.env.CI,
          timeout: 20000,
        },
      }),
});
