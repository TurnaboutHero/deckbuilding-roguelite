// P5.4 성능 계측 (report-only, CI 비차단) — P5.0 예산 대비 관측만 기록한다.
// 지표: 부팅 TTI(내비게이션→첫 상호작용 가능), 전투 커맨드 라운드트립(클릭→DOM 반영),
// 번들 크기. 사용: node scripts/perf-check.mjs [출력 JSON]
import { writeFileSync, statSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] ?? "/tmp/perf-report.json";
const base = "http://127.0.0.1:4186/deckbuilding-roguelite/";

const server = await (
  await import("vite")
).preview({ root, preview: { host: "127.0.0.1", port: 4186, strictPort: true } });
const browser = await chromium.launch();

const measureBoot = async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const t0 = Date.now();
  await page.goto(`${base}?seed=BRAVE-EMBER-42&encounter=raider`, {
    waitUntil: "commit",
  });
  await page.waitForFunction(
    () =>
      document.querySelector(".end-turn:not(:disabled)") !== null &&
      document.querySelector(".float-text") === null,
    undefined,
    { timeout: 30000 },
  );
  const tti = Date.now() - t0;
  // 커맨드 라운드트립: 코인 선택 클릭 → aria-pressed 반영
  const coin = page.locator(".hand-tray .coin").first();
  const t1 = Date.now();
  await coin.click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".hand-tray .coin")
        ?.getAttribute("aria-pressed") === "true",
    undefined,
    { timeout: 5000 },
  );
  const commandRoundtrip = Date.now() - t1;
  await page.close();
  return { tti, commandRoundtrip };
};

const runs = [];
for (let index = 0; index < 3; index += 1) runs.push(await measureBoot());

const distDir = join(root, "dist");
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
    const path = join(dir, entry.name);
    return sum + (entry.isDirectory() ? walk(path) : statSync(path).size);
  }, 0);
const distBytes = walk(distDir);

const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const report = {
  schemaVersion: "perf-report-v1",
  reportOnly: true,
  budgets: { distBytes: 2726297, ttiMs: 3000, commandRoundtripMs: 100 },
  measured: {
    distBytes,
    ttiMsMedian: median(runs.map((r) => r.tti)),
    commandRoundtripMsMedian: median(runs.map((r) => r.commandRoundtrip)),
    runs,
  },
  withinBudget: {
    dist: distBytes <= 2726297,
    tti: median(runs.map((r) => r.tti)) <= 3000,
    commandRoundtrip: median(runs.map((r) => r.commandRoundtrip)) <= 100,
  },
};
writeFileSync(out, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.measured));
console.log("withinBudget:", JSON.stringify(report.withinBudget));
await browser.close();
await server.close();
