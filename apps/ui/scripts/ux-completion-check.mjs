import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const rootUrl =
  process.env.UX_COMPLETION_BASE_URL ??
  "http://127.0.0.1:5173/deckbuilding-roguelite/";
const url = `${rootUrl}?seed=BRAVE-EMBER-42`;
const screenshotDir = resolve(".omx/reports/task56-screenshots");
mkdirSync(screenshotDir, { recursive: true });

const browser = await chromium.launch();
const failures = [];
const check = (name, condition, detail = "") => {
  console.log(`[${condition ? "ok" : "FAIL"}] ${name}${detail ? ` - ${detail}` : ""}`);
  if (!condition) failures.push(name);
};

const boot = async (viewport, preferences, reducedMotion = "no-preference") => {
  const context = await browser.newContext({ viewport, reducedMotion });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const nativeTimeout = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay = 0, ...args) =>
      nativeTimeout(callback, Number(delay) === 7000 ? 80 : delay, ...args);
  });
  if (preferences !== undefined) {
    await page.addInitScript((value) => {
      localStorage.setItem(
        "deckbuilding-roguelite.combat-preferences",
        JSON.stringify({ version: 1, ...value }),
      );
    }, preferences);
  }
  await page.goto(url, { waitUntil: "networkidle" });
  await page.locator("main.combat-shell").waitFor();
  return { context, page };
};

