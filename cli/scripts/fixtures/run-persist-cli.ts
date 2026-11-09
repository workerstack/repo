import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** What every persist CLI prints on success; the filename is absent from the roadmap CLI's output. */
export interface PersistCliJson {
  serial: number;
  path: string;
  absPath: string;
  filename?: string;
}

export function parsePersistCliJson(raw: string): PersistCliJson {
  const v: unknown = JSON.parse(raw);
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error(`persist CLI printed non-object JSON: ${raw}`);
  const serial: unknown = "serial" in v ? v.serial : undefined;
  const p: unknown = "path" in v ? v.path : undefined;
  const absPath: unknown = "absPath" in v ? v.absPath : undefined;
  const filename: unknown = "filename" in v ? v.filename : undefined;
  if (typeof serial !== "number" || typeof p !== "string" || typeof absPath !== "string") {
    throw new Error(`persist CLI printed an unexpected shape: ${raw}`);
  }
  return typeof filename === "string" ? { serial, path: p, absPath, filename } : { serial, path: p, absPath };
}

// Runs a persist CLI the way a host without the hook does: relative --workspace from the caller's cwd.
export function runPersistCli(script: string, body: string) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "persist-cli-"));
  const ws = path.join(cwd, "ws");
  fs.mkdirSync(ws);
  const r = spawnSync("bun", [path.join(scriptsDir, script), "--workspace", "ws"], {
    cwd,
    input: body,
    encoding: "utf8",
  });
  return { cwd, ws, status: r.status, stderr: r.stderr, json: r.status === 0 ? parsePersistCliJson(r.stdout) : null };
}
