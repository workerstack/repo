import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMMANDS,
  PIPELINE_CONFIG_REL,
  envWithLocalBin,
  formatCheckFailures,
  inferPipelineSkip,
  loadPipelineOverlay,
  quotedCommandsInBlock,
  resolvePipelineCommands,
  runPipeline,
} from "./pipeline.mjs";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmp(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function writeOverlay(cwd: string, body: string) {
  fs.mkdirSync(path.join(cwd, ".rulesync"), { recursive: true });
  fs.writeFileSync(path.join(cwd, PIPELINE_CONFIG_REL), body);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "pipeline.mjs");

describe("runPipeline", () => {
  it("runs generate commands in order with local .bin PATH", () => {
    const exec = vi.fn();
    const cwd = "/tmp/ws";
    runPipeline("generate", { cwd, exec });
    expect(exec.mock.calls.map((c) => c[0])).toEqual(COMMANDS.generate);
    const env = exec.mock.calls[0][1].env;
    expect(env.PATH.startsWith(path.join(cwd, "node_modules", ".bin") + path.delimiter)).toBe(
      true,
    );
    expect(exec.mock.calls[0][1]).toMatchObject({
      cwd,
      stdio: "inherit",
      shell: true,
    });
  });

  it("generate stops after the first failing command", () => {
    const exec = vi.fn(() => {
      throw new Error("boom");
    });
    expect(() => runPipeline("generate", { cwd: "/tmp", exec })).toThrow(/boom/);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][0]).toBe(COMMANDS.generate[0]);
  });

  it("check runs every command and reports all failures", () => {
    const exec = vi.fn((cmd: string) => {
      if (String(cmd).includes("emit-gemini") || String(cmd).includes("subagents")) {
        throw new Error(`boom\n${cmd}`);
      }
    });
    let err: Error | undefined;
    try {
      runPipeline("check", { cwd: "/tmp", exec });
    } catch (e) {
      err = e as Error;
    }
    expect(exec).toHaveBeenCalledTimes(COMMANDS.check.length);
    expect(err?.message).toMatch(/pipeline check failed \(2 steps\)/);
    expect(err?.message).toMatch(/emit-gemini/);
    expect(err?.message).toMatch(/subagents/);
    expect(err?.message).toMatch(/grunt\.pipeline\.jsonc/);
  });

  it("check reports a single step and string throws", () => {
    expect(() =>
      runPipeline("check", {
        cwd: "/tmp",
        exec: (cmd: string) => {
          if (cmd === COMMANDS.check[0]) throw "nope";
        },
      }),
    ).toThrow(/pipeline check failed \(1 step\)/);
  });

  it("check with every command skipped succeeds", () => {
    const cwd = tmp("pipe-skipall-");
    writeOverlay(cwd, JSON.stringify({ check: { skip: COMMANDS.check } }));
    const exec = vi.fn();
    runPipeline("check", { cwd, exec });
    expect(exec).not.toHaveBeenCalled();
  });

  it("drops non-string and empty overlay entries", () => {
    const cwd = tmp("pipe-filter-");
    writeOverlay(cwd, `{"check":{"skip":["x",1,""],"extra":["",1,"y"]}}`);
    expect(loadPipelineOverlay(cwd, "check")).toEqual({ skip: ["x"], extra: ["y"] });
  });

  it("skips overlay commands and appends extra", () => {
    const cwd = tmp("pipe-overlay-");
    writeOverlay(
      cwd,
      `{
      "check": {
        "skip": ${JSON.stringify([COMMANDS.check[1]])},
        "extra": ["node scripts/codex-sync.mjs --check"]
      }
    }`,
    );
    const exec = vi.fn();
    runPipeline("check", { cwd, exec });
    const cmds = exec.mock.calls.map((c) => c[0]);
    expect(cmds).not.toContain(COMMANDS.check[1]);
    expect(cmds.at(-1)).toBe("node scripts/codex-sync.mjs --check");
    expect(cmds).toHaveLength(COMMANDS.check.length);
  });

  it("ignores a bad overlay and a non-object section", () => {
    const cwd = tmp("pipe-bad-");
    writeOverlay(cwd, "{ nope");
    const warn = vi.fn();
    expect(loadPipelineOverlay(cwd, "check", warn)).toEqual({ skip: [], extra: [] });
    expect(warn).toHaveBeenCalled();
    writeOverlay(cwd, JSON.stringify({ check: ["nope"] }));
    expect(loadPipelineOverlay(cwd, "check")).toEqual({ skip: [], extra: [] });
    writeOverlay(cwd, JSON.stringify(["nope"]));
    expect(loadPipelineOverlay(cwd, "check")).toEqual({ skip: [], extra: [] });
    expect(resolvePipelineCommands("nope" as "check", cwd)).toBeNull();
  });

  it("inferPipelineSkip reads quoted dest commands and ignores comments", () => {
    const src = `export const COMMANDS = {
  check: [
    ${JSON.stringify(COMMANDS.check[0])},
    // ${JSON.stringify(COMMANDS.check[1])},
  ],
};
`;
    expect(quotedCommandsInBlock(src, "check")).toEqual([COMMANDS.check[0]]);
    expect(inferPipelineSkip(src, "check")).toEqual(COMMANDS.check.slice(1));
    expect(inferPipelineSkip("export const COMMANDS = {}\n", "check")).toEqual([]);
    expect(inferPipelineSkip(src, "nope")).toEqual([]);
  });

  it("formatCheckFailures drops blank error lines", () => {
    expect(
      formatCheckFailures([{ cmd: "x", err: { message: "a\n\nb" } }]),
    ).toMatch(/- x\n  a\n  b\n/);
  });

  it("rejects unknown mode", () => {
    expect(() => runPipeline("")).toThrow(/generate\|check\|watch/);
    expect(() => runPipeline("nope")).toThrow(/generate\|check\|watch/);
  });

  it("envWithLocalBin prepends when PATH is missing", () => {
    const cwd = "/tmp/ws";
    const env = envWithLocalBin(cwd, {});
    expect(env.PATH).toBe(path.join(cwd, "node_modules", ".bin") + path.delimiter);
  });
});

describe("CLI", () => {
  it("exits 1 with usage on bad mode", () => {
    const result = spawnSync(process.execPath, [script, "nope"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/generate\|check\|watch/);
    expect(result.stdout).toBe("");
  });
});