try {
  {
    const { context, page } = await boot({ width: 1280, height: 720 });
    await page.screenshot({ path: resolve(screenshotDir, "default.png"), fullPage: true });
    check("current-turn summary is visible", await page.getByTestId("turn-resource-summary").isVisible());
    check("recommended load control is visible", await page.getByTestId("recommended-load-open").isVisible());
    await page.getByTestId("recommended-load-open").click();
    check("recommended load requires a preview", await page.getByTestId("recommended-load-preview").isVisible());
    await page.getByTestId("recommended-load-confirm").click();
    const phaseAfter = await page.locator("main.combat-shell").getAttribute("data-auto-turn-end-phase");
    check(
      "recommendation never fires a skill",
      (await page.locator(".socket.loaded").count()) > 0 &&
        phaseAfter === "idle" &&
        (await page.locator(".skill-card.resolving, .socket-coin.flipping, .resolution-ticket").count()) === 0 &&
        /전투 기록\s*0/.test(await page.getByTestId("combat-history").locator("summary").innerText()),
      `phase=${phaseAfter}`,
    );

    await page.getByTestId("combat-help-open").click();
    const help = await page.getByTestId("combat-help").innerText();
    check("persistent combat help covers the full flow", ["장전", "실행 순서", "자동", "대상", "보존", "쿨타임", "상태"].every((term) => help.includes(term)), help);
    await page.keyboard.press("Escape");
    check("non-modal combat help closes with Escape", (await page.getByTestId("combat-help").count()) === 0);

    await page.getByTestId("combat-preferences-open").click();
    check("only one flip-speed control exists", (await page.getByTestId("flip-speed").count()) === 1);
    check("legacy mute control is removed", (await page.getByTestId("mute-toggle").count()) === 0);
    await page.getByTestId("preference-high-contrast").check();
    await page.screenshot({ path: resolve(screenshotDir, "high-contrast.png"), fullPage: true });
    await page.getByTestId("preference-background-effects").selectOption("reduced");
    await page.getByTestId("preference-reduced-motion").check();
    check("preferences apply through root data attributes", await page.locator("main.combat-shell[data-high-contrast='true'][data-background-effects='reduced'][data-reduced-motion='true']").isVisible());
    await page.screenshot({ path: resolve(screenshotDir, "reduced-effects.png"), fullPage: true });
    await context.close();
  }

  {
    const { context, page } = await boot({ width: 390, height: 844 });
    await page.getByTestId("combat-help-open").click();
    await page.getByTestId("combat-preferences-open").click();
    check(
      "mobile help and settings are mutually exclusive",
      (await page.getByTestId("combat-help").count()) === 0 &&
        (await page.getByTestId("combat-preferences-panel").isVisible()),
    );
    await page.getByRole("button", { name: "전투 설정 닫기" }).click();
    await context.close();
  }

  {
    const { context, page } = await boot({ width: 1280, height: 720 });
    await page.locator(".hand-tray .coin").first().click();
    await page.locator(".skill-card").nth(1).locator(".socket").click();
    await page.locator(".skill-card").nth(1).locator(".card-action").click();
    await page.locator("[data-testid='combat-history'] li:not(.empty)").waitFor({ state: "attached", timeout: 15000 });
    await page.locator(".resolution-ticket").waitFor({ state: "detached", timeout: 5000 });
    const history = page.getByTestId("combat-history");
    check("combat history survives the temporary resolution ticket", (await history.locator("li:not(.empty)").count()) === 1);
    const summary = history.locator("summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    check("combat history is keyboard accessible", await history.evaluate((element) => element.hasAttribute("open")));
    check("combat history list is scrollable and bounded", await history.locator("ol").evaluate((element) => getComputedStyle(element).overflowY === "auto" && getComputedStyle(element).maxHeight !== "none"));
    await context.close();
  }

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    const { context, page } = await boot(viewport);
    const rail = page.getByTestId("mobile-coin-rail");
    check(`${viewport.width}x${viewport.height} mobile coin rail visible`, await rail.isVisible());
    const targetSizes = await page.evaluate(() =>
      ["combat-help-open", "combat-preferences-open", "coin-rail-prev", "coin-rail-next"].map((testId) => {
        const rect = document.querySelector(`[data-testid='${testId}']`)?.getBoundingClientRect();
        return { testId, width: rect?.width ?? 0, height: rect?.height ?? 0 };
      }),
    );
    check("mobile utility and navigation targets are at least 44x44", targetSizes.every(({ width, height }) => width >= 44 && height >= 44), JSON.stringify(targetSizes));
    check("mobile turn summary text is at least 12px", await page.getByTestId("turn-resource-summary").evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize) >= 12));
    check("coin rail position count visible", /\d+\s*\/\s*\d+/.test(await page.getByTestId("coin-rail-position").innerText()));
    check("coin rail left boundary disabled", await page.getByTestId("coin-rail-prev").isDisabled());
    const next = page.getByTestId("coin-rail-next");
    const hasOverflow = await page.locator(".hand-tray").evaluate((element) => element.scrollWidth > element.clientWidth + 1);
    if (hasOverflow && !(await next.isDisabled())) {
      const before = await page.getByTestId("coin-rail-position").innerText();
      await next.click();
      await page.waitForFunction((previous) => document.querySelector("[data-testid='coin-rail-position']")?.textContent !== previous, before);
    }
    check("coin rail move state matches overflow", hasOverflow ? !(await page.getByTestId("coin-rail-prev").isDisabled()) : await next.isDisabled());
    for (let index = 0; index < 12 && !(await next.isDisabled()); index += 1) {
      const before = await page.getByTestId("coin-rail-position").innerText();
      await next.click();
      await page.waitForFunction((previous) => document.querySelector("[data-testid='coin-rail-position']")?.textContent !== previous, before);
    }
    check("coin rail right boundary disables", await next.isDisabled());
    check("mobile viewport has no page-level horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await page.screenshot({ path: resolve(screenshotDir, `${viewport.width}x${viewport.height}.png`), fullPage: true });
    await context.close();
  }


  {
    const { context, page } = await boot({ width: 390, height: 844 }, undefined, "reduce");
    await page.evaluate(() => {
      window.__coinScrollBehaviors = [];
      const original = HTMLElement.prototype.scrollTo;
      HTMLElement.prototype.scrollTo = function scrollTo(options) {
        if (this.classList.contains("hand-tray") && typeof options === "object") {
          window.__coinScrollBehaviors.push(options.behavior);
        }
        return original.call(this, options);
      };
    });
    await page.getByTestId("coin-rail-next").click();
    check(
      "OS reduced motion forces programmatic coin scrolling to auto",
      await page.evaluate(() => window.__coinScrollBehaviors.at(-1) === "auto"),
    );
    await context.close();
  }
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(`FAIL ${failures.length}: ${failures.join(", ")}`);
  process.exit(1);
}

console.log("ux-completion-check passed");
