// P8 overlay/VFX/SFX focused browser contract. Prerequisite: `pnpm -F @game/ui build`.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = resolve(root, "../../docs/ui/regression/p8");
const baseUrl =
  process.env.FEEDBACK_REGRESSION_BASE_URL ??
  "http://127.0.0.1:4181/deckbuilding-roguelite/";
const seeds = {
  overlay: "P8-OVERLAY-GHOUL",
  combat: "P8-COMBAT-FEEDBACK",
  summon: "P8-SUMMON-FEEDBACK",
};

const failures = [];
const check = (name, condition, detail = "") => {
  const suffix = detail === "" ? "" : ` — ${detail}`;
  console.log(`[${condition ? "ok" : "FAIL"}] ${name}${suffix}`);
  if (!condition) failures.push(`${name}${suffix}`);
};

const server =
  process.env.FEEDBACK_REGRESSION_BASE_URL === undefined
    ? await (
        await import("vite")
      ).preview({
        root,
        preview: { host: "127.0.0.1", port: 4181, strictPort: true },
      })
    : null;
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_EXECUTABLE_PATH === undefined
    ? {}
    : { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH },
);

await mkdir(outputDir, { recursive: true });

const allErrors = { console: [], network: [], page: [] };
const attachErrorCapture = (page) => {
  const errors = { console: [], network: [], page: [] };
  page.on("pageerror", (error) => errors.page.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.console.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.network.push(`${response.status()} ${response.url()}`);
  });
  return errors;
};

const mergeErrors = (errors) => {
  for (const kind of Object.keys(allErrors)) allErrors[kind].push(...errors[kind]);
};

const installFakeAudio = async (page) => {
  await page.addInitScript(() => {
    const evidence = { contexts: 0, oscillatorStarts: 0 };
    class FakeAudioContext {
      constructor() {
        evidence.contexts += 1;
        this.currentTime = 0;
        this.destination = {};
        this.state = "running";
      }
      createOscillator() {
        return {
          connect(node) {
            return node;
          },
          frequency: {
            exponentialRampToValueAtTime() {},
            setValueAtTime() {},
          },
          start() {
            evidence.oscillatorStarts += 1;
          },
          stop() {},
          type: "sine",
        };
      }
      createGain() {
        return {
          connect() {
            return this;
          },
          gain: {
            exponentialRampToValueAtTime() {},
            setValueAtTime() {},
          },
        };
      }
      resume() {
        return Promise.resolve();
      }
    }
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: FakeAudioContext,
    });
    Object.defineProperty(window, "webkitAudioContext", {
      configurable: true,
      value: FakeAudioContext,
    });
    Object.defineProperty(window, "__p8AudioEvidence", {
      configurable: true,
      value: evidence,
    });
  });
};

const readAudio = (page) =>
  page.evaluate(() => ({ ...window.__p8AudioEvidence }));

const waitForCombat = (page) =>
  page.waitForFunction(
    () =>
      document.querySelector(".end-turn:not(:disabled)") !== null &&
      document.querySelector(".float-text") === null,
    undefined,
    { timeout: 15000 },
  );

