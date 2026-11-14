/**
 * Runs a repo lint rule through oxlint's own `RuleTester`, in process on Node, over fixture files written to a temp
 * dir that is each case's `cwd`: the parser and checks real lint runs, with the rule's code visible to coverage.
 */
import { AssertionError } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { RuleTester } from "oxlint/plugins-dev";

import type { RepoRule } from "../cli/lint/rule.types.ts";
import { removeTree } from "../cli/remove-tree.ts";
import { MessageRecorder } from "./message-recorder.ts";

/** Repo-relative path → source; package.json files among them are read by rules that read manifests. */
export type Fixture = Record<string, string>;

/** One finding: the fixture path it is in and the rule's message. */
export type Report = { file: string; message: string };

/** Any repo rule, whatever its message ids and options. */
type AnyRule = RepoRule<string, readonly unknown[]>;

/** What one lint of one file found: the rule's messages in position order and the code with its fixes applied. */
type Linted = { messages: string[]; fixed: string };

/** What follows `"error"` in a rule's config: the JSON values RuleTester passes to the rule. */
export type RuleOptions = Readonly<NonNullable<RuleTester.ValidTestCase["options"]>>;

/** The files the rule runs over, as oxlint lints them by extension. */
const SOURCE = /\.[cm]?[jt]sx?$/u;

/** One case RuleTester runs: the code, the file it is linted as, its `cwd` and the rule's options. */
type Case = RuleTester.ValidTestCase;

/** A RuleTester whose cases run inline: the describe and it it groups cases with call straight through. */
function tester(): RuleTester {
  RuleTester.describe = (_name: string, run: () => void) => run();
  RuleTester.it = (_name: string, run: () => void) => run();

  return new RuleTester();
}

/** The assertion `run` fails with, or null when it passes; any other error, such as a parse failure, throws. */
function failureOf(run: () => void): AssertionError | null {
  try {
    run();

    return null;
  } catch (error) {
    if (error instanceof AssertionError) return error;
    throw error;
  }
}

/**
 * `rule` over `base`: a valid case fails with the count of reports as its actual value, then an invalid case with that
 * many recorders records the messages and, having no `output`, fails with the fixed code as its actual.
 */
function lintCase(rule: AnyRule, base: Case): Linted {
  const code = base.code;
  const run = tester();

  const oxlintRule =
    rule /* oxlint runs typescript-eslint rule modules as is; RuleTester types rules by its own API */ as never;

  const counted = failureOf(() => run.run("rule", oxlintRule, { invalid: [], valid: [base] }));

  if (counted === null) return { fixed: code, messages: [] };
  const messages: string[] = [];
  const errors = Array.from({ length: Number(counted.actual) }, () => new MessageRecorder(messages));
  const fixed = failureOf(() => run.run("rule", oxlintRule, { invalid: [{ ...base, errors }], valid: [] }));

  return { fixed: fixed === null ? code : String(fixed.actual), messages };
}

/** The case of `file` holding `code` in `dir`, with `options` only when there are any. */
function caseOf(dir: string, [file, code]: readonly [string, string], options: RuleOptions): Case {
  const optioned = options.length === 0 ? {} : { options: [...options] };

  return { code, cwd: dir, filename: path.join(dir, file), ...optioned };
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
 * order. `options` is what follows `"error"` in `["error", {…}]`; options the rule's schema refuses throw, and so does
 * a file that does not parse, so no fixture passes by being skipped.
 */
export function reportsOf(rule: AnyRule, fixture: Fixture, options: RuleOptions = []): Report[] {
  return inFixture(fixture, (dir) =>
    Object.entries(fixture)
      .filter(([file]) => SOURCE.test(file))
      .flatMap(([file, code]) =>
        lintCase(rule, caseOf(dir, [file, code], options)).messages.map((message) => ({ file, message })),
      ),
  );
}

/** `code` as `a.ts` with every fix `rule` reports applied, as `oxlint --fix` would leave it. */
export function fixedOf(rule: AnyRule, code: string): string {
  const file = "a.ts";

  return inFixture({ [file]: code }, (dir) => lintCase(rule, caseOf(dir, [file, code], [])).fixed);
}
