/**
 * The known-failures list: every `it.fails` / `test.fails` case named `<file> > <describe titles> > <title>` in a JSON
 * array, so a case that starts passing is the only way a listed one leaves, and a new one cannot appear unlisted.
 */
import fs from "node:fs";
import path from "node:path";

import { parseSync } from "oxc-parser";

import { DEFAULT_LIST, DESCRIBE, FAILS, NODE, SEPARATOR, SOURCE, TEST_ROOTS } from "./known-failures.constants.ts";

/** A `.fails` case found in a file: where, how it was called, and its name, or null for a title that is no literal. */
type Case = { line: number; call: string; title: string | null; name: string | null };

type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function lineOf(source: string, at: number) {
  return source.slice(0, at).split("\n").length;
}

/** `value[key]`, or undefined when `value` is no node. */
function get(value: unknown, key: string): unknown {
  return isNode(value) ? value[key] : undefined;
}

/** The identifiers of a callee chain `a.b.c`, root first; null when the chain holds anything else. */
function chainOf(callee: unknown): string[] | null {
  const type = get(callee, "type");

  if (type === NODE.identifier) return [String(get(callee, "name"))];

  if (type !== NODE.member || get(callee, "computed") === true) return null;
  const head = chainOf(get(callee, "object"));

  return head === null ? null : [...head, String(get(get(callee, "property"), "name"))];
}

/** The text of a string literal or a template without expressions, else null. */
function titleOf(arg: unknown): string | null {
  if (get(arg, "type") === NODE.literal) {
    const value = get(arg, "value");

    return isString(value) ? value : null;
  }

  const bare = get(arg, "type") === NODE.template && get(get(arg, "expressions"), "length") === 0;

  return bare ? String(get(get(get(get(arg, "quasis"), "0"), "value"), "cooked")) : null;
}

type Scope = (string | null)[];

function caseOf(node: Node, scope: Scope, source: string): Case {
  const title = titleOf(get(get(node, "arguments"), "0"));
  const start = Number(get(node, "start"));
  const end = Number(get(get(node, "callee"), "end"));
  const named = title === null || scope.includes(null) ? null : [...scope, title].join(SEPARATOR);

  return { call: source.slice(start, end), line: lineOf(source, start), name: named, title };
}

/** The scope inside `node`: a `describe` call adds its title (null when it is no literal). */
function scopeOf(node: Node, chain: string[] | null, scope: Scope): Scope {
  if (chain?.[0] !== DESCRIBE) return scope;

  return [...scope, titleOf(get(get(node, "arguments"), "0"))];
}

function isFailsCall(chain: string[] | null): chain is string[] {
  return chain !== null && TEST_ROOTS.includes(String(chain[0])) && chain.includes(FAILS);
}

/** What a walk carries: the source it reads and the cases it found. */
type Walk = { source: string; out: Case[] };

/** The cases under `node`, `scope` being the describe titles around it (null for one that is no literal). */
function collect(node: unknown, scope: Scope, walk: Walk): void {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, scope, walk);

    return;
  }

  if (!isNode(node)) return;
  const chain = node["type"] === NODE.call ? chainOf(node["callee"]) : null;

  if (isFailsCall(chain)) walk.out.push(caseOf(node, scope, walk.source));
  const inner = scopeOf(node, chain, scope);

  for (const child of Object.values(node)) collect(child, inner, walk);
}

function casesOf(rel: string, source: string): Case[] {
  if (!source.includes(`.${FAILS}`)) return [];
  const found: Case[] = [];
  collect(parseSync(rel, source).program, [], { out: found, source });

  return found;
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** The list's entries, or null when the file is absent; a file that is no array of strings is an empty list. */
function readList(file: string): string[] | null {
  const text = readText(file);

  if (text === null) return null;

  try {
    const parsed: unknown = JSON.parse(text);

    return Array.isArray(parsed) ? parsed.filter(isString) : [];
  } catch {
    return [];
  }
}

/**
 * The problems between the `.fails` cases of the test `files` (relative to `root`) and the list at `list` (default
 * `known-failures.json`): a case not listed, a non-literal title, a listed entry with no case. No list file counts as
 * an empty list.
 */
export function knownFailures(root: string, files: readonly string[], list: string = DEFAULT_LIST): string[] {
  const listed = readList(path.join(root, list)) ?? [];
  const seen = new Set<string>();
  const problems: string[] = [];

  for (const rel of files.filter((f) => SOURCE.test(f))) {
    const source = readText(path.join(root, rel));

    if (source === null) continue;

    for (const found of casesOf(rel, source)) {
      const at = `${rel}:${found.line}`;

      if (found.name === null) {
        problems.push(
          `${at}: ${found.call}() title is not a string literal; write the title as a literal so ${list} can name it`,
        );
        continue;
      }

      const name = `${rel}${SEPARATOR}${found.name}`;
      seen.add(name);

      if (!listed.includes(name))
        problems.push(`${at}: ${found.call}("${found.title}") is not in ${list}; list it or fix it`);
    }
  }

  for (const entry of listed)
    if (!seen.has(entry)) problems.push(`${list} lists "${entry}", which has no it.fails; remove it from the list`);

  return problems;
}
