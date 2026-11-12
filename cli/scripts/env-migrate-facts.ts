/**
 * What `bun repo env migrate` needs of an old file before it writes: how many createScriptEnv calls it holds, the
 * exported names whose values parity hashes, the modules its parents come from, and the keys whose value holds `$`.
 * A call parity cannot reach refuses here, before any write: one bound to no `const` (an `export default`, a factory's
 * return), or bound to a local one no exported call of the file names as its `parent`.
 */
import ts from "typescript";

import { DOLLAR, OLD_CALL, PARENT_KEY } from "./env-command.constants.ts";
import { propertiesOf, sourceOf } from "./env-files.ts";
import { refuse } from "./env-io.ts";
import {
  bindingOf,
  calleeOf,
  configBlocks,
  configsOf,
  elementsOf,
  importsFrom,
  isExported,
  lineOf,
  literalsOf,
  secretArgument,
  specifierOf,
  unwrapped,
  type Imports,
  type OldPackage,
} from "./env-migrate-source.ts";

/** What main needs of an old file: its calls, the exported names parity hashes, its parents' modules, the `$` keys. */
export type ScriptFacts = {
  readonly calls: number;
  readonly bindings: string[];
  readonly parents: string[];
  readonly dollars: string[];
};

/** Every createScriptEnv call of `source` through `imports`, in order. */
function oldCalls(source: ts.SourceFile, imports: Imports): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && calleeOf(node, imports) === OLD_CALL) calls.push(node);
    ts.forEachChild(node, visit);
  }

  visit(source);

  return calls;
}

/** The text a value holds when the source spells it: a literal, or a secret() of one. */
function heldTexts(value: ts.Node, imports: Imports): string[] {
  return literalsOf(secretArgument(value, imports) ?? [value]);
}

/** The names the configs of `calls` give as `parent`. */
function parentNamesOf(calls: readonly ts.CallExpression[]): Set<string> {
  return new Set(
    calls
      .flatMap(configsOf)
      .flatMap((config) => [propertiesOf(config).get(PARENT_KEY)?.initializer])
      .filter((node): node is ts.Expression => node !== undefined)
      .map((node) => unwrapped(node).getText()),
  );
}

/** The names `calls` are bound to as exports, refusing a call that is neither one nor a local parent of one. */
function exportedNames(rel: string, calls: readonly ts.CallExpression[]): string[] {
  const bound = calls.map((call) => ({ binding: bindingOf(call), call }));

  const exported = bound.flatMap(({ binding, call }) =>
    binding !== undefined && isExported(binding.statement) ? [{ binding, call }] : [],
  );

  const parents = parentNamesOf(exported.map(({ call }) => call));

  const stray = bound.find(
    ({ binding }) =>
      binding === undefined || (!isExported(binding.statement) && !parents.has(binding.declaration.name.getText())),
  );

  if (stray !== undefined) {
    const fix = "export it or migrate it by hand";
    refuse(`${rel}:${lineOf(stray.call)} createScriptEnv call is not an exported const; ${fix}`);
  }

  return exported.map(({ binding }) => binding.declaration.name.getText());
}

/** What main needs of the old file `rel`; see the file comment. */
export function scriptFacts(rel: string, text: string, packages: readonly OldPackage[]): ScriptFacts {
  const source = sourceOf(rel, text);
  const imports = importsFrom(source, packages);
  const calls = oldCalls(source, imports);
  const bindings = exportedNames(rel, calls);
  const parentNames = parentNamesOf(calls);

  const parents = source.statements
    .filter(ts.isImportDeclaration)
    .filter((decl) => elementsOf(decl).some((element) => parentNames.has(element.name.text)))
    .map(specifierOf);

  const dollars = calls
    .flatMap(configBlocks)
    .flatMap(({ members }) =>
      members.flatMap((member) =>
        member.spread || !heldTexts(member.value, imports).some((held) => held.includes(DOLLAR)) ? [] : [member.key],
      ),
    );

  return { bindings, calls: calls.length, dollars: [...new Set(dollars)], parents };
}
