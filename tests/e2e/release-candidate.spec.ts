import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("opens the Cosmoaudition observation instrument", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Cosmoaudition System");
  await expect(
    page.getByRole("heading", { name: "Cosmoaudition System", level: 1 })
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Instrument workspaces" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Take observation/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Listen/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Panic" })).toBeVisible();
  await expect(page.getByTestId("orbital-field")).toContainText("No observation loaded");
  await expect(page.getByRole("status")).toContainText("Ready for an explicit fixture observation");
});

test("loads a reproducible fixture across source strata", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Situated point").selectOption("quito");
  await page.getByRole("button", { name: /Take observation/ }).click();

  await expect(page.getByRole("status")).toContainText(
    "Fixture observation accepted"
  );
  await expect(page.getByRole("status")).toContainText(
    "the bundled Bogotá fixture"
  );
  await expect(page.getByRole("status")).toContainText("fixture/API signals");
  await expect(page.getByRole("status")).toContainText(
    "4 browser-session signals added locally"
  );
  await expect(page.getByRole("status")).not.toContainText("Quito");
  await expect(page.locator(".signal-node").first()).toBeVisible();
  expect(await page.locator(".signal-node").count()).toBeGreaterThan(6);
  await expect(page.getByRole("button", { name: /Cosmos/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Atmosphere/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Biosphere/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Human activity/ })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Signal" })).not.toContainText(
    "Select a node"
  );
  await expect(page.getByText(/authored controls, not source voices/i)).toHaveCount(0);
  await expect(page.getByText(/authored transduction/i)).toBeVisible();
});

test("makes mapping decisions explicit in the patch workspace", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Take observation/ }).click();
  await page.locator(".workspace-nav").getByRole("button", { name: "Patch" }).click();

  await expect(page.getByRole("heading", { name: /Patch observations/ })).toBeVisible();
  await expect(page.getByText("Observation", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Control signal", { exact: true })).toBeVisible();

  const firstRoute = page.locator(".patch-row").first();
  const checkbox = firstRoute.getByRole("checkbox");
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  await expect(firstRoute.getByText("skipped", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("skipped");
});

test("keeps imported material private and distinguishes live processing from a derivative", async ({
  page
}) => {
  await page.goto("/");
  await page.locator(".workspace-nav").getByRole("button", { name: "Transform" }).click();

  await expect(page.getByRole("heading", { name: "Transform imported matter" })).toBeVisible();
  await expect(page.getByText(/bytes stay in this browser session/i)).toBeVisible();
  await expect(page.getByText(/not a measured sonogram/i)).toBeVisible();
  await expect(page.getByText("not recorded", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play loop" })).toBeDisabled();
});

test("starts only after the explicit listen gesture and panic closes audio", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Listen/ }).click();

  await expect(page.getByRole("status")).toContainText("Listening engine running");
  await page.getByRole("button", { name: "Panic" }).click();
  await expect(page.getByRole("status")).toContainText("Panic stop engaged");
  await expect(page.locator(".armed-outputs")).toContainText("panicked");
});

test("surfaces observation failure without inventing a field", async ({ page }) => {
  await page.route("**/api/snapshot**", (route) => route.abort("failed"));
  await page.goto("/");
  await page.getByRole("button", { name: /Take observation/ }).click();

  await expect(page.getByRole("status")).toContainText(/No value was substituted/);
  await expect(page.getByTestId("orbital-field")).toContainText("No observation loaded");
  await expect(page.locator(".signal-node")).toHaveCount(0);
});

test("archives and replays a bounded browser-local observation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Take observation/ }).click();
  await page.locator(".workspace-nav").getByRole("button", { name: "Archive" }).click();
  await page.getByRole("button", { name: "Save current observation" }).click();

  await expect(page.getByRole("status")).toContainText("private browser archive");
  await expect(page.locator(".archive-entry")).toHaveCount(1);
  await page.getByRole("button", { name: "Load" }).click();
  await expect(page.getByRole("status")).toContainText("Archived observation loaded");
  await expect(page.getByRole("heading", { name: "Current observation" })).toBeVisible();
});

test("keeps the observation flow inside bounded runtime budgets", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Take observation/ }).click();

  const metrics = await page.evaluate(() => {
    const maybeMemory = performance as Performance & {
      memory?: { usedJSHeapSize: number };
    };
    return {
      domNodes: document.querySelectorAll("*").length,
      resources: performance.getEntriesByType("resource").length,
      heap: maybeMemory.memory?.usedJSHeapSize ?? null
    };
  });

  expect(metrics.domNodes).toBeLessThan(3_000);
  expect(metrics.resources).toBeLessThan(160);
  if (metrics.heap !== null) expect(metrics.heap).toBeLessThan(140 * 1024 * 1024);
});