const waitForVisualStability = async (page) => {
  await page.waitForFunction(() =>
    [...document.images].every(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  );
  await page.evaluate(async () => {
    await Promise.all(
      [...document.images].map((image) => image.decode().catch(() => undefined)),
    );
    await new Promise((resolveFrame) =>
      requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
    );
  });
  // Chromium can finish image.decode() before the decoded sprite reaches the compositor.
  await page.waitForTimeout(1000);
};

const passiveButton = (page) =>
  page.locator(".unit.enemy .passive-chip").locator("xpath=ancestor::button");

const tooltipEvidence = async (page, trigger) => {
  const describedBy = await trigger.getAttribute("aria-describedby");
  const tooltip = page.locator(`[id=${JSON.stringify(describedBy)}]`);
  await tooltip.waitFor({ state: "visible" });
  const geometry = await tooltip.evaluate((element) => {
    const node = element;
    const rect = node.getBoundingClientRect();
    const previousPointerEvents = node.style.pointerEvents;
    node.style.pointerEvents = "auto";
    const topmost = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    node.style.pointerEvents = previousPointerEvents;
    return {
      describedBy: node.id,
      insideViewport:
        rect.left >= 8 &&
        rect.top >= 8 &&
        rect.right <= innerWidth - 8 &&
        rect.bottom <= innerHeight - 8,
      layer: node.parentElement?.dataset.overlayLayer ?? null,
      placement: node.dataset.placement ?? null,
      role: node.getAttribute("role"),
      topmost: topmost === node || node.contains(topmost),
    };
  });
  return { ...geometry, ariaDescribedBy: describedBy === geometry.describedBy };
};

const bootOverlay = async (viewport, mobile = false) => {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    hasTouch: mobile,
    isMobile: mobile,
  });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = attachErrorCapture(page);
  await page.goto(`${baseUrl}?seed=${seeds.overlay}&encounter=ghoul`, {
    waitUntil: "networkidle",
  });
  await waitForCombat(page);
  return { context, errors, page };
};

const manifest = {
  schemaVersion: 1,
  seeds,
  screenshots: [
    "overlay-desktop.png",
    "overlay-mobile.png",
    "combat-feedback.png",
    "summon-feedback.png",
  ],
  viewports: {
    desktop: { height: 720, width: 1280 },
    mobile: { height: 844, width: 390 },
  },
};

