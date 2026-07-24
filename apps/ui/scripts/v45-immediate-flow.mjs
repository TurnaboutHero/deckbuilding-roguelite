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

const rectsOverlap = (first, second) =>
  first.x < second.x + second.width &&
  first.x + first.width > second.x &&
  first.y < second.y + second.height &&
  first.y + first.height > second.y;

const checkFirstCardLayout = async (page, context) => {
  const card = skillCard(page, 0);
  const titleBox = await card.locator(".card-title").boundingBox();
  const socketBox = await card.locator("button.socket").first().boundingBox();
  check(
    `${context} socket hit area is at least 44 by 44 CSS pixels`,
    socketBox !== null && socketBox.width >= 44 && socketBox.height >= 44,
    socketBox === null ? "missing socket" : `${socketBox.width}x${socketBox.height}`,
  );
  check(
    `${context} first card title and socket do not overlap`,
    titleBox !== null && socketBox !== null && !rectsOverlap(titleBox, socketBox),
    titleBox === null || socketBox === null
      ? "missing title or socket"
      : `title=${JSON.stringify(titleBox)} socket=${JSON.stringify(socketBox)}`,
  );
};

const checkCombatGuidance = async (page, context) => {
  const guide = page.locator('[data-testid="combat-step-guide"]');
  const guideBox = await guide.boundingBox();
  const cardBox = await page.locator("article.skill-card").first().boundingBox();
  check(
    `${context} combat step guide exists above the card rail`,
    (await guide.count()) === 1 &&
      guideBox !== null &&
      cardBox !== null &&
      guideBox.y + guideBox.height <= cardBox.y,
    guideBox === null || cardBox === null
      ? "missing guide or card"
      : `guide=${JSON.stringify(guideBox)} card=${JSON.stringify(cardBox)}`,
  );
};

