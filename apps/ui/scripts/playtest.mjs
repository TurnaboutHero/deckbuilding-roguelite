// 결정론 브라우저 플레이테스트 — 코인 장전 루프·플립 가시성·불타는 일격 회귀·뷰포트 검증.
// 사용: node scripts/playtest.mjs [스크린샷 디렉토리 (기본 /tmp/playtest)]
// 전제: `pnpm build` 완료 (vite preview가 dist를 서빙). 실패 시 exit code 1 + FAIL 목록 출력.
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { preview } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] ?? '/tmp/playtest';
const SEED = 'BRAVE-EMBER-42';
const URL = `http://127.0.0.1:4174/deckbuilding-roguelite/?seed=${SEED}`;

const failures = [];
const check = (name, condition, detail = '') => {
  const mark = condition ? 'ok' : 'FAIL';
  console.log(`[${mark}] ${name}${detail === '' ? '' : ` — ${detail}`}`);
  if (!condition) failures.push(`${name}${detail === '' ? '' : ` — ${detail}`}`);
};

const server = await preview({ root, preview: { host: '127.0.0.1', port: 4174, strictPort: true } });
const browser = await chromium.launch();
await mkdir(outDir, { recursive: true });

/** 페이지 준비 — 콘솔/페이지 에러 수집기 부착 후 이벤트 큐가 빠질 때까지 대기 */
const boot = async (viewport = { width: 1280, height: 720 }) => {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => document.querySelector('.end-turn:not(:disabled)') !== null && document.querySelector('.float-text') === null,
    undefined,
    { timeout: 15000 }
  );
  return { page, errors };
};

const shellAlive = (page) => page.evaluate(() => document.querySelector('main.combat-shell') !== null);
const handCount = (page) => page.locator('.hand-tray .coin').count();

