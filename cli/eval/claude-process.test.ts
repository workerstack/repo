import fs from "node:fs";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { plantStub } from "../__fixtures__/stub-bin.ts";
import { useTempTree } from "../__fixtures__/temp-tree.ts";
import { childEnv } from "../env.ts";
import { claudeProcess } from "./claude-process.ts";

const tempTree = useTempTree("claude-process-");

/**
 * Echoes stdin, the system file's path (the third argument, after `-p --system-prompt-file`) and content,
 * the cwd, its entries and the env, each after a `--name` marker.
 */
const FAKE = {
  cmd: "more\necho --file\necho %3\necho --sys\ntype %3\necho --cwd\ncd\necho --ls\ndir /b\necho --env\nset",
  sh: [
    "cat",
    "echo --file",
    'echo "$3"',
    "echo --sys",
    'cat "$3"',
    "echo --cwd",
    "pwd",
    "echo --ls",
    "ls -A",
    "echo --env",
    "env",
  ].join("\n"),
};

/** The lines after the marker `--name`, up to the next marker. */
function section(stdout: string, name: string): string[] {
  const lines = stdout.split(/\r?\n/);
  const rest = lines.slice(lines.indexOf(`--${name}`) + 1);
  const end = rest.findIndex((line) => line.startsWith("--") && line.length > 2);

  return end === -1 ? rest : rest.slice(0, end);
}

const CALL = { args: ["-p"], stdin: "hello\n", system: "line one\nline two\n" };

function plantFake(): string {
  const bin = tempTree({});
  plantStub(bin, "claude", FAKE);
  vi.stubEnv("PATH", `${bin}${path.delimiter}${childEnv().PATH ?? ""}`);

  return bin;
}

it("runs claude with the input on stdin and the whole multi-line system text in a file", async () => {
  plantFake();
  const { code, stdout } = await claudeProcess(CALL);

  expect(code).toBe(0);
  expect(stdout.startsWith("hello")).toBe(true);
  expect(section(stdout, "sys").join("\n").trim()).toBe("line one\nline two");
});

it("runs claude in an empty directory and removes every temp file after", async () => {
  plantFake();
  const { stdout } = await claudeProcess(CALL);
  const [file = ""] = section(stdout, "file");
  const [cwd = ""] = section(stdout, "cwd");

  expect(section(stdout, "ls").filter((line) => line !== "")).toStrictEqual([]);
  expect(fs.existsSync(cwd.trim())).toBe(false);
  expect(fs.existsSync(path.dirname(file.trim()))).toBe(false);
});

it("drops every ANTHROPIC and CLAUDE variable but the OAuth token and the config dir", async () => {
  plantFake();
  vi.stubEnv("ANTHROPIC_API_KEY", "key");
  vi.stubEnv("ANTHROPIC_BASE_URL", "http://x");
  vi.stubEnv("CLAUDECODE", "1");
  vi.stubEnv("CLAUDE_EFFORT", "high");
  vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "token");
  vi.stubEnv("CLAUDE_CONFIG_DIR", "/cfg");
  const { stdout } = await claudeProcess(CALL);
  const names = section(stdout, "env").map((line) => line.split("=")[0]);

  expect(names).not.toContain("ANTHROPIC_API_KEY");
  expect(names).not.toContain("ANTHROPIC_BASE_URL");
  expect(names).not.toContain("CLAUDECODE");
  expect(names).not.toContain("CLAUDE_EFFORT");
  expect(stdout).toContain("CLAUDE_CODE_OAUTH_TOKEN=token");
  expect(stdout).toContain("CLAUDE_CONFIG_DIR=/cfg");
});

it.skipIf(process.platform === "win32")("reports exit 1 when claude dies on a signal", async () => {
  const bin = tempTree({});
  plantStub(bin, "claude", { cmd: "", sh: "kill -9 $$\n" });
  vi.stubEnv("PATH", `${bin}${path.delimiter}${childEnv().PATH ?? ""}`);

  const result = await claudeProcess({ ...CALL, args: [] });

  expect(result.code).toBe(1);
});

/** More input than a pipe buffers, so writing it to a claude that exits without reading breaks the pipe. */
const PIPE_OVERFLOW = "x".repeat(4 * 1024 * 1024);

it("reports claude's exit code when it exits before reading its input", async () => {
  const bin = tempTree({});
  plantStub(bin, "claude", { cmd: "exit /b 3", sh: "exit 3\n" });
  vi.stubEnv("PATH", `${bin}${path.delimiter}${childEnv().PATH ?? ""}`);

  const result = await claudeProcess({ ...CALL, args: [], stdin: PIPE_OVERFLOW });

  expect(result.code).toBe(3);
});

it("rejects with the install line when claude is not on PATH", async () => {
  vi.stubEnv("PATH", tempTree({}));

  await expect(claudeProcess({ ...CALL, args: [] })).rejects.toThrow(
    "eval: --via session needs the claude CLI, logged in; install Claude Code, or use --via api",
  );
});
