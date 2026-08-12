import { expect, test, type Page } from "@playwright/test";

async function installMockMidi(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const testWindow = globalThis as typeof globalThis & {
      __cosmoMidiSends: number[][];
    };
    testWindow.__cosmoMidiSends = [];
    const output = {
      id: "test-midi-output",
      name: "Test MIDI output",
      send(data: readonly number[] | Uint8Array) {
        testWindow.__cosmoMidiSends.push(Array.from(data));
      }
    };
    Object.defineProperty(navigator, "requestMIDIAccess", {
      configurable: true,
      value: async () => ({ outputs: new Map([[output.id, output]]) })
    });
  });
}

async function armMockMidi(page: Page): Promise<void> {
  await page.locator(".workspace-nav").getByRole("button", { name: "Route" }).click();
  await page.getByRole("switch", { name: "MIDI output" }).click();
  await page.getByRole("button", { name: "Authorize MIDI devices" }).click();
  await expect(page.getByRole("status")).toContainText("1 MIDI output authorized");
}

async function installDelayedMaterialRead(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const testWindow = globalThis as typeof globalThis & {
      __cosmoMaterialReadStarted: boolean;
      __cosmoMaterialReadReleased: boolean;
      __releaseCosmoMaterialRead?: () => void;
    };
    const originalArrayBuffer = File.prototype.arrayBuffer;
    testWindow.__cosmoMaterialReadStarted = false;
    testWindow.__cosmoMaterialReadReleased = false;
    File.prototype.arrayBuffer = function arrayBuffer(): Promise<ArrayBuffer> {
      testWindow.__cosmoMaterialReadStarted = true;
      return new Promise<ArrayBuffer>((resolve, reject) => {
        testWindow.__releaseCosmoMaterialRead = () => {
          originalArrayBuffer.call(this).then(
            (bytes) => {
              testWindow.__cosmoMaterialReadReleased = true;
              resolve(bytes);
            },
            reject
          );
        };
      });
    };
  });
}

async function installDelayedAudioResume(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const testWindow = globalThis as typeof globalThis & {
      __cosmoAudioResumeStarted: number;
      __cosmoAudioResumeReleased: number;
      __releaseCosmoAudioResume?: (index?: number) => void;
    };
    const originalResume = AudioContext.prototype.resume;
    const pendingResumes: Array<() => void> = [];
    testWindow.__cosmoAudioResumeStarted = 0;
    testWindow.__cosmoAudioResumeReleased = 0;
    testWindow.__releaseCosmoAudioResume = (index = 0) => {
      pendingResumes.splice(index, 1)[0]?.();
    };
    AudioContext.prototype.resume = function resume(): Promise<void> {
      testWindow.__cosmoAudioResumeStarted += 1;
      return new Promise<void>((resolve, reject) => {
        pendingResumes.push(() => {
          originalResume.call(this).then(
            () => {
              testWindow.__cosmoAudioResumeReleased += 1;
              resolve();
            },
            (error) => {
              testWindow.__cosmoAudioResumeReleased += 1;
              reject(error);
            }
          );
        });
      });
    };
  });
}

async function installOversizedMaterialProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const testWindow = globalThis as typeof globalThis & {
      __cosmoOversizeReadCalled: boolean;
      __cosmoOversizeResumeCalled: boolean;
    };
    const originalArrayBuffer = File.prototype.arrayBuffer;
    const originalResume = AudioContext.prototype.resume;
    testWindow.__cosmoOversizeReadCalled = false;
    testWindow.__cosmoOversizeResumeCalled = false;
    Object.defineProperty(File.prototype, "size", {
      configurable: true,
      get: () => 64 * 1024 * 1024 + 1
    });
    File.prototype.arrayBuffer = function arrayBuffer(): Promise<ArrayBuffer> {
      testWindow.__cosmoOversizeReadCalled = true;
      return originalArrayBuffer.call(this);
    };
    AudioContext.prototype.resume = function resume(): Promise<void> {
      testWindow.__cosmoOversizeResumeCalled = true;
      return originalResume.call(this);
    };
  });
}

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
  await expect(page.getByRole("button", { name: /Hydrosphere/ })).toBeVisible();
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

test("choosing material remains unavailable until the explicit Listen gesture", async ({
  page
}) => {
  await page.goto("/");
  await page.locator(".workspace-nav").getByRole("button", { name: "Transform" }).click();

  await expect(page.locator('input[type="file"]')).toBeDisabled();
  await expect(page.locator(".armed-outputs")).toContainText("idle");
  await expect(page.getByRole("status")).toContainText("Audio is stopped");
});

