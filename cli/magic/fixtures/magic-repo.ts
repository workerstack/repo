/** Temp repos for the magic literal tests, the messages they expect, and a schema type to bound. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scriptDiagnostics } from "../../script-diagnostics.ts";
import type { Diagnostic } from "../../scripts/lint-baseline.ts";

export const SLOW = 60_000;
export const NUMBER = "repo(magic-number)";
export const STRING = "repo(magic-string)";
export const REGEX = "repo(magic-regex)";
export const NAMES_NOTHING = (text: string) => `${text} names nothing; give it a named const`;
export const BOUND = (call: string) =>
  `${call} is a schema bound; import it from a *.constants.ts file or a constants package`;
export const COMPARED = (text: string) =>
  `"${text}" is compared to a plain string; type the value as a literal union or brand, or import the string from a *.constants.ts file`;
export const COPIES = (name: string, text: string) =>
  `${name} copies "${text}" locally to compare to a plain string; move it to a *.constants.ts file`;

const temps: string[] = [];

export function cleanTemps(): void {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

/** A temp root holding `files`, removed by `cleanTemps`. */
export function plant(files: Record<string, string>): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-magic-")));
  temps.push(root);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

/** The diagnostic of a hit at `at`, `<file>:<line>:<column>`. */
export const hit = (at: string, rule: string, message: string): Diagnostic => ({
  file: at.slice(0, at.indexOf(":")),
  rule,
  line: `${at}: error ${rule}: ${message}`,
});

/** Every hit of the planted `files`, all of them checked. */
export function magicOf(files: Record<string, string>): Diagnostic[] {
  const found = scriptDiagnostics(plant(files), Object.keys(files));
  if (!found.ok) throw new Error(found.errors.join("\n"));
  return found.value;
}

/** A schema type: the receiver of a bound has a `parse` method. */
export const SCHEMA = [
  "export class Schema {",
  "  parse(value: unknown): unknown {",
  "    return value;",
  "  }",
  "  max(_bound: number): Schema {",
  "    return this;",
  "  }",
  "  min(_bound: number): Schema {",
  "    return this;",
  "  }",
  "}",
  "",
].join("\n");

/** The message of a regex written as `text` inside a function. */
export function inlineRegex(text: string): string {
  return (
    `${text} is a regex inside a function; hoist it to a named module const or a *.constants.ts export ` +
    "(a /g or /y regex keeps lastIndex: use that const only with replace, replaceAll, matchAll or split)"
  );
}
