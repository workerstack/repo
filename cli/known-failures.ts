/**
 * The known-failures list: every `it.fails` / `test.fails` case named `<file> > <describe titles> > <title>` in a JSON
 * array, so a case that starts passing is the only way a listed one leaves, and a new one cannot appear unlisted.
 */
import fs from "node:fs";
import path from "node:path";

import { parseSync } from "oxc-parser";
import { z } from "zod";

import { tryJson } from "./json.ts";
import { DEFAULT_LIST, DESCRIBE, FAILS, NODE, SEPARATOR, SOURCE, TEST_ROOTS } from "./known-failures.constants.ts";
import { asNode, isSyntaxList, type SyntaxNode, type SyntaxValue, textOf } from "./syntax-node.ts";

/** A `.fails` case found in a file: where, how it was called, and its name, or null for a title that is no literal. */
type Case = { line: number; call: string; title: string | null; name: string | null };

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function lineOf(source: string, at: number) {
  return source.slice(0, at).split("\n").length;
}

/** `value[key]`, or undefined when `value` is no node. */
function get(value: SyntaxValue, key: string): SyntaxValue {
  return asNode(value)?.[key];
}

/** The items of `value`, which is a list, one value standing for a list of one, or nothing. */
function itemsOf(value: SyntaxValue): SyntaxValue[] {
  return [value].flat();
}

/** The first item of `value`, read as `itemsOf` reads it. */
function firstOf(value: SyntaxValue): SyntaxValue {
  return itemsOf(value)[0];
}

/** The identifiers of a callee chain `a.b.c`, root first; null when the chain holds anything else. */
function chainOf(callee: SyntaxValue): string[] | null {
  const type = get(callee, "type");

  if (type === NODE.identifier) return [textOf(get(callee, "name"))];

  if (type !== NODE.member || get(callee, "computed") === true) return null;
  const head = chainOf(get(callee, "object"));

  return head === null ? null : [...head, textOf(get(get(callee, "property"), "name"))];
}

/** The text of a string literal or a template without expressions, else null. */
function titleOf(arg: SyntaxValue): string | null {
  if (get(arg, "type") === NODE.literal) {
    const value = get(arg, "value");

    return isString(value) ? value : null;
  }

  const bare = get(arg, "type") === NODE.template && itemsOf(get(arg, "expressions")).length === 0;

  return bare ? textOf(get(get(firstOf(get(arg, "quasis")), "value"), "cooked")) : null;
}

type Scope = (string | null)[];

function caseOf(node: SyntaxNode, scope: Scope, source: string): Case {
  const title = titleOf(firstOf(get(node, "arguments")));
  const start = Number(get(node, "start"));
  const end = Number(get(get(node, "callee"), "end"));
  const named = title === null || scope.includes(null) ? null : [...scope, title].join(SEPARATOR);

  return { call: source.slice(start, end), line: lineOf(source, start), name: named, title };
}

/** The scope inside `node`: a `describe` call adds its title (null when it is no literal). */
function scopeOf(node: SyntaxNode, chain: string[] | null, scope: Scope): Scope {
  if (chain?.[0] !== DESCRIBE) return scope;

  return [...scope, titleOf(firstOf(get(node, "arguments")))];
}

function isFailsCall(chain: string[] | null): chain is string[] {
  return chain !== null && TEST_ROOTS.includes(String(chain[0])) && chain.includes(FAILS);
}

/** What a walk carries: the source it reads and the cases it found. */
type Walk = { source: string; out: Case[] };

/** The cases under `node`, `scope` being the describe titles around it (null for one that is no literal). */
function collect(node: SyntaxValue, scope: Scope, walk: Walk): void {
  if (isSyntaxList(node)) {
    for (const child of node) collect(child, scope, walk);

    return;
  }

  const found = asNode(node);

  if (found === null) return;
  const chain = found["type"] === NODE.call ? chainOf(found["callee"]) : null;

  if (isFailsCall(chain)) walk.out.push(caseOf(found, scope, walk.source));
  const inner = scopeOf(found, chain, scope);

  for (const child of Object.values(found)) collect(child, inner, walk);
}

function casesOf(rel: string, source: string): Case[] {
  if (!source.includes(`.${FAILS}`)) return [];
  const found: Case[] = [];
  collect(asNode(parseSync(rel, source).program), [], { out: found, source });

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

  return tryJson(z.array(z.unknown()), text)?.filter(isString) ?? [];
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