try {
  {
    const { context, errors, page } = await bootOverlay(
      manifest.viewports.desktop,
    );
    const trigger = passiveButton(page);
    await trigger.focus();
    const overlay = await tooltipEvidence(page, trigger);
    check(
      "desktop tooltip portal contract",
      overlay.role === "tooltip" &&
        overlay.layer === "tooltip" &&
        overlay.insideViewport &&
        overlay.topmost &&
        overlay.ariaDescribedBy,
      JSON.stringify(overlay),
    );
    await waitForVisualStability(page);
    await page.screenshot({
      path: resolve(outputDir, "overlay-desktop.png"),
    });
    manifest.overlayDesktop = {
      keyboardReachable: true,
      ...overlay,
    };
    mergeErrors(errors);
    await context.close();
  }

  {
    const { context, errors, page } = await bootOverlay(
      manifest.viewports.mobile,
      true,
    );
    const trigger = passiveButton(page);
    await trigger.tap();
    const overlay = await tooltipEvidence(page, trigger);
    check(
      "mobile tooltip portal contract",
      overlay.role === "tooltip" &&
        overlay.layer === "tooltip" &&
        overlay.insideViewport &&
        overlay.topmost &&
        overlay.ariaDescribedBy,
      JSON.stringify(overlay),
    );
    await waitForVisualStability(page);
    await page.screenshot({ path: resolve(outputDir, "overlay-mobile.png") });
    await page.keyboard.press("Escape");
    await page
      .locator(`[id=${JSON.stringify(overlay.describedBy)}]`)
      .waitFor({ state: "detached" });
    manifest.overlayMobile = {
      ...overlay,
      escapeCloses: true,
      touchReachable: true,
    };
    mergeErrors(errors);
    await context.close();
  }

  {
    const context = await browser.newContext({
      viewport: manifest.viewports.desktop,
      deviceScaleFactor: 1,
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();
    await installFakeAudio(page);
    const errors = attachErrorCapture(page);
    await page.goto(`${baseUrl}?seed=${seeds.combat}`, {
      waitUntil: "networkidle",
    });
    await waitForCombat(page);

    const muteToggle = page.locator('[data-testid="mute-toggle"]');
    const mutedBefore = await muteToggle.innerText();
    const audioBefore = await readAudio(page);
    check(
      "sound defaults to muted without AudioContext construction",
      /끔/.test(mutedBefore) && audioBefore.contexts === 0,
      JSON.stringify({ audioBefore, mutedBefore }),
    );
    await muteToggle.focus();
    await page.keyboard.press("Enter");
    const muteKeyboardToggle =
      (await muteToggle.getAttribute("aria-pressed")) === "true" &&
      (await page.evaluate(() =>
        localStorage.getItem("deckbuilding-roguelite.muted"),
      )) === "false";
    check(
      "sound toggle persists explicit unmute",
      muteKeyboardToggle,
    );

    const basicCoin = page.locator(
      ".hand-tray .coin:not(.fire):not(.mana):not(.frost):not(.lightning):not(.granted-fire)",
    );
    await basicCoin.first().click();
    await page.locator(".skill-card").first().locator(".socket").click();
    const placementVfx = page
      .locator(".skill-card")
      .first()
      .locator(".socket .socket-coin.vfx-reveal");
    await placementVfx.waitFor({ state: "visible", timeout: 5000 });
    const placementVfxTarget = (await placementVfx.count()) === 1;
    check(
      "coin placement VFX is attached to the moved coin",
      placementVfxTarget,
    );
    await page.waitForFunction(
      () => window.__p8AudioEvidence.oscillatorStarts >= 1,
      undefined,
      { timeout: 5000 },
    );
    const audioAfterPlacement = await readAudio(page);
    check(
      "one coin-place event starts one mapped cue group",
      audioAfterPlacement.contexts === 1 &&
        audioAfterPlacement.oscillatorStarts === 1,
      JSON.stringify(audioAfterPlacement),
    );

    await page.locator(".skill-card").first().locator(".socket").click();
    const recoveryVfx = page.locator(".hand-tray .coin.vfx-reveal");
    await recoveryVfx.waitFor({ state: "visible", timeout: 5000 });
    const recoveryVfxTarget = (await recoveryVfx.count()) === 1;
    check(
      "coin recovery VFX is attached to the returned hand coin",
      recoveryVfxTarget,
    );
    await basicCoin.first().click();
    await page.locator(".skill-card").first().locator(".socket").click();

    await page.locator(".skill-card").first().locator(".card-title").click();
    await page.locator(".unit.enemy.vfx-hit").waitFor({
      state: "visible",
      timeout: 10000,
    });
    const visibleText = await page.locator(".unit.enemy .float-text").innerText();
    const vfxTarget = await page
      .locator(".unit.enemy.vfx-hit")
      .evaluate((element) => element.classList.contains("vfx-hit"));
    await waitForVisualStability(page);
    await page.screenshot({ path: resolve(outputDir, "combat-feedback.png") });
    const audioAfterAction = await readAudio(page);
    check(
      "representative unmuted combat action produces mapped audio activity",
      audioAfterAction.contexts === 1 &&
        audioAfterAction.oscillatorStarts >
          audioAfterPlacement.oscillatorStarts,
      JSON.stringify({ audioAfterAction, audioAfterPlacement }),
    );
    check(
      "combat VFX is attached to the real enemy target with visible text",
      vfxTarget && /^-[0-9]+$/.test(visibleText.trim()),
      visibleText,
    );

    await page.reload({ waitUntil: "networkidle" });
    const continueButton = page.locator('[data-testid="title-continue"]');
    if ((await continueButton.count()) > 0) await continueButton.click();
    await waitForCombat(page);
    const persistedUnmute =
      (await page.locator('[data-testid="mute-toggle"]').innerText()).includes(
        "켬",
      );
    check("sound preference survives reload", persistedUnmute);
    manifest.combatFeedback = {
      audio: {
        afterAction: audioAfterAction,
        afterPlacement: audioAfterPlacement,
        defaultMutedContextCount: audioBefore.contexts,
        keyboardToggle: muteKeyboardToggle,
        persistedUnmute,
      },
      placementVfxTarget,
      recoveryVfxTarget,
      cue: "vfx-hit",
      target: ".unit.enemy",
      targetAttached: vfxTarget,
      visibleEquivalent: /^-[0-9]+$/.test(visibleText.trim()),
    };
    mergeErrors(errors);
    await context.close();
  }

  {
    const context = await browser.newContext({
      viewport: manifest.viewports.desktop,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await installFakeAudio(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors = attachErrorCapture(page);
    await page.goto(`${baseUrl}?seed=${seeds.combat}`, {
      waitUntil: "networkidle",
    });
    await waitForCombat(page);
    const basicCoin = page.locator(
      ".hand-tray .coin:not(.fire):not(.mana):not(.frost):not(.lightning):not(.granted-fire)",
    );
    await basicCoin.first().click();
    await page.locator(".skill-card").first().locator(".socket").click();
    await page.locator(".skill-card").first().locator(".card-title").click();
    await page.locator(".unit.enemy .float-text").waitFor({
      state: "visible",
      timeout: 10000,
    });
    const movementCueCount = await page.locator(".unit.enemy.vfx-hit").count();
    const visibleEquivalent = await page
      .locator(".unit.enemy .float-text")
      .isVisible();
    const mutedAudio = await readAudio(page);
    check(
      "reduced motion removes target movement but preserves visible outcome",
      movementCueCount === 0 && visibleEquivalent,
      JSON.stringify({ movementCueCount, visibleEquivalent }),
    );
    check(
      "muted reduced-motion path creates no audio context",
      mutedAudio.contexts === 0 && mutedAudio.oscillatorStarts === 0,
      JSON.stringify(mutedAudio),
    );
    manifest.reducedMotion = {
      audio: mutedAudio,
      movementCueAbsent: movementCueCount === 0,
      visibleEquivalent,
    };
    mergeErrors(errors);
    await context.close();
  }

  {
    const context = await browser.newContext({
      viewport: manifest.viewports.desktop,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors = attachErrorCapture(page);
    await page.goto(
      `${baseUrl}?seed=${seeds.summon}&character=arcanist`,
      { waitUntil: "networkidle" },
    );
    await waitForCombat(page);
    const summon = page.locator('[data-testid="summon-slot-0"]');
    const accessibleLabel = await summon.getAttribute("aria-label");
    const duration = await summon.locator(".summon-duration").innerText();
    check(
      "summon rail exposes target and duration accessibly",
      (await summon.count()) === 1 &&
        duration === "1" &&
        accessibleLabel?.includes("지속 1") === true,
      JSON.stringify({ accessibleLabel, duration }),
    );
    await waitForVisualStability(page);
    await page.screenshot({ path: resolve(outputDir, "summon-feedback.png") });
    manifest.summonFeedback = {
      accessibleDuration: accessibleLabel?.includes("지속 1") === true,
      duration,
      target: '[data-testid="summon-slot-0"]',
      targetExists: (await summon.count()) === 1,
    };
    mergeErrors(errors);
    await context.close();
  }
} catch (error) {
  failures.push(error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  await browser.close();
  if (server !== null)
    await new Promise((resolveClose) => server.httpServer.close(resolveClose));
}

manifest.accessibility = {
  keyboardTooltip: manifest.overlayDesktop?.keyboardReachable === true,
  muteKeyboardToggle: manifest.combatFeedback?.audio.keyboardToggle === true,
  reducedMotionVisibleEquivalent:
    manifest.reducedMotion?.visibleEquivalent === true,
  summonDurationLabel: manifest.summonFeedback?.accessibleDuration === true,
  touchTooltip: manifest.overlayMobile?.touchReachable === true,
};
manifest.errors = {
  console: allErrors.console.length,
  network: allErrors.network.length,
  page: allErrors.page.length,
};

check(
  "browser console/page/network errors are zero",
  Object.values(manifest.errors).every((count) => count === 0),
  JSON.stringify(allErrors),
);

await writeFile(
  resolve(outputDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

if (failures.length > 0) {
  console.error(`\nfeedback regression failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`\nfeedback regression passed — ${outputDir}`);
