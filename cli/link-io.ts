import { spawnSync } from "node:child_process";
import { EXIT_FAIL } from "./link.constants.ts";
import { linkGit } from "./link-git.ts";
import type { LinkIo } from "./link-io.types.ts";

/** The process's own streams, git and `bun install`. */
export function linkIo(): LinkIo {
  return {
    cwd: process.cwd(),
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    git: linkGit,
    install: (root) => {
      const result = spawnSync("bun", ["install"], { cwd: root, encoding: "utf8" });
      return { code: result.status ?? EXIT_FAIL, output: [result.stdout, result.stderr].filter(Boolean).join("") };
    },
    now: () => new Date(),
  };
}
