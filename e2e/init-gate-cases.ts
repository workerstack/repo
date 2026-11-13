/** The fresh-repo cases on the installed gates: fmt, lint, turn, check, lint.skip and the git hooks. */
import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { repoEnv } from "../cli/repo-env.ts";
import { nodelessPath } from "../dev/nodeless-path.ts";
import type { GetSandbox } from "./get-sandbox.types";
import { gitStdout } from "./git-stdout";
import {
  expectClean,
  expectGatesPass,
  expectPlantedFails,
  expectSkipsChecked,
  FLOATING,
  NON_NULL,
} from "./init-helpers";
import type { Sandbox } from "./sandbox";
import { tail } from "./tail";

/** One executable hook's `git ls-files -s` line, up to the hook's name. */
const HOOK_LS_LINE = "100755 \\w+ 0\\t\\.githooks\\/";

/** The `git ls-files -s .githooks` listing: the three hooks, each executable. */
function hooksListing(): RegExp {
  return new RegExp(`^${HOOK_LS_LINE}commit-msg\n${HOOK_LS_LINE}pre-commit\n${HOOK_LS_LINE}pre-push\n$`);
}

/** With node off PATH, fmt passes and every gate fails a planted non-null assertion and floating promise. */
export function nodelessGatesCase(get: GetSandbox) {
  it.skipIf(process.platform === "win32")(
    "with node off PATH, fmt --check passes on the fresh consumer, and lint, turn and check fail a planted " +
      "non-null assertion and floating promise until it is gone",
    async () => {
      const sb = get();
      const env = { PATH: nodelessPath(sb.root, repoEnv.process.PATH ?? "") };
      const node = await sb.run("sh", ["-c", "command -v node"], { env });
      expect(node.status).not.toBe(0);
      const fmt = await sb.run("bun", ["repo", "fmt", "--check"], { env });
      expect(fmt.status, tail(fmt.out)).toBe(0);
      expect(fmt.stdout).toContain("All matched files use the correct format");
      sb.write("src/planted.ts", `${NON_NULL}\n${FLOATING}`);

      try {
        const lint = await sb.run("bun", ["repo", "lint"], { env });
        expect(lint.status, tail(lint.out)).toBe(1);
        expect(lint.out).toContain("no-non-null-assertion");
        expect(lint.out).toContain("no-floating-promises");
        await expectPlantedFails(sb, env);
      } finally {
        fs.rmSync(path.join(sb.repo, "src/planted.ts"));
      }

      await expectGatesPass(sb, env);
    },
  );
}

/** Lint runs the repo plugin from the install, and check and sync police lint.skip. */
export function pluginAndSkipCases(get: GetSandbox) {
  it("lint loads the repo plugin from the install: a module let and a bare import fail until removed", async () => {
    const sb = get();
    sb.write("src/stateful.ts", "let count = 0;\nexport const next = (): number => ++count;\n");
    sb.write("src/polyfill.ts", 'import "./stateful.ts";\n');

    try {
      const lint = await sb.run("bun", ["repo", "lint"]);
      expect(lint.status, tail(lint.out)).toBe(1);
      expect(lint.out).toContain("repo(no-module-state)");
      expect(lint.out).toContain("repo(no-side-effect-import)");
    } finally {
      for (const rel of ["src/stateful.ts", "src/polyfill.ts"]) fs.rmSync(path.join(sb.repo, rel));
    }

    expectClean(sb, await sb.run("bun", ["repo", "lint"]));
  });

  it("check prints a live lint.skip and fails a stale one, and a skip of an unknown rule fails sync", async () => {
    const sb = get();
    const original = sb.read("repo.config.ts");
    sb.write("src/skipped.ts", NON_NULL);

    try {
      await expectSkipsChecked(sb, original);
    } finally {
      fs.rmSync(path.join(sb.repo, "src/skipped.ts"));
      sb.write("repo.config.ts", original);
      await sb.run("bun", ["repo", "sync"]);
    }

    expect(sb.read(".oxlintrc.json")).not.toContain("src/skipped.ts");
    expectClean(sb, await sb.run("bun", ["repo", "sync", "--check"]));
  });
}

/** `git commit -m message` in the sandbox, its hooks running. */
function commitAs(sb: Sandbox, message: string) {
  return sb.run("git", ["commit", "-q", "-m", message]);
}

/** The tracked git hooks run turn on a commit and check its message. */
export function gitHooksCase(get: GetSandbox) {
  it("points core.hooksPath at tracked, executable hooks, so git commit runs turn and the message check", async () => {
    const sb = get();
    expect(await gitStdout(sb, "config", "core.hooksPath")).toBe(".githooks\n");
    expect(await gitStdout(sb, "ls-files", "-s", ".githooks")).toMatch(hooksListing());
    sb.write("src/planted.ts", NON_NULL);
    await sb.git("add", "src/planted.ts");
    const planted = await commitAs(sb, "chore: plant");
    expect(planted.status, tail(planted.out)).toBe(1);
    expect(planted.stderr).toContain(
      "repo turn: src/planted.ts has 1 typescript(no-non-null-assertion), the baseline allows 0; fix the new one",
    );
    await sb.git("rm", "-q", "--cached", "src/planted.ts");
    fs.rmSync(path.join(sb.repo, "src/planted.ts"));
    sb.write("src/feature.ts", "export const feature = 1;\n");
    sb.write("src/index.ts", `${sb.read("src/index.ts")}export { feature } from "./feature.ts";\n`);
    await sb.git("add", "src/feature.ts", "src/index.ts");
    const untested = await commitAs(sb, "feat: add the feature");
    expect(untested.status, tail(untested.out)).toBe(1);
    expect(untested.stderr).toContain(
      "commit-msg: the message was refused\n" +
        "  - a feat commit must include a test change (a *.test.* or *.spec.* file, or a file under e2e/)\n",
    );
    const clean = await commitAs(sb, "chore: add the feature");
    expect(clean.status, tail(clean.out)).toBe(0);
    expect(await gitStdout(sb, "log", "-1", "--format=%s")).toBe("chore: add the feature\n");
  });
}
