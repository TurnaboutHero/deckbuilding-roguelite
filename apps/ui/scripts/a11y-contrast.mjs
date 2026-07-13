// P5.3 대비 게이트 (차단) — 주요 텍스트 요소의 실효 대비가 AA(4.5:1 일반,
// 3:1 대형)를 충족해야 exit 0. 그라디언트 배경은 최악-스톱 토큰쌍 보수 계산
// (backgroundColor 투명 → 조상 폴백이 만드는 가짜 1.0x 오탐을 차단).
// 대상 요소 누락도 명시적 실패 — 문맥이 다른 토큰은 해당 화면에서 측정한다.
// 사용: node scripts/a11y-contrast.mjs [출력 JSON 경로]
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] ?? "/tmp/a11y-contrast.json";
const base =
  process.env.PLAYTEST_BASE_URL ?? "http://127.0.0.1:4183/deckbuilding-roguelite/";

const server =
  process.env.PLAYTEST_BASE_URL === undefined
    ? await (
        await import("vite")
      ).preview({ root, preview: { host: "127.0.0.1", port: 4183, strictPort: true } })
    : null;
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_EXECUTABLE_PATH === undefined
    ? {}
    : { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH },
);

const measure = (page, targets) =>
  page.evaluate((targetList) => {
    const luminance = ([r, g, b]) => {
      const f = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const parse = (value) => {
      const m = value.match(
        /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/,
      );
      return m
        ? {
            rgb: [Number(m[1]), Number(m[2]), Number(m[3])],
            a: m[4] === undefined ? 1 : Number(m[4]),
          }
        : null;
    };
    const gradientStops = (image) => {
      const stops = [];
      const re =
        /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)|#([0-9a-fA-F]{6})/g;
      let m;
      while ((m = re.exec(image)) !== null) {
        if (m[5] !== undefined) {
          stops.push([
            parseInt(m[5].slice(0, 2), 16),
            parseInt(m[5].slice(2, 4), 16),
            parseInt(m[5].slice(4, 6), 16),
          ]);
        } else {
          stops.push([Number(m[1]), Number(m[2]), Number(m[3])]);
        }
      }
      return stops;
    };
    // 배경: 그라디언트면 전경과 대비가 가장 낮은 스톱(보수), 아니면 불투명 조상
    const bgOf = (el, fgRgb) => {
      let node = el;
      while (node && node !== document.documentElement) {
        const cs = getComputedStyle(node);
        const image = cs.backgroundImage;
        if (image && image.includes("gradient")) {
          const stops = gradientStops(image);
          if (stops.length > 0) {
            const lf = luminance(fgRgb);
            let worst = stops[0];
            let worstRatio = Infinity;
            for (const stop of stops) {
              const lb = luminance(stop);
              const ratio =
                (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
              if (ratio < worstRatio) {
                worstRatio = ratio;
                worst = stop;
              }
            }
            return worst;
          }
        }
        const c = parse(cs.backgroundColor);
        if (c && c.a >= 0.9) return c.rgb;
        node = node.parentElement;
      }
      return [35, 48, 29];
    };
    const rows = [];
    for (const [selector, label] of targetList) {
      const el = document.querySelector(selector);
      if (!el) {
        rows.push({ selector, label, present: false });
        continue;
      }
      const cs = getComputedStyle(el);
      const fg = parse(cs.color);
      if (!fg) continue;
      const bg = bgOf(el, fg.rgb);
      const l1 = luminance(fg.rgb);
      const l2 = luminance(bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const px = Number.parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      const large = px >= 24 || (px >= 18.66 && bold);
      rows.push({
        selector,
        label,
        present: true,
        ratio: Math.round(ratio * 100) / 100,
        fontSizePx: px,
        threshold: large ? 3 : 4.5,
        passAA: ratio >= (large ? 3 : 4.5),
      });
    }
    return rows;
  }, targets);

// ── 1) 전투 화면 문맥 ────────────────────────────────────────────────
const combatPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await combatPage.goto(`${base}?seed=BRAVE-EMBER-42&encounter=raider`, {
  waitUntil: "networkidle",
});
await combatPage.waitForFunction(
  () =>
    document.querySelector(".end-turn:not(:disabled)") !== null &&
    document.querySelector(".float-text") === null,
  undefined,
  { timeout: 30000 },
);
// 거부 칩 유발: 코인 없이 카드 사용 시도
try {
  // 미장전 카드 제목은 aria-disabled로 클릭이 가로채인다 — force로 거부 사유 유발
  await combatPage
    .locator(".skill-card .card-title")
    .first()
    .click({ force: true });
  await combatPage.waitForSelector(".rejection-chip", { timeout: 3000 });
} catch {
  // 미출현이면 measure에서 missing으로 명시 실패
}
const report = await measure(combatPage, [
  [".unit-name", "유닛 이름"],
  [".hp-num", "HP 숫자"],
  [".card-title", "카드 제목"],
  [".card-effect-copy", "카드 효과 본문"],
  [".run-meta strong", "진행 메타"],
  [".end-turn", "턴 종료 버튼"],
  [".rejection-chip", "거부 칩"],
  [".hint-strip", "힌트 스트립"],
  [".mute-toggle", "음소거 토글"],
]);
await combatPage.close();

// ── 2) 상점 화면 문맥 (주입 저장 — 경제 보존 정합 골드) ─────────────
const shopPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await shopPage.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [
  "deckbuilding-roguelite.run-save",
  // P7 v7 저장 (8슬롯·시작 4스킬 — 경제 보존:
  // 골드 135 ≤ 엘리트 2승 140, rest/treasure 레이어 없음 = 카운터 0)
  JSON.stringify({
    version: 7,
    contentVersion: "1.5.0-p11",
    runSeed: "A11Y-SHOP",
    character: "warrior",
    currentHp: 63,
    maxHp: 70,
    bag: [...Array.from({ length: 8 }, () => "basic"), "fire", "fire"],
    equippedSkills: ["jab", "fist-guard", "burning-fist", "inner-passion", null, null, null, null],
    upgradedSlots: [false, false, false, false, false, false, false, false],
    acquiredPassives: [],
    gold: 135,
    graph: {
      layers: [
        [{ id: "a0", kind: "elite", encounter: ["raider-plus"] }],
        [{ id: "a1", kind: "elite", encounter: ["gatekeeper-plus"] }],
        [{ id: "a2", kind: "shop" }],
        [{ id: "a3", kind: "boss", encounter: ["ember-archmage"] }],
      ],
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
    combatIndex: 2,
    attempt: 0,
    phase: "shop",
    pendingShop: {
      coinOptions: ["basic", "fire", "mana"],
      coinPrices: [25, 50, 70],
      skillOptions: ["smash", "fire-infusion"],
      skillPrices: [50, 80],
    },
  }),
]);
await shopPage.goto(base, { waitUntil: "networkidle" });
await shopPage.locator('[data-testid="title-continue"]').click();
await shopPage.waitForSelector('[data-testid="shop-screen"]', { timeout: 15000 });
report.push(
  ...(await measure(shopPage, [
    [".shop-price", "상점 가격"],
    [".shop-item-name", "상점 품명"],
    [".shop-gold", "상점 골드"],
  ])),
);
await shopPage.close();

const missing = report.filter((r) => !r.present).map((r) => r.label);
const failing = report.filter((r) => r.present && !r.passAA).map((r) => r.label);
const summary = {
  schemaVersion: "a11y-contrast-report-v2",
  blocking: true,
  rows: report,
  missing,
  failing,
  pass: failing.length === 0 && missing.length === 0,
};
writeFileSync(out, JSON.stringify(summary, null, 1));
console.log(
  report
    .map((r) =>
      r.present
        ? `${r.passAA ? "ok " : "LOW"} ${r.label} ${r.ratio}:1`
        : `MISSING ${r.label}`,
    )
    .join("\n"),
);
await browser.close();
if (server) await server.close();
if (!summary.pass) {
  console.error(
    `contrast gate FAIL — failing: [${failing.join(", ")}] missing: [${missing.join(", ")}]`,
  );
  process.exit(1);
}
console.log("contrast gate PASS");
