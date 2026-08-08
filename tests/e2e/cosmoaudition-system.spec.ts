import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("keeps the workbench semantically inspectable", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Instrument workspaces" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Source strata" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Signal" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Audio is stopped");
  await expect(
    page.getByRole("heading", { name: "Cosmoaudition System", level: 1 })
  ).toHaveCount(1);
});

test("has no unlabeled visible interactive controls", async ({ page }) => {
  await page.goto("/");

  const unlabeled = await page.evaluate(() => {
    function visible(element: Element) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    }
    function name(element: Element): string {
      const aria = element.getAttribute("aria-label")?.trim();
      if (aria) return aria;
      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy) {
        const copy = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
          .join(" ")
          .trim();
        if (copy) return copy;
      }
      if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
        const copy = Array.from(element.labels ?? [])
          .map((label) => label.textContent?.trim() ?? "")
          .join(" ")
          .trim();
        if (copy) return copy;
      }
      return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
    }
    return Array.from(document.querySelectorAll("button, input, select, a[href]"))
      .filter(visible)
      .map((element) => ({ tag: element.tagName, className: element.className, name: name(element) }))
      .filter((item) => item.name.length === 0);
  });

  expect(unlabeled).toEqual([]);
});

test("supports keyboard-only observation and workspace switching", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#cosmo-workspace$/);

  const observe = page.getByRole("button", { name: /Take observation/ });
  await observe.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Fixture observation accepted");

  const patch = page.locator(".workspace-nav").getByRole("button", { name: "Patch" });
  await patch.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /Patch observations/ })).toBeVisible();
});

test("has no horizontal page overflow on a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("button", { name: /Take observation/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Listen/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Panic" })).toBeVisible();
  await page.getByRole("button", { name: /Take observation/ }).click();
  await expect(page.getByRole("status")).toContainText("Fixture observation accepted");

  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    navBottom: document.querySelector(".mobile-nav")?.getBoundingClientRect().bottom,
    viewportHeight: window.innerHeight
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  expect(layout.navBottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
});

test("preserves visible evidence and output caveats", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Take observation/ }).click();
  await expect(page.locator(".field-legend")).toContainText("measured");
  await expect(page.locator(".field-legend")).toContainText("unknown");

  await page.locator(".workspace-nav").getByRole("button", { name: "Route" }).click();
  await expect(page.getByText(/not evidence that another system received/i)).toBeVisible();
  await expect(page.getByText("scheduled locally")).toBeVisible();
  await expect(page.getByText("optional projection")).toBeVisible();
});
