// v4.5 immediate-use browser contract. Prerequisite: `pnpm -F @game/ui build`.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const positionalOutput = process.argv.slice(2).find((argument) => !argument.startsWith("-"));
const outputDir =
  positionalOutput === undefined
    ? resolve(root, "../../docs/ui/regression/p8")
    : resolve(root, positionalOutput);
const port = Number(process.env.V45_HARNESS_PORT ?? 4181);
const baseUrl =
  process.env.V45_HARNESS_BASE_URL ??
  `http://127.0.0.1:${port}/deckbuilding-roguelite/`;
const failures = [];
const allErrors = { console: [], network: [], page: [] };

const check = (name, condition, detail = "") => {
  const suffix = detail === "" ? "" : ` — ${detail}`;
  console.log(`[${condition ? "ok" : "FAIL"}] ${name}${suffix}`);
  if (!condition) failures.push(`${name}${suffix}`);
};

const server =
  process.env.V45_HARNESS_BASE_URL === undefined
    ? await (
        await import("vite")
      ).preview({
        root,
        preview: { host: "127.0.0.1", port, strictPort: true },
      })
    : null;

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_EXECUTABLE_PATH === undefined
    ? {}
    : { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH },
);

const attachErrorCapture = (page) => {
  const errors = { console: [], network: [], page: [] };
  page.on("pageerror", (error) => errors.page.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.console.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico"))
      errors.network.push(`${response.status()} ${response.url()}`);
  });
  return errors;
};

const collectErrors = (errors) => {
  for (const kind of Object.keys(allErrors)) allErrors[kind].push(...errors[kind]);
};

const openFreshPage = async (viewport) => {
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    // A stable seed keeps the map and screenshots reproducible without changing game code.
    Math.random = () => 0.424242;
  });
  const errors = attachErrorCapture(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  return { context, errors, page };
};

const handCoins = (page) => page.locator('[data-testid="mobile-coin-rail"] button.coin');
const skillCard = (page, slot) => page.locator(`article.skill-card[data-slot="${slot}"]`);
const actionButton = (page, slot) => page.locator(`[data-testid="skill-action-${slot}"]`);

const waitForCombat = (page) =>
  page.waitForFunction(
    () => document.querySelector("main.combat-shell") !== null && document.querySelector(".end-turn:not(:disabled)") !== null,
    undefined,
    { timeout: 15_000 },
  );

const startNormalRun = async (page, screenshotPath) => {
  await page.locator('[data-testid="title-new-run"]').click();
  await page.locator('[data-testid="character-select"]').waitFor({ state: "visible", timeout: 10_000 });
  await page.screenshot({ path: screenshotPath, fullPage: false });

  const portraits = page.locator('[data-testid^="character-select-"]');
  check("character portraits are horizontal selectable entries", (await portraits.count()) >= 2);
  const railColumns = await page.locator(".character-portrait-rail").evaluate(
    (element) => getComputedStyle(element).gridTemplateColumns,
  );
  check("character portrait rail uses a horizontal grid", railColumns.split(" ").length >= 2, railColumns);
  await portraits.first().click();
  await page.locator('[data-testid="character-selected-detail"]').waitFor({ state: "visible" });
  await page.locator('[data-testid="character-start"]').click();
  await page.locator('[data-testid="node-choice"]').waitFor({ state: "visible", timeout: 10_000 });
  check("normal run enters node-selection map", await page.locator('[data-testid="run-map"]').count() === 1);

  const combatNode = page.locator('.node-card.node-combat').first();
  check("map exposes a combat node", (await combatNode.count()) === 1);
  if ((await combatNode.count()) === 1) await combatNode.click();
  await page.locator('[data-testid="next-combat"]').waitFor({ state: "visible", timeout: 10_000 });
  await page.locator('[data-testid="next-combat"]').click();
  await waitForCombat(page);
};

