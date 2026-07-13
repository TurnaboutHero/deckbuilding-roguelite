// P5.5/P5.6 번들 예산 게이트 (차단) — 빌드 후 실행한다.
// 예산: 총량 ≤ 2.61MiB, JS 총량 ≤ 400KiB, CSS 총량 ≤ 70KiB, 단일 파일 ≤ 700KiB.
// 사용: node scripts/check-budget.mjs
import { readdirSync, statSync } from "node:fs";
import { join, resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "apps/ui/dist");
// P6: 3막 런·패시브·강화·소환 시스템 추가로 JS 예산 320→400KiB 상향 (게임 시스템
// 2종 규모 증가분. 런 내비게이션 UI는 새 이미지 없이 기존 캐릭터 아틀라스를 재사용하며
// 총량만 10KiB 상향한다. JS·CSS·단일 파일 한도와 LCP·CLS 게이트는 유지한다.
const BUDGETS = {
  total: 2744729, // P8.3 합성 SFX 팔레트 반영: P8.1 예산 + 4 KiB (오디오 자산 0)
  js: 409600, // 400 KiB
  css: 71680, // 70 KiB
  maxFile: 716800, // 700 KiB
};

let total = 0;
let js = 0;
let css = 0;
let maxFile = { path: "", bytes: 0 };
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path);
      continue;
    }
    const bytes = statSync(path).size;
    total += bytes;
    const ext = extname(entry.name).toLowerCase();
    if (ext === ".js" || ext === ".mjs") js += bytes;
    if (ext === ".css") css += bytes;
    if (bytes > maxFile.bytes) maxFile = { path, bytes };
  }
};
walk(dist);

const failures = [];
if (total > BUDGETS.total) failures.push(`총량 ${total}B > ${BUDGETS.total}B`);
if (js > BUDGETS.js) failures.push(`JS ${js}B > ${BUDGETS.js}B`);
if (css > BUDGETS.css) failures.push(`CSS ${css}B > ${BUDGETS.css}B`);
if (maxFile.bytes > BUDGETS.maxFile)
  failures.push(`단일 파일 ${maxFile.path} ${maxFile.bytes}B > ${BUDGETS.maxFile}B`);

const mib = (total / 1048576).toFixed(3);
if (failures.length > 0) {
  console.error(`budget gate FAIL (${failures.length}건):`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(
  `budget gate PASS — 총 ${total}B (${mib}MiB) · JS ${js}B · CSS ${css}B · 최대 ${maxFile.bytes}B`,
);
