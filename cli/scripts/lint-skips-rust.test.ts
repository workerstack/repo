import { execFileSync } from "node:child_process";
import fs from "node:fs";

import { expect, it } from "vitest";

import { useTempTree } from "../__fixtures__/temp-tree.ts";
import type { LintSkip } from "../config.ts";
import type { Workspace } from "../sync/workspace.ts";
import { checkLintSkips } from "./lint-skips.ts";

const REASON = "the crate unwraps a value its caller checked";
const UNWRAP = "src/lib.rs:3:27: error clippy(unwrap_used): used `unwrap()` on a `Result` value";
const HIT = { file: "src/lib.rs", line: UNWRAP, rule: "clippy(unwrap_used)" };
const SCRIPT_HIT = {
  file: "src/lib.rs",
  line: "src/lib.rs:2:1: error repo(rust-block-comment): Rust comments use the line form",
  rule: "repo(rust-block-comment)",
};

const tree = useTempTree("workerstack-skips-rust-");

/** A directory holding `files` that is not a git repo. */
function untracked(files: Record<string, string>): Workspace {
  return { manifest: { name: "app" }, packages: [], root: fs.realpathSync(tree(files)) };
}

/** `untracked`, made a git repo. */
function checkout(files: Record<string, string>): Workspace {
  const ws = untracked(files);
  execFileSync("git", ["init", "-q"], { cwd: ws.root });
  return ws;
}

function skip(files: string[], rules: string[]): LintSkip {
  return { files, reason: REASON, rules };
}
const CRATE = { "Cargo.toml": "[package]\n", "src/lib.rs": "pub fn f() {}\n", "src/main.rs": "fn main() {}\n" };

it("checkLintSkips matches a .rs glob and reports the clippy and source-rule hits it turns off", () => {
  const ws = checkout(CRATE);
  const skips = [skip(["src/lib.rs"], ["clippy/unwrap_used", "repo/rust-block-comment"])];
  expect(checkLintSkips(ws, { skip: skips }, { scripts: [HIT, SCRIPT_HIT] })).toStrictEqual({
    problems: [],
    report: [
      `skip clippy/unwrap_used in src/lib.rs: 1 hit (${REASON})`,
      `skip repo/rust-block-comment in src/lib.rs: 1 hit (${REASON})`,
      "skips: clippy/unwrap_used 1, repo/rust-block-comment 1",
    ],
  });
});

it("checkLintSkips matches a glob over every .rs file, and fails a misspelled Rust rule as having no hit", () => {
  const ws = checkout(CRATE);
  const skips = [skip(["**/*.rs"], ["clippy/unwrap_used"]), skip(["src/main.rs"], ["clippy/unwrap_usd"])];
  expect(checkLintSkips(ws, { skip: skips }, { scripts: [HIT] })).toStrictEqual({
    problems: ['lint.skip[1]: clippy/unwrap_usd has no hit in "src/main.rs"; delete it from the entry'],
    report: [`skip clippy/unwrap_used in **/*.rs: 1 hit (${REASON})`, "skips: clippy/unwrap_used 1"],
  });
});

it("checkLintSkips matches no .rs file without a Cargo.toml", () => {
  const ws = checkout({ "src/lib.rs": "pub fn f() {}\n" });
  expect(
    checkLintSkips(ws, { skip: [skip(["src/lib.rs"], ["clippy/unwrap_used"])] }, { scripts: [HIT] }),
  ).toStrictEqual({
    problems: ['lint.skip[0]: "src/lib.rs" matches no file; fix the path or delete the entry'],
    report: [],
  });
});

it("checkLintSkips reports why the Rust files could not be listed", () => {
  const ws = untracked(CRATE);
  const checked = checkLintSkips(ws, { skip: [skip(["src/lib.rs"], ["clippy/unwrap_used"])] }, { scripts: [] });
  expect(checked.problems).toStrictEqual([expect.stringMatching(/^git ls-files failed: /)]);
});
