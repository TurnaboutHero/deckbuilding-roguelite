// 번들 예산 게이트 (차단) — 빌드 후 실행한다.
// 사용: node scripts/check-budget.mjs
import { readdirSync, statSync } from "node:fs";
import { join, resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "apps/ui/dist");
// P9: 마도기사·전기 결투사의 두 빌드와 선택형 소환/르미즈 해결 규칙을 추가했다.
// 이미지 자산 증가는 없으며, 중복 명령 비교·선택 라우팅을 제거한 뒤의 실측치에
// 총 22KiB, JS 5KiB, CSS 64B만 허용한다. 단일 파일·LCP·CLS 게이트는 유지한다.
const BUDGETS = {
  total: 2767257,
  js: 414720, // 405 KiB
  css: 71744, // 70 KiB + 64 B
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
