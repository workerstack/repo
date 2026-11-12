/**
 * How `bun repo env migrate` rewrites a file's imports of the old package. Each import loses the old names
 * (createScriptEnv, secret, secretKeysOf, unwrapSecrets) and the namespace the file no longer uses, keeping its default
 * import and every other name; one left with nothing goes with its line. The import createScriptEnv came from gives
 * way to `import { defineEnv[, sealed][, type EnvInstance][, type Sealed] } from "@workerstack/repo/env";`.
 */
import type ts from "typescript";

import { DEFINE_ENV } from "../check-env-values.constants.ts";
import {
  ENV_MODULE,
  KEYS_OF,
  OLD_CALL,
  SEALED_NAME,
  SEALED_TYPE,
  SECRET_CALL,
  UNWRAP,
} from "./env-command.constants.ts";
import { dropped, elementsOf, importedOf, namespaceOf, type Edit, type Imports } from "./env-migrate-source.ts";

/** What the new import names: whether it seals, types an isolated export, and types an isolated seal. */
type Named = { readonly sealed: boolean; readonly typed: boolean; readonly isolated: boolean };

/** How the imports change: whether createScriptEnv was called, what the new import names, the old names still used. */
export type ImportChange = { readonly called: boolean; readonly named: Named; readonly used: ReadonlySet<string> };

const OLD_NAMES: ReadonlySet<string> = /* @__PURE__ */ new Set([OLD_CALL, SECRET_CALL, KEYS_OF, UNWRAP]);
const ENV_TYPE = "type EnvInstance";

/** The new import's line. */
function addedImport({ isolated, sealed, typed }: Named): string {
  const parts: [boolean, string][] = [
    [true, DEFINE_ENV],
    [sealed, SEALED_NAME],
    [typed, ENV_TYPE],
    [isolated && sealed, `type ${SEALED_TYPE}`],
  ];

  const names = parts.filter(([isNamed]) => isNamed).map(([, name]) => name);

  return `import { ${names.join(", ")} } from "${ENV_MODULE}";`;
}

/** Whether `decl` brings createScriptEnv, by name or as a namespace. */
function bringsOldCall(decl: ts.ImportDeclaration): boolean {
  return elementsOf(decl).some((element) => importedOf(element) === OLD_CALL) || namespaceOf(decl).length > 0;
}

/** The import the new one takes the place of: the first that brings createScriptEnv, when it is called. */
function anchorOf(imports: Imports, { called }: ImportChange): ts.ImportDeclaration | undefined {
  return called ? imports.decls.find(bringsOldCall) : undefined;
}

/** `decl` as it is left: its default, its namespace when still used, and its names but the unused old ones. */
function keptClause(decl: ts.ImportDeclaration, used: ReadonlySet<string>): { clause: string; whole: boolean } {
  const elements = elementsOf(decl);
  const kept = elements.filter((element) => !OLD_NAMES.has(importedOf(element)) || used.has(element.name.text));
  const spaces = namespaceOf(decl);
  const keptSpaces = spaces.filter((name) => used.has(name));

  const named = [kept]
    .filter((list) => list.length > 0)
    .map((list) => `{ ${list.map((e) => e.getText()).join(", ")} }`);

  const parts = [decl.importClause?.name?.text ?? "", ...keptSpaces.map((name) => `* as ${name}`), ...named];
  const whole = kept.length === elements.length && keptSpaces.length === spaces.length;

  return { clause: parts.filter((part) => part !== "").join(", "), whole };
}

/** The edits of the old imports; see the file comment. */
export function importEdits(text: string, imports: Imports, change: ImportChange): Edit[] {
  const anchor = anchorOf(imports, change);

  return imports.decls.flatMap((decl): Edit[] => {
    const { clause, whole } = keptClause(decl, change.used);
    const isAnchor = decl === anchor;

    if (!isAnchor && whole) return [];

    const rebuilt = [clause]
      .filter((kept) => kept !== "")
      .map((kept) => `import ${kept} from ${decl.moduleSpecifier.getText()};`);

    const at = { end: decl.end, start: decl.getStart() };

    if (isAnchor) return [{ ...at, insert: [...rebuilt, addedImport(change.named)].join("\n") }];

    return [rebuilt.length > 0 ? { ...at, insert: rebuilt.join("") } : dropped(text, decl)];
  });
}