test("starts only after the explicit listen gesture and panic closes audio", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Listen/ }).click();

  await expect(page.getByRole("status")).toContainText("Listening engine running");
  await page.getByRole("button", { name: "Panic" }).click();
  await expect(page.getByRole("status")).toContainText("Panic stop engaged");
  await expect(page.locator(".armed-outputs")).toContainText("panicked");
});

test("panic cancels a Listen still waiting for its first observation", async ({ page }) => {
  let releaseRequest!: () => void;
  let markRequestReached!: () => void;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  const requestReached = new Promise<void>((resolve) => {
    markRequestReached = resolve;
  });
  await page.route(
    "**/api/snapshot**",
    async (route) => {
      markRequestReached();
      await requestGate;
      await route.continue();
    },
    { times: 1 }
  );
  await page.goto("/");

  await page.getByRole("button", { name: /Listen/ }).click();
  await requestReached;
  await page.getByRole("button", { name: "Panic" }).click();
  await expect(page.getByRole("status")).toContainText("Panic stop engaged");

  releaseRequest();
  await expect(page.locator(".signal-node").first()).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Panic stop engaged");
  await expect(page.locator(".armed-outputs")).toContainText("panicked");
});

test("a superseded delayed Listen closes the context it started", async ({ page }) => {
  await installDelayedAudioResume(page);
  await page.goto("/");

  await page.getByRole("button", { name: /Listen/ }).click();
  await page.waitForFunction(
    () =>
      (globalThis as typeof globalThis & { __cosmoAudioResumeStarted?: number })
        .__cosmoAudioResumeStarted === 1
  );
  await page.getByRole("button", { name: /Take observation/ }).click();
  await expect(page.getByRole("status")).toContainText("Fixture observation accepted");

  await page.evaluate(() => {
    (
      globalThis as typeof globalThis & {
        __releaseCosmoAudioResume?: (index?: number) => void;
      }
    ).__releaseCosmoAudioResume?.();
  });
  await page.waitForFunction(
    () =>
      (globalThis as typeof globalThis & { __cosmoAudioResumeReleased?: number })
        .__cosmoAudioResumeReleased === 1
  );
  await expect(page.locator(".armed-outputs")).toContainText("stopped");
  await expect(page.getByRole("status")).not.toContainText("Listening engine running");
});

test("duplicate Listen gestures coalesce while audio startup is pending", async ({ page }) => {
  await installDelayedAudioResume(page);
  await page.goto("/");

  const listen = page.getByRole("button", { name: /Listen/ });
  await listen.evaluate((button) => {
    button.click();
    button.click();
  });
  await page.waitForFunction(
    () =>
      (globalThis as typeof globalThis & { __cosmoAudioResumeStarted?: number })
        .__cosmoAudioResumeStarted === 1
  );
  await expect(page.getByRole("button", { name: "Starting…" })).toBeDisabled();

  await page.evaluate(() => {
    (
      globalThis as typeof globalThis & {
        __releaseCosmoAudioResume?: (index?: number) => void;
      }
    ).__releaseCosmoAudioResume?.();
  });
  await page.waitForFunction(
    () =>
      (globalThis as typeof globalThis & { __cosmoAudioResumeReleased?: number })
        .__cosmoAudioResumeReleased === 1
  );
  await expect(page.locator(".armed-outputs")).toContainText("running");
  await expect(page.getByRole("status")).toContainText("Listening engine running");
});

test("Stop followed by Listen starts a fresh context while an old resume settles", async ({
  page
}) => {
  await installDelayedAudioResume(page);
  await page.goto("/");

  await page.getByRole("button", { name: /Listen/ }).click();
  await page.waitForFunction(
    () =>
      (globalThis as typeof globalThis & { __cosmoAudioResumeStarted?: number })
        .__cosmoAudioResumeStarted === 1
  );
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.locator(".armed-outputs")).toContainText("stopped");

  await page.getByRole("button", { name: /Listen/ }).click();
  await page.waitForFunction(
    () =>
      (globalThis as typeof globalThis & { __cosmoAudioResumeStarted?: number })
        .__cosmoAudioResumeStarted === 2
  );
  await page.evaluate(() => {
    (
      globalThis as typeof globalThis & {
        __releaseCosmoAudioResume?: (index?: number) => void;
      }
    ).__releaseCosmoAudioResume?.(1);
  });
  await page.waitForFunction(
    () =>
      (globalThis as typeof globalThis & { __cosmoAudioResumeReleased?: number })
        .__cosmoAudioResumeReleased === 1
  );
  await expect(page.locator(".armed-outputs")).toContainText("running");
  await expect(page.getByRole("status")).toContainText("Listening engine running");

  await page.evaluate(() => {
    (
      globalThis as typeof globalThis & {
        __releaseCosmoAudioResume?: (index?: number) => void;
      }
    ).__releaseCosmoAudioResume?.();
  });
  await page.waitForFunction(
    () =>
      (globalThis as typeof globalThis & { __cosmoAudioResumeReleased?: number })
        .__cosmoAudioResumeReleased === 2
  );
  await expect(page.locator(".armed-outputs")).toContainText("running");
  await expect(page.getByRole("status")).toContainText("Listening engine running");
});

