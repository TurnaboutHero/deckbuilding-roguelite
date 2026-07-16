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

const boot = async (url = URL, compressTimers = true, autoExecute = true) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
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
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    const source = message.location().url;
    if (
      message.type() === "error" &&
      !source.endsWith("/favicon.ico") &&
      !message.text().includes("ERR_NO_BUFFER_SPACE")
    )
      errors.push("console: " + message.text());
  });
  if (autoExecute)
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
  await page.locator(".hand-tray .coin").first().click();
  await card(page, cardIndex).locator(".socket").nth(socketIndex).click();
};

const useLoadedCard = async (page, cardIndex) => {
  const action = card(page, cardIndex).locator(".card-action");
  check(
    "\uC7A5\uC804 \uC644\uB8CC \uD6C4\uC5D0\uB3C4 \uC218\uB3D9 \uC0AC\uC6A9 \uBC84\uD2BC \uC720\uC9C0",
    /\uC2A4\uD0AC \uC0AC\uC6A9/.test(await action.innerText()) && !(await action.isDisabled()),
  );
  await action.click();
  await waitReady(page);
};
const chipText = async (page) =>
  page.locator(".rejection-chip").last().innerText({ timeout: 2000 });

try {
  {
    const { page, errors } = await boot(URL, true, false);
    await placeInto(page, 0);
    const action = card(page, 0).locator(".card-action");
    check(
      "\uC218\uB3D9 \uAE30\uBCF8 \uBAA8\uB4DC\uC5D0\uC11C \uC7A5\uC804 \uC2A4\uD0AC \uBC84\uD2BC \uD65C\uC131",
      /\uC2A4\uD0AC \uC0AC\uC6A9/.test(await action.innerText()) && !(await action.isDisabled()),
    );
    check(
      "\uC218\uB3D9 \uAE30\uBCF8 \uBAA8\uB4DC\uC758 \uD134 \uC885\uB8CC \uB808\uC774\uBE14",
      (await page.locator(".end-turn").innerText()) === "\uD134 \uC885\uB8CC",
    );
    await page.locator(".end-turn").click();
    await page.getByTestId("turn-end-warning").waitFor({ state: "visible" });
    check(
      "\uBBF8\uC0AC\uC6A9 \uC7A5\uC804 \uC2A4\uD0AC\uC774 \uC788\uC744 \uB54C\uB9CC \uACBD\uACE0",
      (await card(page, 0).locator(".socket.loaded").count()) === 1,
    );
    await page.getByRole("button", { name: "\uB3CC\uC544\uAC00\uAE30", exact: true }).click();
    await action.click();
    await waitReady(page);
    check(
      "\uACBD\uACE0 \uCDE8\uC18C \uD6C4 \uC218\uB3D9 \uC0AC\uC6A9",
      (await card(page, 0).locator(".socket.loaded").count()) === 0,
    );
    check("\uC218\uB3D9 \uBAA8\uB4DC \uC624\uB958 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  {
    const { page, errors } = await boot(URL, true, false);
    await placeInto(page, 0);
    await page.locator(".end-turn").click();
    await page.getByTestId("turn-end-warning-remember").check();
    await page.getByTestId("turn-end-warning-confirm").click();
    await waitReady(page);
    check(
      "\uACBD\uACE0\uC5D0\uC11C \uC55E\uC73C\uB85C \uC790\uB3D9 \uC2E4\uD589 \uC800\uC7A5",
      (await page.locator("main").getAttribute("data-auto-execute-loaded")) === "true",
    );
    const savedAutoExecution = await page.evaluate(() => {
      const raw = localStorage.getItem("deckbuilding-roguelite.combat-preferences");
      return raw !== null && JSON.parse(raw).autoExecuteLoadedSkills === true;
    });
    check(
      "\uC790\uB3D9 \uC2E4\uD589 \uC124\uC815 \uC800\uC7A5\uC18C \uC720\uC9C0",
      savedAutoExecution,
    );
    check("\uC790\uB3D9 \uBAA8\uB4DC \uC800\uC7A5 \uC624\uB958 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  {
    const { page, errors } = await boot(URL, true, false);
    await placeInto(page, 0);
    await page.locator(".end-turn").click();
    await page.getByTestId("turn-end-warning-discard").click();
    await waitReady(page);
    check(
      "\uC0AC\uC6A9\uD558\uC9C0 \uC54A\uACE0 \uD134 \uC885\uB8CC \uC120\uD0DD",
      (await page.getByTestId("turn-end-warning").count()) === 0 &&
        (await card(page, 0).locator(".socket.loaded").count()) === 0,
    );
    check("\uBBF8\uC0AC\uC6A9 \uC885\uB8CC \uC624\uB958 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  {
    const { page, errors } = await boot();
    await placeInto(page, 0);
    await placeInto(page, 1);
    const rail = page.getByTestId("execution-rail");
    check("완전 장전 2개 실행 레일 표시", (await rail.locator("li").count()) === 2);
    check(
      "턴 종료 기본 동작이 일괄 실행으로 표시",
      /\uC2A4\uD0AC 2\uAC1C \uC790\uB3D9 \uC2E4\uD589 \uD6C4 \uD134 \uC885\uB8CC/.test(await page.locator(".end-turn").innerText()),
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
    check("자동 실행 순서 시나리오 에러 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  for (const speed of ["normal", "fast"]) {
    const { page, errors } = await boot();
    await setFlipSpeed(page, speed);
    await placeInto(page, 0);
    await page.locator(".end-turn").click();
    await waitReady(page);
    check(
      `${speed} 모드 자동 실행 완료`,
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
      "다중 적 자동 실행이 대상 선택에서 일시정지",
      (await page.locator("main").getAttribute("data-auto-turn-end-phase")) === "choosing",
    );
    await page.locator(".unit.enemy.targetable .sprite").last().click();
    await waitReady(page);
    check(
      "대상 선택 뒤 같은 큐가 1회 재개",
      (await card(page, 0).locator(".socket.loaded").count()) === 0 &&
        (await page.locator(".targeting-prompt").count()) === 0,
    );
    check("대상 선택 자동 실행 에러 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  {
    const { page, errors } = await boot(`${URL}&skills=burning-fist&encounter=raider`);
    await placeInto(page, 0);
    check(
      "부분 장전은 실행 순서에서 제외되고 명시적으로 표시",
      (await page.getByTestId("execution-rail").count()) === 0 &&
        /미완료/.test(await card(page, 0).locator(".execution-partial-badge").innerText()) &&
        (await page.locator(".end-turn").innerText()) === "턴 종료",
    );
    check("부분 장전 시나리오 에러 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  {
    const { page, errors } = await boot(`${URL}&skills=furnace&encounter=raider`);
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
        (await card(page, 1).locator(".card-action").isDisabled()),
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
    check("코인 선택 자동 실행 에러 0", errors.length === 0, errors.join(" | "));
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
    check("장비·소환 자동 실행 에러 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  {
    const url = `${URL}&character=warrior&skills=arcane-command&encounter=raider`;
    const { page, errors } = await boot(url);
    await placeInto(page, 0, 0);
    await placeInto(page, 0, 1);
    await page.locator(".end-turn").click();
    await page.waitForFunction(
      () => document.querySelector("main")?.getAttribute("data-auto-turn-end-phase") === "blocked",
    );
    check(
      "불법 큐 스킬을 건너뛰지 않고 복구 UI 표시",
      (await page.locator(".execution-blocked").count()) === 1 &&
        (await card(page, 0).locator(".socket.loaded").count()) === 2,
    );
    await page.getByRole("button", { name: "남은 스킬 건너뛰고 종료" }).click();
    await waitReady(page);
    check(
      "blocked 건너뛰기 선택은 보존/턴 종료로 진행",
      (await card(page, 0).locator(".socket.loaded").count()) === 0,
    );
    check("blocked 복구 에러 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  {
    const url = `${URL}&skills=comet-blow,jab&encounter=slime`;
    const { page, errors } = await boot(url, false);
    await setFlipSpeed(page, "instant");
    for (let socketIndex = 0; socketIndex < 4; socketIndex += 1)
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
      (await card(page, 1).locator(".socket.loaded").count()) === 1 &&
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
    check("자동 실행 취소 에러 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  {
    const { page, errors } = await boot();
    await placeInto(page, 2, 0);
    await placeInto(page, 2, 1);
    await useLoadedCard(page, 2);
    const text = await card(page, 2).locator(".card-action").innerText();
    check("자동 실행 후 장전 상태 초기화", /동전 0\/2|재사용까지/.test(text), text);
    check("자동 실행 후 셸 생존", await shellAlive(page));
    check("자동 실행 단일 카드 시나리오 에러 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
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
      "불타는 일격 프리뷰 코인 생성",
      /코인 생성/.test(strikePreview),
      strikePreview,
    );

    await placeInto(page, 0);
    const slashPreviewTip = page.locator("#skill-preview-0");
    await page.mouse.move(0, 0);
    await card(page, 0).hover();
    await slashPreviewTip.waitFor({ state: "visible" });
    const slashPreview = await slashPreviewTip.innerText();
    check("공격 프리뷰 자해 없음", !/자해/.test(slashPreview), slashPreview);
    check("프리뷰 시나리오 에러 0", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  {
    const { page, errors } = await boot(`${URL}&character=frost-knight`);
    await placeInto(page, 0);
    check(
      "냉기 도적도 장전 스킬 실행 대기 표시",
      (await page.getByTestId("execution-rail").count()) === 1 &&
        /\uC2A4\uD0AC \uC0AC\uC6A9/.test(await card(page, 0).locator(".card-action").innerText()),
    );
    await page.locator(".end-turn").click();
    await page.locator(".preserve-picker").waitFor({ state: "visible" });
    check(
      "자동 실행 뒤 기존 보존 선택 흐름으로 일시정지",
      (await card(page, 0).locator(".socket.loaded").count()) === 0 &&
        (await page.locator("main").getAttribute("data-auto-turn-end-phase")) === "preserving",
    );
    check(
      "보존 단계에 자동 턴 종료 취소가 명시적으로 표시",
      (await page.getByRole("button", { name: "자동 턴 종료 취소" }).count()) >= 1,
    );
    await page.locator(".end-turn").click();
    await waitReady(page);
    check(
      "보존 확정 뒤 자동 턴 종료 완료",
      (await page.locator(".preserve-picker").count()) === 0,
    );
    check(
      "자동 실행 보존 시나리오 에러 0",
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
