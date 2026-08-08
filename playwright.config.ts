import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env.E2E_WEB_PORT ?? "5175");
const apiPort = Number(process.env.E2E_API_PORT ?? "8798");
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${webPort}`;
const apiBaseURL =
  process.env.E2E_API_BASE_URL ?? `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  // Both spec files share one local API and its cache directory, so they run
  // one at a time rather than racing across workers.
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 7_000
  },
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: process.env.E2E_SKIP_WEBSERVER
    ? undefined
    : [
        {
          // Run the built gateway rather than the file watcher: a source edit
          // mid-run would otherwise restart the API underneath the tests.
          command: `HOST=127.0.0.1 PORT=${apiPort} COSMOAUDITION_CORS_ORIGIN=${baseURL},http://localhost:${webPort} pnpm --filter @cosmoaudition/api start`,
          url: `${apiBaseURL}/health`,
          reuseExistingServer: false,
          timeout: 20_000
        },
        {
          command: `VITE_API_BASE_URL=${apiBaseURL} pnpm --filter @cosmoaudition/web exec vite --host 127.0.0.1 --port ${webPort} --strictPort`,
          url: baseURL,
          reuseExistingServer: false,
          timeout: 20_000
        }
      ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
