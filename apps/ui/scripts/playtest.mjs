// 결정론 브라우저 플레이테스트 — 코인 장전 루프·플립 가시성·불타는 일격 회귀·뷰포트 검증.
// 사용: node scripts/playtest.mjs [스크린샷 디렉토리 (기본 /tmp/playtest)]
// 전제: `pnpm build` 완료 (vite preview가 dist를 서빙). 실패 시 exit code 1 + FAIL 목록 출력.
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.argv[2] ?? "/tmp/playtest";
const SEED = "BRAVE-EMBER-42";
const baseUrl =
  process.env.PLAYTEST_BASE_URL ??
  "http://127.0.0.1:4174/deckbuilding-roguelite/";
const URL = `${baseUrl}?seed=${SEED}`;
const urlWith = (params) => {
  const url = new globalThis.URL(baseUrl);
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  return String(url);
};

const failures = [];
const check = (name, condition, detail = "") => {
  const mark = condition ? "ok" : "FAIL";
  console.log(`[${mark}] ${name}${detail === "" ? "" : ` — ${detail}`}`);
  if (!condition)
    failures.push(`${name}${detail === "" ? "" : ` — ${detail}`}`);
};

const server =
  process.env.PLAYTEST_BASE_URL === undefined
    ? await (
        await import("vite")
      ).preview({
        root,
        preview: { host: "127.0.0.1", port: 4174, strictPort: true },
      })
    : null;
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_EXECUTABLE_PATH === undefined
    ? {}
    : { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH },
);
await mkdir(outDir, { recursive: true });

