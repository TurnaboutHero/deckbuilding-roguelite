// 거부 사유·프리뷰 축 브라우저 검증. 전제: `pnpm -F @game/ui build`.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEED = "BRAVE-EMBER-42";
const baseUrl =
  process.env.FEEDBACK_CHECK_BASE_URL ??
  "http://127.0.0.1:4180/deckbuilding-roguelite/";
const URL = `${baseUrl}?seed=${SEED}`;

const failures = [];
const check = (name, condition, detail = "") => {
  const mark = condition ? "ok" : "FAIL";
  console.log(`[${mark}] ${name}${detail === "" ? "" : ` — ${detail}`}`);
  if (!condition)
    failures.push(`${name}${detail === "" ? "" : ` — ${detail}`}`);
};

const server =
  process.env.FEEDBACK_CHECK_BASE_URL === undefined
    ? await (
        await import("vite")
      ).preview({
        root,
        preview: { host: "127.0.0.1", port: 4180, strictPort: true },
      })
    : null;

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_EXECUTABLE_PATH === undefined
    ? {}
    : { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH },
);

const boot = async () => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const nativeTimeout = window.setTimeout.bind(window);
    // 거부 칩 수명(1500ms)만 판독 가능한 250ms로 축소 보존하고 나머지는 12ms 압축 —
    // 전역 12ms는 칩 해제를 같은 React 커밋 창에 밀어넣어 칩이 DOM에 닿지 못하게 한다
    window.setTimeout = (callback, delay = 0, ...args) => {
      const ms = Number(delay);
      const mapped = ms === 1500 ? 250 : Math.min(ms, 12);
      return nativeTimeout(callback, mapped, ...args);
    };
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    const source = message.location().url;
    if (message.type() === "error" && !source.endsWith("/favicon.ico"))
      errors.push(`console: ${message.text()}`);
  });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () =>
      document.querySelector(".end-turn:not(:disabled)") !== null &&
      document.querySelector(".float-text") === null,
    undefined,
    { timeout: 15000 },
  );
  return { page, errors };
};

const shellAlive = (page) =>
  page.evaluate(() => document.querySelector("main.combat-shell") !== null);

const waitReady = (page) =>
  page.waitForFunction(
    () =>
      document.querySelector(".end-turn:not(:disabled)") !== null &&
      document.querySelector(
        ".float-text, .skill-card.resolving, .socket-coin.flipping",
      ) === null,
    undefined,
    { timeout: 15000 },
  );

const card = (page, index) => page.locator(".skill-card").nth(index);

const placeInto = async (page, cardIndex, socketIndex = 0) => {
  await page.locator(".hand-tray .coin").first().click();
  await card(page, cardIndex).locator(".socket").nth(socketIndex).click();
};

const useLoadedCard = async (page, cardIndex) => {
  await card(page, cardIndex).locator(".card-title").click();
  await waitReady(page);
};

const chipText = async (page) =>
  page.locator(".rejection-chip").last().innerText({ timeout: 2000 });

try {
  {
    const { page, errors } = await boot();
    await placeInto(page, 0);
    await useLoadedCard(page, 0);
    await placeInto(page, 1);
    await useLoadedCard(page, 1);
    await placeInto(page, 3);
    await useLoadedCard(page, 3);

    await placeInto(page, 5);
    await card(page, 5).locator(".card-title").click({ force: true });
    const text = await chipText(page);
    check("턴 3회 캡 사유 표시", /턴당 3회/.test(text), text);
    check("캡 거부 후 셸 생존", await shellAlive(page));
    check("캡 시나리오 에러 0", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  {
    const { page, errors } = await boot();
    await placeInto(page, 0);
    await page.locator(".hand-tray .coin").first().click();
    await card(page, 0).locator(".card-art").click();
    const text = await chipText(page);
    check("가득 찬 소켓 사유 표시", /소켓.*가득/.test(text), text);
    check("소켓 거부 후 셸 생존", await shellAlive(page));
    check("소켓 시나리오 에러 0", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  {
    const { page, errors } = await boot();
    await placeInto(page, 5);
    const rampagePreview = await card(page, 5)
      .locator(".preview-tip")
      .innerText({ timeout: 2000 });
    check("화염 폭주 프리뷰 자해", /자해/.test(rampagePreview), rampagePreview);
    check(
      "화염 폭주 프리뷰 코인 생성",
      /코인 생성/.test(rampagePreview),
      rampagePreview,
    );

    await placeInto(page, 0);
    const slashPreview = await card(page, 0)
      .locator(".preview-tip")
      .innerText({ timeout: 2000 });
    check("베기 프리뷰 자해 없음", !/자해/.test(slashPreview), slashPreview);
    check("프리뷰 시나리오 에러 0", errors.length === 0, errors.join(" | "));
    await page.close();
  }
} finally {
  await browser.close();
  await server?.httpServer.close();
}

if (failures.length > 0) {
  console.error(`\nFAIL ${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("\nfeedback-check passed");
