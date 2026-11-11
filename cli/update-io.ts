import { readEnv } from "./env.ts";
import { linkIo } from "./link-io.ts";
import { captureSorted } from "./scripts/lint.ts";
import type { ToolResult, UpdateIo } from "./update-io.types.ts";

/** Sorts the json keys of `files` under `root` and formats them with oxfmt, as `repo fmt` does. */
export function formatFiles(root: string, files: string[]): ToolResult {
  const result = captureSorted(files, root);
  return { code: result.code, output: result.stdout + result.stderr };
}

/** The process's own streams, the global fetch, `bun install` and the formatter. */
export function updateIo(): UpdateIo {
  const base = linkIo();
  return {
    cwd: base.cwd,
    env: readEnv(),
    err: base.err,
    fetch: globalThis.fetch,
    format: formatFiles,
    install: base.install,
    out: base.out,
  };
}
