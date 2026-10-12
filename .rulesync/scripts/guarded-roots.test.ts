import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachGuardedRootWatchers,
  runGuardedRoots,
} from "./guarded-roots.mjs";
import { COMMANDS } from "./pipeline.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "guarded-roots.mjs");

const tmpDirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmp(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function writeGuarded(dest: string, file: string, interior: string, user: string) {
  fs.writeFileSync(
    path.join(dest, file),
    `<!-- grunt:begin -->\n${interior}\n<!-- grunt:end -->\n${user}\n`,
  );
}

describe("attachGuardedRootWatchers", () => {
  it("heals guarded basenames only; close errors are ignored", () => {
    let handler: ((event: string, filename: string | Buffer | null) => void) | undefined;
    const close = vi.fn();
    vi.spyOn(fs, "watch").mockImplementation(((_cwd, cb) => {
      handler = cb as typeof handler;
      return { close } as unknown as fs.FSWatcher;
    }) as typeof fs.watch);
    const heal = vi.fn();
    const stop = attachGuardedRootWatchers("/tmp", heal);
    handler?.("change", "");
    handler?.("change", null);
    handler?.("change", "README.md");
    handler?.("rename", "AGENTS.md");
    handler?.("change", path.join("nested", "CLAUDE.md"));
    handler?.("change", Buffer.from("GEMINI.md"));
    expect(heal.mock.calls.map((c) => c[0])).toEqual([
      "AGENTS.md",
      "CLAUDE.md",
      "GEMINI.md",
    ]);
    stop();
    expect(close).toHaveBeenCalledTimes(1);
    close.mockImplementation(() => {
      throw new Error("already closed");
    });
    expect(() => stop()).not.toThrow();
  });
});

describe("runGuardedRoots", () => {
  it("generate rematches after inner clobber even when exec throws", () => {
    const dest = tmp("guarded-gen-");
    writeGuarded(dest, "AGENTS.md", "old", "keep me");
    const exec = vi.fn(() => {
      fs.writeFileSync(path.join(dest, "AGENTS.md"), "fresh ssot\n");
      throw new Error("raw failed");
    });
    expect(() => runGuardedRoots("generate", { cwd: dest, exec })).toThrow(
      /raw failed/,
    );
    expect(exec.mock.calls.map((c) => c[0])).toEqual([COMMANDS.generate[0]]);
    expect(exec.mock.calls[0][1]).toMatchObject({
      cwd: dest,
      stdio: "inherit",
      shell: true,
    });
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\nfresh ssot\n<!-- grunt:end -->\nkeep me\n",
    );
  });

  it("check runs pipeline inside interiors wrapper", () => {
    const dest = tmp("guarded-check-");
    writeGuarded(dest, "AGENTS.md", "ssot", "user bottom");
    const exec = vi.fn(() => {
      const live = fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8");
      expect(live).toContain("ssot");
      expect(live).not.toContain("user bottom");
    });
    runGuardedRoots("check", { cwd: dest, exec });
    expect(exec.mock.calls.map((c) => c[0])).toEqual(COMMANDS.check);
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toContain(
      "user bottom",
    );
  });

  it("watch rematches on exit and swallows stop() throw", () => {
    const dest = tmp("guarded-watch-");
    writeGuarded(dest, "AGENTS.md", "old", "keep me");
    const exec = vi.fn(() => {
      fs.writeFileSync(path.join(dest, "AGENTS.md"), "from-watch\n");
    });
    const stop = vi.fn(() => {
      throw new Error("stop boom");
    });
    expect(() =>
      runGuardedRoots("watch", {
        cwd: dest,
        exec,
        attachWatchers: () => stop,
      }),
    ).not.toThrow();
    expect(exec.mock.calls.map((c) => c[0])).toEqual(COMMANDS.watch);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\nfrom-watch\n<!-- grunt:end -->\nkeep me\n",
    );
  });

  it("rejects unknown mode", () => {
    expect(() => runGuardedRoots("")).toThrow(/generate\|check\|watch/);
    expect(() => runGuardedRoots("nope")).toThrow(/generate\|check\|watch/);
  });
});

describe("CLI", () => {
  it("exits 1 with usage on bad mode; does not inherit exec", () => {
    const result = spawnSync(process.execPath, [script, "nope"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/generate\|check\|watch/);
    expect(result.stdout).toBe("");
  });
});
