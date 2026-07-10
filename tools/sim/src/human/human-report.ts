import { writeFileSync } from "node:fs";

import { readHumanLogDirectory } from "./reader";
import { replayHumanRun } from "./replay";
import { buildHumanReport, renderHumanReportMarkdown } from "./report";

const usage = "usage: pnpm sim:human -- --dir <path> [--json] [--out <file>]";

type ParsedHumanReportArgs =
  | { ok: true; help: true }
  | { ok: true; help: false; dir: string | undefined; out: string | undefined; json: boolean }
  | { ok: false; unknown: string | undefined };

export const parseHumanReportArgs = (args: readonly string[]): ParsedHumanReportArgs => {
  let dir: string | undefined;
  let out: string | undefined;
  let json = false;

  const nextValueIndex = (start: number): number => {
    let valueIndex = start;
    while (args[valueIndex] === "--") {
      valueIndex += 1;
    }
    return valueIndex;
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--dir") {
      const valueIndex = nextValueIndex(index + 1);
      dir = args[valueIndex];
      index = valueIndex;
    } else if (arg === "--out") {
      const valueIndex = nextValueIndex(index + 1);
      out = args[valueIndex];
      index = valueIndex;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--help" || arg === "-h") {
      return { ok: true, help: true };
    } else {
      return { ok: false, unknown: arg };
    }
  }

  return { ok: true, help: false, dir, out, json };
};

const main = (args: readonly string[]): never => {
  const parsed = parseHumanReportArgs(args);

  if (!parsed.ok) {
    console.error(`unknown argument: ${parsed.unknown ?? ""}`);
    console.error(usage);
    process.exit(1);
  }

  if (parsed.help) {
    console.log(usage);
    process.exit(0);
  }

  const { dir, out, json } = parsed;

  if (dir === undefined || dir.length === 0) {
    console.error(usage);
    process.exit(1);
  }

  const read = readHumanLogDirectory(dir);
  const rejected = [...read.rejected];
  const verified = [];

  for (const file of read.files) {
    const replay = replayHumanRun(file.trace);
    if (!replay.verification.ok || replay.run === undefined) {
      rejected.push({
        filename: file.filename,
        reason: replay.verification.mismatches.join("; "),
      });
    } else {
      verified.push({ ...replay.run, filename: file.filename });
    }
  }

  const report = buildHumanReport(verified, rejected);
  const output = json
    ? JSON.stringify(report)
    : renderHumanReportMarkdown(report);

  if (out !== undefined && out.length > 0 && !json) {
    writeFileSync(out, output, "utf8");
  }

  console.log(output);
  process.exit(verified.length > 0 ? 0 : 1);
};

if ((process.argv[1] ?? "").endsWith("human-report.ts")) {
  main(process.argv.slice(2));
}