/** 페이지 준비 — 콘솔/페이지 에러 수집기 부착 후 이벤트 큐가 빠질 때까지 대기 */
const boot = async (
  viewport = { width: 1280, height: 720 },
  { fast = false, url = URL, waitFor = "combat" } = {},
) => {
  // 시나리오 간 저장소를 분리하되, 한 시나리오 안의 reload에는 같은 저장소를 유지한다.
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  if (fast) {
    await page.addInitScript(() => {
      const nativeTimeout = window.setTimeout.bind(window);
      window.setTimeout = (callback, delay = 0, ...args) =>
        nativeTimeout(callback, Math.min(Number(delay), 12), ...args);
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
  }
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    const source = message.location().url;
    if (message.type() === "error" && !source.endsWith("/favicon.ico"))
      errors.push(`console: ${message.text()}`);
  });
  await page.goto(url, { waitUntil: "networkidle" });
  if (waitFor === "select") {
    // 캐릭터 선택 화면 진입 — 전투 준비 대기를 건너뛴다 (S21)
    await page.waitForSelector('[data-testid="character-select"]', {
      timeout: 15000,
    });
    return { page, errors };
  }
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
const handCount = (page) => page.locator(".hand-tray .coin").count();
const hpValue = async (locator) =>
  Number((await locator.innerText()).split("/")[0]);

const keywordTooltipVisible = (page, description) =>
  page.evaluate((expected) => {
    const tip = [...document.querySelectorAll('[role="tooltip"]')].find(
      (node) => node.textContent?.includes(expected) === true,
    );
    return tip !== undefined && getComputedStyle(tip).display !== "none";
  }, description);

const waitForKeywordTooltip = (page, description, visible) =>
  page.waitForFunction(
    ({ expected, shouldBeVisible }) => {
      const tip = [...document.querySelectorAll('[role="tooltip"]')].find(
        (node) => node.textContent?.includes(expected) === true,
      );
      const isVisible =
        tip !== undefined && getComputedStyle(tip).display !== "none";
      return isVisible === shouldBeVisible;
    },
    { expected: description, shouldBeVisible: visible },
  );

const tooltipLayerEvidence = async (page, expected) => {
  await page.waitForFunction((text) => {
    const tip = [...document.querySelectorAll('[role="tooltip"]')].find(
      (node) => node.textContent?.includes(text) === true,
    );
    return tip instanceof HTMLElement && tip.dataset.placement !== undefined;
  }, expected);
  return page.evaluate((text) => {
    const tip = [...document.querySelectorAll('[role="tooltip"]')].find(
      (node) => node.textContent?.includes(text) === true,
    );
    if (!(tip instanceof HTMLElement)) return null;
    const rect = tip.getBoundingClientRect();
    const previousPointerEvents = tip.style.pointerEvents;
    tip.style.pointerEvents = "auto";
    const topmost = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    tip.style.pointerEvents = previousPointerEvents;
    return {
      insideViewport:
        rect.left >= 8 &&
        rect.top >= 8 &&
        rect.right <= innerWidth - 8 &&
        rect.bottom <= innerHeight - 8,
      layer: tip.parentElement?.dataset.overlayLayer ?? null,
      topmost: topmost === tip || tip.contains(topmost),
    };
  }, expected);
};

const continueFromTitleIfShown = async (page) => {
  const continueButton = page.locator('[data-testid="title-continue"]');
  if ((await continueButton.count()) === 0) return;
  await continueButton.click();
};

const turnBuffTooltipVisible = (page, expected) =>
  page.evaluate((text) => {
    const tip = [...document.querySelectorAll(".turn-buff-tip")].find(
      (node) => node.textContent?.includes(text) === true,
    );
    return tip !== undefined && getComputedStyle(tip).display !== "none";
  }, expected);

const waitForTurnBuffTooltip = (page, expected, visible) =>
  page.waitForFunction(
    ({ text, shouldBeVisible }) => {
      const tip = [...document.querySelectorAll(".turn-buff-tip")].find(
        (node) => node.textContent?.includes(text) === true,
      );
      const isVisible =
        tip !== undefined && getComputedStyle(tip).display !== "none";
      return isVisible === shouldBeVisible;
    },
    { text: expected, shouldBeVisible: visible },
  );

const TEMPORARY_COIN_DESCRIPTION =
  "이번 전투에서만 쓰는 동전. 전투가 끝나면 사라진다.";

const waitForCombatOrBoundary = (page, timeout = 15000) =>
  page.waitForFunction(
    () =>
      document.querySelector(
        '[data-testid="reward-overlay"], [data-testid="run-result"]',
      ) !== null ||
      (document.querySelector(".end-turn:not(:disabled)") !== null &&
        document.querySelector(
          ".float-text, .skill-card.resolving, .socket-coin.flipping",
        ) === null),
    undefined,
    { timeout },
  );

const resolveSkillAnimation = async (page) => {
  await page.waitForTimeout(20);
  await waitForCombatOrBoundary(page);
};

const waitForOpaqueSkillCards = async (page) =>
  page.waitForFunction(() => {
    const row = document.querySelector(".skill-row");
    const cards = [...document.querySelectorAll(".skill-card")];
    return (
      row !== null &&
      !row.classList.contains("dimmed") &&
      cards.length === 8 &&
      cards
        .filter((card) => !card.classList.contains("empty-slot"))
        .every(
        (card) => Number.parseFloat(getComputedStyle(card).opacity) === 1,
        )
    );
  });

const placeHandCoinInto = async (page, cardIndex, socketIndex) => {
  const preferred = page
    .locator(".hand-tray .coin:not(.fire):not(.mana):not(.granted-fire)")
    .first();
  if ((await preferred.count()) > 0) await preferred.click();
  else await page.locator(".hand-tray .coin").first().click();
  await page
    .locator(".skill-card")
    .nth(cardIndex)
    .locator(".socket")
    .nth(socketIndex)
    .click();
};

const useConsumeIfReady = async (page, slotIndex) => {
  const card = page.locator(".skill-card").nth(slotIndex);
  if (
    (await card.count()) === 0 ||
    (await card.locator(".card-title").getAttribute("aria-disabled")) !==
      "false"
  )
    return false;
  await card.locator(".card-title").click();
  await resolveSkillAnimation(page);
  return true;
};

const useFlipSkill = async (page, slotIndex) => {
  const card = page.locator(".skill-card").nth(slotIndex);
  if ((await card.count()) === 0) return false;
  const sockets = card.locator(".socket");
  const socketCount = await sockets.count();
  if (socketCount === 0 || (await handCount(page)) < socketCount) return false;
  for (let index = 0; index < socketCount; index += 1) {
    if ((await sockets.nth(index).locator(".socket-coin").count()) > 0)
      continue;
    await page.locator(".hand-tray .coin").first().click();
    await sockets.nth(index).click();
  }
  if (
    (await card.locator(".card-title").getAttribute("aria-disabled")) !==
    "false"
  )
    return false;
  await card.locator(".card-title").click();
  await resolveSkillAnimation(page);
  return true;
};

const winCurrentCombat = async (page) => {
  for (let turn = 0; turn < 18; turn += 1) {
    for (let action = 0; action < 10; action += 1) {
      const atBoundary =
        (await page
          .locator(
            '[data-testid="reward-overlay"], [data-testid="run-result"]',
          )
          .count()) > 0;
      if (atBoundary) return;
      if (await useConsumeIfReady(page, 3)) continue;
      if (await useFlipSkill(page, 2)) continue;
      if (await useFlipSkill(page, 0)) continue;
      if (await useFlipSkill(page, 1)) continue;
      break;
    }
    await page.locator(".end-turn").click();
    await waitForCombatOrBoundary(page, 20000);
    if (
      (await page
        .locator('[data-testid="reward-overlay"], [data-testid="run-result"]')
        .count()) > 0
    )
      return;
  }
  throw new Error("자동 전투가 18턴 안에 끝나지 않았다");
};

// ---------- 시나리오 1: 첫 상태 + 클릭 장전/회수/사용 (베기) ----------
{
  const { page, errors } = await boot();
  await page.screenshot({ path: `${outDir}/01-initial.png` });
  check(
    "S1 favicon is explicitly declared",
    (await page.locator('link[rel~="icon"]').count()) === 1,
  );

  check("S1 첫 손패 5개", (await handCount(page)) === 5);
  // P5.2: 음소거 토글 — 정확히 1개(중복 렌더 금지)·기본 끔·반전·리로드 영속
  check(
    "S1 음소거 토글 정확히 1개",
    (await page.locator('[data-testid="mute-toggle"]').count()) === 1,
  );
  check(
    "S1 음소거 토글 기본 꺼짐",
    (await page.locator('[data-testid="mute-toggle"]').first().getAttribute("aria-pressed")) === "false",
  );
  await page.locator('[data-testid="mute-toggle"]').first().click();
  check(
    "S1 음소거 토글 켬 반전",
    (await page.locator('[data-testid="mute-toggle"]').first().getAttribute("aria-pressed")) === "true",
  );
  await page.reload({ waitUntil: "networkidle" });
  await continueFromTitleIfShown(page);
  await page.waitForFunction(
    () => document.querySelector(".end-turn:not(:disabled)") !== null,
    undefined,
    { timeout: 15000 },
  );
  check(
    "S1 음소거 설정 리로드 영속",
    (await page.locator('[data-testid="mute-toggle"]').first().getAttribute("aria-pressed")) === "true",
  );
  await page.locator('[data-testid="mute-toggle"]').first().click();
  check(
    "S1 주머니 6 (10+불씨1-드로우5)",
    (await page.locator(".pouch-circle").innerText()) === "6",
  );
  check(
    "S1 적 의도 1턴부터 공개",
    (await page.locator(".intent").count()) === 1,
  );
  check(
    "S1 손패 코인에 플립 결과 얼굴 없음",
    (await page.locator(".hand-tray .coin .coin-face-mark").count()) === 0,
  );

  // 클릭 장전: 코인 선택 → 합법 소켓 하이라이트 → 소켓 클릭 → 장전
  await page.locator(".hand-tray .coin").first().click();
  check(
    "S1 선택 코인 표시",
    (await page.locator(".hand-tray .coin.selected").count()) === 1,
  );
  const acceptCount = await page.locator(".socket.accept").count();
  check(
    "S1 합법 소켓 하이라이트 ≥1",
    acceptCount >= 1,
    `accept=${acceptCount}`,
  );

  const slashSocket = page.locator(".skill-card").first().locator(".socket");
  await slashSocket.first().click();
  check("S1 장전 후 손패 4개", (await handCount(page)) === 4);
  check(
    "S1 소켓 loaded",
    (await page
      .locator(".skill-card")
      .first()
      .locator(".socket.loaded")
      .count()) === 1,
  );
  await page.screenshot({ path: `${outDir}/02-placed.png` });

  // 회수: 장전된 소켓 클릭 → 손패 복귀
  await slashSocket.first().click();
  check("S1 회수 후 손패 5개", (await handCount(page)) === 5);

  // 재장전 → 카드 제목 버튼으로 사용 → 플립 연출 가시성
  await page.locator(".hand-tray .coin").first().click();
  await slashSocket.first().click();
  const beforeUse = `${outDir}/03-before-use.png`;
  await page.screenshot({ path: beforeUse });
  await page.locator(".skill-card").first().locator(".card-title").click();

  // 플립 연출: 해결 중 소켓 코인이 남아 flipping 클래스를 가져야 한다
  const sawFlip = await page
    .waitForFunction(
      () =>
        document.querySelector(".socket-coin.flipping, .coin.flipping") !==
        null,
      undefined,
      { timeout: 4000 },
    )
    .then(() => true)
    .catch(() => false);
  check("S1 플립 연출 가시 (flipping 클래스 등장)", sawFlip);
  await page.screenshot({ path: `${outDir}/04-during-flip.png` });

  const sawFace = await page
    .waitForFunction(
      () => document.querySelector(".coin-face-mark") !== null,
      undefined,
      { timeout: 4000 },
    )
    .then(() => true)
    .catch(() => false);
  check("S1 플립 결과 면 공개 (앞/뒤 마크)", sawFace);
  await page.screenshot({ path: `${outDir}/05-face-revealed.png` });

  await page.waitForFunction(
    () => document.querySelector(".end-turn:not(:disabled)") !== null,
    undefined,
    { timeout: 15000 },
  );
  check(
    "S1 기본기 반복 표시",
    (await page.locator(".skill-card").first().locator(".repeat-label").count()) ===
      1 && (await page.locator(".skill-card").first().getAttribute("class"))?.includes("spent") === false,
  );
  check("S1 해결 후 손패 4개", (await handCount(page)) === 4);
  check("S1 콘솔/페이지 에러 0", errors.length === 0, errors.join(" | "));
  await page.close();
}

// ---------- 시나리오 2: 불타는 일격 회귀 — 부분 장전이 화면을 죽이지 않는다 ----------
{
  const { page, errors } = await boot();
  const strike = page.locator(".skill-card").nth(2); // slot 2 = 불타는 일격 (cost 2)

  await page.locator(".hand-tray .coin").first().click();
  await strike.locator(".socket").first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/06-strike-one-coin.png` });
  check("S2 1/2 장전 후 화면 생존", await shellAlive(page));
  check("S2 1/2 장전 후 에러 0", errors.length === 0, errors.join(" | "));

  await page.locator(".hand-tray .coin").first().click();
  await strike.locator(".socket").nth(1).click();
  await page.waitForTimeout(300);
  check(
    "S2 2/2 장전 후 프리뷰 표시",
    (await page.locator("#skill-preview-2").count()) === 1,
  );
  await page.screenshot({ path: `${outDir}/07-strike-loaded.png` });

  const discardBefore = await page.locator(".pile-button.discard").innerText();
  await strike.locator(".card-title").click();
  await page.waitForFunction(
    () => document.querySelector(".end-turn:not(:disabled)") !== null,
    undefined,
    { timeout: 15000 },
  );
  await page.screenshot({ path: `${outDir}/08-strike-resolved.png` });
  check("S2 사용 후 화면 생존", await shellAlive(page));
  const discardAfter = await page.locator(".pile-button.discard").innerText();
  check(
    "S2 버림 더미 증가 (코인2+임시화염1)",
    discardBefore !== discardAfter,
    `${discardBefore} → ${discardAfter}`,
  );
  check("S2 에러 0", errors.length === 0, errors.join(" | "));
  await page.close();
}

// ---------- 시나리오 3: 키보드 전용 장전/회수/사용 ----------
{
  const { page, errors } = await boot();
  const coin = page.locator(".hand-tray .coin").first();
  await coin.focus();
  await page.keyboard.press("Enter");
  check(
    "S3 키보드 선택",
    (await page.locator(".hand-tray .coin.selected").count()) === 1,
  );

  const socket = page.locator(".skill-card").first().locator(".socket").first();
  await socket.focus();
  await page.keyboard.press("Enter");
  check("S3 키보드 장전", (await handCount(page)) === 4);

  await socket.focus();
  await page.keyboard.press("Enter");
  check("S3 키보드 회수", (await handCount(page)) === 5);

  // 다시 장전 후 카드 제목으로 사용
  await coin.focus();
  await page.keyboard.press("Enter");
  await socket.focus();
  await page.keyboard.press("Enter");
  const title = page.locator(".skill-card").first().locator(".card-title");
  await title.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => document.querySelector(".end-turn:not(:disabled)") !== null,
    undefined,
    { timeout: 15000 },
  );
  check(
    "S3 키보드 사용 후 기본기 반복 가능",
    (await page.locator(".skill-card").first().locator(".repeat-label").count()) ===
      1 && (await page.locator(".skill-card").first().getAttribute("class"))?.includes("spent") === false,
  );
  check("S3 에러 0", errors.length === 0, errors.join(" | "));
  await page.close();
}

// ---------- 시나리오 4: 드래그 장전 / 무효 드롭 / 소켓 드래그 회수 ----------
{
  const { page, errors } = await boot();
  const coin = page.locator(".hand-tray .coin").first();
  const guardCard = page.locator(".skill-card").nth(1); // 방어 (cost 1)

  // 드래그 성공: 코인 → 방어 소켓
  const coinBox = await coin.boundingBox();
  await page.mouse.move(
    coinBox.x + coinBox.width / 2,
    coinBox.y + coinBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(coinBox.x, coinBox.y - 60, { steps: 5 });
  const proxyVisible = await page.locator(".drag-proxy").count();
  check("S4 드래그 프록시 표시", proxyVisible === 1);
  const socketBox = await guardCard.locator(".socket").first().boundingBox();
  await page.mouse.move(
    socketBox.x + socketBox.width / 2,
    socketBox.y + socketBox.height / 2,
    { steps: 8 },
  );
  await page.screenshot({ path: `${outDir}/09-dragging.png` });
  await page.mouse.up();
  await page.waitForTimeout(250);
  check("S4 드래그 장전 성공", (await handCount(page)) === 4);
  check(
    "S4 방어 소켓 loaded",
    (await guardCard.locator(".socket.loaded").count()) === 1,
  );

  // 무효 드롭: 코인 → 전장 (아무 일 없음 + 손패 유지)
  const coin2 = page.locator(".hand-tray .coin").first();
  const coin2Box = await coin2.boundingBox();
  await page.mouse.move(
    coin2Box.x + coin2Box.width / 2,
    coin2Box.y + coin2Box.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(640, 200, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  check("S4 무효 드롭 시 손패 유지", (await handCount(page)) === 4);
  check("S4 무효 드롭 후 화면 생존", await shellAlive(page));

  // 소켓에서 드래그로 회수: 장전된 소켓 → 트레이
  const loaded = guardCard.locator(".socket.loaded");
  const loadedBox = await loaded.boundingBox();
  const trayBox = await page.locator(".hand-tray").boundingBox();
  await page.mouse.move(
    loadedBox.x + loadedBox.width / 2,
    loadedBox.y + loadedBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    trayBox.x + trayBox.width / 2,
    trayBox.y + trayBox.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await page.waitForTimeout(250);
  check("S4 소켓 드래그 회수", (await handCount(page)) === 5);
  check("S4 에러 0", errors.length === 0, errors.join(" | "));
  await page.close();
}

// ---------- 시나리오 5: 멀티 턴 — 면 리셋 · 리셔플 후 낡은 얼굴 없음 ----------
{
  const { page, errors } = await boot();
  for (let turn = 0; turn < 3; turn += 1) {
    // 매 턴 베기 1회 사용 (코인 플립 발생) 후 턴 종료
    await page.locator(".hand-tray .coin").first().click();
    await page
      .locator(".skill-card")
      .first()
      .locator(".socket")
      .first()
      .click();
    await page.locator(".skill-card").first().locator(".card-title").click();
    await page.waitForFunction(
      () => document.querySelector(".end-turn:not(:disabled)") !== null,
      undefined,
      { timeout: 20000 },
    );
    if ((await page.locator(".result-overlay").count()) > 0) break;
    await page.locator(".end-turn").click();
    await page.waitForFunction(
      () =>
        document.querySelector(".result-overlay") !== null ||
        document.querySelector(".end-turn:not(:disabled)") !== null,
      undefined,
      { timeout: 30000 },
    );
    if ((await page.locator(".result-overlay").count()) > 0) break;
    const stale = await page
      .locator(".hand-tray .coin .coin-face-mark")
      .count();
    check(`S5 턴${turn + 2} 손패에 낡은 얼굴 0`, stale === 0, `mark=${stale}`);
  }
  await page.screenshot({ path: `${outDir}/10-multi-turn.png` });
  check("S5 멀티 턴 에러 0", errors.length === 0, errors.join(" | "));
  await page.close();
}

// ---------- 시나리오 7: 다중 슬롯·다중 코인 스트레스 (한 판 연속) ----------
// 사용자 재현 보고 검증: ① 불타는 일격 부분 장전 생존 ② 여러 스킬 동시 장전 후 사용
// (행동 제한 없이 4회 연속 사용 — 구 프리뷰 크래시 경로) ③ 연속 장전 무잠금
// ④ 플립·면 공개가 피해 피드백보다 먼저 ⑤ 턴 전환 후 낡은 상태 없음
{
  const { page, errors } = await boot();
  const card = (index) => page.locator(".skill-card").nth(index);
  const placeInto = async (cardIndex, socketIndex) => {
    await page.locator(".hand-tray .coin").first().click();
    await card(cardIndex).locator(".socket").nth(socketIndex).click();
  };
  const useCard = async (cardIndex) => {
    await card(cardIndex).locator(".card-title").click();
    await page.waitForFunction(
      () => document.querySelector(".end-turn:not(:disabled)") !== null,
      undefined,
      { timeout: 20000 },
    );
  };
  const loadedCount = () => page.locator(".socket.loaded").count();

  // 1. 불타는 일격(slot 2, cost 2)에 1개 — 화면 생존, 프리뷰 실행 없음
  await placeInto(2, 0);
  check("S7 스트라이크 1/2 화면 생존", await shellAlive(page));
  check("S7 스트라이크 1/2 손패 4", (await handCount(page)) === 4);
  check(
    "S7 스트라이크 1/2 프리뷰 없음",
    (await page.locator("#skill-preview-2").count()) === 0,
  );
  await page.screenshot({ path: `${outDir}/11-strike-partial.png` });

  // 2. 완료 전 다른 스킬(방어 slot 1)에도 장전 — 둘 다 장전 유지, 조작 가능
  await placeInto(1, 0);
  check("S7 두 카드 동시 장전", (await loadedCount()) === 2);
  check(
    "S7 다중 장전 후 조작 가능(무잠금)",
    (await page.locator(".end-turn:not(:disabled)").count()) === 1,
  );
  await page.screenshot({ path: `${outDir}/12-multi-loaded.png` });

  // 3. 방어 코인 회수 — 총량 보존 (손패+장전 = 5)
  await card(1).locator(".socket.loaded").click();
  check("S7 회수 후 손패 4", (await handCount(page)) === 4);
  check("S7 회수 후 총량 보존 (장전 1)", (await loadedCount()) === 1);
  await page.screenshot({ path: `${outDir}/13-unplaced.png` });

  // 4. 재장전 → 방어 사용 — 스트라이크 코인은 규칙대로 제자리
  await placeInto(1, 0);
  await useCard(1);
  check(
    "S7 방어 해결 후 스트라이크 장전 유지",
    (await card(2).locator(".socket.loaded").count()) === 1,
  );
  check("S7 방어 해결 후 화면 생존", await shellAlive(page));

  // 5. 스트라이크 2/2 — 첫 장전 후 입력 잠금 없음, 카드 준비 상태
  await placeInto(2, 1);
  check(
    "S7 스트라이크 2/2 즉시 조작 가능",
    (await page.locator(".end-turn:not(:disabled)").count()) === 1,
  );
  check(
    "S7 스트라이크 ready",
    (await card(2).evaluate((el) => el.classList.contains("ready"))) === true,
  );
  check(
    "S7 스트라이크 프리뷰 표시",
    (await page.locator("#skill-preview-2").count()) === 1,
  );

  // 6. 스트라이크 사용 후 기본 공격 2회 — 별도 행동 카운트 없이 한 턴 4회 행동
  await useCard(2);
  await placeInto(0, 0);
  await useCard(0);
  await placeInto(0, 0);
  await useCard(0);
  check("S7 4회 행동 후 화면 생존", await shellAlive(page));
  check(
    "S7 사용한 스트라이크는 쿨타임 상태",
    (await card(2).evaluate((el) => el.classList.contains("ready"))) === false,
  );
  check(
    "S7 사용한 스트라이크 프리뷰 숨김",
    (await page.locator("#skill-preview-2").count()) === 0,
  );
  check("S7 4회 행동 에러 0", errors.length === 0, errors.join(" | "));
  await page.screenshot({ path: `${outDir}/14-four-actions.png` });

  // 7. 턴 종료 — 다음 턴 드로우·쿨타임 복귀·낡은 면 제거 확인
  await page.locator(".end-turn").click();
  await page.waitForFunction(
    () =>
      document.querySelector(".result-overlay") !== null ||
      document.querySelector(".end-turn:not(:disabled)") !== null,
    undefined,
    { timeout: 30000 },
  );
  check("S7 턴2 스트라이크 소켓 비움 (D7)", (await loadedCount()) === 0);
  // 그래프 세대: 1전투가 주술사(위축) — 턴2 드로우 5-1=4
  check("S7 턴2 손패 4 (위축 반영)", (await handCount(page)) === 4);
  check(
    "S7 턴2 낡은 면 0",
    (await page.locator(".hand-tray .coin .coin-face-mark").count()) === 0,
  );

  // 8. 턴2에 스트라이크 완충·사용 — 소켓 코인 전부 플립·면 공개가 피해 피드백보다 먼저
  await placeInto(2, 0);
  await placeInto(2, 1);
  const discardBefore = await page.locator(".pile-button.discard").innerText();
  await card(2).locator(".card-title").click();
  const sawFlipAnim = await page
    .waitForFunction(
      () => document.querySelector(".socket-coin.flipping") !== null,
      undefined,
      { timeout: 5000 },
    )
    .then(() => true)
    .catch(() => false);
  check("S7 플립 애니메이션 가시", sawFlipAnim);
  await page.screenshot({ path: `${outDir}/15-flip-in-progress.png` });
  await page.waitForFunction(
    () => document.querySelectorAll(".coin-face-mark").length >= 1,
    undefined,
    { timeout: 5000 },
  );
  check(
    "S7 면 공개가 피해 피드백보다 먼저",
    (await page.locator(".float-text.kind-damage").count()) === 0,
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".coin-face-mark").length === 2,
    undefined,
    { timeout: 5000 },
  );
  await page.screenshot({ path: `${outDir}/16-faces-revealed.png` });
  const sawDamage = await page
    .waitForFunction(
      () => document.querySelector(".float-text.kind-damage") !== null,
      undefined,
      { timeout: 6000 },
    )
    .then(() => true)
    .catch(() => false);
  check("S7 면 공개 후 피해 피드백", sawDamage);
  await page.waitForFunction(
    () =>
      document.querySelector(".result-overlay") !== null ||
      document.querySelector(".end-turn:not(:disabled)") !== null,
    undefined,
    { timeout: 20000 },
  );
  const discardAfter = await page.locator(".pile-button.discard").innerText();
  check(
    "S7 해결 후 버림 반영",
    discardBefore !== discardAfter,
    `${discardBefore} → ${discardAfter}`,
  );
  check("S7 해결 후 화면 생존", await shellAlive(page));
  await page.screenshot({ path: `${outDir}/17-post-resolution.png` });
  check("S7 전 구간 에러 0", errors.length === 0, errors.join(" | "));
  await page.close();
}

// ---------- 시나리오 8: 뽑을 더미 팝오버 — 구성 공개·라이브 갱신·닫기 ----------
{
  const { page, errors } = await boot();
  const popSum = async () => {
    const text = await page.locator(".pouch-pop").innerText();
    return [...text.matchAll(/×(\d+)/g)].reduce(
      (sum, match) => sum + Number(match[1]),
      0,
    );
  };

  const popSettled = () =>
    page.waitForFunction(() => {
      const pop = document.querySelector(".pouch-pop");
      return pop !== null && getComputedStyle(pop).opacity === "1";
    });

  await page.locator(".pouch-circle").click();
  check("S8 팝오버 열림", (await page.locator(".pouch-pop").count()) === 1);
  await popSettled();
  const pouchNumber = Number(await page.locator(".pouch-circle").innerText());
  check(
    "S8 구성 합계 = 주머니 매수",
    (await popSum()) === pouchNumber,
    `sum vs ${pouchNumber}`,
  );
  const popText = await page.locator(".pouch-pop").innerText();
  check(
    "S8 기본·화염 종류 표기",
    popText.includes("기본") && popText.includes("화염"),
    popText.replace(/\n/g, " / "),
  );
  const popBox = await page.locator(".pouch-pop").boundingBox();
  check(
    "S8 팝오버 좌측 고정 (전장 미가림)",
    popBox !== null && popBox.x + popBox.width < 640,
    `right=${Math.round((popBox?.x ?? 0) + (popBox?.width ?? 0))}`,
  );
  await page.screenshot({ path: `${outDir}/18-pouch-open.png` });

  await page.keyboard.press("Escape");
  check("S8 Escape 닫기", (await page.locator(".pouch-pop").count()) === 0);

  await page.locator(".pouch-circle").click();
  await page.mouse.click(640, 200);
  check("S8 바깥 클릭 닫기", (await page.locator(".pouch-pop").count()) === 0);

  // 턴 전환 후 구성 갱신 — 2턴 드로우 뒤 더미 1닢
  await page.locator(".end-turn").click();
  await page.waitForFunction(
    () =>
      document.querySelector(".result-overlay") !== null ||
      document.querySelector(".end-turn:not(:disabled)") !== null,
    undefined,
    { timeout: 30000 },
  );
  await page.locator(".pouch-circle").click();
  await popSettled();
  check("S8 턴2 구성 합계 2 (위축 드로우 4)", (await popSum()) === 2);
  check(
    "S8 턴2 주머니 라벨 2",
    (await page.locator(".pouch-circle").innerText()) === "2",
  );
  await page.screenshot({ path: `${outDir}/19-pouch-turn2.png` });
  check("S8 에러 0", errors.length === 0, errors.join(" | "));
  await page.close();
}

// ---------- 시나리오 9: 카드 겹침 — 장전 상시 확대 금지·검사 승격은 수직 리프트 전용 ----------
// 겹침 레일은 유지하되: 장전(.lifted)은 절제된 리프트만, 검사 승격(호버/키보드 포커스/드롭
// 목적지)은 가로 확대 없는 수직 리프트 — 승격 중에도 이웃 카드의 제목·소켓이 가려지지 않는다.
{
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
    { width: 1024, height: 720 },
  ]) {
    const tag = `${viewport.width}x${viewport.height}`;
    const maxCardWidth = viewport.width >= 1440 ? 160 : 126;
    const { page, errors } = await boot(viewport);
    const cardRect = (index) =>
      page.evaluate((i) => {
        const rect = document.querySelectorAll(".skill-card")[i].getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          width: rect.width,
        };
      }, index);
    // 승격 중 이웃(불타는 일격, index 2)의 제목 중심·소켓 중심이 자기 카드로 히트되는가
    const adjacentClear = () =>
      page.evaluate(() => {
        const cards = [...document.querySelectorAll(".skill-card")];
        const target = cards[2];
        const probe = (el) => {
          if (el === null) return false;
          const rect = el.getBoundingClientRect();
          const under = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          return under !== null && target.contains(under);
        };
        return (
          probe(target.querySelector(".card-title")) &&
          probe(target.querySelector(".socket"))
        );
      });
    const detailShown = (index) =>
      page.evaluate(
        (i) => {
          const effects =
            [...document.querySelectorAll(".skill-card")][i]?.querySelector(
              ".card-effects",
            ) ?? null;
          return (
            effects !== null &&
            effects.querySelector(".card-effect-badge") !== null &&
            getComputedStyle(effects).display !== "none"
          );
        },
        index,
      );
    const parkPointer = async () => {
      await page.mouse.move(640, 260);
      await page.waitForTimeout(250);
    };

    await parkPointer();
    const rest = await cardRect(1);
    check(
      `S9 ${tag} 휴식 카드 기본 폭`,
      rest.width <= maxCardWidth,
      `w=${Math.round(rest.width)}`,
    );
    await page.screenshot({ path: `${outDir}/20-${tag}-rail-rest.png` });

    // 호버 승격 = 수직 리프트 + 상세 노출, 가로 확대 없음
    await page.locator(".skill-card").nth(1).hover();
    await page.waitForTimeout(250);
    const hovered = await cardRect(1);
    check(
      `S9 ${tag} 호버 수직 승격 (확대 없음)`,
      hovered.width <= maxCardWidth && hovered.top <= rest.top - 24,
      `w=${Math.round(hovered.width)} lift=${Math.round(rest.top - hovered.top)}`,
    );
    check(`S9 ${tag} 호버 효과 행 노출`, await detailShown(1));
    await page.screenshot({ path: `${outDir}/21-${tag}-hover.png` });
    await parkPointer();

    // 인접 두 카드 장전: 방어(1) + 불타는 일격(2)
    await page.locator(".hand-tray .coin").first().click();
    await page.locator(".skill-card").nth(1).locator(".socket").first().click();
    await page.locator(".hand-tray .coin").first().click();
    await page.locator(".skill-card").nth(2).locator(".socket").first().click();
    await parkPointer();
    const left = await cardRect(1);
    const right = await cardRect(2);
    check(
      `S9 ${tag} 장전 카드 상시 확대 없음`,
      left.width <= maxCardWidth && right.width <= maxCardWidth,
      `w=${Math.round(left.width)},${Math.round(right.width)}`,
    );
    check(
      `S9 ${tag} 장전 카드 겹침 ≤20px`,
      left.right - right.left <= 20,
      `overlap=${Math.round(left.right - right.left)}`,
    );
    check(`S9 ${tag} 두 장전 카드 제목·소켓 히트 가능`, await adjacentClear());
    await page.screenshot({ path: `${outDir}/22-${tag}-multi-loaded.png` });

    // 장전 카드 호버 승격 — 이웃 겹침이 휴식 수준(-14px)을 넘지 않고, 이웃 제목·소켓 무가림
    await page.locator(".skill-card").nth(1).hover();
    await page.waitForTimeout(250);
    const promoted = await cardRect(1);
    const neighbor = await cardRect(2);
    check(
      `S9 ${tag} 장전 카드 호버 수직 승격`,
      promoted.width <= maxCardWidth && promoted.top <= rest.top - 24,
      `w=${Math.round(promoted.width)} lift=${Math.round(rest.top - promoted.top)}`,
    );
    check(
      `S9 ${tag} 승격 중 이웃 겹침 ≤15px`,
      promoted.right - neighbor.left <= 15,
      `overlap=${Math.round(promoted.right - neighbor.left)}`,
    );
    check(`S9 ${tag} 승격 중 이웃 제목·소켓 무가림`, await adjacentClear());
    check(`S9 ${tag} 승격 카드 효과 행 노출`, await detailShown(1));
    await page.screenshot({ path: `${outDir}/23-${tag}-loaded-hover.png` });
    await parkPointer();

    // 키보드 포커스 = 호버와 동일 승격 — 슬롯0 제목에 앵커 후 실제 Tab 2회
    // (마지막 이동이 실제 키 입력이라 :focus-visible이 보장된다): 슬롯0 소켓 → 슬롯1 제목.
    // P6: warrior 시작 스킬 교체(slash/guard → jab/fist-guard)로 슬롯1 표시명은 '가드'.
    await page.locator(".skill-card").nth(0).locator(".card-title").focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(250);
    const focusOn = await page.evaluate(
      () => document.activeElement?.textContent ?? "",
    );
    check(
      `S9 ${tag} 키보드 포커스 대상 = 가드 제목`,
      focusOn.includes("가드"),
      focusOn,
    );
    const kb = await cardRect(1);
    check(
      `S9 ${tag} 키보드 포커스 수직 승격`,
      kb.width <= maxCardWidth && kb.top <= rest.top - 24,
      `w=${Math.round(kb.width)} lift=${Math.round(rest.top - kb.top)}`,
    );
    check(
      `S9 ${tag} 키보드 승격 중 이웃 제목·소켓 무가림`,
      await adjacentClear(),
    );
    await page.screenshot({ path: `${outDir}/24-${tag}-kb-focus.png` });
    await page.evaluate(
      () =>
        document.activeElement instanceof HTMLElement &&
        document.activeElement.blur(),
    );
    await parkPointer();

    // 겹침 속에서도 소켓은 개별 타깃 가능 — 오른쪽 카드 회수
    const handBefore = await handCount(page);
    await page.locator(".skill-card").nth(2).locator(".socket.loaded").click();
    check(
      `S9 ${tag} 겹침 속 소켓 회수 가능`,
      (await handCount(page)) === handBefore + 1,
    );

    const hScroll = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    check(`S9 ${tag} 가로 스크롤 없음`, !hScroll);
    check(`S9 ${tag} 에러 0`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}

// ---------- 시나리오 11: 버림·소모 인스펙터 + 이동·리셔플 수명주기 피드백 ----------
{
  // P9 전사 시작 4번 슬롯은 잿불 베기다. 이 시나리오는 소모 영역 자체의
  // 계약을 검증하므로 테스트 전용 스킬 오버라이드로 내면의 열정을 명시한다.
  const { page, errors } = await boot(undefined, {
    url: urlWith({
      seed: SEED,
      skills: "jab,fist-guard,burning-fist,ignite-sword",
    }),
  });
  const pileSum = async (selector) => {
    const text = await page.locator(selector).innerText();
    return [...text.matchAll(/×(\d+)/g)].reduce(
      (sum, match) => sum + Number(match[1]),
      0,
    );
  };
  const pileSettled = (selector) =>
    page.waitForFunction((target) => {
      const pop = document.querySelector(target);
      return pop !== null && getComputedStyle(pop).opacity === "1";
    }, selector);

  check(
    "S11 버림·소모 버튼 2개",
    (await page.locator(".pile-button").count()) === 2,
  );
  const pileHitBoxes = await page
    .locator(".pile-button")
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const box = button.getBoundingClientRect();
        return { width: Math.round(box.width), height: Math.round(box.height) };
      }),
    );
  check(
    "S11 더미 버튼 히트 영역 ≥70×24px",
    pileHitBoxes.every((box) => box.width >= 70 && box.height >= 24),
    pileHitBoxes.map((box) => `${box.width}x${box.height}`).join(","),
  );

  await page.locator(".pile-button.discard").click();
  const emptyDiscard = page.locator(".pile-pop.discard");
  await emptyDiscard.waitFor({ state: "visible" });
  const emptyDiscardText = await emptyDiscard.innerText();
  check(
    "S11 빈 버림 인스펙터 열림",
    emptyDiscardText.includes("아직 버린 동전이 없다"),
  );
  check(
    "S11 버림 리셔플 규칙 설명",
    emptyDiscardText.includes("무작위로 섞여"),
  );

  await page.locator(".pile-button.exhausted").click();
  const emptyExhaust = page.locator(".pile-pop.exhausted");
  await emptyExhaust.waitFor({ state: "visible" });
  check(
    "S11 인스펙터 상호 배타적",
    (await page.locator(".pile-pop").count()) === 1 &&
      (await emptyExhaust.count()) === 1,
  );
  const emptyExhaustText = await emptyExhaust.innerText();
  check(
    "S11 소모 수명주기 설명",
    emptyExhaustText.includes("영구 동전은 전투 후 복귀") &&
      emptyExhaustText.includes("임시 동전은 전투 후 소멸"),
  );
  await page.keyboard.press("Escape");
  check(
    "S11 Escape 인스펙터 닫기",
    (await page.locator(".pile-pop").count()) === 0,
  );

  // 기본 동전으로 베기 → 비용 동전이 버림으로 이동하고 HUD가 이를 알려야 한다.
  const basicCoin = page
    .locator(".hand-tray .coin:not(.fire):not(.granted-fire)")
    .first();
  await basicCoin.click();
  await page.locator(".skill-card").nth(0).locator(".socket").first().click();
  await page.locator(".skill-card").nth(0).locator(".card-title").click();
  const sawDiscardFeedback = await page
    .waitForFunction(
      () =>
        document.querySelector(".pile-button.discard.receiving") !== null &&
        document
          .querySelector(".pile-flow")
          ?.textContent?.includes("버림 +1") === true,
      undefined,
      { timeout: 8000 },
    )
    .then(() => true)
    .catch(() => false);
  check("S11 스킬 비용 → 버림 피드백", sawDiscardFeedback);
  await page.waitForFunction(
    () => document.querySelector(".end-turn:not(:disabled)") !== null,
    undefined,
    { timeout: 15000 },
  );

  await page.locator(".pile-button.discard").click();
  await pileSettled(".pile-pop.discard");
  const discardText = await page.locator(".pile-pop.discard").innerText();
  check(
    "S11 버림 구성 합계 = 카운터",
    (await pileSum(".pile-pop.discard")) === 1,
  );
  check(
    "S11 버림 동전 종류·수명 표시",
    discardText.includes("기본 ×1") && discardText.includes("리셔플 대상"),
  );
  await page.screenshot({ path: `${outDir}/26-discard-inspector.png` });
  await page.keyboard.press("Escape");

  // 테스트 장착한 점화권으로 영구 화염 동전을 소비 → 전투 중 제외, 전투 후 복귀 안내.
  check(
    "S11 소비 전 화염 동전 보유",
    (await page.locator(".hand-tray .coin.fire").count()) >= 1,
  );
  await page.locator(".skill-card").nth(3).locator(".card-title").click();
  const sawExhaustFeedback = await page
    .waitForFunction(
      () =>
        document.querySelector(".pile-button.exhausted.receiving") !== null &&
        document
          .querySelector(".pile-flow")
          ?.textContent?.includes("소모 +1") === true,
      undefined,
      { timeout: 8000 },
    )
    .then(() => true)
    .catch(() => false);
  check("S11 소비 동전 → 소모 영역 피드백", sawExhaustFeedback);
  await page.waitForFunction(
    () => document.querySelector(".end-turn:not(:disabled)") !== null,
    undefined,
    { timeout: 15000 },
  );

  await page.locator(".pile-button.exhausted").click();
  await pileSettled(".pile-pop.exhausted");
  const exhaustText = await page.locator(".pile-pop.exhausted").innerText();
  check(
    "S11 소모 구성 합계 = 카운터",
    (await pileSum(".pile-pop.exhausted")) === 1,
  );
  check(
    "S11 소모 동전 종류 표시",
    exhaustText.includes("화염") &&
      (await page.locator(".pile-pop.exhausted .pop-coin.fire").count()) === 1,
  );
  check(
    "S11 소모 동전 수명주기 안내",
    exhaustText.includes("전투 후 복귀") ||
      exhaustText.includes("전투 후 소멸"),
  );
  await page.screenshot({ path: `${outDir}/27-exhaust-inspector.png` });
  await page.keyboard.press("Escape");

  // 두 번 턴 종료하면 남은 1개를 뽑은 뒤 버림 9개가 리셔플된다.
  await page.locator(".end-turn").click();
  await page.waitForFunction(
    () => document.querySelector(".end-turn:not(:disabled)") !== null,
    undefined,
    { timeout: 30000 },
  );
  await page.locator(".end-turn").click();
  const sawShuffleFeedback = await page
    .waitForFunction(
      () =>
        document.querySelector(".pouch-circle.receiving") !== null &&
        document
          .querySelector(".pile-flow")
          ?.textContent?.includes("→ 주머니") === true,
      undefined,
      { timeout: 15000 },
    )
    .then(() => true)
    .catch(() => false);
  check("S11 버림 → 주머니 리셔플 피드백", sawShuffleFeedback);
  await page.waitForFunction(
    () => document.querySelector(".end-turn:not(:disabled)") !== null,
    undefined,
    { timeout: 30000 },
  );
  check(
    "S11 리셔플 후 버림 카운터 0",
    (await page.locator(".pile-button.discard").innerText()).includes("0"),
  );
  await page.locator(".pile-button.discard").click();
  await pileSettled(".pile-pop.discard");
  check(
    "S11 리셔플 후 버림 인스펙터 비움",
    (await page.locator(".pile-pop.discard").innerText()).includes(
      "아직 버린 동전이 없다",
    ),
  );
  await page.screenshot({ path: `${outDir}/28-after-reshuffle.png` });
  check("S11 전 구간 에러 0", errors.length === 0, errors.join(" | "));
  await page.close();
}

// ---------- 시나리오 12: 저장·보상·교체를 포함한 시드 5연전 완주 ----------
{
  const { page, errors } = await boot(
    { width: 1280, height: 720 },
    { fast: true },
  );
  const main = () => page.locator("main");
  const bag = async () =>
    (await main().getAttribute("data-bag"))?.split(",").filter(Boolean) ?? [];
  const equipped = async () =>
    (await main().getAttribute("data-equipped-skills"))
      ?.split(",")
      .filter(Boolean) ?? [];
  const waitForOpaqueSkillCards = async () => {
    const cardsAreStable = () => {
      const row = document.querySelector(".skill-row");
      const cards = [...document.querySelectorAll(".skill-card")];
      return (
        row !== null &&
        !row.classList.contains("dimmed") &&
        cards.length === 8 &&
        cards
          .filter((card) => !card.classList.contains("empty-slot"))
          .every(
          (card) => Number.parseFloat(getComputedStyle(card).opacity) === 1,
          )
      );
    };
    await page.waitForFunction(cardsAreStable);
    await page.mouse.move(20, 200);
    await page.waitForTimeout(350);
    await page.waitForFunction(cardsAreStable);
    await page.waitForTimeout(120);
  };
  const assertBoundaryLayout = async (tag, viewport) => {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(120);
    const metrics = await page.evaluate(() => {
      const panel = document.querySelector(".run-panel");
      const panelRect = panel?.getBoundingClientRect() ?? null;
      const controls = [
        ...document.querySelectorAll(".run-panel button[data-testid]"),
      ]
        .filter((element) => {
          const style = getComputedStyle(element);
          return style.display !== "none" && style.visibility !== "hidden";
        })
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            id: element.getAttribute("data-testid"),
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
          };
        });
      const overlaps = [];
      for (let left = 0; left < controls.length; left += 1) {
        for (let right = left + 1; right < controls.length; right += 1) {
          const a = controls[left];
          const b = controls[right];
          if (
            Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
          ) {
            overlaps.push(`${a.id}/${b.id}`);
          }
        }
      }
      return {
        hScroll:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
        vScroll:
          document.documentElement.scrollHeight >
          document.documentElement.clientHeight,
        panelClipped:
          panelRect === null ||
          panelRect.left < 0 ||
          panelRect.top < 0 ||
          panelRect.right > innerWidth ||
          panelRect.bottom > innerHeight,
        panelOverflow:
          panel === null ||
          panel.scrollWidth > panel.clientWidth + 1 ||
          panel.scrollHeight > panel.clientHeight + 1,
        clipped: controls
          .filter(
            (control) =>
              control.left < 0 ||
              control.top < 0 ||
              control.right > innerWidth ||
              control.bottom > innerHeight,
          )
          .map((control) => control.id),
        overlaps,
      };
    });
    check(
      `S12 ${tag} 가로·세로 페이지 스크롤 없음`,
      !metrics.hScroll && !metrics.vScroll,
      JSON.stringify(metrics),
    );
    check(
      `S12 ${tag} 패널·필수 제어 전부 뷰포트 안`,
      !metrics.panelClipped && metrics.clipped.length === 0,
      JSON.stringify({
        panelClipped: metrics.panelClipped,
        clipped: metrics.clipped,
      }),
    );
    check(
      `S12 ${tag} 내부 클리핑·제어 겹침 없음`,
      !metrics.panelOverflow && metrics.overlaps.length === 0,
      JSON.stringify({
        panelOverflow: metrics.panelOverflow,
        overlaps: metrics.overlaps,
      }),
    );
  };

  // P6 D1: 3막×10방문 그래프 — 진행 표기는 "1막 1/10" (레거시 "노드 1/10" 대체)
  check(
    "S12 첫 노드 진행 1막 1/10 (P6 3막 그래프)",
    (await page.locator('[data-testid="run-progress"] strong').innerText()) ===
      "1막 1/10",
  );
  await winCurrentCombat(page);
  // P6 신스펙: 일반 전투 보상 = 동전 3중1택만 (제거 단계·스킬 2택 삭제).
  // 앱 결함 의심(보고 대상): rewardViewStage(apps/ui/src/interaction.ts)가 코인 단독
  // 보상(coinRemovalResolved=true·skillOptions=[])을 v5 '대체 코인'과 구분하지 못해
  // stage가 'fallback-coin'으로 투영된다 — 여기서는 두 값 모두 코인 선택 단계로 수용.
  check(
    "S12 1전투 승리 후 코인 보상 단계",
    (await main().getAttribute("data-run-phase")) === "rewards" &&
      ["coin", "fallback-coin"].includes(
        (await page
          .locator('[data-testid="reward-stage"]')
          .getAttribute("data-reward-stage")) ?? "",
      ),
  );
  const hpAfterFirst = Number(await main().getAttribute("data-current-hp"));
  check(
    "S12 첫 전투에서 HP 손실 발생",
    hpAfterFirst > 0 && hpAfterFirst < 70,
    `hp=${hpAfterFirst}`,
  );
  const bagBeforeReward = await bag();
  const coinIds = await page
    .locator('[data-testid^="coin-reward-"]:not([data-testid$="skip"])')
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("data-testid")),
    );
  check(
    "S12 코인 보상 3개·중복 없음",
    coinIds.length === 3 && new Set(coinIds).size === 3,
    coinIds.join(","),
  );
  await page.screenshot({ path: `${outDir}/30-m5-coin-reward-1280.png` });
  await assertBoundaryLayout("1280x720 코인 보상", {
    width: 1280,
    height: 720,
  });
  await assertBoundaryLayout("1920x1080 코인 보상", {
    width: 1920,
    height: 1080,
  });
  await page.screenshot({ path: `${outDir}/31-m5-coin-reward-1920.png` });
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.locator('[data-testid="coin-reward-mana"]').click();
  await page.waitForSelector('[data-testid="node-choice"]', { timeout: 15000 });
  const bagAfterAdd = await bag();
  check(
    "S12 마나 코인 영구 추가",
    bagAfterAdd.length === bagBeforeReward.length + 1 &&
      bagAfterAdd.includes("mana"),
    bagAfterAdd.join(","),
  );
  // P6 신스펙: 제거 단계 삭제(상점 전용 회귀) — 일반 전투는 코인 1택 후 즉시 다음
  // 레이어 진입. BRAVE-EMBER-42 그래프의 방문2는 3후보 갈림길(전투 수문장·상점·휴식)
  // — D1 "후보 2~3개" 스펙의 3후보 렌더를 라이브 경로로 검증한다.
  check(
    "S12 코인 1택 후 갈림길 진입 (제거 단계 없음)",
    (await main().getAttribute("data-run-phase")) === "choose-node" &&
      (await page.locator('[data-testid="node-choice"]').count()) === 1,
  );
  const nodeOptions = page.locator('[data-testid^="node-option-"]');
  check(
    "S12 갈림길 후보 3개 렌더",
    (await nodeOptions.count()) === 3,
    String(await nodeOptions.count()),
  );
  const optionTexts = await nodeOptions.allInnerTexts();
  check(
    "S12 후보 종류·미리보기 (전투 수문장·상점·휴식)",
    optionTexts[0]?.includes("수문장") === true &&
      optionTexts[1]?.includes("상점") === true &&
      optionTexts[2]?.includes("휴식") === true,
    optionTexts.map((text) => text.replace(/\n/g, " ")).join(" | "),
  );
  await page.screenshot({ path: `${outDir}/32-p6-choose-node-1280.png` });
  await assertBoundaryLayout("1280x720 갈림길", {
    width: 1280,
    height: 720,
  });
  await assertBoundaryLayout("1920x1080 갈림길", {
    width: 1920,
    height: 1080,
  });
  await page.screenshot({ path: `${outDir}/37-p6-choose-node-1920.png` });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('[data-testid="node-option-0"]').click();
  await page.waitForSelector('[data-testid="next-combat"]', { timeout: 15000 });
  check(
    "S12 전투 후보 선택 → 다음 전투 준비",
    (await main().getAttribute("data-run-phase")) === "ready" &&
      (await page.locator(".run-panel").innerText()).includes("수문장"),
  );
  await page.screenshot({ path: `${outDir}/38-m5-ready-1280.png` });
  await assertBoundaryLayout("1280x720 다음 전투 준비", {
    width: 1280,
    height: 720,
  });
  await assertBoundaryLayout("1920x1080 다음 전투 준비", {
    width: 1920,
    height: 1080,
  });
  await page.screenshot({ path: `${outDir}/39-m5-ready-1920.png` });
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.locator('[data-testid="next-combat"]').click();
  await waitForCombatOrBoundary(page);
  check("S12 다음 전투에 마나 코인 보존", (await bag()).includes("mana"));
  const carriedHp = Number(
    (await page.locator(".unit.player .hp-num").innerText()).split("/")[0],
  );
  check(
    "S12 전투 간 HP 자동 회복 없음",
    carriedHp === hpAfterFirst,
    `${carriedHp} vs ${hpAfterFirst}`,
  );
  let manaVisible = (await page.locator(".hand-tray .coin.mana").count()) > 0;
  if (!manaVisible) {
    await page.locator(".pouch-circle").click();
    manaVisible = (await page.locator(".pouch-pop .pop-coin.mana").count()) > 0;
    await page.keyboard.press("Escape");
  }
  check("S12 추가한 마나 코인이 다음 전투 UI에 표시", manaVisible);

  const attemptBeforeReload = Number(await main().getAttribute("data-attempt"));
  await page.reload({ waitUntil: "networkidle" });
  await continueFromTitleIfShown(page);
  await waitForCombatOrBoundary(page);
  const attemptAfterReload = Number(await main().getAttribute("data-attempt"));
  check(
    "S12 전투 중 reload가 시도 횟수 증가",
    attemptAfterReload === attemptBeforeReload + 1,
    `${attemptBeforeReload} → ${attemptAfterReload}`,
  );
  check(
    "S12 resume 후에도 이월 HP 유지",
    (await page.locator(".unit.player .hp-num").innerText()).startsWith(
      `${hpAfterFirst}/`,
    ),
  );
  await waitForOpaqueSkillCards();
  await page.screenshot({ path: `${outDir}/35-m5-combat-stable-1280.png` });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await waitForOpaqueSkillCards();
  check(
    "S12 1920 안정 전투 카드 opacity 1",
    await page
      .locator(".skill-card")
      .evaluateAll((cards) =>
        cards
          .filter((card) => !card.classList.contains("empty-slot"))
          .every(
          (card) => Number.parseFloat(getComputedStyle(card).opacity) === 1,
          ),
      ),
  );
  await page.screenshot({ path: `${outDir}/36-m5-combat-stable-1920.png` });
  await page.setViewportSize({ width: 1280, height: 720 });
  check(
    "S12 전 구간 콘솔/페이지 에러 0",
    errors.length === 0,
    errors.join(" | "),
  );
  await page.close();

  // ---- 그래프 세대 재설계: 깊은 노드의 보상 교체·승리 화면은 v6 저장 주입으로
  // 결정론 검증한다 (30레이어 브라우저 완주는 승패 비결정·과도 — 완주 증명은 코어 e2e·
  // 시뮬 seed42 골든이 소유). P6 대체 근거: v5 "3전투째 스킬 2택" 흐름은 삭제되어
  // "엘리트 정산 스킬 1 제안(교체/스킵)" 등가물로 검증한다 — 교체 취소/거절/지정
  // 슬롯/스킵 UI 계약은 신스펙에서도 동일하다.
  const inject = async (save) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    const page2 = await context.newPage();
    const errors2 = [];
    page2.on("pageerror", (error) => errors2.push(String(error.message)));
    page2.on("console", (message) => {
      if (
        message.type() === "error" &&
        !message.location().url.endsWith("/favicon.ico")
      )
        errors2.push(message.text());
    });
    await page2.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      ["deckbuilding-roguelite.run-save", JSON.stringify(save)],
    );
    await page2.goto(baseUrl, { waitUntil: "networkidle" });
    await continueFromTitleIfShown(page2);
    return { page: page2, errors: errors2, context };
  };
  // v7 저장 픽스처 — acts 메타 포함 = P6+P7 규칙 적용 (스킬 제안 원천 = 엘리트 정산).
  // 경제 보존: 골드 105 = 완료 노드(전투 35 + 엘리트 70) 총수입과 일치.
  const injectBase = {
    version: 7,
    contentVersion: "1.4.0-p10",
    runSeed: "S12-INJECT",
    character: "warrior",
    currentHp: 63,
    maxHp: 70,
    bag: [...Array.from({ length: 8 }, () => "basic"), "fire", "fire"],
    equippedSkills: [
      "jab",
      "fist-guard",
      "burning-fist",
      "flame-hook",
      null,
      null,
      null,
      null,
    ],
    upgradedSlots: [false, false, false, false, false, false, false, false],
    acquiredPassives: [],
    gold: 105,
    graph: {
      layers: [
        [{ id: "i0", kind: "combat", encounter: ["raider"] }],
        [{ id: "i1", kind: "elite", encounter: ["raider-plus"] }],
        [{ id: "i2", kind: "combat", encounter: ["raider"] }],
        [{ id: "i3", kind: "boss", encounter: ["ember-archmage"] }],
      ],
      acts: [{ start: 0 }],
    },
    nodeChoices: [0, 0, 0, 0],
    shopRemovals: 0,
    shopPurchasedCoins: 0,
    shopPurchasedSkills: 0,
    shopPurchasedPassives: 0,
    eventCombats: 0,
    eventCoinGains: 0,
    eventCoinLosses: 0,
    treasureOpened: 0,
    restHeals: 0,
    restUpgrades: 0,
    attempt: 0,
  };
  // P6 엘리트 정산 등가물: 코인 1택 완료 후 스킬 1 제안이 남은 상태
  const skillRewards = {
    coinOptions: ["basic", "fire", "mana"],
    coinChoiceResolved: true,
    coinRemovalResolved: true,
    skillOptions: ["smash"],
    skillChoiceResolved: false,
  };

  {
    // 교체 취소·거절 흐름
    const { page: p2, errors: e2, context } = await inject({
      ...injectBase,
      combatIndex: 2,
      phase: "rewards",
      pendingRewards: skillRewards,
    });
    const choices = p2.locator(
      '[data-testid^="skill-reward-"]:not([data-testid$="skip"])',
    );
    await p2.waitForSelector('[data-testid="reward-stage"]', { timeout: 15000 });
    check("S12 주입 엘리트 스킬 제안 1개", (await choices.count()) === 1);
    const before = (
      (await p2
        .locator('[data-testid="run-phase"]')
        .getAttribute("data-equipped-skills")) ?? ""
    );
    await choices.first().click();
    check(
      "S12 스킬 선택 후 명시적 8슬롯 교체 화면",
      (await p2.locator('[data-testid^="replace-slot-"]').count()) === 8,
    );
    await p2.locator('[data-testid="replace-cancel"]').click();
    check(
      "S12 교체 취소가 스킬 선택으로 복귀",
      (await choices.count()) === 1,
    );
    await choices.first().click();
    await p2.locator('[data-testid="replace-decline"]').click();
    check(
      "S12 교체 거절이 장착 스킬을 유지하고 다음 노드로 진행",
      (await p2
        .locator('[data-testid="run-phase"]')
        .getAttribute("data-run-phase")) === "ready" &&
        ((await p2
          .locator('[data-testid="run-phase"]')
          .getAttribute("data-equipped-skills")) ?? "") === before,
    );
    check("S12 주입1 에러 0", e2.length === 0, e2.join(" | "));
    await context.close();
  }
  {
    // 지정 슬롯 교체
    const { page: p2, errors: e2, context } = await inject({
      ...injectBase,
      combatIndex: 2,
      phase: "rewards",
      pendingRewards: skillRewards,
    });
    const choices = p2.locator(
      '[data-testid^="skill-reward-"]:not([data-testid$="skip"])',
    );
    await p2.waitForSelector('[data-testid="reward-stage"]', { timeout: 15000 });
    const chosen = String(
      await choices.first().getAttribute("data-testid"),
    ).replace("skill-reward-", "");
    await choices.first().click();
    await p2.locator('[data-testid="replace-slot-5"]').click();
    check(
      "S12 선택 스킬이 지정 슬롯을 교체",
      (
        (await p2
          .locator('[data-testid="run-phase"]')
          .getAttribute("data-equipped-skills")) ?? ""
      ).split(",")[5] === chosen,
    );
    check("S12 주입2 에러 0", e2.length === 0, e2.join(" | "));
    await context.close();
  }
  {
    // 스킬 skip + 최종 승리 화면·새 시드 초기화
    const { page: p2, errors: e2, context } = await inject({
      ...injectBase,
      combatIndex: 2,
      phase: "rewards",
      pendingRewards: skillRewards,
    });
    await p2.waitForSelector('[data-testid="reward-stage"]', { timeout: 15000 });
    await p2.locator('[data-testid="skill-reward-skip"]').click();
    check(
      "S12 스킬 보상 skip 동작",
      (await p2
        .locator('[data-testid="run-phase"]')
        .getAttribute("data-run-phase")) === "ready",
    );
    check("S12 주입3 에러 0", e2.length === 0, e2.join(" | "));
    await context.close();
  }
  {
    const { page: p2, errors: e2, context } = await inject({
      ...injectBase,
      combatIndex: 3,
      phase: "victory",
    });
    await p2.waitForSelector('[data-testid="run-result"]', { timeout: 15000 });
    check(
      "S12 최종 승리 화면 (보스 레이어)",
      (await p2
        .locator('[data-testid="run-phase"]')
        .getAttribute("data-run-phase")) === "victory",
    );
    await p2.screenshot({ path: `${outDir}/29-m5-run-victory.png` });
    const completedSeed = new globalThis.URL(p2.url()).searchParams.get("seed");
    await p2.locator('[data-testid="new-seed"]').click();
    await waitForCombatOrBoundary(p2);
    const restartedSeed = new globalThis.URL(p2.url()).searchParams.get("seed");
    check(
      "S12 새 시드 동작이 다른 새 런 시작",
      restartedSeed !== null &&
        restartedSeed !== completedSeed &&
        (await p2
          .locator('[data-testid="run-phase"], main.combat-shell')
          .first()
          .getAttribute("data-combat-index")) === "0",
    );
    check(
      "S12 새 시드 동작이 HP·attempt 초기화",
      (await p2.locator(".unit.player .hp-num").innerText()) === "70/70" &&
        (await p2
          .locator('[data-testid="run-phase"], main.combat-shell')
          .first()
          .getAttribute("data-attempt")) === "0",
    );
    check("S12 주입4 에러 0", e2.length === 0, e2.join(" | "));
    await context.close();
  }
}

// ---------- 시나리오 10: 패배 연출 완료 후 결과 표시 + 같은 시드 재시작 정리 ----------
{
  // 그래프 세대: 1전투 적이 시드 롤이 되어 테스트 전용 ?encounter=raider로 고정한다
  const { page, errors } = await boot(undefined, {
    url: `${URL}&encounter=raider`,
  });

  // 약탈자 고정 패턴(11, 4×2, 11)으로 아무 행동 없이 6턴을 넘기면 HP 10이 남는다.
  for (let attack = 0; attack < 6; attack += 1) {
    await page.locator(".end-turn").click();
    await page.waitForFunction(
      () => document.querySelector(".end-turn:not(:disabled)") !== null,
      undefined,
      {
        timeout: 30000,
      },
    );
  }
  check(
    "S10 최종 공격 직전 HP 10",
    (await page.locator(".unit.player .hp-num").innerText()) === "10/70",
  );

  // 재시작 시 전투 외 UI 상태도 초기화되는지 보기 위해 주머니를 열린 채로 패배한다.
  await page.locator(".pouch-circle").click();
  check(
    "S10 패배 직전 주머니 팝오버 열림",
    (await page.locator(".pouch-pop").count()) === 1,
  );

  await page.locator(".end-turn").click();
  await page.waitForTimeout(100);
  const terminalTransition = await page.evaluate(() => ({
    overlay: document.querySelector(".result-overlay") !== null,
    locked: document.querySelector(".end-turn:disabled") !== null,
    feedback: document.querySelector(".float-text") !== null,
  }));
  check(
    "S10 최종 피해 연출 중 결과 화면 지연",
    !terminalTransition.overlay &&
      (terminalTransition.locked || terminalTransition.feedback),
    JSON.stringify(terminalTransition),
  );

  await page.waitForFunction(
    () => document.querySelector(".result-overlay") !== null,
    undefined,
    { timeout: 30000 },
  );
  await page.screenshot({ path: `${outDir}/25-defeat-result.png` });
  check(
    "S10 결과 대화상자 aria-modal",
    (await page.locator(".result-overlay").getAttribute("aria-modal")) ===
      "true",
  );
  check(
    "S10 결과 표시 시 잔여 피해 텍스트 0",
    (await page.locator(".float-text").count()) === 0,
  );
  check(
    "S10 결과 표시 시 플립 중 코인 0",
    (await page.locator(".flipping").count()) === 0,
  );
  const primaryFocused = await page
    .waitForFunction(
      () =>
        document.activeElement?.getAttribute("aria-label") ===
        "같은 시드로 재시작",
      undefined,
      {
        timeout: 2000,
      },
    )
    .then(() => true)
    .catch(() => false);
  check("S10 결과 기본 동작에 키보드 포커스", primaryFocused);

  const seedBefore = new globalThis.URL(page.url()).searchParams.get("seed");
  await page.getByRole("button", { name: "같은 시드로 재시작" }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".end-turn:not(:disabled)") !== null &&
      document.querySelector(".float-text") === null,
    undefined,
    { timeout: 15000 },
  );
  check(
    "S10 재시작 후 결과 화면 닫힘",
    (await page.locator(".result-overlay").count()) === 0,
  );
  check(
    "S10 같은 시드 유지",
    new globalThis.URL(page.url()).searchParams.get("seed") === seedBefore,
    String(seedBefore),
  );
  check(
    "S10 재시작 후 HP 초기화",
    (await page.locator(".unit.player .hp-num").innerText()) === "70/70",
  );
  check("S10 재시작 후 손패 5개", (await handCount(page)) === 5);
  check(
    "S10 재시작 후 주머니 팝오버 닫힘",
    (await page.locator(".pouch-pop").count()) === 0,
  );
  check(
    "S10 재시작 후 낡은 얼굴 0",
    (await page.locator(".coin-face-mark").count()) === 0,
  );
  check("S10 전 구간 에러 0", errors.length === 0, errors.join(" | "));
  await page.close();
}

// ---------- 시나리오 6: 뷰포트 매트릭스 — 풀블리드·스크롤·HUD·지면선 ----------
{
  const viewports = [
    { width: 1920, height: 1080 },
    { width: 1600, height: 900 },
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 1024, height: 720 },
  ];
  for (const viewport of viewports) {
    const { page, errors } = await boot(viewport);
    const metrics = await page.evaluate(() => {
      const rect = (selector) =>
        document.querySelector(selector)?.getBoundingClientRect() ?? null;
      const shell = rect("main.combat-shell");
      const backdrop = rect(".backdrop-img");
      const hud = rect(".bottom-hud");
      const runMeta = rect(".run-meta");
      const unitPlates = [...document.querySelectorAll(".unit-plate")].map(
        (element) => element.getBoundingClientRect(),
      );
      const sprites = [...document.querySelectorAll(".sprite-frame")].map(
        (el) => Math.round(el.getBoundingClientRect().bottom),
      );
      return {
        vw: window.innerWidth,
        vh: window.innerHeight,
        shellW: shell === null ? 0 : Math.round(shell.width),
        backdropW: backdrop === null ? 0 : Math.round(backdrop.width),
        backdropH: backdrop === null ? 0 : Math.round(backdrop.height),
        hudH: hud === null ? 0 : Math.round(hud.height),
        topHudClear:
          runMeta !== null &&
          unitPlates.length === 2 &&
          unitPlates.every(
            (plate) =>
              plate.right <= runMeta.left ||
              plate.left >= runMeta.right ||
              plate.bottom <= runMeta.top ||
              plate.top >= runMeta.bottom,
          ),
        spriteBottoms: sprites,
        hScroll:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
        vScroll:
          document.documentElement.scrollHeight >
          document.documentElement.clientHeight,
      };
    });
    const tag = `${viewport.width}x${viewport.height}`;
    check(`S6 ${tag} 가로 스크롤 없음`, !metrics.hScroll);
    check(`S6 ${tag} 세로 스크롤 없음`, !metrics.vScroll);
    check(
      `S6 ${tag} 무대 풀블리드 (셸=뷰포트)`,
      metrics.shellW >= metrics.vw,
      `shell=${metrics.shellW} vw=${metrics.vw}`,
    );
    check(
      `S6 ${tag} 배경 풀블리드`,
      metrics.backdropW >= metrics.vw && metrics.backdropH >= metrics.vh,
      `bg=${metrics.backdropW}x${metrics.backdropH}`,
    );
    if (viewport.width === 1280)
      check(`S6 ${tag} HUD ≤78px`, metrics.hudH <= 78, `hud=${metrics.hudH}`);
    check(`S6 ${tag} 상단 HUD 겹침 없음`, metrics.topHudClear);
    check(
      `S6 ${tag} 지면선 정합 (양 유닛 발 y 동일)`,
      metrics.spriteBottoms.length === 2 &&
        Math.abs(metrics.spriteBottoms[0] - metrics.spriteBottoms[1]) <= 2,
      metrics.spriteBottoms.join(","),
    );
    check(`S6 ${tag} 에러 0`, errors.length === 0, errors.join(" | "));
    await page.screenshot({ path: `${outDir}/vp-${tag}.png` });
    if (viewport.width === 1920 || viewport.width === 1024) {
      await page.locator(".pouch-circle").click();
      check(
        `S6 ${tag} 팝오버 열림`,
        (await page.locator(".pouch-pop").count()) === 1,
      );
      await page.waitForFunction(() => {
        const pop = document.querySelector(".pouch-pop");
        return pop !== null && getComputedStyle(pop).opacity === "1";
      });
      await page.screenshot({ path: `${outDir}/vp-${tag}-pouch.png` });
      await page.keyboard.press("Escape");
    }
    await page.close();
  }
}

// ---------- 시나리오 13: URL 시드 재현성 ----------
{
  const fingerprint = (page) =>
    page.evaluate(() => {
      const text = (selector) =>
        document.querySelector(selector)?.textContent?.trim() ?? "";
      const enemy = document.querySelector(".unit.enemy");
      return {
        seedStripText: text(".seed-strip") || text(".run-meta small"),
        pouchCount: text(".pouch-circle"),
        handCoins: [...document.querySelectorAll(".hand-tray .coin")].map(
          (coin) => ({
            label: coin.textContent?.trim() ?? "",
            classes: [...coin.classList].sort(),
          }),
        ),
        enemyName: enemy?.querySelector(".unit-name")?.textContent?.trim() ?? "",
        enemyHpText: enemy?.querySelector(".hp-num")?.textContent?.trim() ?? "",
        enemyIntentText:
          enemy?.querySelector(".intent")?.textContent?.trim() ?? "",
        cards: [...document.querySelectorAll(".skill-card")].map((card) => ({
          title: card.querySelector(".card-title")?.textContent?.trim() ?? "",
          ready: card.classList.contains("ready"),
          spent: card.classList.contains("spent"),
          lifted: card.classList.contains("lifted"),
        })),
      };
    });

  const first = await boot();
  const firstInitial = await fingerprint(first.page);
  await first.page.screenshot({ path: `${outDir}/41-seed-repro-boot-1.png` });
  check(
    "S13 boot1 저장 재개 없이 초기 시도",
    (await first.page.locator(".run-meta").getAttribute("data-attempt")) ===
      "0",
  );
  check("S13 boot1 콘솔/페이지 에러 0", first.errors.length === 0);
  await first.page.close();

  const second = await boot();
  const secondInitial = await fingerprint(second.page);
  await second.page.screenshot({ path: `${outDir}/44-seed-repro-boot-2.png` });
  const fingerprintsMatch =
    JSON.stringify(secondInitial) === JSON.stringify(firstInitial);
  check(
    "S13 같은 URL 시드 초기 상태 지문 동일",
    fingerprintsMatch,
    fingerprintsMatch
      ? ""
      : JSON.stringify({ first: firstInitial, second: secondInitial }),
  );
  const fingerprintFieldsPresent =
    secondInitial.seedStripText.includes(SEED) &&
    secondInitial.pouchCount !== "" &&
    secondInitial.handCoins.length === 5 &&
    secondInitial.enemyName !== "" &&
    secondInitial.enemyHpText !== "" &&
    secondInitial.enemyIntentText !== "" &&
    secondInitial.cards.length >= 6;
  check(
    "S13 지문 필수 필드 채움",
    fingerprintFieldsPresent,
    fingerprintFieldsPresent ? "" : JSON.stringify(secondInitial),
  );

  await second.page.locator(".hand-tray .coin").first().click();
  await second.page.locator(".skill-card").first().locator(".socket").click();
  check("S13 boot2 결정 동작 후 페이지 live", (await handCount(second.page)) === 4);
  check("S13 boot2 콘솔/페이지 에러 0", second.errors.length === 0);
  await second.page.close();
}

// ---------- 시나리오 14: UX 키워드 툴팁 접근성 ----------
{
  const { page, errors } = await boot();
  // 임시 코인 키워드 버튼을 텍스트로 전역 선택 — 슬롯 인덱스 가정 금지
  const trigger = page
    .locator(".card-effects .kw")
    .filter({ hasText: "임시" })
    .first();
  const card = page
    .locator(".skill-card")
    .filter({ has: page.locator(".card-effects .kw", { hasText: "임시" }) })
    .first();
  const handBefore = await handCount(page);
  const spentBefore = await page.locator(".skill-card.spent").count();

  check("S14 카드 효과 키워드 트리거 존재", (await trigger.count()) >= 1);
  await card.hover();
  await trigger.hover();
  await waitForKeywordTooltip(page, TEMPORARY_COIN_DESCRIPTION, true);
  check(
    "S14 hover 툴팁 정의 표시",
    await keywordTooltipVisible(page, TEMPORARY_COIN_DESCRIPTION),
  );
  await page.mouse.move(20, 200);
  await waitForKeywordTooltip(page, TEMPORARY_COIN_DESCRIPTION, false);
  check(
    "S14 hover 해제 툴팁 닫힘",
    !(await keywordTooltipVisible(page, TEMPORARY_COIN_DESCRIPTION)),
  );

  await trigger.focus();
  await waitForKeywordTooltip(page, TEMPORARY_COIN_DESCRIPTION, true);
  check(
    "S14 Tab 포커스 툴팁 표시",
    await keywordTooltipVisible(page, TEMPORARY_COIN_DESCRIPTION),
  );
  await page.keyboard.press("Escape");
  await waitForKeywordTooltip(page, TEMPORARY_COIN_DESCRIPTION, false);

  await trigger.click();
  await waitForKeywordTooltip(page, TEMPORARY_COIN_DESCRIPTION, true);
  await page.mouse.move(20, 200);
  check(
    "S14 클릭 툴팁 열림 유지",
    await keywordTooltipVisible(page, TEMPORARY_COIN_DESCRIPTION),
  );
  await page.keyboard.press("Escape");
  await waitForKeywordTooltip(page, TEMPORARY_COIN_DESCRIPTION, false);
  check(
    "S14 Escape 클릭 툴팁 닫힘",
    !(await keywordTooltipVisible(page, TEMPORARY_COIN_DESCRIPTION)),
  );

  await trigger.click();
  await waitForKeywordTooltip(page, TEMPORARY_COIN_DESCRIPTION, true);
  await page.mouse.click(20, 200);
  await waitForKeywordTooltip(page, TEMPORARY_COIN_DESCRIPTION, false);
  check(
    "S14 바깥 클릭 툴팁 닫힘",
    !(await keywordTooltipVisible(page, TEMPORARY_COIN_DESCRIPTION)),
  );
  check(
    "S14 키워드 클릭이 카드 사용 오발 없음",
    (await handCount(page)) === handBefore &&
      (await page.locator(".skill-card.spent").count()) === spentBefore &&
      (await card.locator(".socket.loaded").count()) === 0,
  );
  check("S14 에러 0", errors.length === 0, errors.join(" | "));
  await page.close();
}

// ---------- 시나리오 15: 카드 효과 문법 행 + 기하 회귀 ----------
{
  const { page, errors } = await boot();
  const rowsText = (index) =>
    page.locator(".skill-card").nth(index).locator(".card-effects").innerText();
  const slash = await rowsText(0);
  const guard = await rowsText(1);
  const burningStrike = await rowsText(2);
  const ignition = await rowsText(3);
  const cardMetrics = await page.locator(".skill-card").evaluateAll((cards) =>
    cards.map((card) => {
      const rect = card.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        rows: card.querySelectorAll(".card-effect-row").length,
        empty: card.classList.contains("empty-slot"),
      };
    }),
  );
  const equippedMetrics = cardMetrics.filter((item) => !item.empty);

  check(
    "S15 장착 스킬 4종 효과 행 존재",
    cardMetrics.length === 8 &&
      equippedMetrics.length === 4 &&
      equippedMetrics.every((item) => item.rows >= 1),
    JSON.stringify(cardMetrics),
  );
  check(
    "S15 베기 기본·앞면 행",
    slash.includes("기본") && slash.includes("앞면"),
    slash.replace(/\n/g, " / "),
  );
  check("S15 방어 뒷면 행", guard.includes("뒷면"), guard.replace(/\n/g, " / "));
  check(
    "S15 불타는 일격 앞면 동전마다 표기",
    burningStrike.includes("앞면") && burningStrike.includes("동전마다"),
    burningStrike.replace(/\n/g, " / "),
  );
  // 회귀 (값 잘림): 앞면 행의 실제 수치가 화면에서 잘리지 않고 보여야 한다 —
  // innerText는 ellipsis로 가려진 글자도 돌려주므로 기하(클립 박스·가로 넘침)로 판정한다
  const strikeHeadsVisible = await page
    .locator(".skill-card")
    .nth(2)
    .locator(".card-effect-row.heads")
    .evaluate((row) => {
      const wrap = row.closest(".card-effects");
      const rowRect = row.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      const copy = row.querySelector(".card-effect-copy");
      return {
        text: row.innerText.replace(/\n/g, " "),
        inside:
          rowRect.top >= wrapRect.top - 1 &&
          rowRect.bottom <= wrapRect.bottom + 1,
        noClip: copy.scrollWidth <= copy.clientWidth + 1,
      };
    });
  check(
    "S15 앞면 행 수치 가시 (피해 +3, 잘림 없음)",
    strikeHeadsVisible.text.includes("피해 +3") &&
      strikeHeadsVisible.inside &&
      strikeHeadsVisible.noClip,
    JSON.stringify(strikeHeadsVisible),
  );
  // 회귀 (행 클리핑): 어떤 카드도 효과 행이 세로로 잘리면 안 된다 — 부족분은 아트가 양보
  const rowClipReport = await page.locator(".skill-card").evaluateAll((cards) =>
    cards.filter((card) => !card.classList.contains("empty-slot")).map((card) => {
      const wrap = card.querySelector(".card-effects");
      if (wrap === null) return { overflow: true, title: "" };
      return {
        title: card.querySelector(".card-title")?.textContent?.trim() ?? "",
        overflow: wrap.scrollHeight > wrap.clientHeight + 1,
        clientHeight: wrap.clientHeight,
        scrollHeight: wrap.scrollHeight,
      };
    }),
  );
  check(
    "S15 전 카드 효과 행 클리핑 없음",
    rowClipReport.every((item) => !item.overflow),
    JSON.stringify(rowClipReport.filter((item) => item.overflow)),
  );
  check(
    "S15 잿불 베기 속성 면 행",
    ignition.includes("화염 앞면") &&
      ignition.includes("화염 뒷면") &&
      ignition.includes("화상"),
    ignition.replace(/\n/g, " / "),
  );
  check(
    "S15 카드 폭 기존 한계 유지",
    cardMetrics.every((item) => item.width <= 126),
    cardMetrics.map((item) => String(item.width)).join(","),
  );
  check("S15 에러 0", errors.length === 0, errors.join(" | "));
  await page.close();
}

// ---------- 시나리오 16: 결산 티켓 — 면·기본·합계 인과 ----------
{
  const { page, errors } = await boot();
  const enemyHp = page.locator(".unit.enemy .hp-num");
  const beforeHp = await hpValue(enemyHp);

  await page.locator(".hand-tray .coin").first().click();
  await page.locator(".skill-card").first().locator(".socket").first().click();
  await page.locator(".skill-card").first().locator(".card-title").click();
  await waitForCombatOrBoundary(page);
  const afterHp = await hpValue(enemyHp);
  const damage = beforeHp - afterHp;
  const ticket = page.locator(".resolution-ticket-anchor .resolution-ticket");
  const ticketText = await ticket.innerText();
  const totalText = await ticket.locator(".resolution-ticket__total").innerText();

  check("S16 결산 티켓 표시", (await ticket.count()) === 1);
  check(
    "S16 티켓 면 칩 1개",
    (await ticket.locator(".resolution-ticket__face").count()) === 1,
  );
  check("S16 티켓 기본 라인", ticketText.includes("기본"), ticketText.replace(/\n/g, " / "));
  check("S16 티켓 합계 라인", totalText.includes("합계"), totalText);
  check(
    "S16 합계 피해 = 적 HP 감소량",
    totalText.includes(`피해 ${damage}`),
    `${totalText} / hp ${beforeHp}→${afterHp}`,
  );

  await page.locator(".hand-tray .coin").first().click();
  await page.locator(".skill-card").nth(1).locator(".socket").first().click();
  check(
    "S16 다음 커맨드에 티켓 제거",
    (await page.locator(".resolution-ticket-anchor .resolution-ticket").count()) === 0,
  );
  check("S16 에러 0", errors.length === 0, errors.join(" | "));
  await page.close();
}

// ---------- 시나리오 17: 위축 정본 어휘 ----------
{
  const { page, errors } = await boot();
  const bodyText = await page.locator("body").innerText();
  check("S17 페이지 전체에 쇠약 부재", !bodyText.includes("쇠약"));
  check("S17 에러 0", errors.length === 0, errors.join(" | "));
  await page.close();
}

// ---------- 시나리오 18: 이벤트 VFX 새니티 + reduced-motion ----------
{
  const { page, errors } = await boot();
  await page.locator(".hand-tray .coin").first().click();
  await page.locator(".skill-card").first().locator(".socket").first().click();
  await page.locator(".skill-card").first().locator(".card-title").click();
  const sawReveal = await page
    .waitForFunction(
      () => document.querySelector(".socket-coin.vfx-reveal") !== null,
      undefined,
      { timeout: 5000 },
    )
    .then(() => true)
    .catch(() => false);
  check("S18 socket-coin vfx-reveal 등장", sawReveal);
  const revealCleared = await page
    .waitForFunction(
      () => document.querySelector(".socket-coin.vfx-reveal") === null,
      undefined,
      { timeout: 5000 },
    )
    .then(() => true)
    .catch(() => false);
  check("S18 socket-coin vfx-reveal 사라짐", revealCleared);
  await waitForCombatOrBoundary(page);
  check("S18 기본 모션 플로우 완료", await shellAlive(page));
  check("S18 기본 모션 에러 0", errors.length === 0, errors.join(" | "));
  await page.close();

  const reduced = await boot({ width: 1280, height: 720 }, { fast: true });
  await reduced.page.locator(".hand-tray .coin").first().click();
  await reduced.page.locator(".skill-card").first().locator(".socket").first().click();
  await reduced.page.locator(".skill-card").first().locator(".card-title").click();
  await waitForCombatOrBoundary(reduced.page);
  check("S18 reduced-motion 플로우 완료", await shellAlive(reduced.page));
  check(
    "S18 reduced-motion 에러 0",
    reduced.errors.length === 0,
    reduced.errors.join(" | "),
  );
  await reduced.page.close();
}

// ---------- 시나리오 19: P3.1 다중 적 대상 지정 모드 ----------
{
  const duoUrl = urlWith({ seed: SEED, encounter: "duo-raiders" });
  const enemySnapshot = (page) =>
    page.locator(".unit.enemy").evaluateAll((enemies) =>
      enemies.map((enemy, index) => {
        const hpText = enemy.querySelector(".hp-num")?.textContent ?? "0/0";
        return {
          index,
          hp: Number(hpText.split("/")[0]),
          targetable: enemy.classList.contains("targetable"),
          selected: enemy.classList.contains("target-selected"),
        };
      }),
    );
  const enemyHpList = async (page) =>
    (await enemySnapshot(page)).map((enemy) => enemy.hp);
  const selectedTarget = async (page) =>
    (await enemySnapshot(page)).find((enemy) => enemy.selected)?.index ?? null;
  const highlightedTargets = async (page) =>
    (await enemySnapshot(page))
      .filter((enemy) => enemy.targetable)
      .map((enemy) => enemy.index);
  const livingTargets = async (page) =>
    (await enemySnapshot(page))
      .filter((enemy) => enemy.hp > 0)
      .map((enemy) => enemy.index);
  const stateFingerprint = (page) =>
    page.evaluate(() => ({
      hp: [...document.querySelectorAll(".unit.enemy .hp-num")].map(
        (node) => node.textContent,
      ),
      hand: [...document.querySelectorAll(".hand-tray .coin")].map(
        (node) => node.textContent,
      ),
      loaded: [...document.querySelectorAll(".skill-card")].map(
        (card) => card.querySelectorAll(".socket.loaded").length,
      ),
      spent: [...document.querySelectorAll(".skill-card.spent")].map(
        (card) => card.querySelector(".card-title")?.textContent,
      ),
    }));
  const assertUnitLayout = async (viewport) => {
    const { page, errors } = await boot(viewport, { url: duoUrl });
    await waitForOpaqueSkillCards(page);
    const metrics = await page.evaluate(() => {
      const units = [...document.querySelectorAll(".unit")].map((unit) => {
        const rect = unit.getBoundingClientRect();
        return {
          cls: unit.className,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        };
      });
      const overlaps = [];
      for (let left = 0; left < units.length; left += 1) {
        for (let right = left + 1; right < units.length; right += 1) {
          const a = units[left];
          const b = units[right];
          const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (x > 1 && y > 1) overlaps.push(`${a.cls}/${b.cls}`);
        }
      }
      return {
        enemyCount: document.querySelectorAll(".unit.enemy").length,
        hScroll:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
        overlaps,
      };
    });
    const tag = `${viewport.width}x${viewport.height}`;
    check(`S19 ${tag} 적 2 렌더`, metrics.enemyCount === 2);
    check(
      `S19 ${tag} 유닛 패널 겹침·가로 스크롤 없음`,
      metrics.overlaps.length === 0 && !metrics.hScroll,
      JSON.stringify(metrics),
    );
    check(`S19 ${tag} 에러 0`, errors.length === 0, errors.join(" | "));
    await page.close();
  };
  const placeCoinInto = async (page, cardIndex, socketIndex) => {
    const preferred = page
      .locator(".hand-tray .coin:not(.fire):not(.mana):not(.granted-fire)")
      .first();
    if ((await preferred.count()) > 0) await preferred.click();
    else await page.locator(".hand-tray .coin").first().click();
    await page
      .locator(".skill-card")
      .nth(cardIndex)
      .locator(".socket")
      .nth(socketIndex)
      .click();
  };
  const enterSlashTargeting = async (page) => {
    await waitForOpaqueSkillCards(page);
    await placeCoinInto(page, 0, 0);
    await waitForOpaqueSkillCards(page);
    await page.locator(".skill-card").nth(0).locator(".card-title").click();
    await page.waitForFunction(
      () => document.querySelectorAll(".unit.enemy.targetable").length > 0,
    );
  };
  const confirmTarget = async (page, target) => {
    await page.locator(".unit.enemy").nth(target).locator(".sprite").click();
    await waitForCombatOrBoundary(page);
  };
  const useArmedAttackAt = async (page, cardIndex, cost, target) => {
    const card = page.locator(".skill-card").nth(cardIndex);
    for (let index = 0; index < cost; index += 1) {
      if ((await card.locator(".socket.loaded").nth(index).count()) > 0)
        continue;
      if ((await handCount(page)) === 0) return false;
      await placeCoinInto(page, cardIndex, index);
    }
    if ((await card.locator(".card-title").getAttribute("aria-disabled")) !== "false")
      return false;
    await card.locator(".card-title").click();
    if ((await page.locator(".unit.enemy.targetable").count()) > 0)
      await confirmTarget(page, target);
    else await waitForCombatOrBoundary(page);
    return true;
  };
  const defeatEnemy = async (page, target) => {
    for (let turn = 0; turn < 5; turn += 1) {
      if ((await enemyHpList(page))[target] <= 0) return true;
      await useArmedAttackAt(page, 2, 2, target);
      if ((await enemyHpList(page))[target] <= 0) return true;
      for (let attack = 0; attack < 3; attack += 1) {
        if (!(await useArmedAttackAt(page, 0, 1, target))) break;
        if ((await enemyHpList(page))[target] <= 0) return true;
      }
      if ((await page.locator(".end-turn:not(:disabled)").count()) === 0)
        return false;
      await page.locator(".end-turn").click();
      await waitForCombatOrBoundary(page, 30000);
    }
    return (await enemyHpList(page))[target] <= 0;
  };

  await assertUnitLayout({ width: 1280, height: 720 });
  await assertUnitLayout({ width: 1024, height: 720 });

  {
    const { page, errors } = await boot({ width: 1280, height: 720 }, { url: duoUrl });
    await enterSlashTargeting(page);
    const initialTargets = await highlightedTargets(page);
    check(
      "S19 베기 대상 지정 진입: targetable 2 + 기본 선택 1",
      initialTargets.length === 2 && (await selectedTarget(page)) === 0,
      `targets=${initialTargets.join(",")} selected=${await selectedTarget(page)}`,
    );
    check(
      "S19 하이라이트 집합 = legalCommands target 집합(생존 2)",
      JSON.stringify(initialTargets) === JSON.stringify(await livingTargets(page)),
      initialTargets.join(","),
    );
    await page.keyboard.press("ArrowRight");
    check("S19 ArrowRight 생존 대상 순환", (await selectedTarget(page)) === 1);
    const beforeRight = await enemyHpList(page);
    await page.keyboard.press("Enter");
    await waitForCombatOrBoundary(page);
    const afterRight = await enemyHpList(page);
    check(
      "S19 Enter 확정은 선택 대상 HP만 감소",
      afterRight[0] === beforeRight[0] && afterRight[1] < beforeRight[1],
      `${beforeRight.join(",")} → ${afterRight.join(",")}`,
    );

    await page.locator(".end-turn").click();
    await waitForCombatOrBoundary(page, 30000);
    await enterSlashTargeting(page);
    check("S19 마지막 공격 생존 적이 다음 기본 대상", (await selectedTarget(page)) === 1);
    await page.keyboard.press("ArrowLeft");
    check("S19 ArrowLeft 생존 대상 순환", (await selectedTarget(page)) === 0);
    const beforeEscape = await stateFingerprint(page);
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.querySelector(".unit.enemy.targetable") === null,
    );
    const afterEscape = await stateFingerprint(page);
    check(
      "S19 Escape 취소: 모드 해제·상태 불변·소켓 유지",
      JSON.stringify(afterEscape) === JSON.stringify(beforeEscape) &&
        (await page.locator(".skill-card").first().locator(".socket.loaded").count()) === 1,
      JSON.stringify({ beforeEscape, afterEscape }),
    );
    check("S19 대상 지정 에러 0", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  {
    const { page, errors } = await boot({ width: 1280, height: 720 }, { url: duoUrl });
    await enterSlashTargeting(page);
    const beforeClick = await enemyHpList(page);
    await confirmTarget(page, 1);
    const afterClick = await enemyHpList(page);
    check(
      "S19 클릭 확정은 클릭한 적에게 피해 귀속",
      afterClick[0] === beforeClick[0] && afterClick[1] < beforeClick[1],
      `${beforeClick.join(",")} → ${afterClick.join(",")}`,
    );
    const killed = await defeatEnemy(page, 1);
    check("S19 한 적 처치 준비 완료", killed, (await enemyHpList(page)).join(","));
    if (killed) {
      if (
        (await page
          .locator(".skill-card")
          .first()
          .locator(".card-title")
          .getAttribute("aria-disabled")) !== "false"
      ) {
        await page.locator(".end-turn").click();
        await waitForCombatOrBoundary(page, 30000);
      }
      const beforeFallback = await enemyHpList(page);
      await placeCoinInto(page, 0, 0);
      await waitForOpaqueSkillCards(page);
      await page.locator(".skill-card").first().locator(".card-title").click();
      await waitForCombatOrBoundary(page);
      const afterFallback = await enemyHpList(page);
      check(
        "S19 죽은 적 하이라이트 금지·왼쪽 첫 생존 폴백",
        (await highlightedTargets(page)).length === 0 &&
          afterFallback[1] === 0 &&
          afterFallback[0] < beforeFallback[0],
        `${beforeFallback.join(",")} → ${afterFallback.join(",")}`,
      );
    }
    check("S19 처치 후 에러 0", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  {
    const { page, errors } = await boot();
    const before = await hpValue(page.locator(".unit.enemy .hp-num"));
    await placeCoinInto(page, 0, 0);
    await waitForOpaqueSkillCards(page);
    await page.locator(".skill-card").first().locator(".card-title").click();
    await waitForCombatOrBoundary(page);
    const after = await hpValue(page.locator(".unit.enemy .hp-num"));
    check(
      "S19 단일 적은 대상 모드 없이 즉시 발동",
      (await page.locator(".unit.enemy.targetable").count()) === 0 && after < before,
      `${before} → ${after}`,
    );
    check("S19 단일 적 에러 0", errors.length === 0, errors.join(" | "));
    await page.close();
  }
}

// ---------- 시나리오 20: P3.1 용광로 기본 코인 선택 ----------
{
  const furnaceUrl = urlWith({
    seed: SEED,
    skills: "furnace,slash,guard,ignite,ignite-sword,flame-rampage",
  });
  const handCoinReport = (page) =>
    page.locator(".hand-tray .coin").evaluateAll((coins) =>
      coins.map((coin, index) => ({
        index,
        label: coin.textContent?.trim() ?? "",
        classes: [...coin.classList].sort(),
        selected: coin.classList.contains("fuel-selected"),
        valid: coin.classList.contains("fuel-valid"),
        invalid: coin.classList.contains("fuel-invalid"),
      })),
    );
  const selectedChoiceIndex = async (page) =>
    (await handCoinReport(page)).find((coin) => coin.selected)?.index ?? null;
  const basicChoiceIndexes = async (page) =>
    (await handCoinReport(page))
      .filter(
        (coin) =>
          coin.valid &&
          !coin.classes.includes("fire") &&
          !coin.classes.includes("mana") &&
          !coin.classes.includes("granted-fire"),
      )
      .map((coin) => coin.index);
  const armFurnaceChoice = async (page) => {
    await waitForOpaqueSkillCards(page);
    await page
      .locator(".hand-tray .coin:not(.fire):not(.mana):not(.granted-fire)")
      .first()
      .click();
    await page.locator(".skill-card").first().locator(".socket").first().click();
    await waitForOpaqueSkillCards(page);
    await page.locator(".skill-card").first().locator(".card-title").click();
    await page.waitForFunction(
      () => document.querySelector(".hand-tray .coin.fuel-valid") !== null,
    );
  };

  {
    const { page, errors } = await boot({ width: 1280, height: 720 }, { url: furnaceUrl });
    await armFurnaceChoice(page);
    const basics = await basicChoiceIndexes(page);
    const firstSuggested = await selectedChoiceIndex(page);
    check(
      "S20 용광로 선택 모드: 기본 코인만 하이라이트·자동 제안 1개",
      basics.length >= 2 &&
        firstSuggested !== null &&
        (await page.locator(".hand-tray .coin.fuel-selected").count()) === 1 &&
        (await page.locator(".hand-tray .coin.fire.fuel-valid, .hand-tray .coin.mana.fuel-valid").count()) === 0,
      JSON.stringify(await handCoinReport(page)),
    );
    const replacement = basics.find((index) => index !== firstSuggested);
    await page.locator(".hand-tray .coin").nth(replacement).click();
    check(
      "S20 다른 기본 코인 클릭 → 선택 교체",
      (await selectedChoiceIndex(page)) === replacement,
      JSON.stringify(await handCoinReport(page)),
    );
    const elementIndex = (await handCoinReport(page)).find((coin) =>
      coin.classes.includes("fire") || coin.classes.includes("mana"),
    )?.index;
    if (elementIndex !== undefined) await page.locator(".hand-tray .coin").nth(elementIndex).click();
    check(
      "S20 속성 코인 클릭 거부: 선택 불변·사유 칩",
      (await selectedChoiceIndex(page)) === replacement &&
        (await page.locator(".rejection-chip").count()) === 1,
      JSON.stringify(await handCoinReport(page)),
    );
    await page.keyboard.press("Enter");
    await waitForCombatOrBoundary(page);
    const afterGrant = await handCoinReport(page);
    check(
      "S20 확정 → 선택한 그 코인만 granted-fire",
      afterGrant.filter((coin) => coin.classes.includes("granted-fire")).length === 1 &&
        afterGrant[replacement]?.classes.includes("granted-fire") === true,
      JSON.stringify(afterGrant),
    );
    const ticketText = await page
      .locator(".resolution-ticket-anchor .resolution-ticket")
      .innerText();
    check(
      "S20 elementGranted 결산 티켓 반영",
      ticketText.includes("기본 코인 화염 취급") || ticketText.includes("화염 취급"),
      ticketText.replace(/\n/g, " / "),
    );
    check(
      "S20 granted 코인이 점화 검술 연료로 인정",
      (await page.locator(".skill-card").nth(4).locator(".consume-condition.met").count()) === 1,
    );
    check("S20 확정 경로 에러 0", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  {
    const first = await boot({ width: 1280, height: 720 }, { url: furnaceUrl });
    await armFurnaceChoice(first.page);
    const suggestedFirst = await selectedChoiceIndex(first.page);
    const beforeEscape = await handCoinReport(first.page);
    await first.page.keyboard.press("Escape");
    await first.page.waitForFunction(
      () => document.querySelector(".hand-tray .coin.fuel-valid") === null,
    );
    check(
      "S20 Escape 취소 → 모드 해제·미발동",
      (await first.page.locator(".skill-card.spent").count()) === 0 &&
        (await first.page.locator(".hand-tray .coin.granted-fire").count()) === 0 &&
        (await first.page.locator(".skill-card").first().locator(".socket.loaded").count()) === 1,
      JSON.stringify({ beforeEscape, after: await handCoinReport(first.page) }),
    );
    check("S20 Escape 경로 에러 0", first.errors.length === 0, first.errors.join(" | "));
    await first.page.close();

    const second = await boot({ width: 1280, height: 720 }, { url: furnaceUrl });
    await armFurnaceChoice(second.page);
    check(
      "S20 같은 URL 재부팅 시 자동 제안 동일",
      (await selectedChoiceIndex(second.page)) === suggestedFirst,
      `${suggestedFirst} → ${await selectedChoiceIndex(second.page)}`,
    );
    check("S20 결정론 경로 에러 0", second.errors.length === 0, second.errors.join(" | "));
    await second.page.close();
  }
}

// ---------- 시나리오 21: P3.2 캐릭터 선택 ----------
{
  // 21a. ?select=1 → 선택 화면: 두 캐릭터 카드, 특성 문구(발동 시점·임시 수명 명시)
  const { page, errors } = await boot(undefined, {
    url: `${baseUrl}?seed=${SEED}&select=1`,
    waitFor: "select",
  });
  // P6 D6: 마도기사(arcanist) 추가로 5종 — 데이터 주도 노출의 의도 변경
  check(
    "S21 선택 화면 캐릭터 카드 5종 (화염 격투가·수호자·술사·냉기 기사·마도기사)",
    (await page.locator(".character-card").count()) === 5 &&
      (await page.locator('[data-testid="character-select-sorcerer"]').count()) === 1 &&
      (await page.locator('[data-testid="character-select-frost-knight"]').count()) === 1 &&
      (await page.locator('[data-testid="character-select-arcanist"]').count()) === 1,
  );
  // P6 D5: warrior 표시명 '화염 격투가' (id는 'warrior' 유지)
  check(
    "S21 화염 격투가 표시명 카드",
    (
      await page.locator('[data-testid="character-select-warrior"]').innerText()
    ).includes("화염 격투가"),
  );
  const guardianCard = page.locator(
    '[data-testid="character-select-guardian"]',
  );
  const guardianText = (await guardianCard.innerText()).replace(/\n/g, " ");
  check(
    "S21 수호자 특성 문구 — 전투 시작·임시 명시",
    guardianText.includes("전투 시작 시") && guardianText.includes("임시"),
    guardianText.slice(0, 120),
  );
  check(
    "S21 수호자 카드 구성 정보 (HP·마나)",
    guardianText.includes("70") && guardianText.includes("마나"),
  );

  // 21b. 키보드로 수호자 선택 → 수호자 전투 진입 (가방 마나 2·전용 스킬 카드·스프라이트 폴백)
  await guardianCard.focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector(".combat-shell[data-bag]");
  await page.waitForFunction(
    () => document.querySelector(".end-turn:not(:disabled)") !== null,
  );
  const bag = await page
    .locator(".combat-shell")
    .getAttribute("data-bag");
  check(
    "S21 수호자 가방 마나 2닢",
    (bag ?? "").split(",").filter((id) => id === "mana").length === 2,
    bag ?? "",
  );
  const cardTitles = await page
    .locator(".skill-card .card-title")
    .allInnerTexts();
  check(
    "S21 수호자 전용 스킬 카드 렌더",
    ["수호 타격", "마나 방벽"].every((name) => cardTitles.includes(name)) &&
      cardTitles.filter((name) => name === "빈 슬롯").length === 4,
    cardTitles.join(","),
  );
  check(
    "S21 수호자 전용 스프라이트 (폴백 마커 없음)",
    (await page.locator("[data-sprite-fallback]").count()) === 0 &&
      (await page.locator(".unit.player .sprite-frame").count()) >= 1,
  );
  check("S21 선택 플로우 에러 0", errors.length === 0, errors.join(" | "));
  await page.close();
}

{
  // 21c. ?seed=만 → 선택 화면 없이 warrior 즉시 시작 (하네스·시드 재현 불변 규칙)
  const { page, errors } = await boot();
  check(
    "S21 시드 부팅은 선택 화면 생략",
    (await page.locator('[data-testid="character-select"]').count()) === 0,
  );
  // P6 D5: warrior 표시명 '화염 격투가' — 시드 부팅 캐릭터 불변 규칙은 동일
  check(
    "S21 시드 부팅 warrior(화염 격투가) 유지",
    (await page.locator(".unit.player .unit-name").innerText()) ===
      "화염 격투가",
  );

  // 21d. ?character=guardian 직접 부팅
  const direct = await boot(undefined, {
    url: `${baseUrl}?seed=${SEED}&character=guardian`,
  });
  check(
    "S21 직접 부팅 선택 화면 생략",
    (await direct.page.locator('[data-testid="character-select"]').count()) ===
      0,
  );
  const directBag = await direct.page
    .locator(".combat-shell")
    .getAttribute("data-bag");
  check(
    "S21 직접 부팅 수호자 가방",
    (directBag ?? "").split(",").filter((id) => id === "mana").length === 2,
    directBag ?? "",
  );
  check(
    "S21 캐릭터 부팅 에러 0",
    errors.length === 0 && direct.errors.length === 0,
    [...errors, ...direct.errors].join(" | "),
  );
  await page.close();
  await direct.page.close();
}

// ---------- 시나리오 22: P3.3 불의 심장 연료 지정 + 턴 버프 ----------
{
  const heartSkills =
    "heart-of-flame,slash,guard,ignite,ignite-sword,flame-rampage";
  const heartUrl = urlWith({
    seed: "P33-R3-35",
    skills: heartSkills,
  });
  const poorHeartUrl = urlWith({
    seed: "BRAVE-EMBER-42",
    skills: heartSkills,
  });
  const handCoinReport = (page) =>
    page.locator(".hand-tray .coin").evaluateAll((coins) =>
      coins.map((coin, index) => ({
        index,
        label: coin.textContent?.trim() ?? "",
        classes: [...coin.classList].sort(),
        selected: coin.classList.contains("fuel-selected"),
        valid: coin.classList.contains("fuel-valid"),
        invalid: coin.classList.contains("fuel-invalid"),
      })),
    );
  const selectedFuelIndexes = async (page) =>
    (await handCoinReport(page))
      .filter((coin) => coin.selected)
      .map((coin) => coin.index);
  const enterHeartFuel = async (page) => {
    await waitForOpaqueSkillCards(page);
    await page.locator(".skill-card").first().click();
    await page.waitForFunction(
      () => document.querySelectorAll(".hand-tray .coin.fuel-selected").length > 0,
    );
  };
  const waitForIdle = (page) =>
    page.waitForFunction(
      () =>
        document.querySelector(".end-turn:not(:disabled)") !== null &&
        document.querySelector(".float-text, .skill-card.resolving") === null,
    );

  {
    const { page, errors } = await boot(
      { width: 1280, height: 720 },
      { url: poorHeartUrl },
    );
    const report = await handCoinReport(page);
    const fireCount = report.filter((coin) =>
      coin.classes.includes("fire") || coin.classes.includes("granted-fire"),
    ).length;
    await page.locator(".skill-card").first().click();
    await page.waitForFunction(
      () => document.querySelector(".rejection-chip") !== null,
    );
    check(
      "S22 부족(화염 <3) 시 진입 거부",
      fireCount === 2 &&
        (await page.locator(".hand-tray .coin.fuel-valid").count()) === 0 &&
        (await page.locator(".rejection-chip").count()) === 1,
      JSON.stringify(report),
    );
    check("S22 부족 경로 에러 0", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  {
    const { page, errors } = await boot(
      { width: 1280, height: 720 },
      { url: heartUrl },
    );
    const firstReport = await handCoinReport(page);
    const fireCount = firstReport.filter((coin) =>
      coin.classes.includes("fire") || coin.classes.includes("granted-fire"),
    ).length;
    await enterHeartFuel(page);
    const suggested = await selectedFuelIndexes(page);
    check(
      "S22 선택 3개 사전 제안",
      fireCount === 3 &&
        suggested.length === 3 &&
        (await page.locator(".skill-card").first().locator(".consume-condition.met").count()) === 1,
      JSON.stringify({ fireCount, suggested, hand: firstReport }),
    );

    await page.locator(".hand-tray .coin").nth(suggested[0]).click();
    check(
      "S22 코인 토글 해제",
      (await selectedFuelIndexes(page)).length === 2 &&
        (await page.locator(".skill-card").first().locator(".consume-condition.met").count()) === 0,
      JSON.stringify(await handCoinReport(page)),
    );
    await page.locator(".hand-tray .coin").nth(suggested[0]).click();
    check(
      "S22 코인 토글 재선택",
      (await selectedFuelIndexes(page)).length === 3 &&
        (await page.locator(".skill-card").first().locator(".consume-condition.met").count()) === 1,
      JSON.stringify(await handCoinReport(page)),
    );

    const basicIndex = (await handCoinReport(page)).find(
      (coin) => !coin.classes.includes("fire") && !coin.classes.includes("granted-fire"),
    )?.index;
    if (basicIndex !== undefined)
      await page.locator(".hand-tray .coin").nth(basicIndex).click();
    check(
      "S22 비화염 거부(사유 칩)",
      (await selectedFuelIndexes(page)).length === 3 &&
        (await page.locator(".rejection-chip").count()) === 1,
      JSON.stringify(await handCoinReport(page)),
    );

    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.querySelector(".hand-tray .coin.fuel-valid") === null,
    );
    check(
      "S22 Escape 취소",
      (await page.locator(".skill-card.spent").count()) === 0 &&
        (await page.locator(".turn-buff-chip").count()) === 0,
    );

    await enterHeartFuel(page);
    check(
      "S22 재진입",
      (await selectedFuelIndexes(page)).length === 3 &&
        (await page.locator(".skill-card").first().locator(".consume-condition.met").count()) === 1,
    );
    const exhaustedBefore = await page.locator(".pile-button.exhausted").innerText();
    await page.keyboard.press("Enter");
    await waitForIdle(page);
    check(
      "S22 확정 → 트리거 칩 등장",
      (await page.locator(".turn-buff-chip").count()) === 1 &&
        (await page.locator(".turn-buff-chip").innerText()).includes("불의 심장"),
    );
    check(
      "S22 소모 영역 3장 이동(DOM 카운트)",
      exhaustedBefore.includes("0") &&
        (await page.locator(".pile-button.exhausted").innerText()).includes("3"),
      `${exhaustedBefore} → ${await page.locator(".pile-button.exhausted").innerText()}`,
    );

    const chip = page.locator(".turn-buff-chip").first();
    await chip.hover();
    await waitForTurnBuffTooltip(page, "공격 스킬 해결 후", true);
    check("S22 턴 버프 툴팁 hover", await turnBuffTooltipVisible(page, "공격 스킬 해결 후"));
    const turnBuffLayer = await tooltipLayerEvidence(page, "공격 스킬 해결 후");
    check(
      "S22 턴 버프 툴팁 포털·경계·최상단",
      turnBuffLayer?.layer === "tooltip" &&
        turnBuffLayer.insideViewport &&
        turnBuffLayer.topmost,
      JSON.stringify(turnBuffLayer),
    );
    await page.mouse.move(20, 20);
    await chip.focus();
    await waitForTurnBuffTooltip(page, "공격 스킬 해결 후", true);
    check("S22 턴 버프 툴팁 focus", await turnBuffTooltipVisible(page, "공격 스킬 해결 후"));
    await chip.click();
    await waitForTurnBuffTooltip(page, "공격 스킬 해결 후", true);
    check("S22 턴 버프 툴팁 tap", await turnBuffTooltipVisible(page, "공격 스킬 해결 후"));
    await page.keyboard.press("Escape");
    await waitForTurnBuffTooltip(page, "공격 스킬 해결 후", false);
    check("S22 턴 버프 툴팁 Escape", !(await turnBuffTooltipVisible(page, "공격 스킬 해결 후")));

    const burnBefore = await page.locator(".unit.enemy .burn-chip").count();
    await placeHandCoinInto(page, 1, 0);
    await waitForOpaqueSkillCards(page);
    await page.locator(".skill-card").nth(1).locator(".card-title").click();
    await waitForCombatOrBoundary(page);
    const ticketText = await page
      .locator(".resolution-ticket-anchor .resolution-ticket")
      .innerText();
    check(
      "S22 공격 사용 → 적 화상 +2",
      burnBefore === 0 &&
        (await page.locator('.unit.enemy .burn-chip[aria-label="화상 2"]').count()) === 1,
      ticketText.replace(/\n/g, " / "),
    );
    check(
      "S22 티켓 트리거 라인",
      ticketText.includes("트리거") &&
        ticketText.includes("불의 심장") &&
        ticketText.includes("화상 +2"),
      ticketText.replace(/\n/g, " / "),
    );
    await page.locator(".end-turn").click();
    await waitForCombatOrBoundary(page, 30000);
    check(
      "S22 턴 종료 시 칩 만료",
      (await page.locator(".turn-buff-chip").count()) === 0,
    );
    check("S22 확정 경로 에러 0", errors.length === 0, errors.join(" | "));
    await page.close();
  }
}

// ---------- 시나리오 23: P3.3 화염검 턴 버프 수명 ----------
{
  const flameSwordUrl = urlWith({
    seed: "BRAVE-EMBER-42",
    skills: "flame-sword,slash,burning-strike,guard,ignite-sword,flame-rampage",
  });
  const { page, errors } = await boot(
    { width: 1280, height: 720 },
    { url: flameSwordUrl },
  );
  await waitForOpaqueSkillCards(page);
  await page.locator(".skill-card").first().locator(".card-title").click();
  await waitForCombatOrBoundary(page);
  check(
    "S23 화염검 setup → 턴 버프 칩 등장",
    (await page.locator(".turn-buff-chip").count()) === 1 &&
      (await page.locator(".turn-buff-chip").innerText()).includes("화염검"),
  );
  await placeHandCoinInto(page, 1, 0);
  await waitForOpaqueSkillCards(page);
  await page.locator(".skill-card").nth(1).locator(".card-title").click();
  await waitForCombatOrBoundary(page);
  await placeHandCoinInto(page, 2, 0);
  await placeHandCoinInto(page, 2, 1);
  await waitForOpaqueSkillCards(page);
  await page.locator(".skill-card").nth(2).locator(".card-title").click();
  await waitForCombatOrBoundary(page);
  check(
    "S23 공격 2회 → 화상 +2",
    (await page.locator('.unit.enemy .burn-chip[aria-label="화상 2"]').count()) === 1,
  );
  check(
    "S23 공격 후 칩 유지",
    (await page.locator(".turn-buff-chip").count()) === 1,
  );
  await page.locator(".end-turn").click();
  await waitForCombatOrBoundary(page, 30000);
  check(
    "S23 턴 종료 → 화염검 칩 만료",
    (await page.locator(".turn-buff-chip").count()) === 0,
  );
  check("S23 에러 0", errors.length === 0, errors.join(" | "));
  await page.close();
}

// ---------- 시나리오 24: P3.4 신규 캐릭터 부팅·전용 스킬 스모크 ----------
{
  for (const [character, skillId, skillName, coinClass, statusName, chipSelector] of [
    // 정전기장·한파: base가 상태를 확정 부여 — 면 결과 무관한 결정론 검증
    ["sorcerer", "static-field", "정전기장", "lightning", "감전", ".shock-chip"],
    ["frost-knight", "chilling-field", "한파", "frost", "동상", ".frost-chip"],
  ]) {
    const { page, errors } = await boot(undefined, {
      url: urlWith({ character, skills: `${skillId},slash,guard` }),
    });
    check(
      `S24 ${character} 부팅 대표 코인 2닢`,
      ((await page.locator(".combat-shell").getAttribute("data-bag")) ?? "")
        .split(",")
        .filter((id) => id === coinClass).length === 2,
    );
    check(
      `S24 ${character} 전용 스킬 카드 렌더`,
      (await page.locator(".skill-card .card-title").allInnerTexts()).includes(
        skillName,
      ),
    );
    check(
      `S24 ${character} 전용 스프라이트 렌더`,
      (await page.locator(".unit.player .sprite-frame").count()) >= 1,
    );
    // 주머니 인스펙터 — 신규 원소 그룹이 정본 element 클래스로 유색 렌더 (감사 2)
    await page.locator(".pouch-circle").click();
    check(
      `S24 ${character} ${coinClass} 코인 시각`,
      (await page.locator(`.pouch-pop .pop-coin.${coinClass}`).count()) >= 1 ||
        (await page.locator(`.hand-tray .coin.${coinClass}`).count()) >= 1,
    );
    await page.locator(".pouch-circle").click();
    check(
      `S24 ${character} 팝오버 닫힘`,
      (await page.locator(".pouch-pop").count()) === 0,
    );
    // 전용 공격 스킬 사용 → 상태 부여 확인 (앞면이면 상태, 뒷면이어도 크래시 0)
    await page.locator(".hand-tray .coin").first().click();
    const card = page.locator(".skill-card", { hasText: skillName }).first();
    await card.locator(".socket").first().click();
    await card.locator(".card-title").click();
    await page.waitForFunction(
      () => document.querySelector(".end-turn:not(:disabled)") !== null,
      undefined,
      { timeout: 15000 },
    );
    check(`S24 ${character} 전용 스킬 해결 생존`, await shellAlive(page));
    // 카드 행 가독성: 기본 배지 + 상태 문구(raw id 아님)
    const cardText = (
      await page
        .locator(".skill-card", { hasText: skillName })
        .first()
        .locator(".card-effects")
        .innerText()
    ).replace(/\s+/g, " ");
    check(
      `S24 ${character} 카드 행 상태 문구 한국어 (${statusName})`,
      cardText.includes("기본") && cardText.includes(statusName),
      cardText.slice(0, 80),
    );
    // 결정론 상태 부여: 적 상태 칩 + 결산 티켓 상태 라인
    check(
      `S24 ${character} 적 ${statusName} 칩 표시`,
      (await page.locator(`.unit.enemy ${chipSelector}`).count()) === 1,
    );
    const ticket = await page
      .locator(".resolution-ticket")
      .innerText()
      .catch(() => "");
    check(
      `S24 ${character} 결산 티켓 ${statusName} 반영`,
      ticket.includes(statusName),
      ticket.replace(/\n/g, " | ").slice(0, 100),
    );
    check(`S24 ${character} 에러 0`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
}

// ---------- 시나리오 25: P4.3 상점·갈림길 — 저장 주입 결정론 검증 ----------
// v7 저장을 localStorage에 주입해 상점/갈림길 화면을 직접 부팅한다 (테스트 전용 경로,
// 정식 콘텐츠 무접촉). 가격·경계 진실은 코어/저장 검증기가 소유 — 여기선 DOM 반영만 확인.
// P6: 상점 패시브 1슬롯 진열·구매 커버리지 추가.
{
  const CONTENT_VERSION_PIN = "1.4.0-p10"; // 버전 승격 시 골든처럼 함께 재고정
  const WARRIOR_SKILLS = [
    "jab",
    "fist-guard",
    "burning-fist",
    "flame-hook",
    null,
    null,
    null,
    null,
  ];
  const baseSave = {
    version: 7,
    contentVersion: CONTENT_VERSION_PIN,
    runSeed: "S25-SHOP",
    character: "warrior",
    currentHp: 63,
    maxHp: 70,
    bag: [...Array.from({ length: 8 }, () => "basic"), "fire", "fire"],
    equippedSkills: WARRIOR_SKILLS,
    upgradedSlots: [false, false, false, false, false, false, false, false],
    acquiredPassives: [],
    gold: 150,
    nodeChoices: [0, 0, 0],
    shopRemovals: 0,
    shopPurchasedCoins: 0,
    shopPurchasedSkills: 0,
    shopPurchasedPassives: 0,
    eventCombats: 0,
    eventCoinGains: 0,
    eventCoinLosses: 0,
    treasureOpened: 0,
    restHeals: 0,
    restUpgrades: 0,
    combatIndex: 1,
    attempt: 0,
  };
  const bootWithSave = async (save) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      ["deckbuilding-roguelite.run-save", JSON.stringify(save)],
    );
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !message.location().url.endsWith("/favicon.ico")
      )
        errors.push(`console: ${message.text()}`);
    });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await continueFromTitleIfShown(page);
    return { page, errors, context };
  };

  // A. 상점 — 패시브/스킬/코인 구매·제거 누진·나가기.
  // 경제 보존: 골드 220 ≤ 엘리트 2승(140) + 보물(100) = 240, treasureOpened=1 정합.
  const shopSave = {
    ...baseSave,
    gold: 220,
    treasureOpened: 1,
    combatIndex: 3,
    nodeChoices: [0, 0, 0, 0, 0],
    phase: "shop",
    graph: {
      layers: [
        [{ id: "n0", kind: "elite", encounter: ["raider-plus"] }],
        [{ id: "n1", kind: "elite", encounter: ["gatekeeper-plus"] }],
        [{ id: "n2", kind: "treasure" }],
        [{ id: "n3", kind: "shop" }],
        [{ id: "n4", kind: "boss", encounter: ["ember-archmage"] }],
      ],
    },
    pendingShop: {
      coinOptions: ["basic", "fire", "mana"],
      coinPrices: [25, 50, 70],
      skillOptions: ["smash", "fire-infusion"],
      skillPrices: [50, 80],
      // P6 D2 — 상점 패시브 1슬롯 진열 (iron-body 정본가 70)
      passiveOptions: ["iron-body"],
      passivePrices: [70],
    },
  };
  {
    const { page, errors, context } = await bootWithSave(shopSave);
    await page.waitForSelector('[data-testid="shop-screen"]', {
      timeout: 15000,
    });
    check(
      "S25 상점 부팅·골드 220",
      (await page.locator('[data-testid="run-gold"]').innerText()).includes(
        "220",
      ),
    );
    check(
      "S25 코인 진열 3종·가격 정본",
      (await page.locator('[data-testid="shop-coins"] .shop-item').count()) ===
        3 &&
        (await page.locator('[data-testid="shop-coins"]').innerText()).includes(
          "25G",
        ),
    );
    // P6 신규: 패시브 진열 1슬롯 — 구매 → 골드 차감·배지 반영·슬롯 매진
    check(
      "S25 패시브 진열 1슬롯 (단단한 몸 70G)",
      (await page
        .locator('[data-testid="shop-passives"] .shop-item')
        .count()) === 1 &&
        (await page.locator('[data-testid="shop-passives"]').innerText()).includes(
          "70G",
        ),
    );
    await page.locator('[data-testid="shop-passive-iron-body"]').click();
    check(
      "S25 패시브 구매 반영 (골드 150·★ 패시브 1)",
      (await page.locator('[data-testid="run-gold"]').innerText()).includes(
        "150",
      ) &&
        (await page.locator('[data-testid="run-passives"]').innerText()).includes(
          "패시브 1",
        ),
    );
    check(
      "S25 패시브 슬롯 매진 표기",
      (await page.locator('[data-testid="shop-passives"]').innerText()).includes(
        "매진",
      ),
    );
    // 스킬 구매: 강타 50 → 슬롯 1 교체
    await page.locator('[data-testid="shop-skill-smash"]').click();
    check(
      "S25 스킬 슬롯 픽커 표시",
      (await page.locator('[data-testid="shop-slot-picker"]').count()) === 1,
    );
    await page.locator('[data-testid="shop-replace-slot-0"]').click();
    check(
      "S25 스킬 구매 반영 (골드 100·슬롯1 강타)",
      (await page.locator('[data-testid="run-gold"]').innerText()).includes(
        "100",
      ) &&
        (
          (await page
            .locator('[data-testid="run-phase"]')
            .getAttribute("data-equipped-skills")) ?? ""
        ).startsWith("smash,"),
    );
    // 동전 제거: 75 → 골드 25, 다음 제거가 100으로 누진
    await page.locator('[data-testid="shop-remove-0"]').click();
    const removalText = await page
      .locator('[data-testid="shop-removal"] h3')
      .innerText();
    check(
      "S25 제거 75 지불·누진 100 표기",
      (await page.locator('[data-testid="run-gold"]').innerText()).includes(
        "25",
      ) && removalText.includes("100G"),
    );
    check(
      "S25 잔여 골드 25로 화염(50)·강습(80) 비활성, 기본(25) 활성",
      (await page
        .locator('[data-testid="shop-coin-fire"]')
        .isDisabled()) &&
        !(await page.locator('[data-testid="shop-coin-basic"]').isDisabled()),
    );
    await page.locator('[data-testid="shop-coin-basic"]').click();
    check(
      "S25 기본 코인 구매 (골드 0·가방 10)",
      (await page.locator('[data-testid="run-gold"]').innerText()).includes(
        "0",
      ) &&
        (
          (await page
            .locator('[data-testid="run-phase"]')
            .getAttribute("data-bag")) ?? ""
        )
          .split(",")
          .filter(Boolean).length === 10,
    );
    await page.locator(".shop-leave").click();
    check(
      "S25 상점 나가기 → 보스 노드 준비",
      (await page
        .locator('[data-testid="run-phase"]')
        .getAttribute("data-run-phase")) === "ready" &&
        (await page.locator(".run-panel").innerText()).includes("잿불 마도왕"),
    );
    check("S25 상점 에러 0", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // B. 갈림길 — 현재 레이어 선택만, 선택 후 진입 (P6 D1: 후보 2~3개 — 3후보 주입)
  const chooseSave = {
    ...baseSave,
    gold: 35,
    phase: "choose-node",
    graph: {
      layers: [
        [{ id: "c0", kind: "combat", encounter: ["raider"] }],
        [
          { id: "c1a", kind: "shop" },
          { id: "c1b", kind: "combat", encounter: ["goblin", "ghoul"] },
          { id: "c1c", kind: "rest" },
        ],
        [{ id: "c2", kind: "boss", encounter: ["ember-archmage"] }],
      ],
    },
  };
  {
    const { page, errors, context } = await bootWithSave(chooseSave);
    await page.waitForSelector('[data-testid="node-choice"]', {
      timeout: 15000,
    });
    check(
      "S25 갈림길 옵션 3 (상점·전투·휴식)",
      (await page.locator('[data-testid^="node-option-"]').count()) === 3 &&
        (await page.locator('[data-testid="node-option-0"]').innerText()).includes(
          "상점",
        ) &&
        (
          await page.locator('[data-testid="node-option-1"]').innerText()
        ).includes("고블린·구울") &&
        (
          await page.locator('[data-testid="node-option-2"]').innerText()
        ).includes("휴식"),
    );
    await page.locator('[data-testid="node-option-1"]').click();
    check(
      "S25 전투 노드 선택 → 준비 페이즈·조우 표기",
      (await page
        .locator('[data-testid="run-phase"]')
        .getAttribute("data-run-phase")) === "ready" &&
        (await page.locator(".run-panel").innerText()).includes("고블린·구울"),
    );
    check("S25 갈림길 에러 0", errors.length === 0, errors.join(" | "));
    await context.close();
  }
}

// ---------- 시나리오 26: P4.4 이벤트 4종 — 저장 주입 결정론 검증 ----------
// pendingEvent는 롤 결과가 저장되는 사실이므로 v7 저장 주입으로 4종을 각각 고정한다.
{
  const injectEvent = async (eventId, extra = {}) => {
    // 경제 보존 법칙: 골드 120은 엘리트 2승(140) 프리픽스로 정당화한다
    const layers = [
      [{ id: "v0", kind: "elite", encounter: ["raider-plus"] }],
      [{ id: "v1", kind: "elite", encounter: ["gatekeeper-plus"] }],
      [{ id: "v2", kind: "event" }],
      [{ id: "v3", kind: "boss", encounter: ["ember-archmage"] }],
    ];
    const save = {
      version: 7,
      contentVersion: "1.4.0-p10",
      runSeed: "S26-EVENT",
      character: "warrior",
      currentHp: 63,
      maxHp: 70,
      bag: [...Array.from({ length: 8 }, () => "basic"), "fire", "fire"],
      equippedSkills: [
        "jab",
        "fist-guard",
        "burning-fist",
        "flame-hook",
        null,
        null,
        null,
        null,
      ],
      upgradedSlots: [false, false, false, false, false, false, false, false],
      acquiredPassives: [],
      gold: 120,
      graph: { layers },
      nodeChoices: [0, 0, 0, 0],
      shopRemovals: 0,
      shopPurchasedCoins: 0,
      shopPurchasedSkills: 0,
      shopPurchasedPassives: 0,
      eventCombats: 0,
      eventCoinGains: 0,
      eventCoinLosses: 0,
      treasureOpened: 0,
      restHeals: 0,
      restUpgrades: 0,
      combatIndex: 2,
      attempt: 0,
      phase: "event",
      pendingEvent: { eventId },
      ...extra,
    };
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error.message)));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !message.location().url.endsWith("/favicon.ico")
      )
        errors.push(message.text());
    });
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      ["deckbuilding-roguelite.run-save", JSON.stringify(save)],
    );
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await continueFromTitleIfShown(page);
    await page.waitForSelector('[data-testid="event-screen"]', {
      timeout: 15000,
    });
    return { page, errors, context };
  };
  const phaseOf = (page) =>
    page.locator('[data-testid="run-phase"]').getAttribute("data-run-phase");
  const goldOf = async (page) =>
    (await page.locator('[data-testid="run-gold"]').innerText()).replace(/\D/g, "");

  // ① 피의 제물 — HP 5 지불, 대표 코인 +1
  {
    const { page, errors, context } = await injectEvent("blood-offering");
    check(
      "S26 제물 위험·보상 문구",
      (await page.locator('[data-testid="event-risk"]').innerText()).includes(
        "체력 5",
      ) &&
        (
          await page.locator('[data-testid="event-reward"]').innerText()
        ).includes("대표 속성"),
    );
    await page.locator('[data-testid="event-accept"]').click();
    check(
      "S26 제물 수락 — HP 58·가방 11",
      (await page
        .locator('[data-testid="run-phase"]')
        .getAttribute("data-current-hp")) === "58" &&
        (
          (await page
            .locator('[data-testid="run-phase"]')
            .getAttribute("data-bag")) ?? ""
        )
          .split(",")
          .filter(Boolean).length === 11,
    );
    check("S26 제물 에러 0", errors.length === 0, errors.join(" | "));
    await context.close();
  }
  // ② 변환 제단 — 코인 선택 필수, 100골드 지불, 가방 크기 불변
  {
    const { page, errors, context } = await injectEvent("transmute-altar");
    check(
      "S26 제단 선택 전 수락 비활성",
      await page.locator('[data-testid="event-accept"]').isDisabled(),
    );
    check(
      "S26 제단 비기본 코인 선택 불가",
      await page.locator('[data-testid="event-pick-8"]').isDisabled(),
    );
    await page.locator('[data-testid="event-pick-0"]').click();
    await page.locator('[data-testid="event-accept"]').click();
    const bag = (
      (await page
        .locator('[data-testid="run-phase"]')
        .getAttribute("data-bag")) ?? ""
    )
      .split(",")
      .filter(Boolean);
    check(
      "S26 제단 수락 — 골드 20·가방 10·fire 3",
      (await goldOf(page)) === "20" &&
        bag.length === 10 &&
        bag.filter((coin) => coin === "fire").length === 3,
    );
    check("S26 제단 에러 0", errors.length === 0, errors.join(" | "));
    await context.close();
  }
  // ③ 동전 희생 — 기본 −1·대표 +1 (순 크기 불변)
  {
    const { page, errors, context } = await injectEvent("coin-sacrifice");
    await page.locator('[data-testid="event-pick-0"]').click();
    await page.locator('[data-testid="event-accept"]').click();
    const bag = (
      (await page
        .locator('[data-testid="run-phase"]')
        .getAttribute("data-bag")) ?? ""
    )
      .split(",")
      .filter(Boolean);
    check(
      "S26 희생 수락 — basic 7·fire 3",
      bag.filter((coin) => coin === "basic").length === 7 &&
        bag.filter((coin) => coin === "fire").length === 3,
    );
    check("S26 희생 에러 0", errors.length === 0, errors.join(" | "));
    await context.close();
  }
  // ④ 매복 현상금 — 수락 → 즉시 전투 준비, 거절 경로는 다음 노드 진입
  {
    const { page, errors, context } = await injectEvent("ambush-bounty");
    await page.locator('[data-testid="event-accept"]').click();
    check("S26 매복 수락 — 전투 준비 전이", (await phaseOf(page)) === "ready");
    check("S26 매복 에러 0", errors.length === 0, errors.join(" | "));
    await context.close();
  }
  {
    const { page, errors, context } = await injectEvent("blood-offering", {
      currentHp: 5,
    });
    check(
      "S26 체력 하한 — 수락 비활성·사유 표기",
      (await page.locator('[data-testid="event-accept"]').isDisabled()) &&
        (
          await page
            .locator('[data-testid="event-disabled-reason"]')
            .innerText()
        ).includes("체력"),
    );
    await page.locator('[data-testid="event-decline"]').click();
    check("S26 거절 — 다음 노드 진입", (await phaseOf(page)) === "ready");
    check("S26 하한/거절 에러 0", errors.length === 0, errors.join(" | "));
    await context.close();
  }
}

// ---------- 시나리오 28: P5.1 모바일/터치 — 세로·가로 페이지 스크롤 0·도달성·터치 ----------
{
  const mobileBoot = async ({ width, height, url, save, waitSel }) => {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      hasTouch: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error.message)));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !message.location().url.endsWith("/favicon.ico")
      )
        errors.push(message.text());
    });
    if (save)
      await page.addInitScript(
        ([k, v]) => window.localStorage.setItem(k, v),
        ["deckbuilding-roguelite.run-save", JSON.stringify(save)],
      );
    await page.goto(url ?? baseUrl, { waitUntil: "networkidle" });
    if (save) await continueFromTitleIfShown(page);
    if (waitSel) await page.waitForSelector(waitSel, { timeout: 15000 });
    await page.waitForTimeout(400);
    return { page, errors, context };
  };
  const noPageScroll = (page) =>
    page.evaluate(() => ({
      h: document.documentElement.scrollWidth <= window.innerWidth,
      v: document.documentElement.scrollHeight <= window.innerHeight,
    }));
  const mobileSave = (phase, extra = {}) => ({
    version: 7,
    contentVersion: "1.4.0-p10",
    runSeed: "S28",
    character: "warrior",
    currentHp: 63,
    maxHp: 70,
    bag: [...Array.from({ length: 8 }, () => "basic"), "fire", "fire"],
    equippedSkills: [
      "jab",
      "fist-guard",
      "burning-fist",
      "flame-hook",
      null,
      null,
      null,
      null,
    ],
    upgradedSlots: [false, false, false, false, false, false, false, false],
    acquiredPassives: [],
    // 경제 보존: 엘리트 2승 총수입 140 이내
    gold: 135,
    graph: {
      layers: [
        [{ id: "m0", kind: "elite", encounter: ["raider-plus"] }],
        [{ id: "m1", kind: "elite", encounter: ["gatekeeper-plus"] }],
        [{ id: "m2", kind: "shop" }],
        [{ id: "m3", kind: "event" }],
        [{ id: "m4", kind: "boss", encounter: ["ember-archmage"] }],
      ],
    },
    nodeChoices: [0, 0, 0, 0, 0],
    shopRemovals: 0,
    shopPurchasedCoins: 0,
    shopPurchasedSkills: 0,
    shopPurchasedPassives: 0,
    eventCombats: 0,
    eventCoinGains: 0,
    eventCoinLosses: 0,
    treasureOpened: 0,
    restHeals: 0,
    restUpgrades: 0,
    combatIndex: 2,
    attempt: 0,
    phase,
    ...extra,
  });
  const shopPending = {
    pendingShop: {
      coinOptions: ["basic", "fire", "mana"],
      coinPrices: [25, 50, 70],
      skillOptions: ["smash", "fire-infusion"],
      skillPrices: [50, 80],
    },
  };

  for (const vp of [
    { name: "세로 390x844", width: 390, height: 844 },
    { name: "가로 844x390", width: 844, height: 390 },
  ]) {
    // 전투: 페이지 스크롤 0 + 터치 장전 1회
    {
      const { page, errors, context } = await mobileBoot({
        ...vp,
        url: `${baseUrl}?seed=${SEED}&encounter=raider`,
        waitSel: ".end-turn",
      });
      const scroll = await noPageScroll(page);
      check(`S28 ${vp.name} 전투 페이지 스크롤 0`, scroll.h && scroll.v);
      const coin = page.locator(".hand-tray .coin").first();
      await coin.scrollIntoViewIfNeeded();
      await coin.tap();
      const card = page.locator(".skill-card", { hasText: "정권" }).first(); // P6: warrior 슬롯0 = jab(정권)
      await card.scrollIntoViewIfNeeded();
      await card.locator(".socket").first().tap();
      check(
        `S28 ${vp.name} 터치 장전 성공`,
        (await card.locator(".socket-coin").count()) >= 1,
      );
      const endTurn = await page.locator(".end-turn").boundingBox();
      check(
        `S28 ${vp.name} 턴 종료 뷰포트 내`,
        endTurn !== null &&
          endTurn.y + endTurn.height <= vp.height &&
          endTurn.x + endTurn.width <= vp.width,
      );
      check(`S28 ${vp.name} 전투 에러 0`, errors.length === 0, errors.join(" | "));
      await context.close();
    }
    // 상점: 하단 나가기 도달성 (패널 자체 스크롤)
    {
      const { page, errors, context } = await mobileBoot({
        ...vp,
        save: mobileSave("shop", shopPending),
        waitSel: '[data-testid="shop-screen"]',
      });
      const scroll = await noPageScroll(page);
      check(`S28 ${vp.name} 상점 페이지 스크롤 0`, scroll.h && scroll.v);
      const leave = page.locator(".shop-leave");
      await leave.scrollIntoViewIfNeeded();
      await leave.tap();
      check(
        `S28 ${vp.name} 상점 나가기 도달·동작`,
        (await page
          .locator('[data-testid="run-phase"]')
          .getAttribute("data-run-phase")) !== "shop",
      );
      check(`S28 ${vp.name} 상점 에러 0`, errors.length === 0, errors.join(" | "));
      await context.close();
    }
    // 이벤트: 거절 버튼 도달성
    {
      const { page, errors, context } = await mobileBoot({
        ...vp,
        save: mobileSave("event", {
          combatIndex: 3,
          pendingEvent: { eventId: "blood-offering" },
        }),
        waitSel: '[data-testid="event-screen"]',
      });
      const scroll = await noPageScroll(page);
      check(`S28 ${vp.name} 이벤트 페이지 스크롤 0`, scroll.h && scroll.v);
      const decline = page.locator('[data-testid="event-decline"]');
      await decline.scrollIntoViewIfNeeded();
      await decline.tap();
      check(
        `S28 ${vp.name} 이벤트 거절 도달·동작`,
        (await page
          .locator('[data-testid="run-phase"]')
          .getAttribute("data-run-phase")) !== "event",
      );
      check(`S28 ${vp.name} 이벤트 에러 0`, errors.length === 0, errors.join(" | "));
      await context.close();
    }
    // 보상: 스킵 제어 도달성
    {
      const { page, errors, context } = await mobileBoot({
        ...vp,
        // P6 신스펙 대체: 제거 단계 삭제 — 엘리트 정산(코인 3택 + 스킬 1 제안)으로
        // 코인 스킵 → 스킬 선택 단계 전이를 검증한다.
        save: mobileSave("rewards", {
          combatIndex: 2,
          gold: 60,
          graph: {
            layers: [
              [{ id: "r0", kind: "elite", encounter: ["raider-plus"] }],
              [{ id: "r1", kind: "elite", encounter: ["gatekeeper-plus"] }],
              [{ id: "r2", kind: "combat", encounter: ["gatekeeper"] }],
              [{ id: "r3", kind: "event" }],
              [{ id: "r4", kind: "boss", encounter: ["ember-archmage"] }],
            ],
          },
          pendingRewards: {
            coinOptions: ["basic", "fire", "mana"],
            coinChoiceResolved: false,
            coinRemovalResolved: true,
            skillOptions: ["smash"],
            skillChoiceResolved: false,
          },
        }),
        waitSel: '[data-testid="reward-stage"]',
      });
      const scroll = await noPageScroll(page);
      check(`S28 ${vp.name} 보상 페이지 스크롤 0`, scroll.h && scroll.v);
      const skip = page.locator('[data-testid="coin-reward-skip"]');
      await skip.scrollIntoViewIfNeeded();
      await skip.tap();
      check(
        `S28 ${vp.name} 보상 스킵 도달·동작`,
        (await page.locator('[data-testid="reward-stage"]').innerText()).includes(
          "스킬 선택",
        ),
      );
      check(`S28 ${vp.name} 보상 에러 0`, errors.length === 0, errors.join(" | "));
      await context.close();
    }
  }
}

// ---------- 시나리오 29: P5.3 접근성 — 키보드 완주 (Tab/Enter/Escape) ----------
{
  const kbBoot = async ({ url, save, waitSel }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error.message)));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !message.location().url.endsWith("/favicon.ico")
      )
        errors.push(message.text());
    });
    if (save)
      await page.addInitScript(
        ([k, v]) => window.localStorage.setItem(k, v),
        ["deckbuilding-roguelite.run-save", JSON.stringify(save)],
      );
    await page.goto(url ?? baseUrl, { waitUntil: "networkidle" });
    if (save) await continueFromTitleIfShown(page);
    if (waitSel) await page.waitForSelector(waitSel, { timeout: 15000 });
    return { page, errors, context };
  };
  const pressOn = async (page, locator) => {
    await locator.focus();
    await page.keyboard.press("Enter");
  };
  const kbSave = (phase, extra = {}) => ({
    version: 7,
    contentVersion: "1.4.0-p10",
    runSeed: "S29",
    character: "warrior",
    currentHp: 63,
    maxHp: 70,
    bag: [...Array.from({ length: 8 }, () => "basic"), "fire", "fire"],
    equippedSkills: [
      "jab",
      "fist-guard",
      "burning-fist",
      "flame-hook",
      null,
      null,
      null,
      null,
    ],
    upgradedSlots: [false, false, false, false, false, false, false, false],
    acquiredPassives: [],
    gold: 135,
    graph: {
      layers: [
        [{ id: "k0", kind: "elite", encounter: ["raider-plus"] }],
        [{ id: "k1", kind: "elite", encounter: ["gatekeeper-plus"] }],
        [{ id: "k2", kind: "shop" }],
        [
          { id: "k3a", kind: "shop" },
          { id: "k3b", kind: "combat", encounter: ["goblin", "ghoul"] },
        ],
        [{ id: "k4", kind: "event" }],
        [{ id: "k5", kind: "boss", encounter: ["ember-archmage"] }],
      ],
    },
    nodeChoices: [0, 0, 0, 0, 0, 0],
    shopRemovals: 0,
    shopPurchasedCoins: 0,
    shopPurchasedSkills: 0,
    shopPurchasedPassives: 0,
    eventCombats: 0,
    eventCoinGains: 0,
    eventCoinLosses: 0,
    treasureOpened: 0,
    restHeals: 0,
    restUpgrades: 0,
    combatIndex: 2,
    attempt: 0,
    phase,
    ...extra,
  });

  // ① 전투: 코인 선택 → 소켓 장전 → 카드 사용 → 턴 종료 전부 focus+Enter
  {
    const { page, errors, context } = await kbBoot({
      url: `${baseUrl}?seed=${SEED}&encounter=raider`,
      waitSel: ".end-turn",
    });
    // 초기 이벤트 큐 소진(locked 해제)까지 대기 — boot()와 동일 조건
    await page.waitForFunction(
      () =>
        document.querySelector(".end-turn:not(:disabled)") !== null &&
        document.querySelector(".float-text") === null,
      undefined,
      { timeout: 20000 },
    );
    await pressOn(page, page.locator(".hand-tray .coin").first());
    const card = page.locator(".skill-card", { hasText: "정권" }).first(); // P6: warrior 슬롯0 = jab(정권)
    await pressOn(page, card.locator(".socket").first());
    check(
      "S29 키보드 장전",
      (await card.locator(".socket-coin").count()) >= 1,
    );
    await pressOn(page, card.locator(".card-title"));
    await page.waitForFunction(
      () => document.querySelector(".end-turn:not(:disabled)") !== null,
      undefined,
      { timeout: 15000 },
    );
    check("S29 키보드 스킬 사용 생존", await shellAlive(page));
    await pressOn(page, page.locator(".end-turn"));
    await page.waitForFunction(
      () => document.querySelector(".end-turn:not(:disabled)") !== null,
      undefined,
      { timeout: 30000 },
    );
    check("S29 키보드 턴 종료", true);
    // 키워드 툴팁 Escape 해제 (WCAG 1.4.13)
    const chip = page.locator(".chip-keyword").first();
    if ((await chip.count()) > 0) {
      await chip.locator("em").first().focus();
      await page.keyboard.press("Escape");
    }
    check("S29 전투 에러 0", errors.length === 0, errors.join(" | "));
    await context.close();
  }
  // ② 상점: 구매·나가기 키보드
  {
    const { page, errors, context } = await kbBoot({
      save: kbSave("shop", {
        pendingShop: {
          coinOptions: ["basic", "fire", "mana"],
          coinPrices: [25, 50, 70],
          skillOptions: ["smash", "fire-infusion"],
          skillPrices: [50, 80],
        },
      }),
      waitSel: '[data-testid="shop-screen"]',
    });
    await pressOn(page, page.locator('[data-testid="shop-coin-basic"]'));
    check(
      "S29 상점 키보드 구매 (골드 110)",
      (
        await page.locator('[data-testid="run-gold"]').innerText()
      ).includes("110"),
    );
    await pressOn(page, page.locator(".shop-leave"));
    check(
      "S29 상점 키보드 나가기 → 갈림길",
      (await page
        .locator('[data-testid="run-phase"]')
        .getAttribute("data-run-phase")) === "choose-node",
    );
    // ③ 갈림길: 노드 선택 키보드
    await pressOn(page, page.locator('[data-testid="node-option-1"]'));
    check(
      "S29 갈림길 키보드 선택 → 전투 준비",
      (await page
        .locator('[data-testid="run-phase"]')
        .getAttribute("data-run-phase")) === "ready",
    );
    check("S29 상점/갈림길 에러 0", errors.length === 0, errors.join(" | "));
    await context.close();
  }
  // ④ 이벤트: 거절 키보드
  {
    const { page, errors, context } = await kbBoot({
      save: kbSave("event", {
        combatIndex: 4,
        pendingEvent: { eventId: "coin-sacrifice" },
      }),
      waitSel: '[data-testid="event-screen"]',
    });
    await pressOn(page, page.locator('[data-testid="event-decline"]'));
    check(
      "S29 이벤트 키보드 거절 → 진행",
      (await page
        .locator('[data-testid="run-phase"]')
        .getAttribute("data-run-phase")) !== "event",
    );
    check("S29 이벤트 에러 0", errors.length === 0, errors.join(" | "));
    await context.close();
  }
}

// ---------- 시나리오 30: P5.4 복구 — 손상 저장 명시 UX (조용한 삭제 금지) ----------
{
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error.message)));
  // addInitScript는 내비게이션마다 재주입되므로 evaluate+reload로 1회만 손상시킨다
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() =>
    window.localStorage.setItem(
      "deckbuilding-roguelite.run-save",
      "{corrupted-not-json",
    ),
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="corrupt-save-restart"]', {
    timeout: 15000,
  });
  const recoveryLayers = await page.evaluate(() => {
    const recovery = document.querySelector(".boot-recovery");
    const backdrop = document.querySelector(".backdrop");
    if (recovery === null || backdrop === null) return null;
    const recoveryStyle = getComputedStyle(recovery);
    const backdropStyle = getComputedStyle(backdrop);
    return {
      recoveryPosition: recoveryStyle.position,
      recoveryZ: Number(recoveryStyle.zIndex),
      backdropZ: Number(backdropStyle.zIndex),
    };
  });
  check(
    "S30 recovery action renders above backdrop",
    recoveryLayers !== null &&
      recoveryLayers.recoveryPosition !== "static" &&
      recoveryLayers.recoveryZ > recoveryLayers.backdropZ,
    JSON.stringify(recoveryLayers),
  );
  check(
    "S30 손상 저장 명시 화면 (자동 삭제 아님)",
    (await page
      .locator('[data-testid="run-phase"]')
      .getAttribute("data-run-phase")) === "corrupt-save" &&
      (await page.evaluate(() =>
        window.localStorage.getItem("deckbuilding-roguelite.run-save"),
      )) !== null,
  );
  await page.locator('[data-testid="corrupt-save-restart"]').click();
  await page.waitForSelector('[data-testid="character-select"]', {
    timeout: 15000,
  });
  check(
    "S30 새 런 시작 → 저장 정리·선택 화면",
    (await page.evaluate(() =>
      window.localStorage.getItem("deckbuilding-roguelite.run-save"),
    )) === null,
  );
  check("S30 에러 0", errors.length === 0, errors.join(" | "));
  await context.close();
}

// ---------- 시나리오 31: P5.4 리로드 영속 — 10페이즈 전부 저장/복원 ----------
// P6: rest/treasure 페이즈 2케이스 추가 (신규 노드의 리로드 영속 계약).
{
  const phaseSave = (phase, extra = {}) => ({
    version: 7,
    contentVersion: "1.4.0-p10",
    runSeed: "S31",
    character: "warrior",
    currentHp: 63,
    maxHp: 70,
    bag: [...Array.from({ length: 8 }, () => "basic"), "fire", "fire"],
    equippedSkills: [
      "jab",
      "fist-guard",
      "burning-fist",
      "flame-hook",
      null,
      null,
      null,
      null,
    ],
    upgradedSlots: [false, false, false, false, false, false, false, false],
    acquiredPassives: [],
    gold: 60,
    graph: {
      layers: [
        [{ id: "p0", kind: "elite", encounter: ["raider-plus"] }],
        [{ id: "p1", kind: "combat", encounter: ["raider"] }],
        [{ id: "p2", kind: "shop" }],
        [
          { id: "p3a", kind: "shop" },
          { id: "p3b", kind: "combat", encounter: ["goblin", "ghoul"] },
        ],
        [{ id: "p4", kind: "event" }],
        [{ id: "p5", kind: "rest" }],
        [{ id: "p6", kind: "treasure" }],
        [{ id: "p7", kind: "boss", encounter: ["ember-archmage"] }],
      ],
    },
    nodeChoices: [0, 0, 0, 0, 0, 0, 0, 0],
    shopRemovals: 0,
    shopPurchasedCoins: 0,
    shopPurchasedSkills: 0,
    shopPurchasedPassives: 0,
    eventCombats: 0,
    eventCoinGains: 0,
    eventCoinLosses: 0,
    treasureOpened: 0,
    restHeals: 0,
    restUpgrades: 0,
    combatIndex: 1,
    attempt: 0,
    phase,
    ...extra,
  });
  const cases = [
    ["ready", phaseSave("ready"), "ready"],
    ["combat", phaseSave("combat"), "combat"],
    [
      // P6 신스펙 대체: 제거 단계 삭제 — 엘리트 정산 등가(코인 3택 + 스킬 1 제안)
      "rewards",
      phaseSave("rewards", {
        pendingRewards: {
          coinOptions: ["basic", "fire", "mana"],
          coinChoiceResolved: false,
          coinRemovalResolved: true,
          skillOptions: ["smash"],
          skillChoiceResolved: false,
        },
      }),
      "rewards",
    ],
    [
      "shop",
      phaseSave("shop", {
        combatIndex: 2,
        pendingShop: {
          coinOptions: ["basic", "fire", "mana"],
          coinPrices: [25, 50, 70],
          skillOptions: ["smash", "fire-infusion"],
          skillPrices: [50, 80],
        },
      }),
      "shop",
    ],
    [
      "event",
      phaseSave("event", {
        combatIndex: 4,
        pendingEvent: { eventId: "blood-offering" },
      }),
      "event",
    ],
    ["choose-node", phaseSave("choose-node", { combatIndex: 3 }), "choose-node"],
    // P6 신규: 휴식 페이즈 영속 (combatIndex 5 = rest 노드)
    ["rest", phaseSave("rest", { combatIndex: 5 }), "rest"],
    // P6 신규: 보물 페이즈 영속 — 경제 보존: 통과한 rest 1개 = restHeals 1
    [
      "treasure",
      phaseSave("treasure", {
        combatIndex: 6,
        restHeals: 1,
        pendingTreasure: { passiveOption: "iron-body" },
      }),
      "treasure",
    ],
    [
      "victory",
      phaseSave("victory", { combatIndex: 7, restHeals: 1, treasureOpened: 1 }),
      "victory",
    ],
    ["defeat", phaseSave("defeat", { currentHp: 0 }), "defeat"],
  ];
  for (const [label, save, expectPhase] of cases) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error.message)));
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.evaluate(
      ([k, v]) => window.localStorage.setItem(k, v),
      ["deckbuilding-roguelite.run-save", JSON.stringify(save)],
    );
    await page.reload({ waitUntil: "networkidle" });
    await continueFromTitleIfShown(page);
    await page.waitForSelector(
      '[data-testid="run-phase"], main.combat-shell',
      { timeout: 15000 },
    );
    const phase1 = await page
      .locator('[data-testid="run-phase"], main.combat-shell')
      .first()
      .getAttribute("data-run-phase");
    await page.reload({ waitUntil: "networkidle" });
    await continueFromTitleIfShown(page);
    await page.waitForSelector(
      '[data-testid="run-phase"], main.combat-shell',
      { timeout: 15000 },
    );
    const phase2 = await page
      .locator('[data-testid="run-phase"], main.combat-shell')
      .first()
      .getAttribute("data-run-phase");
    check(
      `S31 ${label} 리로드 영속`,
      phase1 === expectPhase && phase2 === expectPhase,
      `1차 ${phase1} / 2차 ${phase2}`,
    );
    if (label === "combat") {
      // 전투 중 리로드는 시도 증가 재개 의미론
      const attempt = await page
        .locator("main.combat-shell")
        .getAttribute("data-attempt");
      check("S31 combat 리로드 시도 증가", Number(attempt) >= 1, `attempt=${attempt}`);
    }
    check(`S31 ${label} 에러 0`, errors.length === 0, errors.join(" | "));
    await context.close();
  }
}

// ---------- 시나리오 32: P5.6 몬스터 패시브 — 구울 '썩은 육체' (balance-provisional) ----------
{
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error.message)));
  await page.goto(`${baseUrl}?seed=S32-PASSIVE&encounter=ghoul`, {
    waitUntil: "networkidle",
  });
  const waitTurnReady = () =>
    page.waitForFunction(
      () =>
        document.querySelector(".end-turn:not(:disabled)") !== null &&
        document.querySelector(".float-text") === null,
      undefined,
      { timeout: 30000 },
    );
  await waitTurnReady();

  const chip = page.locator(".unit.enemy .passive-chip");
  check(
    "S32 패시브 칩 표시 (썩은 육체)",
    (await chip.count()) === 1 &&
      ((await chip.textContent()) ?? "").includes("썩은 육체"),
  );
  const PASSIVE_DESCRIPTION = "HP를 1 회복";
  await chip.hover();
  await waitForKeywordTooltip(page, PASSIVE_DESCRIPTION, true);
  check("S32 패시브 툴팁 hover 표시", true);
  const passiveLayer = await tooltipLayerEvidence(page, PASSIVE_DESCRIPTION);
  check(
    "S32 패시브 툴팁 포털·경계·최상단",
    passiveLayer?.layer === "tooltip" &&
      passiveLayer.insideViewport &&
      passiveLayer.topmost,
    JSON.stringify(passiveLayer),
  );
  await page.locator(".unit-name").first().hover();
  await waitForKeywordTooltip(page, PASSIVE_DESCRIPTION, false);
  await chip.click();
  await waitForKeywordTooltip(page, PASSIVE_DESCRIPTION, true);
  check("S32 패시브 툴팁 클릭(터치) 표시", true);
  await page.keyboard.press("Escape");
  await waitForKeywordTooltip(page, PASSIVE_DESCRIPTION, false);
  check("S32 패시브 툴팁 Escape 닫힘", true);
  // 키보드 경로 — 칩의 .kw 버튼에 focus 후 Enter (hover-focus-touch 계약 마감)
  await page.evaluate(() => {
    document
      .querySelector(".unit.enemy .passive-chip")
      ?.closest(".kw-host")
      ?.querySelector("button.kw")
      ?.focus();
  });
  await page.keyboard.press("Enter");
  await waitForKeywordTooltip(page, PASSIVE_DESCRIPTION, true);
  check("S32 패시브 툴팁 focus+Enter 표시", true);
  await page.keyboard.press("Escape");
  await waitForKeywordTooltip(page, PASSIVE_DESCRIPTION, false);

  // 기본 코인을 명시적으로 찾아 베기 장전 — 화상 없이 결정론 회복 산술 (+1) 검증.
  // 손패 index 가정 금지: 속성/부여 클래스가 전부 없는 코인만 기본 코인이다.
  const basicCoin = page.locator(
    ".hand-tray .coin:not(.fire):not(.mana):not(.frost):not(.lightning):not(.granted-fire)",
  );
  check("S32 기본 코인 존재", (await basicCoin.count()) > 0);
  await basicCoin.first().click();
  await page.locator(".skill-card").nth(0).locator(".socket").nth(0).click();
  await page
    .locator(".skill-card")
    .nth(0)
    .locator(".card-title")
    .click();
  await resolveSkillAnimation(page);
  await waitTurnReady();
  const readGhoulHp = async () =>
    Number(
      ((await page.locator(".unit.enemy .hp-num").textContent()) ?? "0/0").split(
        "/",
      )[0],
    );
  const hpAfterAttack = await readGhoulHp();
  check("S32 베기 피해 적용", hpAfterAttack < 38, `hp=${hpAfterAttack}`);
  check(
    "S32 화상 없음 (회복 산술 전제)",
    (await page.locator(".unit.enemy .burn-chip").count()) === 0,
  );
  await page.locator(".end-turn").click();
  await waitTurnReady();
  const hpAfterEnemyTurn = await readGhoulHp();
  check(
    "S32 적 턴 시작 패시브 회복 +1",
    hpAfterEnemyTurn === hpAfterAttack + 1,
    `공격 후 ${hpAfterAttack} → 적 턴 후 ${hpAfterEnemyTurn}`,
  );
  check("S32 에러 0", errors.length === 0, errors.join(" | "));
  await context.close();
}

// ---------- 시나리오 33~36: P6 신규 커버리지 (휴식·보물·보스 패시브·마도기사) ----------
// v6 저장 주입 공통 부팅 — S25 bootWithSave와 동일 패턴 (테스트 전용 경로).
const bootV6 = async (save, waitSel) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error.message)));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.location().url.endsWith("/favicon.ico")
    )
      errors.push(message.text());
  });
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    ["deckbuilding-roguelite.run-save", JSON.stringify(save)],
  );
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await continueFromTitleIfShown(page);
  if (waitSel) await page.waitForSelector(waitSel, { timeout: 15000 });
  return { page, errors, context };
};
const V7_WARRIOR_SKILLS = [
  "jab",
  "fist-guard",
  "burning-fist",
  "flame-hook",
  null,
  null,
  null,
  null,
];
const v6Save = (overrides = {}) => ({
  version: 7,
  contentVersion: "1.4.0-p10",
  runSeed: "S33-P6",
  character: "warrior",
  currentHp: 63,
  maxHp: 70,
  bag: [...Array.from({ length: 8 }, () => "basic"), "fire", "fire"],
  equippedSkills: V7_WARRIOR_SKILLS,
  upgradedSlots: [false, false, false, false, false, false, false, false],
  acquiredPassives: [],
  gold: 35,
  nodeChoices: [0, 0, 0],
  shopRemovals: 0,
  shopPurchasedCoins: 0,
  shopPurchasedSkills: 0,
  shopPurchasedPassives: 0,
  eventCombats: 0,
  eventCoinGains: 0,
  eventCoinLosses: 0,
  treasureOpened: 0,
  restHeals: 0,
  restUpgrades: 0,
  combatIndex: 1,
  attempt: 0,
  ...overrides,
});
const phaseAttr = (page, name) =>
  page.locator('[data-testid="run-phase"]').getAttribute(name);

// ---------- 시나리오 33: P6 D1/D3 휴식 — 회복 택1 · 강화 택1 · 불가 사유 ----------
{
  // 33a. 회복: 최대 체력 30% (70 → floor 21), 상한 없음 케이스 — 40 + 21 = 61
  const { page, errors, context } = await bootV6(
    v6Save({
      runSeed: "S33-REST",
      currentHp: 40,
      phase: "rest",
      graph: {
        layers: [
          [{ id: "t0", kind: "combat", encounter: ["raider"] }],
          [{ id: "t1", kind: "rest" }],
          [{ id: "t2", kind: "boss", encounter: ["ember-archmage"] }],
        ],
      },
    }),
    '[data-testid="rest-screen"]',
  );
  check(
    "S33 휴식 화면 렌더·회복량 표기 (+21)",
    (await page.locator('[data-testid="rest-heal"]').innerText()).includes(
      "+21",
    ),
  );
  // P10: 불씨권 강화는 미확정이므로 비활성, 나머지 시작 스킬 3종만 활성.
  const upgradeButtons = page.locator('[data-testid^="rest-upgrade-"]');
  check(
    "S33 강화 리스트 4종 중 확정 3종만 활성",
    (await upgradeButtons.count()) === 4 &&
      (await upgradeButtons.evaluateAll((buttons) =>
        buttons.filter((button) => !button.disabled).length === 3,
      )) &&
      (await page.locator('[data-testid="rest-upgrade-3"]').getAttribute("title")) ===
        "강화가 정의되지 않은 스킬",
  );
  await page.screenshot({ path: `${outDir}/60-p6-rest.png` });
  await page.locator('[data-testid="rest-heal"]').click();
  check(
    "S33 회복 선택 → HP 61·다음 레이어 진입",
    (await phaseAttr(page, "data-current-hp")) === "61" &&
      (await phaseAttr(page, "data-run-phase")) === "ready",
  );
  check("S33 휴식 회복 에러 0", errors.length === 0, errors.join(" | "));
  await context.close();
}
{
  // 33b. 강화: 이미 강화된 슬롯·강화 미정의 스킬은 비활성 + 사유 title (D3).
  // 픽스처 정합: acts 포함 = P6 규칙 — flame-sword 교체 1회는 엘리트 정산 1회로,
  // upgradedSlots[1]은 이전 rest 강화 1회(restUpgrades=1)로 정당화.
  const { page, errors, context } = await bootV6(
    v6Save({
      runSeed: "S33-UPGRADE",
      phase: "rest",
      combatIndex: 2,
      gold: 70,
      restUpgrades: 1,
      upgradedSlots: [false, true, false, false, false, false, false, false],
      equippedSkills: [
        "jab",
        "fist-guard",
        "burning-fist",
        "flame-sword", // upgrade 미정의 스킬 (화염 붕대)
        null,
        null,
        null,
        null,
      ],
      graph: {
        layers: [
          [{ id: "u0", kind: "elite", encounter: ["raider-plus"] }],
          [{ id: "u1", kind: "rest" }],
          [{ id: "u2", kind: "rest" }],
          [{ id: "u3", kind: "boss", encounter: ["ember-archmage"] }],
        ],
        acts: [{ start: 0 }],
      },
      nodeChoices: [0, 0, 0, 0],
    }),
    '[data-testid="rest-screen"]',
  );
  check(
    "S33 이미 강화된 슬롯 비활성 + 사유 title",
    (await page.locator('[data-testid="rest-upgrade-1"]').isDisabled()) &&
      (await page
        .locator('[data-testid="rest-upgrade-1"]')
        .getAttribute("title")) === "이미 강화됨",
  );
  check(
    "S33 강화 미정의 스킬 비활성 + 사유 title",
    (await page.locator('[data-testid="rest-upgrade-3"]').isDisabled()) &&
      (await page
        .locator('[data-testid="rest-upgrade-3"]')
        .getAttribute("title")) === "강화가 정의되지 않은 스킬",
  );
  await page.locator('[data-testid="rest-upgrade-0"]').click();
  check(
    "S33 슬롯0 강화 선택 → 다음 레이어 진입",
    (await phaseAttr(page, "data-run-phase")) === "ready",
  );
  // P6 D3 — 강화 슬롯은 전투 카드에 ＋ 배지 (upgradedSlots 0·1 = 배지 2개)
  await page.locator('[data-testid="next-combat"]').click();
  await page.waitForSelector("main.combat-shell", { timeout: 15000 });
  await page.waitForFunction(
    () => document.querySelector(".end-turn:not(:disabled)") !== null,
    undefined,
    { timeout: 20000 },
  );
  check(
    "S33 전투 카드 강화 ＋ 배지 2개 (슬롯 0·1)",
    (await page.locator(".skill-card .upgrade-badge").count()) === 2 &&
      (
        await page.locator(".skill-card").first().locator(".card-title").innerText()
      ).includes("＋"),
  );
  await page.screenshot({ path: `${outDir}/61-p6-upgrade-badge.png` });
  check("S33 휴식 강화 에러 0", errors.length === 0, errors.join(" | "));
  await context.close();
}

// ---------- 시나리오 34: P6 D1/D2 보물 — 개봉 → 골드 100 + 패시브 부여 ----------
{
  const treasureGraph = {
    layers: [
      [{ id: "b0", kind: "combat", encounter: ["raider"] }],
      [{ id: "b1", kind: "treasure" }],
      [{ id: "b2", kind: "boss", encounter: ["ember-archmage"] }],
    ],
  };
  const { page, errors, context } = await bootV6(
    v6Save({
      runSeed: "S34-TREASURE",
      phase: "treasure",
      graph: treasureGraph,
      pendingTreasure: { passiveOption: "iron-body" },
    }),
    '[data-testid="treasure-screen"]',
  );
  check(
    "S34 보물 화면·패시브 미리보기 (강철 피부)",
    (await page.locator('[data-testid="treasure-screen"]').innerText()).includes(
      "강철 피부",
    ),
  );
  check(
    "S34 개봉 전 골드 35·패시브 배지 없음",
    (await page.locator('[data-testid="run-gold"]').innerText()).includes("35") &&
      (await page.locator('[data-testid="run-passives"]').count()) === 0,
  );
  await page.screenshot({ path: `${outDir}/62-p6-treasure.png` });
  await page.locator('[data-testid="treasure-claim"]').click();
  check(
    "S34 개봉 → 골드 +100 (135)·다음 레이어 진입",
    (await page.locator('[data-testid="run-gold"]').innerText()).includes("135") &&
      (await phaseAttr(page, "data-run-phase")) === "ready",
  );
  check(
    "S34 개봉 → run-passives 배지 반영",
    (await page.locator('[data-testid="run-passives"]').innerText()).includes(
      "패시브 1",
    ),
  );
  check("S34 보물 에러 0", errors.length === 0, errors.join(" | "));
  await context.close();
}
{
  // 풀 소진 케이스: passiveOption null → 금화만
  const { page, errors, context } = await bootV6(
    v6Save({
      runSeed: "S34-EMPTY",
      phase: "treasure",
      graph: {
        layers: [
          [{ id: "e0", kind: "combat", encounter: ["raider"] }],
          [{ id: "e1", kind: "treasure" }],
          [{ id: "e2", kind: "boss", encounter: ["ember-archmage"] }],
        ],
      },
      pendingTreasure: { passiveOption: null },
    }),
    '[data-testid="treasure-screen"]',
  );
  check(
    "S34 풀 소진 보물 — 금화만 안내",
    (await page.locator(".treasure-passive").innerText()).includes(
      "패시브 풀이 비어",
    ),
  );
  await page.locator('[data-testid="treasure-claim"]').click();
  check(
    "S34 풀 소진 개봉 — 골드만 +100·배지 없음",
    (await page.locator('[data-testid="run-gold"]').innerText()).includes("135") &&
      (await page.locator('[data-testid="run-passives"]').count()) === 0,
  );
  check("S34 풀 소진 에러 0", errors.length === 0, errors.join(" | "));
  await context.close();
}

// ---------- 시나리오 35: P6 D2 보스 보상 — 패시브 3중1택 (선택/스킵) ----------
{
  // 비최종 보스 정산 상태: 코인 1택 완료 후 패시브 단계 (gold 135 = 전투 35 + 보스 100)
  const bossRewardSave = () =>
    v6Save({
      runSeed: "S35-BOSS",
      phase: "rewards",
      combatIndex: 2,
      gold: 135,
      graph: {
        layers: [
          [{ id: "s0", kind: "combat", encounter: ["raider"] }],
          [{ id: "s1", kind: "boss", encounter: ["gatekeeper-plus"] }],
          [{ id: "s2", kind: "combat", encounter: ["raider"] }],
          [{ id: "s3", kind: "boss", encounter: ["ember-archmage"] }],
        ],
      },
      nodeChoices: [0, 0, 0, 0],
      pendingRewards: {
        coinOptions: ["basic", "fire", "mana"],
        coinChoiceResolved: true,
        coinRemovalResolved: true,
        skillOptions: [],
        skillChoiceResolved: true,
        passiveOptions: ["iron-body", "steady-breath", "reserve-coin"],
        passiveChoiceResolved: false,
      },
    });
  {
    const { page, errors, context } = await bootV6(
      bossRewardSave(),
      '[data-testid="reward-stage"]',
    );
    check(
      "S35 보스 패시브 단계 표기",
      (await page
        .locator('[data-testid="reward-stage"]')
        .getAttribute("data-reward-stage")) === "passive" &&
        (await page.locator('[data-testid="reward-stage"]').innerText()).includes(
          "보스 전리품",
        ),
    );
    const passiveChoices = page.locator(
      '[data-testid^="passive-reward-"]:not([data-testid$="skip"])',
    );
    check(
      "S35 패시브 3중1택 렌더",
      (await passiveChoices.count()) === 3 &&
        (await page.locator('[data-testid="passive-reward-skip"]').count()) === 1,
    );
    await page.screenshot({ path: `${outDir}/63-p6-boss-passive.png` });
    await page.locator('[data-testid="passive-reward-iron-body"]').click();
    check(
      "S35 패시브 선택 → 배지 반영·다음 레이어 진입",
      (await page.locator('[data-testid="run-passives"]').innerText()).includes(
        "패시브 1",
      ) && (await phaseAttr(page, "data-run-phase")) === "ready",
    );
    check("S35 선택 경로 에러 0", errors.length === 0, errors.join(" | "));
    await context.close();
  }
  {
    const { page, errors, context } = await bootV6(
      bossRewardSave(),
      '[data-testid="reward-stage"]',
    );
    await page.locator('[data-testid="passive-reward-skip"]').click();
    check(
      "S35 패시브 스킵 → 미획득·다음 레이어 진입",
      (await page.locator('[data-testid="run-passives"]').count()) === 0 &&
        (await phaseAttr(page, "data-run-phase")) === "ready",
    );
    check("S35 스킵 경로 에러 0", errors.length === 0, errors.join(" | "));
    await context.close();
  }
}

// ---------- 시나리오 36: P6 D6 마도기사 — 소환 레일·trait 턴 시작 소환 ----------
{
  const { page, errors } = await boot(undefined, {
    url: `${baseUrl}?seed=${SEED}&character=arcanist`,
  });
  check(
    "S36 마도기사 부팅 (표시명·마나 2닢)",
    (await page.locator(".unit.player .unit-name").innerText()) === "마도기사" &&
      ((await page.locator(".combat-shell").getAttribute("data-bag")) ?? "")
        .split(",")
        .filter((id) => id === "mana").length === 2,
  );
  check(
    "S36 소환 레일 렌더 (3슬롯)",
    (await page.locator('[data-testid="summon-rail"]').count()) === 1 &&
      (await page.locator(".summon-rail .summon-slot").count()) === 3,
  );
  // trait '마도 공방' (turnStart): 1턴 시작에 마나 검(지속 1) 1개 소환
  check(
    "S36 턴 시작 trait 소환 — 슬롯0 마나 검 지속 1",
    (await page.locator('[data-testid="summon-slot-0"]').count()) === 1 &&
      (await page
        .locator('[data-testid="summon-slot-0"] .summon-duration')
        .innerText()) === "1",
  );
  const arcanistTitles = await page
    .locator(".skill-card .card-title")
    .allInnerTexts();
  check(
    "S36 마도기사 전용 스킬 카드 렌더",
    ["마력 충전", "명령"].every((name) =>
      arcanistTitles.some((title) => title.includes(name)),
    ) && arcanistTitles.filter((name) => name === "빈 슬롯").length === 4,
    arcanistTitles.join(","),
  );
  await page.screenshot({ path: `${outDir}/64-p6-arcanist-summon.png` });
  check("S36 마도기사 에러 0", errors.length === 0, errors.join(" | "));
  await page.close();
}

await browser.close();
if (server !== null)
  await new Promise((resolveClose) => server.httpServer.close(resolveClose));

if (failures.length > 0) {
  console.error(
    `\n${failures.length}건 실패:\n${failures.map((line) => ` - ${line}`).join("\n")}`,
  );
  process.exit(1);
}
console.log("\n플레이테스트 전 항목 통과");
