declare module "node:fs" {
  export interface Stats {
    size: number;
    isFile(): boolean;
  }
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function mkdtempSync(prefix: string): string;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function statSync(path: string): Stats;
  export function writeFileSync(path: string, data: string, encoding: "utf8"): void;
}

declare module "node:child_process" {
  export function execFileSync(
    file: string,
    args: readonly string[],
    options: {
      cwd?: string;
      encoding: "utf8";
      stdio?: readonly ["ignore", "pipe", "pipe"];
    },
  ): string;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
}

declare module "node:os" {
  export function tmpdir(): string;
}

declare class Buffer {
  toString(encoding?: string): string;
}

declare const process: {
  argv: string[];
  execPath: string;
  cwd(): string;
  exit(code?: number): never;
};
