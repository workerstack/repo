import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { plantProgram } from "../fixtures/stub-bin.ts";
import { readEnv } from "../env.ts";
import { runHook, spawnHook } from "./fixtures/run-hook.ts";
import type { HookIo } from "./hook-io.ts";
import { main } from "./rtk-grok.ts";

/** The stub's brain: `rtk rewrite --ultra-compact <cmd>` answers by the command's first word. */
const STUB_JS = `
const cmd = process.argv[4] ?? "";
if (cmd.startsWith("slow")) setTimeout(() => {}, 10000);
else if (cmd.startsWith("same")) process.stdout.write(cmd);
else if (cmd.startsWith("none")) process.stdout.write("");
else process.stdout.write("rtk " + cmd);
`;

const tmpDirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

let shared: string | undefined;
afterAll(() => {
  if (shared) fs.rmSync(shared, { recursive: true, force: true });
});

/** A directory holding an `rtk` that runs the stub; built once, since win32 compiles it to an .exe. */
function stubDir(): string {
  if (shared === undefined) {
    shared = fs.mkdtempSync(path.join(os.tmpdir(), "rtk-stub-"));
    plantProgram(shared, "rtk", STUB_JS);
  }
  return shared;
}

const withStub = (dir: string) => ({ PATH: `${dir}${path.delimiter}${readEnv().PATH ?? ""}` });
const call = (command: unknown, env: Record<string, string | undefined> = withStub(stubDir())) =>
  runHook(main, { tool_name: "Bash", tool_input: { command, description: "d" }, hookEventName: "PreToolUse" }, env);

function updated(command: string): unknown {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecisionReason: "RTK auto-rewrite",
      updatedInput: { command, description: "d" },
    },
  };
}

describe("rtk-grok hook", () => {
  it("rewrites a command through rtk and keeps the other tool input", () => {
    const r = call("git status");
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(updated("rtk git status"));
  });

  it("adds --ultra-compact to a rewrite that names an ultra subcommand", () => {
    expect(JSON.parse(call("grep foo src").stdout)).toEqual(updated("rtk grep --ultra-compact foo src"));
    expect(JSON.parse(call("grep").stdout)).toEqual(updated("rtk grep --ultra-compact"));
  });

  it("injects the flag into a command that already starts with rtk, and leaves it alone otherwise", () => {
    expect(JSON.parse(call("rtk grep foo").stdout)).toEqual(updated("rtk grep --ultra-compact foo"));
    expect(call("/usr/bin/rtk tsc").stdout).toBe("");
    expect(call("rtk grep --ultra-compact foo").stdout).toBe("");
    expect(call("rtk git status").stdout).toBe("");
    expect(call("rtk").stdout).toBe("");
  });

  it("prints nothing when rtk answers the same command or nothing", () => {
    expect(call("same one")).toEqual({ status: 0, stdout: "" });
    expect(call("none one")).toEqual({ status: 0, stdout: "" });
  });
});

/** Makes the process's stdin (fd 0) yield `text` once, so `main` can run with its default io. */
function feedStdin(text: string): void {
  const bytes = Buffer.from(text);
  vi.spyOn(fs, "readSync").mockImplementationOnce((_fd, into) =>
    bytes.copy(new Uint8Array(into.buffer, into.byteOffset, into.byteLength)),
  );
}

describe("rtk-grok hook on the process stdin", () => {
  it("reads the payload from stdin and answers on stdout", () => {
    vi.stubEnv("PATH", `${stubDir()}${path.delimiter}${readEnv().PATH ?? ""}`);
    feedStdin(JSON.stringify({ tool_input: { command: "git status" } }));
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    expect(main()).toBe(0);
    expect(JSON.parse(String(out.mock.calls[0]?.[0]))).toMatchObject({
      hookSpecificOutput: { updatedInput: { command: "rtk git status" } },
    });
  });
});

describe("rtk-grok hook without a rewrite", () => {
  it("prints nothing when rtk is not on PATH", () => {
    expect(call("git status", { PATH: tmp("rtk-empty-") })).toEqual({ status: 0, stdout: "" });
  });

  it("prints nothing when PATH is not set", () => {
    expect(call("git status", { PATH: undefined })).toEqual({ status: 0, stdout: "" });
  });

  it("prints nothing when rtk outlives the timeout", () => {
    expect(call("slow one")).toEqual({ status: 0, stdout: "" });
  });

  it("prints nothing for a payload with no usable command", () => {
    for (const bad of ["not json", "{}", '{"tool_input":{"command":5}}', '{"tool_input":{"command":"   "}}']) {
      expect(runHook(main, bad, withStub(stubDir()))).toEqual({ status: 0, stdout: "" });
    }
    expect(call(7).stdout).toBe("");
  });

  it("prints nothing when the command cannot be handed to a process", () => {
    expect(call("git\0status")).toEqual({ status: 0, stdout: "" });
  });
});

describe("rtk-grok hook edge cases", () => {
  it("fails open when the reply cannot be written", () => {
    const input = new TextEncoder().encode(JSON.stringify({ tool_input: { command: "ls" } }));
    let fed = false;
    const io: HookIo = {
      readChunk: () => (fed ? null : ((fed = true), input)),
      write: () => {
        throw new Error("closed pipe");
      },
    };
    vi.stubEnv("PATH", `${stubDir()}${path.delimiter}${readEnv().PATH ?? ""}`);
    expect(main([], io)).toBe(0);
  });

  it("reads the camelCase toolInput Grok sends", () => {
    const r = runHook(main, { toolInput: { command: "ls" } }, withStub(stubDir()));
    expect(JSON.parse(r.stdout)).toMatchObject({ hookSpecificOutput: { updatedInput: { command: "rtk ls" } } });
  });
});

describe("repo hook rtk-grok (spawned)", () => {
  it("rewrites a command through the real entry", () => {
    const r = spawnHook(
      "rtk-grok",
      { tool_name: "Bash", tool_input: { command: "git status", description: "d" } },
      { env: withStub(stubDir()) },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(updated("rtk git status"));
  });
});
