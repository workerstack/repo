import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, vi } from "vitest";

/** Planted dirs under the OS temp dir, removed after each case; nothing here touches the real home. */
export function plantDirs(): (prefix: string) => string {
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

/** Write `body` at `rel` under `root`, creating parent dirs. */
export function plant(root: string, rel: string, body: string): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  return abs;
}

/** A workspace holding `manifest` as the stock manifest; `payloads` maps repo-relative paths to file text. */
export function plantWorkspace(
  make: (prefix: string) => string,
  manifest: unknown,
  payloads: Record<string, string> = {},
): string {
  const ws = make("yolo-kit-ws-");
  plant(ws, "agents/global-settings/manifest.json", typeof manifest === "string" ? manifest : JSON.stringify(manifest));
  for (const [rel, body] of Object.entries(payloads)) plant(ws, rel, body);
  return ws;
}

/** Collect what the code under test writes to stdout and stderr; the caller restores mocks after each case. */
export function captureStreams(): { out: () => string; err: () => string; reset: () => void } {
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
  return {
    out: () => out.join(""),
    err: () => err.join(""),
    reset: () => {
      out.length = 0;
      err.length = 0;
    },
  };
}
