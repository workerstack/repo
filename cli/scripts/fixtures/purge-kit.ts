import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, vi } from "vitest";

/** A planted home under the OS temp dir, removed after each case; nothing here touches the real home. */
export function plantHomes(): (prefix: string) => string {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  return (prefix) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  };
}

/** Write `body` at `rel` under `home`, creating parent dirs. */
export function plant(home: string, rel: string, body: string): string {
  const abs = path.join(home, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  return abs;
}

/** Collect what the code under test writes to stdout and stderr; the caller restores mocks after each case. */
export function captureStreams(): { out: () => string; err: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
  return { out: () => out.join(""), err: () => err.join("") };
}
