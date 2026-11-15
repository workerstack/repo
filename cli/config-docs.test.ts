import path from "node:path";

import { isTypeAliasDeclaration } from "typescript/unstable/ast/is";
import { SymbolFlags, TypeFlags } from "typescript/unstable/async";
import type { Checker, Symbol as TsSymbol, Type } from "typescript/unstable/async";
import { beforeAll, describe, expect, it } from "vitest";

import { SECTION_PACKS } from "./config-schema.ts";
import { withFiles, withTsApi } from "./ts-api.ts";
import { posix } from "./ts-program.ts";

/** In the forward-slash form the API keys its files by on every platform, Windows too. */
const DIR = posix(import.meta.dirname);
const PROBE = "__config-docs-probe.ts";
const PROBE_TEXT = 'import type { RepoConfig } from "./repo-config.types.ts";\nexport type Probe = RepoConfig;\n';
const BASE = "tsconfig.config-docs.json";

const OPTIONS = {
  allowImportingTsExtensions: true,
  exactOptionalPropertyTypes: true,
  module: "esnext",
  moduleResolution: "bundler",
  noEmit: true,
  strict: true,
  target: "es2022",
  types: [],
};

/** The checker and the walk's cycle guard, by type id, shared by every step of one walk. */
type Walk = { readonly checker: Checker; readonly seen: Set<number> };

/** What the three tests assert, read on one API: the doc problems, the options with no example, wrong pack notes. */
type Read = { problems: string[]; unexampled: string[]; unpacked: string[] };

/** The object types one union member holds: itself when it has properties, and what its entries or values hold. */
async function memberObjects(checker: Checker, member: Type): Promise<Type[]> {
  const isList = (await checker.isArrayType(member)) || (await checker.isTupleType(member));
  const found: Type[] = [];

  if (isList && member.isTypeReference()) {
    for (const arg of await checker.getTypeArguments(member)) found.push(...(await innerObjects(checker, arg)));

    return found;
  }

  if ((member.flags & (TypeFlags.Object | TypeFlags.Intersection)) === 0) return [];

  for (const info of await checker.getIndexInfosOfType(member))
    found.push(...(await innerObjects(checker, info.valueType)));
  const props = await checker.getPropertiesOfType(member);

  return props.length > 0 ? [member, ...found] : found;
}

/** The object types to walk into: a nested section, an entry of a list or a value of a map; never a string union. */
async function innerObjects(checker: Checker, type: Type): Promise<Type[]> {
  const bare = (await checker.getNonNullableType(type)) ?? type;
  const members = bare.isUnionType() ? await bare.getTypes() : [bare];
  const found: Type[] = [];

  for (const member of members) found.push(...(await memberObjects(checker, member)));

  return found;
}

/** Each problem with the docs of `type`'s properties, `at` the path that reaches it. */
async function docProblems(walk: Walk, type: Type, at: string): Promise<string[]> {
  if (walk.seen.has(type.id)) return [];
  walk.seen.add(type.id);
  const problems: string[] = [];

  for (const prop of await walk.checker.getPropertiesOfType(type))
    problems.push(...(await propProblems(walk, prop, at)));

  return problems;
}

/** Each problem with the docs of one property and of the objects it holds. */
async function propProblems(walk: Walk, prop: TsSymbol, at: string): Promise<string[]> {
  const { checker } = walk;
  const propType = await checker.getTypeOfSymbol(prop);
  const bare = propType === undefined ? undefined : await checker.getNonNullableType(propType);

  // A taken name (`?: never`) is a refusal, not an option.
  if (propType === undefined || bare === undefined || (bare.flags & TypeFlags.Never) !== 0) return [];
  const name = `${at}${prop.name}`;
  const inner = await innerObjects(checker, propType);
  const isOptional = (prop.flags & SymbolFlags.Optional) !== 0;
  const problems: string[] = [];
  const text = await checker.getDocumentationCommentOfSymbol(prop);
  const hasDefault = await hasTag(checker, prop, "default");

  if (text.trim() === "") problems.push(`${name}: no description`);

  if (isOptional && inner.length === 0 && !hasDefault) problems.push(`${name}: no @default`);
  const nested: string[] = [];

  for (const object of inner) nested.push(...(await docProblems(walk, object, `${name}.`)));

  return [...problems, ...nested];
}

async function hasTag(checker: Checker, prop: TsSymbol, tag: string): Promise<boolean> {
  const tags = await checker.getJsDocTagsOfSymbol(prop);

  return tags.some((each) => each.name === tag);
}

/** The three reads over a project of the config types plus one in-memory file that names `RepoConfig`. */
function readDocs(): Promise<Read> {
  return withTsApi(DIR, (run) => {
    run.virtual.set(path.posix.join(DIR, PROBE), PROBE_TEXT);
    run.virtual.set(path.posix.join(DIR, BASE), JSON.stringify({ compilerOptions: OPTIONS }));

    return withFiles(run, { base: BASE, dir: DIR, files: [PROBE] }, async ({ checker, program }) => {
      const file = await program.getSourceFile(path.posix.join(DIR, PROBE));
      const alias = file?.statements.find(isTypeAliasDeclaration);
      const probe = alias === undefined ? undefined : await checker.getTypeAtLocation(alias.name);

      if (probe === undefined) throw new Error("the probe file declares Probe");
      const problems = await docProblems({ checker, seen: new Set() }, probe, "");
      const unexampled: string[] = [];

      for (const prop of await checker.getPropertiesOfType(probe))
        if (!(await hasTag(checker, prop, "example"))) unexampled.push(prop.name);
      const unpacked: string[] = [];

      for (const [key, pack] of Object.entries(SECTION_PACKS)) {
        const prop = await checker.getPropertyOfType(probe, key);
        const text = prop === undefined ? "" : await checker.getDocumentationCommentOfSymbol(prop);

        if (!text.includes(`Needs the \`${pack}\` pack`)) unpacked.push(key);
      }

      return { problems, unexampled, unpacked };
    });
  });
}

describe("repo.config.ts docs", () => {
  let read: Read;

  beforeAll(async () => {
    read = await readDocs();
  });

  it("documents every option at every depth, with a default for each optional value", () => {
    expect(read.problems).toStrictEqual([]);
  });

  it("gives each top-level option an example", () => {
    expect(read.unexampled).toStrictEqual([]);
  });

  it("names the pack each gated section needs", () => {
    expect(read.unpacked).toStrictEqual([]);
  });
});
