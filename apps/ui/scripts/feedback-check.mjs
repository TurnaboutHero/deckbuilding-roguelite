// 거부 사유·프리뷰 축 브라우저 검증. 전제: `pnpm -F @game/ui build`.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { capturePlaytestDiagnostics } from "./playtest-diagnostics.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEED = "BRAVE-EMBER-42";
const baseUrl =
  process.env.FEEDBACK_CHECK_BASE_URL ??
  "http://127.0.0.1:4180/deckbuilding-roguelite/";
const URL = `${baseUrl}?seed=${SEED}`;

const failures = [];
const consoleErrors = [];
const pageErrors = [];
let diagnosticPage;
let runFailure;
const check = (name, condition, detail = "") => {
  const mark = condition ? "ok" : "FAIL";
  console.log(`[${mark}] ${name}${detail === "" ? "" : ` — ${detail}`}`);
  if (!condition)
    failures.push(`${name}${detail === "" ? "" : ` — ${detail}`}`);
};

let server;
let browser;

const boot = async (url = URL, compressTimers = true, legacyAutoExecution = false) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  diagnosticPage = page;
  if (compressTimers)
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
  page.on("pageerror", (error) => {
    const message = `pageerror: ${error.message}`;
    errors.push(message);
    pageErrors.push(message);
  });
  page.on("console", (message) => {
    const source = message.location().url;
    if (
      message.type() === "error" &&
      !source.endsWith("/favicon.ico") &&
      !message.text().includes("ERR_NO_BUFFER_SPACE")
    ) {
      const text = "console: " + message.text();
      errors.push(text);
      consoleErrors.push(text);
    }
  });
  if (legacyAutoExecution)
    await page.addInitScript(() => {
      localStorage.setItem(
        "deckbuilding-roguelite.combat-preferences",
        JSON.stringify({ version: 1, autoExecuteLoadedSkills: true }),
      );
    });
  await page.goto(url, { waitUntil: "networkidle" });
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

const setFlipSpeed = async (page, speed) => {
  const control = page.getByTestId("flip-speed");
  if (!(await control.isVisible())) await page.getByTestId("combat-preferences-open").click();
  await control.selectOption(speed);
};

const placeInto = async (page, cardIndex, socketIndex = 0) => {
  const basic = page.locator(
    ".hand-tray .coin:not(.fire):not(.mana):not(.frost):not(.lightning):not(.blood):not(.granted-fire)",
  );
  if ((await basic.count()) > 0) await basic.first().click();
  else await page.locator(".hand-tray .coin").first().click();
  await card(page, cardIndex).locator(".socket").nth(socketIndex).click();
};

const confirmLoadedCards = async (page) => {
  await page.locator(".end-turn").click();
  await waitReady(page);
};
const chipText = async (page) =>
  page.locator(".rejection-chip").last().innerText({ timeout: 2000 });

