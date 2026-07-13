// 번들 예산 게이트 (차단) — 빌드 후 실행한다.
// 사용: node scripts/check-budget.mjs
import { readdirSync, statSync } from "node:fs";
import { join, resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "apps/ui/dist");
// P11: 냉기 도적의 보존·지정 뽑기·가변 소비와 스킬/패시브 데이터를 추가했다.
// 신규 이미지 자산은 없으며 P10 예산에서 총 20KiB, JS 20KiB를 허용한다.
// 실제 냉기 가변 소비 선택과 정본 카드 설명의 모드별 문구에 JS 1KiB를 추가 배정한다.
// 명시적 보존 선택 패널의 상태·접근성 스타일에는 CSS 1KiB를 배정한다.
// 단일 파일·LCP·CLS 게이트는 유지한다.
const BUDGETS = {
  total: 2800025,
  js: 448512, // 438 KiB
  css: 72704, // 71 KiB
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
  failures.push(
    `단일 파일 ${maxFile.path} ${maxFile.bytes}B > ${BUDGETS.maxFile}B`,
  );

const mib = (total / 1048576).toFixed(3);
if (failures.length > 0) {
  console.error(`budget gate FAIL (${failures.length}건):`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(
  `budget gate PASS — 총 ${total}B (${mib}MiB) · JS ${js}B · CSS ${css}B · 최대 ${maxFile.bytes}B`,
);
