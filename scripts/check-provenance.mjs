// P5.5 자산 provenance 게이트 (차단) — 생성 자산의 출처 증거가 계약을 지키는지 검사.
// 규칙:
//  1) 모든 스프라이트 run 디렉토리는 필수 파일을 갖추고 frames/atlas 리포트 ok=true.
//  2) prompt-kit-validation이 있으면 전 결과 ok=true·errors 0 (P3.3+ 선컴파일 계약).
//  3) 오디오 파일은 저장소에 존재하지 않아야 한다 (P5.2: 런타임 합성만 — 파일이
//     생기면 provenance 문서 없이는 실패).
// 사용: node scripts/check-provenance.mjs
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const spritesRoot = join(root, "apps/ui/src/assets/generated/sprites");
const failures = [];

// ── 1) 스프라이트 run 계약 ───────────────────────────────────────────
const REQUIRED = [
  "sprite-request.json",
  "base-source.png",
  "sprite-sheet-alpha.png",
  "sprite-sheet-alpha.report.json",
  "manifest.json",
  "qa-notes.md",
  "frames/frames-manifest.json",
];
for (const character of readdirSync(spritesRoot)) {
  const dir = join(spritesRoot, character);
  if (!statSync(dir).isDirectory()) continue;
  for (const file of REQUIRED) {
    if (!existsSync(join(dir, file)))
      failures.push(`${character}: 필수 파일 누락 — ${file}`);
  }
  for (const reportFile of [
    "frames/frames-manifest.json",
    "sprite-sheet-alpha.report.json",
  ]) {
    const path = join(dir, reportFile);
    if (!existsSync(path)) continue;
    try {
      const report = JSON.parse(readFileSync(path, "utf8"));
      if (report.ok !== true)
        failures.push(`${character}: ${reportFile} ok=true 아님`);
    } catch {
      failures.push(`${character}: ${reportFile} 파싱 불가`);
    }
  }
  const kitDir = join(dir, "prompt-kit-validation");
  if (existsSync(kitDir)) {
    for (const entry of readdirSync(kitDir)) {
      // 계약 대상은 정련본(.refined.result.json) — 정련 접미사 없는 .result.json은
      // P3.2 사후 검증의 정직한 실패 기록(역사 증거)이라 게이트 대상이 아니다.
      const isRefined = entry.endsWith(".refined.result.json");
      const isPlain = entry.endsWith(".result.json") && !isRefined;
      if (isPlain) continue;
      if (!isRefined) continue;
      try {
        const result = JSON.parse(readFileSync(join(kitDir, entry), "utf8"));
        if (result.ok !== true || (result.errors ?? []).length > 0)
          failures.push(
            `${character}: prompt-kit ${entry} ok=true·0E 아님`,
          );
      } catch {
        failures.push(`${character}: prompt-kit ${entry} 파싱 불가`);
      }
    }
  }
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  if (manifest.degraded_static_fallback === true)
    failures.push(`${character}: degraded_static_fallback 금지`);
}

// ── 2) 오디오 파일 부재 (런타임 합성 계약) ───────────────────────────
const AUDIO_EXT = new Set([".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac"]);
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (AUDIO_EXT.has(extname(entry.name).toLowerCase()))
      failures.push(`오디오 파일 발견 — provenance 문서 없이 금지: ${path}`);
  }
};
walk(join(root, "apps"));
walk(join(root, "packages"));

// ── 3) 카드 아트 킷 증거 디렉토리 존재 ───────────────────────────────
if (!existsSync(join(root, "docs/ui/card-art-prompt-validation")))
  failures.push("docs/ui/card-art-prompt-validation 부재 (카드 아트 킷 증거)");

if (failures.length > 0) {
  console.error(`provenance gate FAIL (${failures.length}건):`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log("provenance gate PASS");