const useRepeatSkillTwice = async (page) => {
  const initialHand = await handCoins(page).count();
  check("combat starts with exactly three drawn hand coins", initialHand === 3, String(initialHand));
  check("combat history is not rendered", (await page.locator('[data-testid="combat-history"]').count()) === 0);
  check("execution rail is not rendered", (await page.locator('[data-testid="execution-rail"]').count()) === 0);
  check("automatic coin placement is not rendered", (await page.locator('[data-testid="auto-placement"]').count()) === 0);
  check("recommendation UI is not rendered", (await page.locator('[data-testid="recommended-load"]').count()) === 0);
  check("action confirmation UI is not rendered", (await page.locator('[data-testid="action-confirm"]').count()) === 0);

  const card = skillCard(page, 0);
  const socket = card.locator("button.socket").first();
  const action = actionButton(page, 0);
  check("first card exposes immediate action", (await action.count()) === 1);

  await handCoins(page).first().click();
  await socket.click();
  await action.click();
  await page.waitForFunction(
    () => document.querySelector('article.skill-card[data-slot="0"].resolving') === null,
    undefined,
    { timeout: 10_000 },
  );
  const afterFirstUse = await handCoins(page).count();
  check("immediate use resolves and consumes one hand coin", afterFirstUse === initialHand - 1, String(afterFirstUse));

  await handCoins(page).first().click();
  await socket.click();
  await action.click();
  await page.waitForFunction(
    () => document.querySelector('article.skill-card[data-slot="0"].resolving') === null,
    undefined,
    { timeout: 10_000 },
  );
  const afterSecondUse = await handCoins(page).count();
  check("repeat skill can be used again in the same turn", afterSecondUse === initialHand - 2, String(afterSecondUse));

  const passiveButton = page.locator('[data-testid="passive-inventory-open"]');
  await passiveButton.click();
  await page.locator('[data-testid="passive-inventory"]').waitFor({ state: "visible" });
  check("passive inventory opens during a run", await page.locator('[data-testid="passive-inventory"]').count() === 1);
  await passiveButton.click();

  const endTurn = page.locator("button.end-turn");
  check("explicit End Turn control is available", await endTurn.isEnabled());
  await endTurn.click();
  await page.waitForTimeout(350);
  check("End Turn remains an explicit combat control", (await page.locator("button.end-turn").count()) === 1);
};

try {
  await rm(outputDir, { force: true, recursive: true });
  await mkdir(outputDir, { recursive: true });

  const desktop = await openFreshPage({ width: 1600, height: 900 });
  try {
    const titleButtons = ["title-continue", "title-new-run", "title-tutorial", "title-settings"];
    for (const testId of titleButtons)
      check(`title exposes ${testId}`, (await desktop.page.locator(`[data-testid="${testId}"]`).count()) === 1);
    check("Continue is disabled without a save", await desktop.page.locator('[data-testid="title-continue"]').isDisabled());
    await desktop.page.screenshot({ path: resolve(outputDir, "title-desktop.png"), fullPage: false });

    await desktop.page.locator('[data-testid="title-tutorial"]').click();
    await desktop.page.locator('[data-testid="tutorial-screen"]').waitFor({ state: "visible" });
    for (let index = 0; index < 5; index += 1) await desktop.page.locator('[data-testid="tutorial-next"]').click();
    await desktop.page.locator('[data-testid="tutorial-start-practice"]').click();
    await desktop.page.locator('[data-testid="character-select"]').waitFor({ state: "visible" });
    check("tutorial reaches the guided practice start", true);
  } finally {
    collectErrors(desktop.errors);
    await desktop.context.close();
  }

  const desktopRun = await openFreshPage({ width: 1600, height: 900 });
  try {
    await startNormalRun(desktopRun.page, resolve(outputDir, "character-select-desktop.png"));
    await useRepeatSkillTwice(desktopRun.page);
    await desktopRun.page.screenshot({ path: resolve(outputDir, "combat-desktop.png"), fullPage: false });
  } finally {
    collectErrors(desktopRun.errors);
    await desktopRun.context.close();
  }

  const mobileRun = await openFreshPage({ width: 932, height: 430 });
  try {
    check("mobile landscape title is visible", await mobileRun.page.locator('[data-testid="title-screen"]').isVisible());
    await startNormalRun(mobileRun.page, resolve(outputDir, "character-select-mobile-landscape.png"));
    check("mobile landscape keeps the hand rail visible", (await handCoins(mobileRun.page).count()) === 3);
    await mobileRun.page.screenshot({ path: resolve(outputDir, "combat-mobile-landscape.png"), fullPage: false });
  } finally {
    collectErrors(mobileRun.errors);
    await mobileRun.context.close();
  }

  for (const [kind, errors] of Object.entries(allErrors))
    check(`no ${kind} errors`, errors.length === 0, errors.join(" | "));

  const manifest = {
    schemaVersion: 2,
    contract: "v4.5-immediate-flow",
    baseUrl,
    screenshots: [
      "title-desktop.png",
      "character-select-desktop.png",
      "combat-desktop.png",
      "character-select-mobile-landscape.png",
      "combat-mobile-landscape.png",
    ],
    viewports: {
      desktop: { width: 1600, height: 900 },
      mobileLandscape: { width: 932, height: 430 },
    },
    checks: {
      title: ["continue-disabled-without-save", "new-run", "tutorial", "settings"],
      run: ["character-select", "node-map", "immediate-repeat-use", "explicit-end-turn", "passive-inventory"],
      removed: ["combat-history", "execution-rail", "auto-placement", "recommendation", "action-confirm"],
      errors: allErrors,
    },
    passed: failures.length === 0,
  };
  await writeFile(resolve(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
} catch (error) {
  failures.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
} finally {
  await browser.close();
  if (server !== null) await new Promise((close) => server.httpServer.close(close));
}

if (failures.length > 0) {
  console.error("\nV4.5 immediate-flow failures:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
}