test("the Internal audio route immediately disarms every local audio path", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Listen/ }).click();
  await expect(page.locator(".armed-outputs")).toContainText("running");

  await page.locator(".workspace-nav").getByRole("button", { name: "Route" }).click();
  const audioSwitch = page.getByRole("switch", { name: "Internal audio output" });
  await audioSwitch.click();
  await expect(audioSwitch).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("status")).toContainText(
    "Internal audio disarmed; all local audio paths were stopped"
  );
  await expect(page.locator(".armed-outputs")).toContainText("stopped");
  await expect(page.getByRole("button", { name: /Listen/ })).toBeDisabled();

  await page.locator(".workspace-nav").getByRole("button", { name: "Transform" }).click();
  await expect(page.locator('input[type="file"]')).toBeDisabled();

  await page.locator(".workspace-nav").getByRole("button", { name: "Route" }).click();
  await audioSwitch.click();
  await expect(audioSwitch).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: /Listen/ })).toBeEnabled();
  await expect(page.locator(".armed-outputs")).toContainText("stopped");
  await expect(page.getByRole("status")).toContainText(
    "output remains stopped until explicit Listen"
  );

  await page.getByRole("button", { name: /Listen/ }).click();
  await expect(page.locator(".armed-outputs")).toContainText("running");
});

test("audio disarm cancels a material file read before decoding can restart audio", async ({
  page
}) => {
  await installDelayedMaterialRead(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Listen/ }).click();
  await expect(page.locator(".armed-outputs")).toContainText("running");

  await page.locator(".workspace-nav").getByRole("button", { name: "Transform" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "delayed-private.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("delayed test bytes")
  });
  await page.waitForFunction(
    () =>
      (globalThis as typeof globalThis & { __cosmoMaterialReadStarted?: boolean })
        .__cosmoMaterialReadStarted === true
  );

  await page.locator(".workspace-nav").getByRole("button", { name: "Route" }).click();
  await page.getByRole("switch", { name: "Internal audio output" }).click();
  await expect(page.locator(".armed-outputs")).toContainText("stopped");

  await page.evaluate(() => {
    (
      globalThis as typeof globalThis & {
        __releaseCosmoMaterialRead?: () => void;
      }
    ).__releaseCosmoMaterialRead?.();
  });
  await page.waitForFunction(
    () =>
      (globalThis as typeof globalThis & { __cosmoMaterialReadReleased?: boolean })
        .__cosmoMaterialReadReleased === true
  );
  await expect(page.getByRole("status")).toContainText(
    "Internal audio disarmed; all local audio paths were stopped"
  );
  await expect(page.locator(".armed-outputs")).toContainText("stopped");

  await page.locator(".workspace-nav").getByRole("button", { name: "Transform" }).click();
  await expect(page.getByText("No material loaded", { exact: true })).toBeVisible();
});

test("Panic requires a new Listen gesture before material loading", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Listen/ }).click();
  await page.getByRole("button", { name: "Panic" }).click();
  await expect(page.locator(".armed-outputs")).toContainText("panicked");

  await page.locator(".workspace-nav").getByRole("button", { name: "Transform" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "panic-private.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("panic test bytes")
  });

  await expect(page.getByRole("status")).toContainText(
    "Panic is active. Press Listen to re-arm audio before loading material"
  );
  await expect(page.locator(".armed-outputs")).toContainText("panicked");
  await expect(page.getByText("No material loaded", { exact: true })).toBeVisible();
});

