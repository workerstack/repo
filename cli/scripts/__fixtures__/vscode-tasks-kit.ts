// The vscode-tasks suites' helpers: temp roots, files written in them, the tasks file read back and run's lines.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach } from "vitest";

import { stripJsonc } from "../strip-jsonc.ts";
import type { TasksFile, TasksIo } from "../vscode-tasks.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { force: true, recursive: true });
});

export function tempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-tasks-"));
  dirs.push(dir);
  return dir;
}

export function write(root: string, rel: string, body: unknown) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body, null, 2));
}

export function readTasks(root: string): TasksFile {
  const text = stripJsonc(fs.readFileSync(path.join(root, ".vscode", "tasks.json"), "utf8"));
  return JSON.parse(text) /* run writes the TasksFile buildTasks returns */ as TasksFile;
}

/** `fn`'s exit code and the lines it printed to each stream of the io it is handed. */
export function silent(fn: (io: TasksIo) => number) {
  const logs: string[] = [];
  const errs: string[] = [];
  const code = fn({ stderr: (line) => void errs.push(line), stdout: (line) => void logs.push(line) });
  return { code, errs, logs };
}
