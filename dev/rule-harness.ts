/**
 * Runs a repo lint rule through eslint's `Linter` with the typescript-eslint parser, over fixture files written to a
 * temp dir that is the linter's `cwd`. oxlint's own `RuleTester` refuses Bun; `cli/scripts/lint-repo-rules.test.ts`
 * runs the rules through real oxlint.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as parser from "@typescript-eslint/parser";
import { TSESLint } from "@typescript-eslint/utils";

import type { RepoRule } from "../cli/lint/rule.types.ts";
import { removeTree } from "../cli/remove-tree.ts";

/** Repo-relative path → source; package.json files among them are read by rules that read manifests. */
export type Fixture = Record<string, string>;

/** One finding: the fixture path it is in and the rule's message. */
export type Report = { file: string; message: string };

/** Any repo rule, whatever its message ids and options. */
type AnyRule = RepoRule<string, readonly unknown[]>;

/** The plugin the rule runs in, and its name there; its findings carry `repo/rule`, as oxlint's carry the real name. */
const PLUGIN = "repo";
const NAME = "rule";
const RULE_ID = `${PLUGIN}/${NAME}`;

/** The config that runs only `rule`, with `options`, over every JS and TS file. */
function configOf(rule: AnyRule, options: readonly unknown[]): TSESLint.FlatConfig.Config {
  return {
    files: ["**/*.{js,jsx,ts,tsx,mts,cts,mjs,cjs}"],
    languageOptions: { parser },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    plugins: { [PLUGIN]: { rules: { [NAME]: rule } } },
    rules: { [RULE_ID]: ["error", ...options] },
  };
}

/** The rule's findings in `messages`; a file that does not parse throws, so no fixture passes by being skipped. */
function ownMessages(file: string, messages: readonly TSESLint.Linter.LintMessage[]): TSESLint.Linter.LintMessage[] {
  const fatal = messages.find((message) => message.fatal === true);

  if (fatal !== undefined) throw new Error(`${file}:${fatal.line}: ${fatal.message}`);

  return messages.filter((message) => message.ruleId === RULE_ID);
}

/** Calls `lint` with the dir `fixture` is written to; the dir is gone after. */
function inFixture<T>(fixture: Fixture, lint: (dir: string) => T): T {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-rule-")));

  try {
    for (const [file, code] of Object.entries(fixture)) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), code);
    }

    return lint(dir);
  } finally {
    removeTree(dir);
  }
}

/**
 * What `rule` reports over every JS and TS file of `fixture`: files in fixture order, each file's findings in position
 * order. `options` is what follows `"error"` in `["error", {…}]`; options the rule's schema refuses throw.
 */
export function reportsOf(rule: AnyRule, fixture: Fixture, options: readonly unknown[] = []): Report[] {
  return inFixture(fixture, (dir) => {
    const linter = new TSESLint.Linter({ cwd: dir });
    const config = configOf(rule, options);

    return Object.entries(fixture).flatMap(([file, code]) =>
      ownMessages(file, linter.verify(code, config, path.join(dir, file))).map((message) => ({
        file,
        message: message.message,
      })),
    );
  });
}

/** `code` as `a.ts` with every fix `rule` reports applied, as `eslint --fix` would leave it. */
export function fixedOf(rule: AnyRule, code: string): string {
  const file = "a.ts";

  return inFixture({ [file]: code }, (dir) => {
    const fixed = new TSESLint.Linter({ cwd: dir }).verifyAndFix(code, configOf(rule, []), {
      filename: path.join(dir, file),
    });

    ownMessages(file, fixed.messages);

    return fixed.output;
  });
}