test("oversized material is refused before reading bytes or starting audio", async ({
  page
}) => {
  await installOversizedMaterialProbe(page);
  await page.goto("/");
  await page.locator(".workspace-nav").getByRole("button", { name: "Transform" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "oversized-private.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("small probe whose reported size is overridden")
  });

  await expect(page.getByRole("status")).toContainText(
    "Imported material exceeds the 64 MiB encoded-data safety limit"
  );
  const calls = await page.evaluate(() => {
    const testWindow = globalThis as typeof globalThis & {
      __cosmoOversizeReadCalled?: boolean;
      __cosmoOversizeResumeCalled?: boolean;
    };
    return {
      read: testWindow.__cosmoOversizeReadCalled,
      resume: testWindow.__cosmoOversizeResumeCalled
    };
  });
  expect(calls).toEqual({ read: false, resume: false });
  await expect(page.getByText("No material loaded", { exact: true })).toBeVisible();
});

test("an in-flight observation uses the latest mapping routes and generator state", async ({
  page
}) => {
  await installMockMidi(page);
  await page.goto("/");
  await armMockMidi(page);

  let releaseRequest!: () => void;
  let markRequestReached!: () => void;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  const requestReached = new Promise<void>((resolve) => {
    markRequestReached = resolve;
  });
  await page.route(
    "**/api/snapshot**",
    async (route) => {
      markRequestReached();
      await requestGate;
      await route.continue();
    },
    { times: 1 }
  );

  await page.locator(".workspace-nav").getByRole("button", { name: "Observe" }).click();
  await page.getByRole("button", { name: /Take observation/ }).click();
  await requestReached;
  await page.locator(".workspace-nav").getByRole("button", { name: "Patch" }).click();
  const generatorSwitch = page.locator(".generator-bank").getByRole("checkbox");
  await generatorSwitch.uncheck();
  const mappingSwitches = page.locator('.patch-row input[type="checkbox"]');
  const mappingCount = await mappingSwitches.count();
  for (let index = 0; index < mappingCount; index += 1) {
    await mappingSwitches.nth(index).uncheck();
  }

  releaseRequest();
  await expect(page.getByRole("status")).toContainText(
    "0 deterministic generator signals added locally"
  );
  await expect(
    page.getByRole("group", { name: "Current generator values" }).locator("span")
  ).toHaveCount(0);
  const sends = await page.evaluate(
    () =>
      (globalThis as typeof globalThis & { __cosmoMidiSends: number[][] })
        .__cosmoMidiSends
  );
  expect(sends).toEqual([]);
});

test("an in-flight observation cannot transmit after MIDI is disarmed", async ({ page }) => {
  await installMockMidi(page);
  await page.goto("/");
  await armMockMidi(page);

  let releaseRequest!: () => void;
  let markRequestReached!: () => void;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  const requestReached = new Promise<void>((resolve) => {
    markRequestReached = resolve;
  });
  await page.route(
    "**/api/snapshot**",
    async (route) => {
      markRequestReached();
      await requestGate;
      await route.continue();
    },
    { times: 1 }
  );

  await page.locator(".workspace-nav").getByRole("button", { name: "Observe" }).click();
  await page.getByRole("button", { name: /Take observation/ }).click();
  await requestReached;
  await page.locator(".workspace-nav").getByRole("button", { name: "Route" }).click();
  await page.getByRole("switch", { name: "MIDI output" }).click();
  releaseRequest();

  await expect(page.getByRole("heading", { name: /Route signals/ })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Fixture observation accepted");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (globalThis as typeof globalThis & { __cosmoMidiSends: number[][] })
            .__cosmoMidiSends.length
      )
    )
    .toBe(0);
});

test("surfaces observation failure without inventing a field", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/snapshot**", (route) => route.abort("failed"));
  await page.goto("/");
  await page.getByRole("button", { name: /Take observation/ }).click();

  await expect(page.getByRole("status")).toContainText(/No value was substituted/);
  await expect(page.getByTestId("orbital-field")).toContainText("No observation loaded");
  await expect(page.locator(".signal-node")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
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

test("does not let an overtaken request replace an archived replay", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Take observation/ }).click();
  await page.locator(".workspace-nav").getByRole("button", { name: "Archive" }).click();
  await page.getByRole("button", { name: "Save current observation" }).click();

  let releaseRequest!: () => void;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route(
    "**/api/snapshot**",
    async (route) => {
      await requestGate;
      await route.continue().catch(() => undefined);
    },
    { times: 1 }
  );

  await page.locator(".workspace-nav").getByRole("button", { name: "Observe" }).click();
  await page.getByRole("button", { name: /Take observation/ }).click();
  await page.locator(".workspace-nav").getByRole("button", { name: "Archive" }).click();
  await page.getByRole("button", { name: "Load" }).click();
  await expect(page.locator(".field-time span")).toHaveText("archive");

  releaseRequest();
  await page.waitForTimeout(200);
  await expect(page.locator(".field-time span")).toHaveText("archive");
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
