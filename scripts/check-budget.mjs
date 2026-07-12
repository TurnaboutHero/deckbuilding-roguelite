// P5.5 번들 예산 게이트 (차단) — dist ≤ 2.6MiB (P5.0). 빌드 후 실행한다.
// 사용: node scripts/check-budget.mjs
import { readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "apps/ui/dist");
const BUDGET = 2726297; // 2.6 MiB (P5.0)

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
    const path = join(dir, entry.name);
    return sum + (entry.isDirectory() ? walk(path) : statSync(path).size);
  }, 0);

const bytes = walk(dist);
const mib = (bytes / 1048576).toFixed(3);
if (bytes > BUDGET) {
  console.error(`budget gate FAIL — dist ${bytes}B (${mib}MiB) > ${BUDGET}B (2.6MiB)`);
  process.exit(1);
}
console.log(`budget gate PASS — dist ${bytes}B (${mib}MiB) ≤ 2.6MiB`);
