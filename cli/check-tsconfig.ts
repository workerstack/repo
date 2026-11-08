import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { canonicalPath } from "../.rulesync/scripts/workspace-root.ts";

const TSCONFIG_NAME = /^tsconfig(\..+)?\.json$/;
const RESET = "reset.d.ts";

/** Tracked and untracked, non-ignored tsconfigs under `cwd`, posix and relative to it; none outside a git repo. */
function listTsconfigs(cwd: string): string[] {
  let out: string;
  try {
    out = execFileSync("git", ["ls-files", "-z", "-co", "--exclude-standard"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return [];
  }
  // An unmerged path is listed once per stage, and a deleted tracked one stays in the index.
  const rels = new Set(out.split("\0").filter((rel) => TSCONFIG_NAME.test(path.posix.basename(rel))));
  return [...rels].filter((rel) => fs.existsSync(path.join(cwd, rel)));
}

function problem(cwd: string, rel: string, reset: string): string | undefined {
  // typescript keys its source files by forward-slash paths and asserts that spelling on win32.
  const file = path.join(cwd, rel).split(path.sep).join("/");
  const read = ts.readConfigFile(file, ts.sys.readFile);
  if (read.error) return `tsconfig: ${rel}: ${ts.flattenDiagnosticMessageText(read.error.messageText, " ")}`;
  // Without a read error, typescript has parsed the root as a JSON object.
  const raw: { files?: unknown; references?: unknown } = read.config;
  const solution = Array.isArray(raw.files) && raw.files.length === 0 && raw.references !== undefined;
  if (solution) return undefined;
  if (raw.files !== undefined) {
    return `tsconfig: ${rel} sets "files", which replaces the base's reset.d.ts. List sources under "include".`;
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(file), undefined, file);
  const keepsReset = parsed.fileNames.some((name) => path.basename(name) === RESET && canonicalPath(name) === reset);
  if (keepsReset) return undefined;
  return `tsconfig: ${rel} does not extend a base. Extend "@workerstack/repo/tsconfig/base", "bun", "worker" or "web".`;
}

/**
 * One stderr line per tsconfig under `cwd` that drops ts-reset: it sets `files`, extends no base from `pkgRoot`,
 * or cannot be read. A solution-style `{"files": [], "references": [...]}` checks no code and passes.
 */
export function checkTsconfigs(cwd: string, pkgRoot: string): string[] {
  const reset = canonicalPath(path.join(pkgRoot, "tsconfig", RESET));
  return listTsconfigs(cwd).flatMap((rel) => problem(cwd, rel, reset) ?? []);
}