try {
  server =
    process.env.FEEDBACK_CHECK_BASE_URL === undefined
      ? await (
          await import("vite")
        ).preview({
          root,
          preview: { host: "127.0.0.1", port: 4180, strictPort: true },
        })
      : null;
  browser = await chromium.launch(
    process.env.PLAYWRIGHT_EXECUTABLE_PATH === undefined
      ? {}
      : { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH },
  );
  {
    const { page, errors } = await boot();
    const beforeConfirm = {
      enemyHp: await page.locator(".unit.enemy .hp-num").innerText(),
      playerHp: await page.locator(".unit.player .hp-num").innerText(),
      history: await page.getByTestId("combat-history").innerText(),
    };
    await placeInto(page, 0);
    check(
      "플립 스킬별 수동 사용 버튼 제거",
      (await card(page, 0).locator(".card-action").count()) === 0,
    );
    check(
      "전역 확정 전에는 장전 상태 유지",
      (await card(page, 0).locator(".socket.loaded").count()) === 1 &&
        (await page.locator(".end-turn").innerText()) === "행동 확정 · 스킬 1개",
    );
    check(
      "전역 확정 전에는 전투 상태를 변경하지 않음",
      (await page.locator(".unit.enemy .hp-num").innerText()) === beforeConfirm.enemyHp &&
        (await page.locator(".unit.player .hp-num").innerText()) === beforeConfirm.playerHp &&
        (await page.getByTestId("combat-history").innerText()) === beforeConfirm.history &&
        (await page.locator(".resolution-ticket").count()) === 0,
    );
    await confirmLoadedCards(page);
    check(
      "전역 확정 뒤 장전 스킬 순차 판정",
      (await card(page, 0).locator(".socket.loaded").count()) === 0,
    );
    check("전역 확정 기본 흐름 오류 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  {
    const { page, errors } = await boot(URL, true, true);
    await placeInto(page, 0);
    check(
      "레거시 자동 실행 키는 UI 동작에 영향 없음",
      (await page.locator("main").getAttribute("data-auto-execute-loaded")) === null &&
        (await page.getByTestId("preference-auto-execute").count()) === 0 &&
        (await page.locator(".end-turn").innerText()) === "행동 확정 · 스킬 1개",
    );
    await setFlipSpeed(page, "fast");
    const legacyKeyRemovedOnSave = await page.evaluate(() => {
      const raw = localStorage.getItem("deckbuilding-roguelite.combat-preferences");
      return raw !== null && !("autoExecuteLoadedSkills" in JSON.parse(raw));
    });
    check(
      "레거시 자동 실행 키는 다음 저장에서 제거",
      legacyKeyRemovedOnSave,
    );
    await confirmLoadedCards(page);
    check("레거시 설정 호환 오류 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  {
    const { page, errors } = await boot(`${URL}&skills=burning-fist&encounter=raider`);
    await placeInto(page, 0, 0);
    check(
      "부분 장전은 전역 확정 예약에서 제외",
      (await page.getByTestId("execution-rail").count()) === 0 &&
        (await page.locator(".end-turn").innerText()) === "행동 확정",
    );
    await confirmLoadedCards(page);
    await waitReady(page);
    check(
      "부분 장전은 기존 턴 종료 회수·버림 적용",
      (await card(page, 0).locator(".socket.loaded").count()) === 0,
    );
    check("부분 장전 확정 오류 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  {
    const { page, errors } = await boot();
    await placeInto(page, 0);
    await placeInto(page, 1);
    const rail = page.getByTestId("execution-rail");
    check("완전 장전 2개 실행 레일 표시", (await rail.locator("li").count()) === 2);
    check(
      "전역 확정 버튼에 실행 스킬 수 표시",
      (await page.locator(".end-turn").innerText()) === "행동 확정 · 스킬 2개",
    );
    const beforeOrder = await rail.locator(".execution-name").allInnerTexts();
    await rail.locator("li").first().getByRole("button", { name: /뒤로/ }).click();
    const afterOrder = await rail.locator(".execution-name").allInnerTexts();
    check(
      "명시적 뒤로 제어로 실행 순서 변경",
      beforeOrder.length === 2 && afterOrder[0] === beforeOrder[1] && afterOrder[1] === beforeOrder[0],
      `${beforeOrder.join(" > ")} -> ${afterOrder.join(" > ")}`,
    );
    await setFlipSpeed(page, "instant");
    await page.locator(".end-turn").click();
    await waitReady(page);
    check(
      "즉시 모드에서도 두 장전 스킬 순차 소진",
      (await card(page, 0).locator(".socket.loaded").count()) === 0 &&
        (await card(page, 1).locator(".socket.loaded").count()) === 0,
    );
    check("확정 실행 순서 시나리오 에러 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  for (const speed of ["normal", "fast"]) {
    const { page, errors } = await boot();
    await setFlipSpeed(page, speed);
    await placeInto(page, 0);
    await page.locator(".end-turn").click();
    await waitReady(page);
    check(
      `${speed} 모드 확정 실행 완료`,
      (await card(page, 0).locator(".socket.loaded").count()) === 0,
    );
    check(`${speed} 모드 에러 0`, errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  {
    const { page, errors } = await boot(`${URL}&encounter=duo-raiders`);
    await placeInto(page, 0);
    await page.locator(".end-turn").click();
    await page.locator(".targeting-prompt").waitFor({ state: "visible" });
    check(
      "다중 적 확정 실행이 대상 선택에서 일시정지",
      (await page.locator("main").getAttribute("data-auto-turn-end-phase")) === "choosing",
    );
    await page.locator(".unit.enemy.targetable .sprite").last().click();
    await waitReady(page);
    check(
      "대상 선택 뒤 같은 큐가 1회 재개",
      (await card(page, 0).locator(".socket.loaded").count()) === 0 &&
        (await page.locator(".targeting-prompt").count()) === 0,
    );
    check("대상 선택 확정 실행 에러 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  {
    const { page, errors } = await boot(`${URL}&skills=burning-fist&encounter=raider`);
    await placeInto(page, 0);
    check(
      "부분 장전은 실행 순서에서 제외되고 명시적으로 표시",
      (await page.getByTestId("execution-rail").count()) === 0 &&
        /미완료/.test(await card(page, 0).locator(".execution-partial-badge").innerText()) &&
        (await page.locator(".end-turn").innerText()) === "행동 확정",
    );
    check("부분 장전 시나리오 에러 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  {
    const { page, errors } = await boot(
      `${baseUrl}?seed=FURNACE-10&skills=furnace&encounter=raider`,
    );
    const basicCoin = page.locator(
      ".hand-tray .coin:not(.fire):not(.mana):not(.frost):not(.lightning):not(.granted-fire)",
    );
    await basicCoin.first().click();
    await card(page, 0).locator(".socket").click();
    await page.locator(".end-turn").click();
    await page.waitForFunction(
      () => document.querySelector("main")?.getAttribute("data-auto-turn-end-phase") === "choosing",
    );
    const validChoice = page.locator(".hand-tray .coin.fuel-valid").first();
    check(
      "코인 선택 중에는 합법 코인과 현재 카드 확정만 활성",
      (await validChoice.count()) === 1 &&
        !(await validChoice.isDisabled()) &&
        !(await card(page, 0).locator(".card-action").isDisabled()) &&
        (await card(page, 1).locator(".card-action").count()) === 0,
    );
    const invalidHand = page.locator(".hand-tray .coin:not(.fuel-valid)").first();
    if ((await invalidHand.count()) > 0) {
      const invalidState = await invalidHand.evaluate((button) => ({
        className: button.className,
        disabled: button instanceof HTMLButtonElement && button.disabled,
        phase: document.querySelector("main")?.getAttribute("data-auto-turn-end-phase"),
      }));
      check("코인 선택과 무관한 손패는 비활성", invalidState.disabled, JSON.stringify(invalidState));
    }
    await card(page, 0).locator(".card-action").click();
    await waitReady(page);
    check(
      "코인 선택 확정 뒤 자동 큐 재개",
      (await card(page, 0).locator(".socket.loaded").count()) === 0,
    );
    check("코인 선택 확정 실행 에러 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  {
    const url = `${URL}&character=arcanist&skills=arcane-charge,arcane-command&encounter=raider`;
    const { page, errors } = await boot(url);
    await placeInto(page, 0);
    await placeInto(page, 1, 0);
    await placeInto(page, 1, 1);
    await page.locator(".end-turn").click();
    await page.getByTestId("equipment-choice").waitFor({ state: "visible" });
    const equipmentIsolation = {
      activeDisabled: await card(page, 0).locator(".card-action").isDisabled(),
      queuedDisabled: await card(page, 1).locator(".card-action").isDisabled(),
      enabledHand: await page.locator(".hand-tray .coin:enabled").count(),
    };
    check(
      "장비 종류 선택 중 무관한 카드와 손패 비활성",
      equipmentIsolation.activeDisabled &&
        equipmentIsolation.queuedDisabled &&
        equipmentIsolation.enabledHand === 0,
      JSON.stringify(equipmentIsolation),
    );
    await page.getByTestId("equipment-choice-mana-sword").click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="summon-slot-0"]')?.getAttribute("data-selectable") === "true",
      undefined,
      { timeout: 15000 },
    );
    check(
      "장비 실행 뒤 기존 소환 선택에서 같은 큐 일시정지",
      (await page.locator("main").getAttribute("data-auto-turn-end-phase")) === "choosing" &&
        (await page.locator(".hand-tray .coin:enabled").count()) === 0,
    );
    await page.getByTestId("summon-slot-0").click();
    await waitReady(page);
    check(
      "장비→소환 선택 체인 완료",
      (await card(page, 0).locator(".socket.loaded").count()) === 0 &&
        (await card(page, 1).locator(".socket.loaded").count()) === 0,
    );
    check("장비·소환 확정 실행 에러 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  {
    const url = `${URL}&character=warrior&skills=arcane-command&encounter=raider`;
    const { page, errors } = await boot(url);
    await placeInto(page, 0, 0);
    await placeInto(page, 0, 1);
    check(
      "현재 불법인 완전 장전 스킬은 실행 순서에서 제외",
      (await page.getByTestId("execution-rail").count()) === 0 &&
        (await page.locator(".end-turn").innerText()) === "행동 확정",
    );
    await page.locator(".end-turn").click();
    await waitReady(page);
    check(
      "현재 불법 스킬 제외 뒤 일반 턴 종료",
      (await card(page, 0).locator(".socket.loaded").count()) === 0 &&
        (await page.locator("main").getAttribute("data-auto-turn-end-phase")) === "idle" &&
        (await page.locator(".execution-blocked").count()) === 0,
    );
    check("현재 불법 스킬 제외 에러 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  {
    const url = `${baseUrl}?seed=WINQ-32&skills=smash,jab&encounter=slime`;
    const { page, errors } = await boot(url, false);
    await setFlipSpeed(page, "instant");
    for (let socketIndex = 0; socketIndex < 2; socketIndex += 1)
      await placeInto(page, 0, socketIndex);
    await placeInto(page, 1);
    const playerHpBefore = await page.locator(".unit.player .hp-num").innerText();
    await page.locator(".end-turn").click();
    await page.waitForFunction(
      () => document.querySelector("main")?.getAttribute("data-auto-turn-end-phase") === "cancelled",
      undefined,
      { timeout: 15000 },
    );
    check(
      "첫 스킬 승리 시 남은 큐와 적 턴 즉시 중단",
      (await page.getByTestId("execution-rail").count()) === 0 &&
        (await page.locator(".unit.player .hp-num").innerText()) === playerHpBefore,
    );
    check("승리 단축 에러 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  {
    const { page, errors } = await boot(`${URL}&encounter=duo-raiders`);
    await placeInto(page, 0);
    const basicCoin = page.locator(
      ".hand-tray .coin:not(.fire):not(.mana):not(.frost):not(.lightning):not(.granted-fire)",
    );
    await basicCoin.first().click();
    await card(page, 1).locator(".socket").click();
    const rail = page.getByTestId("execution-rail");
    await rail.locator("li").first().getByRole("button", { name: /뒤로/ }).click();
    await page.waitForFunction(
      () => document.querySelector(".execution-rail .execution-name")?.textContent === "방어",
    );
    await page.locator(".end-turn").click();
    await page.locator(".unit.enemy.targetable .sprite").first().waitFor({ state: "visible" });
    await page.waitForFunction(
      () => document.querySelectorAll(".skill-card")[1]?.querySelectorAll(".socket.loaded").length === 0,
    );
    const currentBeforeCancel = await rail.locator("li.current .execution-name").allInnerTexts();
    await page.getByRole("button", { name: "남은 실행 취소" }).click();
    const cancelledState = {
      firstLoaded: await card(page, 0).locator(".socket.loaded").count(),
      defenseLoaded: await card(page, 1).locator(".socket.loaded").count(),
      phase: await page.locator("main").getAttribute("data-auto-turn-end-phase"),
      currentBeforeCancel,
    };
    check(
      "선택 중 취소는 완료 효과를 유지하고 남은 장전을 보존",
      cancelledState.defenseLoaded === 0 && cancelledState.firstLoaded === 1 && cancelledState.phase === "cancelled",
      JSON.stringify(cancelledState),
    );
    check("확정 실행 취소 에러 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  {
    const { page, errors } = await boot();

    await placeInto(page, 0);
    const slashPreviewTip = page.locator("#skill-preview-0");
    await page.mouse.move(0, 0);
    await card(page, 0).hover();
    await slashPreviewTip.waitFor({ state: "visible" });
    const slashPreview = await slashPreviewTip.innerText();
    check("공격 프리뷰 자해 없음", !/자해/.test(slashPreview), slashPreview);
    await card(page, 0).locator(".socket.loaded").click();

    await placeInto(page, 2, 0);
    await placeInto(page, 2, 1);
    await confirmLoadedCards(page);
    check(
      "확정 실행 후 장전 상태 초기화",
      (await card(page, 2).locator(".socket.loaded").count()) === 0,
    );
    check("확정 실행 후 셸 생존", await shellAlive(page));
    check("확정 실행 단일 카드 시나리오 에러 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  {
    const { page, errors } = await boot();
    await placeInto(page, 2, 0);
    await placeInto(page, 2, 1);
    await page.locator(".hand-tray .coin").first().click();
    await card(page, 2).locator(".card-art").click();
    const text = await chipText(page);
    check("제한 스킬의 가득 찬 소켓 사유 표시", /소켓.*가득/.test(text), text);
    check("소켓 거부 후 셸 생존", await shellAlive(page));
    check("소켓 시나리오 에러 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  {
    const { page, errors } = await boot();
    await placeInto(page, 2, 0);
    await placeInto(page, 2, 1);
    const strikePreviewTip = page.locator("#skill-preview-2");
    await page.mouse.move(0, 0);
    await card(page, 2).hover();
    await strikePreviewTip.waitFor({ state: "visible" });
    const strikePreview = await strikePreviewTip.innerText();
    check(
      "불타는 일격 프리뷰 자해 없음",
      !/자해/.test(strikePreview),
      strikePreview,
    );
    check(
      "불타는 일격 프리뷰 v1.2 화상 성공 단계",
      /화상/.test(strikePreview),
      strikePreview,
    );
    check(
      "불타는 일격 프리뷰 레거시 코인 생성 없음",
      !/코인 생성/.test(strikePreview),
      strikePreview,
    );
    check("프리뷰 시나리오 에러 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  {
    const { page, errors } = await boot(`${URL}&character=frost-knight`);
    await placeInto(page, 0);
    check(
      "냉기 도적도 장전 스킬 실행 대기 표시",
      (await page.getByTestId("execution-rail").count()) === 1 &&
        (await card(page, 0).locator(".card-action").count()) === 0,
    );
    await page.locator(".end-turn").click();
    await page.locator(".preserve-picker").waitFor({ state: "visible" });
    check(
      "확정 실행 뒤 기존 보존 선택 흐름으로 일시정지",
      (await card(page, 0).locator(".socket.loaded").count()) === 0 &&
        (await page.locator("main").getAttribute("data-auto-turn-end-phase")) === "preserving",
    );
    check(
      "보존 단계에 확정 흐름 취소가 명시적으로 표시",
      (await page.getByRole("button", { name: "확정 흐름 취소" }).count()) >= 1,
    );
    await page.locator(".end-turn").click();
    await waitReady(page);
    check(
      "보존 확정 뒤 자동 턴 종료 완료",
      (await page.locator(".preserve-picker").count()) === 0,
    );
    check(
      "확정 실행 보존 시나리오 에러 0",
      errors.length === 0,
      errors.join(" | "),
    );
    await page.context().close();
  }

  {
    const { page, errors } = await boot(`${URL}&character=frost-knight`);
    await placeInto(page, 0);
    await page.locator(".end-turn").click();
    await page.locator(".preserve-picker").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    check(
      "보존 Escape는 자동 흐름과 선택을 함께 취소",
      (await page.locator(".preserve-picker").count()) === 0 &&
        (await page.locator("main").getAttribute("data-auto-turn-end-phase")) === "cancelled",
    );
    check("보존 취소 에러 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }
  if (failures.length > 0) {
    throw new Error(`feedback-check FAIL (${failures.length})\n${failures.join("\n")}`);
  }
} catch (error) {
  runFailure = error;
  await capturePlaytestDiagnostics({
    baseUrl,
    browser,
    consoleErrors,
    failure: error,
    page: diagnosticPage,
    pageErrors,
    scriptName: "feedback-check",
  });
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server?.httpServer.close();
}

if (failures.length > 0) {
  console.error(`\nFAIL ${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
}

if (!runFailure) console.log("\nfeedback-check passed");