const checkStatusChipPointerTarget = async (page, context) => {
  const chip = page.locator(".enemy-line .intent button.kw").first();
  if ((await chip.count()) === 0) {
    check(`${context} status chip wins pointer hit testing over the sprite`, false, "missing status chip");
    return;
  }
  const result = await chip.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const target = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return {
      chip: target?.closest("button.kw") === element,
      target: target?.tagName ?? "none",
    };
  });
  check(
    `${context} status chip wins pointer hit testing over the sprite`,
    result.chip,
    result.target,
  );
  await chip.hover();
  const tooltip = page.locator('[data-overlay-layer="tooltip"] .kw-tip').last();
  await tooltip.waitFor({ state: "visible" });
  const tooltipBox = await tooltip.boundingBox();
  const plateBox = await chip.evaluate((element) => {
    const rect = element.closest(".unit")?.querySelector(".unit-plate")?.getBoundingClientRect();
    return rect === undefined
      ? null
      : { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  check(
    `${context} status tooltip opens by mouse without covering the HP plate`,
    tooltipBox !== null &&
      plateBox !== null &&
      !rectsOverlap(tooltipBox, plateBox) &&
      tooltipBox.x >= 0 &&
      tooltipBox.y >= 0 &&
      tooltipBox.x + tooltipBox.width <= (await page.evaluate(() => innerWidth)) &&
      tooltipBox.y + tooltipBox.height <= (await page.evaluate(() => innerHeight)),
    tooltipBox === null || plateBox === null
      ? "missing tooltip or plate"
      : `tooltip=${JSON.stringify(tooltipBox)} plate=${JSON.stringify(plateBox)}`,
  );
  await page.mouse.move(0, 0);
};

const skillCardSkeletonsIntact = (page) =>
  page.locator("article.skill-card:not(.empty-slot)").evaluateAll((cards) =>
    cards.every((card) => {
      const art = card.querySelector(".card-art");
      return (
        card.querySelector(".card-title") !== null &&
        art !== null &&
        getComputedStyle(art).display !== "none" &&
        card.querySelector(".card-effects") !== null &&
        card.querySelector(".card-action") !== null
      );
    }),
  );

const boxesStayInViewport = (page, selector) =>
  page.locator(selector).evaluateAll((elements) =>
    elements.every((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
    }),
  );

const waitForCombat = (page) =>
  page.waitForFunction(
    () => document.querySelector("main.combat-shell") !== null && document.querySelector(".end-turn:not(:disabled)") !== null,
    undefined,
    { timeout: 15_000 },
  );

const startNormalRun = async (page, screenshotPath) => {
  await page.locator('[data-testid="title-new-run"]').click();
  await page.locator('[data-testid="character-select"]').waitFor({ state: "visible", timeout: 10_000 });
  if (screenshotPath !== undefined) await page.screenshot({ path: screenshotPath, fullPage: false });

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
  await checkFirstCardLayout(page, "desktop");
  await checkCombatGuidance(page, "desktop");
  await checkStatusChipPointerTarget(page, "desktop");

  await socket.click();
  await page
    .locator('[data-testid="combat-step-guide"]')
    .getByText("손패에서 동전을 먼저 선택", { exact: true })
    .waitFor({ state: "visible" });
  check(
    "empty socket click without a selected coin shows guidance feedback",
    await page
      .locator('[data-testid="combat-step-guide"]')
      .getByText("손패에서 동전을 먼저 선택", { exact: true })
      .isVisible(),
  );

  await handCoins(page).first().click();
  await socket.click();
  const faceForecast = card.locator('[data-testid="face-forecast"]');
  await faceForecast.waitFor({ state: "visible" });
  check(
    "loading a coin shows heads and tails face forecast",
    (await faceForecast.count()) === 1 &&
      (await faceForecast.getByText("앞:", { exact: true }).count()) === 1 &&
      (await faceForecast.getByText("뒤:", { exact: true }).count()) === 1,
  );
  await socket.click();
  check(
    "unloading the coin removes face forecast immediately",
    (await card.locator('[data-testid="face-forecast"]').count()) === 0,
  );
  await handCoins(page).first().click();
  await faceForecast.waitFor({ state: "visible" });
  await action.click();
  await page.waitForFunction(
    () => document.querySelector('article.skill-card[data-slot="0"].resolving') === null,
    undefined,
    { timeout: 10_000 },
  );
  const resolution = page.locator(".resolution-ticket");
  await resolution.waitFor({ state: "visible" });
  check(
    "resolution ticket distinguishes skill and coin components",
    (await resolution.getByText("스킬", { exact: true }).count()) === 1 &&
      (await resolution.getByText("코인", { exact: true }).count()) === 1,
  );
  const afterFirstUse = await handCoins(page).count();
  check("immediate use resolves and consumes one hand coin", afterFirstUse === initialHand - 1, String(afterFirstUse));

  await handCoins(page).first().click();
  check(
    "starting the next coin interaction clears the prior resolution ticket",
    (await page.locator(".resolution-ticket").count()) === 0,
  );
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
  check(
    "resolution ticket is hidden while the passive inventory is open",
    !(await page.locator(".resolution-ticket").isVisible()),
  );
  const passiveCopyFits = await page.locator('[data-testid="passive-inventory"] :is(p, li span)').evaluateAll(
    (elements) => elements.every((element) => element.scrollWidth <= element.clientWidth),
  );
  check("passive inventory body copy fits without horizontal clipping", passiveCopyFits);
  await passiveButton.click();

  const endTurn = page.locator("button.end-turn");
  check("explicit End Turn control is available", await endTurn.isEnabled());
  await endTurn.click();
  const enemyActionBanner = page.locator('[data-testid="enemy-action-banner"]');
  await enemyActionBanner.waitFor({ state: "visible" });
  check(
    "enemy turn exposes a short actor and action banner",
    (await enemyActionBanner.textContent())?.includes(":") === true,
    await enemyActionBanner.textContent(),
  );
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
    check("mobile landscape keeps every skill card skeleton intact", await skillCardSkeletonsIntact(mobileRun.page));
    await checkFirstCardLayout(mobileRun.page, "mobile landscape");
    await checkCombatGuidance(mobileRun.page, "mobile landscape");
    const mobileInitialHand = await handCoins(mobileRun.page).count();
    await handCoins(mobileRun.page).first().click();
    await skillCard(mobileRun.page, 0).locator("button.socket").first().click();
    await actionButton(mobileRun.page, 0).click();
    await mobileRun.page.waitForFunction(
      () => document.querySelector('article.skill-card[data-slot="0"].resolving') === null,
      undefined,
      { timeout: 10_000 },
    );
    const mobileHandAfterUse = await handCoins(mobileRun.page).count();
    check(
      "mobile landscape standard clicks complete one immediate use",
      mobileHandAfterUse === mobileInitialHand - 1,
      String(mobileHandAfterUse),
    );
    const resolutionBox = await mobileRun.page.locator(".resolution-ticket").boundingBox();
    const guideBox = await mobileRun.page.locator('[data-testid="combat-step-guide"]').boundingBox();
    check(
      "mobile landscape resolution and step guide panels do not overlap",
      resolutionBox === null || guideBox === null || !rectsOverlap(resolutionBox, guideBox),
    );
    await mobileRun.page.screenshot({ path: resolve(outputDir, "combat-mobile-landscape.png"), fullPage: false });
  } finally {
    collectErrors(mobileRun.errors);
    await mobileRun.context.close();
  }

  for (const viewport of [
    { label: "1366 by 768", width: 1366, height: 768 },
    { label: "1280 by 720", width: 1280, height: 720 },
    { label: "844 by 390", width: 844, height: 390 },
  ]) {
    const layoutRun = await openFreshPage({ width: viewport.width, height: viewport.height });
    try {
      await startNormalRun(layoutRun.page);
      check(`${viewport.label} keeps every skill card skeleton intact`, await skillCardSkeletonsIntact(layoutRun.page));
      await checkFirstCardLayout(layoutRun.page, viewport.label);
      await checkCombatGuidance(layoutRun.page, viewport.label);
      const labelBoxes = await layoutRun.page
        .locator('[data-testid="mobile-coin-rail"] button.coin small')
        .evaluateAll((elements) =>
          elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top };
          }),
        );
      check(
        `${viewport.label} keeps hand coin labels inside the frame`,
        labelBoxes.every(
          (box) => box.left >= 0 && box.top >= 0 && box.right <= viewport.width && box.bottom <= viewport.height,
        ),
        JSON.stringify(labelBoxes),
      );
    } finally {
      collectErrors(layoutRun.errors);
      await layoutRun.context.close();
    }
  }

  const compactRun = await openFreshPage({ width: 740, height: 360 });
  try {
    await startNormalRun(compactRun.page, resolve(outputDir, "character-select-compact-landscape.png"));
    check("compact landscape keeps every skill card skeleton intact", await skillCardSkeletonsIntact(compactRun.page));
    await checkFirstCardLayout(compactRun.page, "compact landscape");
    check(
      "compact landscape keeps hand coin labels inside the frame",
      await boxesStayInViewport(compactRun.page, '[data-testid="mobile-coin-rail"] button.coin small'),
    );
    const enemyGeometry = await compactRun.page.locator(".enemy-line .unit.enemy").evaluateAll((units) =>
      units.every((unit) => {
        const plate = unit.querySelector(".unit-plate")?.getBoundingClientRect();
        const sprite = unit.querySelector(".sprite")?.getBoundingClientRect();
        return (
          plate !== undefined &&
          sprite !== undefined &&
          !(
            plate.left < sprite.right &&
            plate.right > sprite.left &&
            plate.top < sprite.bottom &&
            plate.bottom > sprite.top
          )
        );
      }),
    );
    check("compact landscape enemy sprites do not overlap HP plates", enemyGeometry);
    check(
      "compact landscape status chips stay inside the frame",
      await boxesStayInViewport(compactRun.page, ".turn-buff-chip, .enemy-line .unit-plate em"),
    );
    const noticeGeometry = await compactRun.page.locator(".skill-row-notices").evaluate((notices) => {
      const guide = notices.querySelector('[data-testid="combat-step-guide"]')?.getBoundingClientRect();
      const card = document.querySelector("article.skill-card")?.getBoundingClientRect();
      return guide !== undefined && card !== undefined && guide.bottom <= card.top;
    });
    check("compact landscape combat step guide stays above the card rail", noticeGeometry);
    await checkStatusChipPointerTarget(compactRun.page, "compact landscape");
    await compactRun.page.screenshot({ path: resolve(outputDir, "combat-compact-landscape.png"), fullPage: false });
  } finally {
    collectErrors(compactRun.errors);
    await compactRun.context.close();
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
      "character-select-compact-landscape.png",
      "combat-compact-landscape.png",
    ],
    viewports: {
      desktop: { width: 1600, height: 900 },
      desktopCompact: { width: 1366, height: 768 },
      reference: { width: 1280, height: 720 },
      mobileLandscape: { width: 932, height: 430 },
      mobileLandscapeCompact: { width: 844, height: 390 },
      compactLandscape: { width: 740, height: 360 },
    },
    checks: {
      title: ["continue-disabled-without-save", "new-run", "tutorial", "settings"],
      run: [
        "character-select",
        "node-map",
        "immediate-repeat-use",
        "mobile-immediate-use",
        "socket-hit-area",
        "socket-title-separation",
        "combat-step-guide",
        "empty-socket-feedback",
        "face-forecast-load-unload",
        "resolution-skill-coin-labels",
        "resolution-clears-on-next-interaction",
        "enemy-action-banner",
        "status-chip-pointer-target",
        "explicit-end-turn",
        "passive-inventory",
      ],
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
