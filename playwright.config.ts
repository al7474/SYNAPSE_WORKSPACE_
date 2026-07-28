import { defineConfig, devices } from "@playwright/test";

const backendEnvironment = {
  DATABASE_URL:
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@127.0.0.1:5434/synapse",
  NODE_ENV: "test",
  PORT: "4000",
  FRONTEND_ORIGIN: "http://127.0.0.1:3000",
  AUTH_PUBLIC_URL: "http://127.0.0.1:4000",
  AUTH_FRONTEND_URL: "http://127.0.0.1:3000",
  AUTH_EMAIL_PROVIDER: "console",
  AUTH_RATE_LIMIT_ENABLED: "false",
  AUTH_RATE_LIMIT_STORE: "memory",
  AUTH_CSRF_ENABLED: "true",
  TRUST_PROXY: "false",
  OPENROUTER_API_KEY: "e2e-local-key",
  OPENROUTER_API_URL: "http://127.0.0.1:4010/v1/embeddings",
  PENDING_REINDEX_INTERVAL_MS: "0",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "node scripts/e2e/mock-openrouter.mjs",
      url: "http://127.0.0.1:4010/healthz",
      timeout: 120_000,
      reuseExistingServer: false,
      env: { OPENROUTER_MOCK_PORT: "4010" },
    },
    {
      command: "pnpm --filter @synapse/backend dev",
      url: "http://127.0.0.1:4000/healthz",
      timeout: 120_000,
      reuseExistingServer: false,
      env: backendEnvironment,
    },
    {
      command: "pnpm --filter @synapse/frontend dev",
      url: "http://127.0.0.1:3000",
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NEXT_PUBLIC_GRAPHQL_ENDPOINT: "http://127.0.0.1:4000/graphql",
        SYNAPSE_DEPLOYMENT_ENV: "development",
      },
    },
  ],
});