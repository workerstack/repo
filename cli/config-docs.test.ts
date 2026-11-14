import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { SECTION_PACKS } from "./config-schema.ts";

const TYPES = path.join(import.meta.dirname, "repo-config.types.ts");

/** In the forward-slash form the compiler hands its host on every platform, Windows too. */
const PROBE = path.join(import.meta.dirname, "__config-docs-probe.ts").replaceAll(path.sep, "/");
const PROBE_TEXT = 'import type { RepoConfig } from "./repo-config.types.ts";\nexport type Probe = RepoConfig;\n';

const OPTIONS: ts.CompilerOptions = {
  allowImportingTsExtensions: true,
  exactOptionalPropertyTypes: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  strict: true,
  target: ts.ScriptTarget.ES2022,
  types: [],
};

/** The checker and the walk's cycle guard, shared by every step of one walk. */
type Walk = { readonly checker: ts.TypeChecker; readonly seen: Set<ts.Type> };

/** A program over the config types plus one in-memory file that names `RepoConfig` with every pack on. */
function probeChecker() {
  const host = ts.createCompilerHost(OPTIONS);
  const disk = ts.createCompilerHost(OPTIONS);

  host.fileExists = (file) => file === PROBE || disk.fileExists(file);
  host.readFile = (file) => (file === PROBE ? PROBE_TEXT : disk.readFile(file));
  host.getSourceFile = (file, version, ...rest) =>
    file === PROBE ? ts.createSourceFile(file, PROBE_TEXT, version) : disk.getSourceFile(file, version, ...rest);
  const program = ts.createProgram([PROBE, TYPES], OPTIONS, host);
  const checker = program.getTypeChecker();
  const alias = program.getSourceFile(PROBE)?.statements.find(ts.isTypeAliasDeclaration);

  if (alias === undefined) throw new Error("the probe file declares Probe");

  return { checker, probe: checker.getTypeAtLocation(alias.name) };
}

/** The object types to walk into: a nested section, an entry of a list or a value of a map; never a string union. */
function innerObjects(checker: ts.TypeChecker, type: ts.Type): ts.Type[] {
  const bare = checker.getNonNullableType(type);
  const members = bare.isUnion() ? bare.types : [bare];

  return members.flatMap((member) => {
    if (checker.isArrayType(member) || checker.isTupleType(member)) {
      return checker
        .getTypeArguments(member /* an array or tuple type is a type reference */ as ts.TypeReference)
        .flatMap((arg) => innerObjects(checker, arg));
    }

    if ((member.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) === 0) return [];
    const index = checker.getIndexInfosOfType(member).flatMap((info) => innerObjects(checker, info.type));

    return member.getProperties().length > 0 ? [member, ...index] : index;
  });
}

/** Each problem with the docs of `type`'s properties, `at` the path that reaches it. */
function docProblems(walk: Walk, type: ts.Type, at: string): string[] {
  if (walk.seen.has(type)) return [];
  walk.seen.add(type);

  return type.getProperties().flatMap((prop) => propProblems(walk, prop, at));
}

/** Each problem with the docs of one property and of the objects it holds. */
function propProblems(walk: Walk, prop: ts.Symbol, at: string): string[] {
  const { checker } = walk;
  const declared = prop.valueDeclaration ?? prop.declarations?.[0];

  if (declared === undefined) return [];
  const propType = checker.getTypeOfSymbolAtLocation(prop, declared);

  // A taken name (`?: never`) is a refusal, not an option.
  if ((checker.getNonNullableType(propType).flags & ts.TypeFlags.Never) !== 0) return [];
  const name = `${at}${prop.name}`;
  const inner = innerObjects(checker, propType);
  const isOptional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
  const problems: string[] = [];

  const text = ts.displayPartsToString(prop.getDocumentationComment(checker)).trim();

  if (text === "") problems.push(`${name}: no description`);

  if (isOptional && inner.length === 0 && !hasTag(checker, prop, "default")) problems.push(`${name}: no @default`);

  return [...problems, ...inner.flatMap((object) => docProblems(walk, object, `${name}.`))];
}

function hasTag(checker: ts.TypeChecker, prop: ts.Symbol, tag: string) {
  return prop.getJsDocTags(checker).some((each) => each.name === tag);
}

describe("repo.config.ts docs", () => {
  const { checker, probe } = probeChecker();

  it("documents every option at every depth, with a default for each optional value", () => {
    expect(docProblems({ checker, seen: new Set() }, probe, "")).toStrictEqual([]);
  });

  it("gives each top-level option an example", () => {
    const missing = probe
      .getProperties()
      .filter((prop) => !hasTag(checker, prop, "example"))
      .map((prop) => prop.name);

    expect(missing).toStrictEqual([]);
  });

  it("names the pack each gated section needs", () => {
    const wrong = Object.entries(SECTION_PACKS).filter(([key, pack]) => {
      const prop = probe.getProperty(key);
      const text = ts.displayPartsToString(prop?.getDocumentationComment(checker) ?? []);

      return !text.includes(`Needs the \`${pack}\` pack`);
    });

    expect(wrong).toStrictEqual([]);
  });
});
