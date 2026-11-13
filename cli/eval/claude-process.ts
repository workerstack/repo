/** The default `RunClaude`: runs the real `claude` in an empty temp dir, with no key or parent session in its env. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import crossSpawn from "cross-spawn";

import { childEnv } from "../env.ts";
import type { ClaudeCall, RunClaude } from "./session-client.ts";

/** Whether a variable leaks a key, a parent session, an effort or a base URL; the login token and config dir do not. */
function isDropped(name: string): boolean {
  const kept = ["CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR"].includes(name);

  return (name.startsWith("ANTHROPIC") || name.startsWith("CLAUDE")) && !kept;
}

/** The environment without any ANTHROPIC* or CLAUDE* variable, but the login token and the config dir. */
function sessionEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(childEnv()).filter(([name]) => !isDropped(name)));
}

function start(call: ClaudeCall, dir: string): ReturnType<RunClaude> {
  const missing = "eval: --via session needs the claude CLI, logged in; install Claude Code, or use --via api";
  const file = path.join(dir, "system.txt");
  const cwd = path.join(dir, "cwd");
  fs.mkdirSync(cwd);
  fs.writeFileSync(file, call.system);

  return new Promise((resolve, reject) => {
    const args = [...call.args, "--system-prompt-file", file];
    const child = crossSpawn("claude", args, { cwd, env: sessionEnv(), stdio: ["pipe", "pipe", "ignore"] });
    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => (stdout += chunk));
    child.on("error", (cause) => reject(new Error(missing, { cause })));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
    child.stdin?.on("error", reject);
    child.stdin?.end(call.stdin);
  });
}

/**
 * Runs `claude` on the call in an empty dir, with the system text in a file passed by `--system-prompt-file` (a
 * `.cmd` shim cannot take a newline in an argument); the whole temp dir is removed after.
 */
export async function claudeProcess(call: ClaudeCall): ReturnType<RunClaude> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-eval-claude-"));

  try {
    return await start(call, dir);
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
}