// ---------- 시나리오 1: 첫 상태 + 클릭 장전/회수/사용 (베기) ----------
{
  const { page, errors } = await boot();
  await page.screenshot({ path: `${outDir}/01-initial.png` });

  check('S1 첫 손패 5개', (await handCount(page)) === 5);
  check('S1 주머니 6 (10+불씨1-드로우5)', (await page.locator('.pouch-circle').innerText()) === '6');
  check('S1 적 의도 1턴부터 공개', (await page.locator('.intent').count()) === 1);
  check('S1 손패 코인에 플립 결과 얼굴 없음', (await page.locator('.hand-tray .coin .coin-face-mark').count()) === 0);

  // 클릭 장전: 코인 선택 → 합법 소켓 하이라이트 → 소켓 클릭 → 장전
  await page.locator('.hand-tray .coin').first().click();
  check('S1 선택 코인 표시', (await page.locator('.hand-tray .coin.selected').count()) === 1);
  const acceptCount = await page.locator('.socket.accept').count();
  check('S1 합법 소켓 하이라이트 ≥1', acceptCount >= 1, `accept=${acceptCount}`);

  const slashSocket = page.locator('.skill-card').first().locator('.socket');
  await slashSocket.first().click();
  check('S1 장전 후 손패 4개', (await handCount(page)) === 4);
  check('S1 소켓 loaded', (await page.locator('.skill-card').first().locator('.socket.loaded').count()) === 1);
  await page.screenshot({ path: `${outDir}/02-placed.png` });

  // 회수: 장전된 소켓 클릭 → 손패 복귀
  await slashSocket.first().click();
  check('S1 회수 후 손패 5개', (await handCount(page)) === 5);

  // 재장전 → 카드 제목 버튼으로 사용 → 플립 연출 가시성
  await page.locator('.hand-tray .coin').first().click();
  await slashSocket.first().click();
  const beforeUse = `${outDir}/03-before-use.png`;
  await page.screenshot({ path: beforeUse });
  await page.locator('.skill-card').first().locator('.card-title').click();

  // 플립 연출: 해결 중 소켓 코인이 남아 flipping 클래스를 가져야 한다
  const sawFlip = await page
    .waitForFunction(() => document.querySelector('.socket-coin.flipping, .coin.flipping') !== null, undefined, { timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  check('S1 플립 연출 가시 (flipping 클래스 등장)', sawFlip);
  await page.screenshot({ path: `${outDir}/04-during-flip.png` });

  const sawFace = await page
    .waitForFunction(() => document.querySelector('.coin-face-mark') !== null, undefined, { timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  check('S1 플립 결과 면 공개 (앞/뒤 마크)', sawFace);
  await page.screenshot({ path: `${outDir}/05-face-revealed.png` });

  await page.waitForFunction(() => document.querySelector('.end-turn:not(:disabled)') !== null, undefined, { timeout: 15000 });
  check('S1 사용됨 표시', (await page.locator('.skill-card.spent').count()) >= 1);
  check('S1 해결 후 손패 4개', (await handCount(page)) === 4);
  check('S1 콘솔/페이지 에러 0', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---------- 시나리오 2: 불타는 일격 회귀 — 부분 장전이 화면을 죽이지 않는다 ----------
{
  const { page, errors } = await boot();
  const strike = page.locator('.skill-card').nth(2); // slot 2 = 불타는 일격 (cost 2)

  await page.locator('.hand-tray .coin').first().click();
  await strike.locator('.socket').first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/06-strike-one-coin.png` });
  check('S2 1/2 장전 후 화면 생존', await shellAlive(page));
  check('S2 1/2 장전 후 에러 0', errors.length === 0, errors.join(' | '));

  await page.locator('.hand-tray .coin').first().click();
  await strike.locator('.socket').nth(1).click();
  await page.waitForTimeout(300);
  check('S2 2/2 장전 후 프리뷰 표시', (await strike.locator('.preview-tip').count()) === 1);
  await page.screenshot({ path: `${outDir}/07-strike-loaded.png` });

  const discardBefore = await page.locator('.pile-button.discard').innerText();
  await strike.locator('.card-title').click();
  await page.waitForFunction(() => document.querySelector('.end-turn:not(:disabled)') !== null, undefined, { timeout: 15000 });
  await page.screenshot({ path: `${outDir}/08-strike-resolved.png` });
  check('S2 사용 후 화면 생존', await shellAlive(page));
  const discardAfter = await page.locator('.pile-button.discard').innerText();
  check('S2 버림 더미 증가 (코인2+임시화염1)', discardBefore !== discardAfter, `${discardBefore} → ${discardAfter}`);
  check('S2 에러 0', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---------- 시나리오 3: 키보드 전용 장전/회수/사용 ----------
{
  const { page, errors } = await boot();
  const coin = page.locator('.hand-tray .coin').first();
  await coin.focus();
  await page.keyboard.press('Enter');
  check('S3 키보드 선택', (await page.locator('.hand-tray .coin.selected').count()) === 1);

  const socket = page.locator('.skill-card').first().locator('.socket').first();
  await socket.focus();
  await page.keyboard.press('Enter');
  check('S3 키보드 장전', (await handCount(page)) === 4);

  await socket.focus();
  await page.keyboard.press('Enter');
  check('S3 키보드 회수', (await handCount(page)) === 5);

  // 다시 장전 후 카드 제목으로 사용
  await coin.focus();
  await page.keyboard.press('Enter');
  await socket.focus();
  await page.keyboard.press('Enter');
  const title = page.locator('.skill-card').first().locator('.card-title');
  await title.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.end-turn:not(:disabled)') !== null, undefined, { timeout: 15000 });
  check('S3 키보드 사용 완료', (await page.locator('.skill-card.spent').count()) >= 1);
  check('S3 에러 0', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---------- 시나리오 4: 드래그 장전 / 무효 드롭 / 소켓 드래그 회수 ----------
{
  const { page, errors } = await boot();
  const coin = page.locator('.hand-tray .coin').first();
  const guardCard = page.locator('.skill-card').nth(1); // 방어 (cost 1)

  // 드래그 성공: 코인 → 방어 소켓
  const coinBox = await coin.boundingBox();
  await page.mouse.move(coinBox.x + coinBox.width / 2, coinBox.y + coinBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(coinBox.x, coinBox.y - 60, { steps: 5 });
  const proxyVisible = await page.locator('.drag-proxy').count();
  check('S4 드래그 프록시 표시', proxyVisible === 1);
  const socketBox = await guardCard.locator('.socket').first().boundingBox();
  await page.mouse.move(socketBox.x + socketBox.width / 2, socketBox.y + socketBox.height / 2, { steps: 8 });
  await page.screenshot({ path: `${outDir}/09-dragging.png` });
  await page.mouse.up();
  await page.waitForTimeout(250);
  check('S4 드래그 장전 성공', (await handCount(page)) === 4);
  check('S4 방어 소켓 loaded', (await guardCard.locator('.socket.loaded').count()) === 1);

  // 무효 드롭: 코인 → 전장 (아무 일 없음 + 손패 유지)
  const coin2 = page.locator('.hand-tray .coin').first();
  const coin2Box = await coin2.boundingBox();
  await page.mouse.move(coin2Box.x + coin2Box.width / 2, coin2Box.y + coin2Box.height / 2);
  await page.mouse.down();
  await page.mouse.move(640, 200, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  check('S4 무효 드롭 시 손패 유지', (await handCount(page)) === 4);
  check('S4 무효 드롭 후 화면 생존', await shellAlive(page));

  // 소켓에서 드래그로 회수: 장전된 소켓 → 트레이
  const loaded = guardCard.locator('.socket.loaded');
  const loadedBox = await loaded.boundingBox();
  const trayBox = await page.locator('.hand-tray').boundingBox();
  await page.mouse.move(loadedBox.x + loadedBox.width / 2, loadedBox.y + loadedBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(trayBox.x + trayBox.width / 2, trayBox.y + trayBox.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  check('S4 소켓 드래그 회수', (await handCount(page)) === 5);
  check('S4 에러 0', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---------- 시나리오 5: 멀티 턴 — 면 리셋 · 리셔플 후 낡은 얼굴 없음 ----------
{
  const { page, errors } = await boot();
  for (let turn = 0; turn < 3; turn += 1) {
    // 매 턴 베기 1회 사용 (코인 플립 발생) 후 턴 종료
    await page.locator('.hand-tray .coin').first().click();
    await page.locator('.skill-card').first().locator('.socket').first().click();
    await page.locator('.skill-card').first().locator('.card-title').click();
    await page.waitForFunction(() => document.querySelector('.end-turn:not(:disabled)') !== null, undefined, { timeout: 20000 });
    if ((await page.locator('.result-overlay').count()) > 0) break;
    await page.locator('.end-turn').click();
    await page.waitForFunction(
      () => document.querySelector('.result-overlay') !== null || document.querySelector('.end-turn:not(:disabled)') !== null,
      undefined,
      { timeout: 30000 }
    );
    if ((await page.locator('.result-overlay').count()) > 0) break;
    const stale = await page.locator('.hand-tray .coin .coin-face-mark').count();
    check(`S5 턴${turn + 2} 손패에 낡은 얼굴 0`, stale === 0, `mark=${stale}`);
  }
  await page.screenshot({ path: `${outDir}/10-multi-turn.png` });
  check('S5 멀티 턴 에러 0', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---------- 시나리오 7: 다중 슬롯·다중 코인 스트레스 (한 판 연속) ----------
// 사용자 재현 보고 검증: ① 불타는 일격 부분 장전 생존 ② 여러 스킬 동시 장전 후 사용
// (턴 3회 캡 상태에서 완충 카드 렌더 — 구 프리뷰 크래시 경로) ③ 연속 장전 무잠금
// ④ 플립·면 공개가 피해 피드백보다 먼저 ⑤ 턴 전환 후 낡은 상태 없음
{
  const { page, errors } = await boot();
  const card = (index) => page.locator('.skill-card').nth(index);
  const placeInto = async (cardIndex, socketIndex) => {
    await page.locator('.hand-tray .coin').first().click();
    await card(cardIndex).locator('.socket').nth(socketIndex).click();
  };
  const useCard = async (cardIndex) => {
    await card(cardIndex).locator('.card-title').click();
    await page.waitForFunction(() => document.querySelector('.end-turn:not(:disabled)') !== null, undefined, { timeout: 20000 });
  };
  const loadedCount = () => page.locator('.socket.loaded').count();

  // 1. 불타는 일격(slot 2, cost 2)에 1개 — 화면 생존, 프리뷰 실행 없음
  await placeInto(2, 0);
  check('S7 스트라이크 1/2 화면 생존', await shellAlive(page));
  check('S7 스트라이크 1/2 손패 4', (await handCount(page)) === 4);
  check('S7 스트라이크 1/2 프리뷰 없음', (await card(2).locator('.preview-tip').count()) === 0);
  await page.screenshot({ path: `${outDir}/11-strike-partial.png` });

  // 2. 완료 전 다른 스킬(방어 slot 1)에도 장전 — 둘 다 장전 유지, 조작 가능
  await placeInto(1, 0);
  check('S7 두 카드 동시 장전', (await loadedCount()) === 2);
  check('S7 다중 장전 후 조작 가능(무잠금)', (await page.locator('.end-turn:not(:disabled)').count()) === 1);
  await page.screenshot({ path: `${outDir}/12-multi-loaded.png` });

  // 3. 방어 코인 회수 — 총량 보존 (손패+장전 = 5)
  await card(1).locator('.socket.loaded').click();
  check('S7 회수 후 손패 4', (await handCount(page)) === 4);
  check('S7 회수 후 총량 보존 (장전 1)', (await loadedCount()) === 1);
  await page.screenshot({ path: `${outDir}/13-unplaced.png` });

  // 4. 재장전 → 방어 사용 — 스트라이크 코인은 규칙대로 제자리
  await placeInto(1, 0);
  await useCard(1);
  check('S7 방어 해결 후 스트라이크 장전 유지', (await card(2).locator('.socket.loaded').count()) === 1);
  check('S7 방어 해결 후 화면 생존', await shellAlive(page));

  // 5. 스트라이크 2/2 — 첫 장전 후 입력 잠금 없음, 카드 준비 상태
  await placeInto(2, 1);
  check('S7 스트라이크 2/2 즉시 조작 가능', (await page.locator('.end-turn:not(:disabled)').count()) === 1);
  check('S7 스트라이크 ready', (await card(2).evaluate((el) => el.classList.contains('ready'))) === true);
  check('S7 스트라이크 프리뷰 표시', (await card(2).locator('.preview-tip').count()) === 1);

  // 6. 점화·베기 사용 → 턴 3회 캡. 완충 스트라이크가 남은 채 렌더 — 구 크래시 경로
  await placeInto(3, 0);
  await useCard(3);
  await placeInto(0, 0);
  await useCard(0);
  check('S7 캡 상태 화면 생존 (완충 카드 렌더)', await shellAlive(page));
  check('S7 캡 상태 스트라이크 사용 불가 (ready 아님)', (await card(2).evaluate((el) => el.classList.contains('ready'))) === false);
  check('S7 캡 상태 프리뷰 숨김', (await card(2).locator('.preview-tip').count()) === 0);
  check('S7 캡 상태 에러 0', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: `${outDir}/14-capped-loaded.png` });

  // 7. 턴 종료 — E0/D7: 미선언 장전 코인은 손패 복귀 후 폐기, 다음 턴 5장·낡은 면 0
  await page.locator('.end-turn').click();
  await page.waitForFunction(
    () => document.querySelector('.result-overlay') !== null || document.querySelector('.end-turn:not(:disabled)') !== null,
    undefined,
    { timeout: 30000 }
  );
  check('S7 턴2 스트라이크 소켓 비움 (D7)', (await loadedCount()) === 0);
  check('S7 턴2 손패 5', (await handCount(page)) === 5);
  check('S7 턴2 낡은 면 0', (await page.locator('.hand-tray .coin .coin-face-mark').count()) === 0);

  // 8. 턴2에 스트라이크 완충·사용 — 소켓 코인 전부 플립·면 공개가 피해 피드백보다 먼저
  await placeInto(2, 0);
  await placeInto(2, 1);
  const discardBefore = await page.locator('.pile-button.discard').innerText();
  await card(2).locator('.card-title').click();
  const sawFlipAnim = await page
    .waitForFunction(() => document.querySelector('.socket-coin.flipping') !== null, undefined, { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check('S7 플립 애니메이션 가시', sawFlipAnim);
  await page.screenshot({ path: `${outDir}/15-flip-in-progress.png` });
  await page.waitForFunction(() => document.querySelectorAll('.coin-face-mark').length >= 1, undefined, { timeout: 5000 });
  check('S7 면 공개가 피해 피드백보다 먼저', (await page.locator('.float-text.kind-damage').count()) === 0);
  await page.waitForFunction(() => document.querySelectorAll('.coin-face-mark').length === 2, undefined, { timeout: 5000 });
  await page.screenshot({ path: `${outDir}/16-faces-revealed.png` });
  const sawDamage = await page
    .waitForFunction(() => document.querySelector('.float-text.kind-damage') !== null, undefined, { timeout: 6000 })
    .then(() => true)
    .catch(() => false);
  check('S7 면 공개 후 피해 피드백', sawDamage);
  await page.waitForFunction(
    () => document.querySelector('.result-overlay') !== null || document.querySelector('.end-turn:not(:disabled)') !== null,
    undefined,
    { timeout: 20000 }
  );
  const discardAfter = await page.locator('.pile-button.discard').innerText();
  check('S7 해결 후 버림 반영', discardBefore !== discardAfter, `${discardBefore} → ${discardAfter}`);
  check('S7 해결 후 화면 생존', await shellAlive(page));
  await page.screenshot({ path: `${outDir}/17-post-resolution.png` });
  check('S7 전 구간 에러 0', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---------- 시나리오 8: 뽑을 더미 팝오버 — 구성 공개·라이브 갱신·닫기 ----------
{
  const { page, errors } = await boot();
  const popSum = async () => {
    const text = await page.locator('.pouch-pop').innerText();
    return [...text.matchAll(/×(\d+)/g)].reduce((sum, match) => sum + Number(match[1]), 0);
  };

  const popSettled = () =>
    page.waitForFunction(() => {
      const pop = document.querySelector('.pouch-pop');
      return pop !== null && getComputedStyle(pop).opacity === '1';
    });

  await page.locator('.pouch-circle').click();
  check('S8 팝오버 열림', (await page.locator('.pouch-pop').count()) === 1);
  await popSettled();
  const pouchNumber = Number(await page.locator('.pouch-circle').innerText());
  check('S8 구성 합계 = 주머니 매수', (await popSum()) === pouchNumber, `sum vs ${pouchNumber}`);
  const popText = await page.locator('.pouch-pop').innerText();
  check('S8 기본·화염 종류 표기', popText.includes('기본') && popText.includes('화염'), popText.replace(/\n/g, ' / '));
  const popBox = await page.locator('.pouch-pop').boundingBox();
  check('S8 팝오버 좌측 고정 (전장 미가림)', popBox !== null && popBox.x + popBox.width < 640, `right=${Math.round((popBox?.x ?? 0) + (popBox?.width ?? 0))}`);
  await page.screenshot({ path: `${outDir}/18-pouch-open.png` });

  await page.keyboard.press('Escape');
  check('S8 Escape 닫기', (await page.locator('.pouch-pop').count()) === 0);

  await page.locator('.pouch-circle').click();
  await page.mouse.click(640, 200);
  check('S8 바깥 클릭 닫기', (await page.locator('.pouch-pop').count()) === 0);

  // 턴 전환 후 구성 갱신 — 2턴 드로우 뒤 더미 1닢
  await page.locator('.end-turn').click();
  await page.waitForFunction(
    () => document.querySelector('.result-overlay') !== null || document.querySelector('.end-turn:not(:disabled)') !== null,
    undefined,
    { timeout: 30000 }
  );
  await page.locator('.pouch-circle').click();
  await popSettled();
  check('S8 턴2 구성 합계 1', (await popSum()) === 1);
  check('S8 턴2 주머니 라벨 1', (await page.locator('.pouch-circle').innerText()) === '1');
  await page.screenshot({ path: `${outDir}/19-pouch-turn2.png` });
  check('S8 에러 0', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---------- 시나리오 9: 카드 겹침 — 장전 상시 확대 금지·검사 승격은 수직 리프트 전용 ----------
// 겹침 레일은 유지하되: 장전(.lifted)은 절제된 리프트만, 검사 승격(호버/키보드 포커스/드롭
// 목적지)은 가로 확대 없는 수직 리프트 — 승격 중에도 이웃 카드의 제목·소켓이 가려지지 않는다.
{
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 720 }]) {
    const tag = `${viewport.width}x${viewport.height}`;
    const { page, errors } = await boot(viewport);
    const cardRect = (index) =>
      page.evaluate((i) => {
        const rect = document.querySelectorAll('.skill-card')[i].getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, width: rect.width };
      }, index);
    // 승격 중 이웃(불타는 일격, index 2)의 제목 중심·소켓 중심이 자기 카드로 히트되는가
    const adjacentClear = () =>
      page.evaluate(() => {
        const cards = [...document.querySelectorAll('.skill-card')];
        const target = cards[2];
        const probe = (el) => {
          if (el === null) return false;
          const rect = el.getBoundingClientRect();
          const under = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return under !== null && target.contains(under);
        };
        return probe(target.querySelector('.card-title')) && probe(target.querySelector('.socket'));
      });
    const detailShown = (index) =>
      page.evaluate((i) => getComputedStyle(document.querySelectorAll('.skill-card')[i].querySelector('p')).opacity === '1', index);
    const parkPointer = async () => {
      await page.mouse.move(640, 260);
      await page.waitForTimeout(250);
    };

    await parkPointer();
    const rest = await cardRect(1);
    check(`S9 ${tag} 휴식 카드 기본 폭`, rest.width <= 126, `w=${Math.round(rest.width)}`);
    await page.screenshot({ path: `${outDir}/20-${tag}-rail-rest.png` });

    // 호버 승격 = 수직 리프트 + 상세 노출, 가로 확대 없음
    await page.locator('.skill-card').nth(1).hover();
    await page.waitForTimeout(250);
    const hovered = await cardRect(1);
    check(
      `S9 ${tag} 호버 수직 승격 (확대 없음)`,
      hovered.width <= 126 && hovered.top <= rest.top - 24,
      `w=${Math.round(hovered.width)} lift=${Math.round(rest.top - hovered.top)}`
    );
    check(`S9 ${tag} 호버 상세 텍스트 노출`, await detailShown(1));
    await page.screenshot({ path: `${outDir}/21-${tag}-hover.png` });
    await parkPointer();

    // 인접 두 카드 장전: 방어(1) + 불타는 일격(2)
    await page.locator('.hand-tray .coin').first().click();
    await page.locator('.skill-card').nth(1).locator('.socket').first().click();
    await page.locator('.hand-tray .coin').first().click();
    await page.locator('.skill-card').nth(2).locator('.socket').first().click();
    await parkPointer();
    const left = await cardRect(1);
    const right = await cardRect(2);
    check(
      `S9 ${tag} 장전 카드 상시 확대 없음`,
      left.width <= 126 && right.width <= 126,
      `w=${Math.round(left.width)},${Math.round(right.width)}`
    );
    check(`S9 ${tag} 장전 카드 겹침 ≤20px`, left.right - right.left <= 20, `overlap=${Math.round(left.right - right.left)}`);
    check(`S9 ${tag} 두 장전 카드 제목·소켓 히트 가능`, await adjacentClear());
    await page.screenshot({ path: `${outDir}/22-${tag}-multi-loaded.png` });

    // 장전 카드 호버 승격 — 이웃 겹침이 휴식 수준(-14px)을 넘지 않고, 이웃 제목·소켓 무가림
    await page.locator('.skill-card').nth(1).hover();
    await page.waitForTimeout(250);
    const promoted = await cardRect(1);
    const neighbor = await cardRect(2);
    check(
      `S9 ${tag} 장전 카드 호버 수직 승격`,
      promoted.width <= 126 && promoted.top <= rest.top - 24,
      `w=${Math.round(promoted.width)} lift=${Math.round(rest.top - promoted.top)}`
    );
    check(
      `S9 ${tag} 승격 중 이웃 겹침 ≤15px`,
      promoted.right - neighbor.left <= 15,
      `overlap=${Math.round(promoted.right - neighbor.left)}`
    );
    check(`S9 ${tag} 승격 중 이웃 제목·소켓 무가림`, await adjacentClear());
    check(`S9 ${tag} 승격 카드 상세 노출`, await detailShown(1));
    await page.screenshot({ path: `${outDir}/23-${tag}-loaded-hover.png` });
    await parkPointer();

    // 키보드 포커스 = 호버와 동일 승격 — 베기 제목에 앵커 후 실제 Tab 2회
    // (마지막 이동이 실제 키 입력이라 :focus-visible이 보장된다): 베기 소켓 → 방어 제목
    await page.locator('.skill-card').nth(0).locator('.card-title').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(250);
    const focusOn = await page.evaluate(() => document.activeElement?.textContent ?? '');
    check(`S9 ${tag} 키보드 포커스 대상 = 방어 제목`, focusOn.includes('방어'), focusOn);
    const kb = await cardRect(1);
    check(
      `S9 ${tag} 키보드 포커스 수직 승격`,
      kb.width <= 126 && kb.top <= rest.top - 24,
      `w=${Math.round(kb.width)} lift=${Math.round(rest.top - kb.top)}`
    );
    check(`S9 ${tag} 키보드 승격 중 이웃 제목·소켓 무가림`, await adjacentClear());
    await page.screenshot({ path: `${outDir}/24-${tag}-kb-focus.png` });
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await parkPointer();

    // 겹침 속에서도 소켓은 개별 타깃 가능 — 오른쪽 카드 회수
    const handBefore = await handCount(page);
    await page.locator('.skill-card').nth(2).locator('.socket.loaded').click();
    check(`S9 ${tag} 겹침 속 소켓 회수 가능`, (await handCount(page)) === handBefore + 1);

    const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check(`S9 ${tag} 가로 스크롤 없음`, !hScroll);
    check(`S9 ${tag} 에러 0`, errors.length === 0, errors.join(' | '));
    await page.close();
  }
}

// ---------- 시나리오 11: 버림·소모 인스펙터 + 이동·리셔플 수명주기 피드백 ----------
{
  const { page, errors } = await boot();
  const pileSum = async (selector) => {
    const text = await page.locator(selector).innerText();
    return [...text.matchAll(/×(\d+)/g)].reduce((sum, match) => sum + Number(match[1]), 0);
  };
  const pileSettled = (selector) =>
    page.waitForFunction((target) => {
      const pop = document.querySelector(target);
      return pop !== null && getComputedStyle(pop).opacity === '1';
    }, selector);

  check('S11 버림·소모 버튼 2개', (await page.locator('.pile-button').count()) === 2);
  const pileHitBoxes = await page.locator('.pile-button').evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { width: Math.round(box.width), height: Math.round(box.height) };
    })
  );
  check(
    'S11 더미 버튼 히트 영역 ≥70×24px',
    pileHitBoxes.every((box) => box.width >= 70 && box.height >= 24),
    pileHitBoxes.map((box) => `${box.width}x${box.height}`).join(',')
  );

  await page.locator('.pile-button.discard').click();
  const emptyDiscardText = await page.locator('.pile-pop.discard').innerText();
  check('S11 빈 버림 인스펙터 열림', emptyDiscardText.includes('아직 버린 동전이 없다'));
  check('S11 버림 리셔플 규칙 설명', emptyDiscardText.includes('무작위로 섞여'));

  await page.locator('.pile-button.exhausted').click();
  check('S11 인스펙터 상호 배타적', (await page.locator('.pile-pop').count()) === 1 && (await page.locator('.pile-pop.exhausted').count()) === 1);
  const emptyExhaustText = await page.locator('.pile-pop.exhausted').innerText();
  check('S11 소모 수명주기 설명', emptyExhaustText.includes('영구 동전은 전투 후 복귀') && emptyExhaustText.includes('임시 동전은 전투 후 소멸'));
  await page.keyboard.press('Escape');
  check('S11 Escape 인스펙터 닫기', (await page.locator('.pile-pop').count()) === 0);

  // 기본 동전으로 베기 → 비용 동전이 버림으로 이동하고 HUD가 이를 알려야 한다.
  const basicCoin = page.locator('.hand-tray .coin:not(.fire):not(.granted-fire)').first();
  await basicCoin.click();
  await page.locator('.skill-card').nth(0).locator('.socket').first().click();
  await page.locator('.skill-card').nth(0).locator('.card-title').click();
  const sawDiscardFeedback = await page
    .waitForFunction(
      () =>
        document.querySelector('.pile-button.discard.receiving') !== null &&
        document.querySelector('.pile-flow')?.textContent?.includes('버림 +1') === true,
      undefined,
      { timeout: 8000 }
    )
    .then(() => true)
    .catch(() => false);
  check('S11 스킬 비용 → 버림 피드백', sawDiscardFeedback);
  await page.waitForFunction(() => document.querySelector('.end-turn:not(:disabled)') !== null, undefined, { timeout: 15000 });

  await page.locator('.pile-button.discard').click();
  await pileSettled('.pile-pop.discard');
  const discardText = await page.locator('.pile-pop.discard').innerText();
  check('S11 버림 구성 합계 = 카운터', (await pileSum('.pile-pop.discard')) === 1);
  check('S11 버림 동전 종류·수명 표시', discardText.includes('기본 ×1') && discardText.includes('리셔플 대상'));
  await page.screenshot({ path: `${outDir}/26-discard-inspector.png` });
  await page.keyboard.press('Escape');

  // 시작 손패의 영구 화염 동전을 점화 검술로 소비 → 전투 중 제외, 전투 후 복귀 안내.
  check('S11 소비 전 화염 동전 보유', (await page.locator('.hand-tray .coin.fire').count()) >= 1);
  await page.locator('.skill-card').nth(4).locator('.card-title').click();
  const sawExhaustFeedback = await page
    .waitForFunction(
      () =>
        document.querySelector('.pile-button.exhausted.receiving') !== null &&
        document.querySelector('.pile-flow')?.textContent?.includes('소모 +1') === true,
      undefined,
      { timeout: 8000 }
    )
    .then(() => true)
    .catch(() => false);
  check('S11 소비 동전 → 소모 영역 피드백', sawExhaustFeedback);
  await page.waitForFunction(() => document.querySelector('.end-turn:not(:disabled)') !== null, undefined, { timeout: 15000 });

  await page.locator('.pile-button.exhausted').click();
  await pileSettled('.pile-pop.exhausted');
  const exhaustText = await page.locator('.pile-pop.exhausted').innerText();
  check('S11 소모 구성 합계 = 카운터', (await pileSum('.pile-pop.exhausted')) === 1);
  check('S11 소모 동전 종류 표시', exhaustText.includes('화염 ×1'));
  check('S11 영구 소모 동전 복귀 안내', exhaustText.includes('전투 후 복귀'));
  await page.screenshot({ path: `${outDir}/27-exhaust-inspector.png` });
  await page.keyboard.press('Escape');

  // 두 번 턴 종료하면 남은 1개를 뽑은 뒤 버림 9개가 리셔플된다.
  await page.locator('.end-turn').click();
  await page.waitForFunction(() => document.querySelector('.end-turn:not(:disabled)') !== null, undefined, { timeout: 30000 });
  await page.locator('.end-turn').click();
  const sawShuffleFeedback = await page
    .waitForFunction(
      () =>
        document.querySelector('.pouch-circle.receiving') !== null &&
        document.querySelector('.pile-flow')?.textContent?.includes('→ 주머니') === true,
      undefined,
      { timeout: 15000 }
    )
    .then(() => true)
    .catch(() => false);
  check('S11 버림 → 주머니 리셔플 피드백', sawShuffleFeedback);
  await page.waitForFunction(() => document.querySelector('.end-turn:not(:disabled)') !== null, undefined, { timeout: 30000 });
  check('S11 리셔플 후 버림 카운터 0', (await page.locator('.pile-button.discard').innerText()).includes('0'));
  await page.locator('.pile-button.discard').click();
  await pileSettled('.pile-pop.discard');
  check('S11 리셔플 후 버림 인스펙터 비움', (await page.locator('.pile-pop.discard').innerText()).includes('아직 버린 동전이 없다'));
  await page.screenshot({ path: `${outDir}/28-after-reshuffle.png` });
  check('S11 전 구간 에러 0', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---------- 시나리오 10: 패배 연출 완료 후 결과 표시 + 같은 시드 재시작 정리 ----------
{
  const { page, errors } = await boot();

  // 약탈자 고정 패턴(11, 4×2, 11)으로 아무 행동 없이 6턴을 넘기면 HP 10이 남는다.
  for (let attack = 0; attack < 6; attack += 1) {
    await page.locator('.end-turn').click();
    await page.waitForFunction(() => document.querySelector('.end-turn:not(:disabled)') !== null, undefined, {
      timeout: 30000
    });
  }
  check('S10 최종 공격 직전 HP 10', (await page.locator('.unit.player .hp-num').innerText()) === '10/70');

  // 재시작 시 전투 외 UI 상태도 초기화되는지 보기 위해 주머니를 열린 채로 패배한다.
  await page.locator('.pouch-circle').click();
  check('S10 패배 직전 주머니 팝오버 열림', (await page.locator('.pouch-pop').count()) === 1);

  await page.locator('.end-turn').click();
  await page.waitForTimeout(100);
  const terminalTransition = await page.evaluate(() => ({
    overlay: document.querySelector('.result-overlay') !== null,
    locked: document.querySelector('.end-turn:disabled') !== null,
    feedback: document.querySelector('.float-text') !== null
  }));
  check(
    'S10 최종 피해 연출 중 결과 화면 지연',
    !terminalTransition.overlay && (terminalTransition.locked || terminalTransition.feedback),
    JSON.stringify(terminalTransition)
  );

  await page.waitForFunction(() => document.querySelector('.result-overlay') !== null, undefined, { timeout: 30000 });
  await page.screenshot({ path: `${outDir}/25-defeat-result.png` });
  check('S10 결과 대화상자 aria-modal', (await page.locator('.result-overlay').getAttribute('aria-modal')) === 'true');
  check('S10 결과 표시 시 잔여 피해 텍스트 0', (await page.locator('.float-text').count()) === 0);
  check('S10 결과 표시 시 플립 중 코인 0', (await page.locator('.flipping').count()) === 0);
  const primaryFocused = await page
    .waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '같은 시드로 재시작', undefined, {
      timeout: 2000
    })
    .then(() => true)
    .catch(() => false);
  check('S10 결과 기본 동작에 키보드 포커스', primaryFocused);

  const seedBefore = new globalThis.URL(page.url()).searchParams.get('seed');
  await page.getByRole('button', { name: '같은 시드로 재시작' }).click();
  await page.waitForFunction(
    () => document.querySelector('.end-turn:not(:disabled)') !== null && document.querySelector('.float-text') === null,
    undefined,
    { timeout: 15000 }
  );
  check('S10 재시작 후 결과 화면 닫힘', (await page.locator('.result-overlay').count()) === 0);
  check('S10 같은 시드 유지', new globalThis.URL(page.url()).searchParams.get('seed') === seedBefore, String(seedBefore));
  check('S10 재시작 후 HP 초기화', (await page.locator('.unit.player .hp-num').innerText()) === '70/70');
  check('S10 재시작 후 손패 5개', (await handCount(page)) === 5);
  check('S10 재시작 후 주머니 팝오버 닫힘', (await page.locator('.pouch-pop').count()) === 0);
  check('S10 재시작 후 낡은 얼굴 0', (await page.locator('.coin-face-mark').count()) === 0);
  check('S10 전 구간 에러 0', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---------- 시나리오 6: 뷰포트 매트릭스 — 풀블리드·스크롤·HUD·지면선 ----------
{
  const viewports = [
    { width: 1920, height: 1080 },
    { width: 1600, height: 900 },
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 1024, height: 720 }
  ];
  for (const viewport of viewports) {
    const { page, errors } = await boot(viewport);
    const metrics = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
      const shell = rect('main.combat-shell');
      const backdrop = rect('.backdrop-img');
      const hud = rect('.bottom-hud');
      const sprites = [...document.querySelectorAll('.sprite-frame')].map((el) => Math.round(el.getBoundingClientRect().bottom));
      return {
        vw: window.innerWidth,
        vh: window.innerHeight,
        shellW: shell === null ? 0 : Math.round(shell.width),
        backdropW: backdrop === null ? 0 : Math.round(backdrop.width),
        backdropH: backdrop === null ? 0 : Math.round(backdrop.height),
        hudH: hud === null ? 0 : Math.round(hud.height),
        spriteBottoms: sprites,
        hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    });
    const tag = `${viewport.width}x${viewport.height}`;
    check(`S6 ${tag} 가로 스크롤 없음`, !metrics.hScroll);
    check(`S6 ${tag} 무대 풀블리드 (셸=뷰포트)`, metrics.shellW >= metrics.vw, `shell=${metrics.shellW} vw=${metrics.vw}`);
    check(
      `S6 ${tag} 배경 풀블리드`,
      metrics.backdropW >= metrics.vw && metrics.backdropH >= metrics.vh,
      `bg=${metrics.backdropW}x${metrics.backdropH}`
    );
    if (viewport.width === 1280) check(`S6 ${tag} HUD ≤78px`, metrics.hudH <= 78, `hud=${metrics.hudH}`);
    check(
      `S6 ${tag} 지면선 정합 (양 유닛 발 y 동일)`,
      metrics.spriteBottoms.length === 2 && Math.abs(metrics.spriteBottoms[0] - metrics.spriteBottoms[1]) <= 2,
      metrics.spriteBottoms.join(',')
    );
    check(`S6 ${tag} 에러 0`, errors.length === 0, errors.join(' | '));
    await page.screenshot({ path: `${outDir}/vp-${tag}.png` });
    if (viewport.width === 1920 || viewport.width === 1024) {
      await page.locator('.pouch-circle').click();
      check(`S6 ${tag} 팝오버 열림`, (await page.locator('.pouch-pop').count()) === 1);
      await page.waitForFunction(() => {
        const pop = document.querySelector('.pouch-pop');
        return pop !== null && getComputedStyle(pop).opacity === '1';
      });
      await page.screenshot({ path: `${outDir}/vp-${tag}-pouch.png` });
      await page.keyboard.press('Escape');
    }
    await page.close();
  }
}

await browser.close();
await new Promise((resolveClose) => server.httpServer.close(resolveClose));

if (failures.length > 0) {
  console.error(`\n${failures.length}건 실패:\n${failures.map((line) => ` - ${line}`).join('\n')}`);
  process.exit(1);
}
console.log('\n플레이테스트 전 항목 통과');
