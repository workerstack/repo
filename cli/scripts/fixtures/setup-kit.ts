import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import type { SetupIo } from "../setup.ts";

const dirs: string[] = [];

/** A planted dir for one case. `home` also stubs HOME and USERPROFILE and os.homedir() answers it, so no default reaches the real home. */
export function plant(prefix: string, home = false): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  if (home) {
    vi.stubEnv("HOME", dir);
    vi.stubEnv("USERPROFILE", dir);
    vi.spyOn(os, "homedir").mockReturnValue(dir);
  }
  return dir;
}

/** Removes every planted dir and restores stubbed env and spies. Call from afterEach. */
export function cleanSetup(): void {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
}

export function captureIo(): SetupIo & { logs: string[]; errs: string[] } {
  const logs: string[] = [];
  const errs: string[] = [];
  return { logs, errs, log: (s) => logs.push(s), error: (s) => errs.push(s) };
}

/** Stdout and stderr writes recorded while the spy lives; restored by cleanSetup. */
export function spyStd(): { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((s) => !!out.push(String(s)));
  vi.spyOn(process.stderr, "write").mockImplementation((s) => !!err.push(String(s)));
  return { out, err };
}

export const desktopOauth = {
  installed: { client_id: "cid.apps.googleusercontent.com", client_secret: "cs", redirect_uris: ["http://127.0.0.1"] },
};

export function enablePacks(cwd: string, packs: string[]): string {
  const cfg = `export default { packs: ["agents"], agents: { skills: ${JSON.stringify(packs)} } }\n`;
  fs.writeFileSync(path.join(cwd, "workerstack.config.ts"), cfg);
  return cwd;
}

export function writeAt(p: string, body: string, mode = 0o644): string {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, { mode });
  return p;
}

export function readSpeakJson(home: string): Record<string, Record<string, string>> {
  const raw = fs.readFileSync(path.join(home, ".workerstack", "speak.json"), "utf8");
  return JSON.parse(raw) as Record<string, Record<string, string>>;
}

/** No binary on any PATH: setup sees a bare machine. */
export const bare = { whichFn: () => "", pathEnv: "/none", platform: "linux" as const };

export function okJson(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve("") };
}
