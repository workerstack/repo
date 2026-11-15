import { spawnSync } from "node:child_process";

import { linkGit } from "./link-git.ts";
import type { LinkIo } from "./link-io.types.ts";
import { EXIT_FAIL } from "./link.constants.ts";

/** The process's own streams, git and `bun install`. */
export function linkIo(): LinkIo {
  return {
    cwd: process.cwd(),
    err: (line) => process.stderr.write(`${line}\n`),
    git: linkGit,
    install: (root) => {
      const result = spawnSync("bun", ["install"], { cwd: root, encoding: "utf8" });

      return { code: result.status ?? EXIT_FAIL, output: [result.stdout, result.stderr].filter(Boolean).join("") };
    },
    now: () => new Date(),
    out: (line) => process.stdout.write(`${line}\n`),
  };
}

/** All of the process's standard input; read here, at the edge, and passed into the commands as text. */
export function readStdin(): Promise<string> {
  return Bun.stdin.text();
}
