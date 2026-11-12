import path from "node:path";

import type { ESTree } from "@oxlint/plugins";

import { ENV_FILE, ENV_PROPERTY, IMPORT_KEYWORD } from "../env.constants.ts";
import type { RepoRule } from "./rule.types.ts";

/** Modules whose `env` export is the process environment. */
const ENV_MODULES = ["process", "node:process", "cloudflare:workers"];
/** Globals that carry the environment as `.env`. */
const GLOBALS = ["process", "Bun"];
const TAIL_HEAD = "is read outside env.ts; add the variable to this package's env.ts schema";
const TAIL = `${TAIL_HEAD} and read it through that module`;
function messageOf(what: string) {
  return `${what} ${TAIL}`;
}

/** The property name of `.name` or `["name"]`, when it is a plain name. */
function propertyName(node: ESTree.MemberExpression): string | undefined {
  if (!node.computed) return node.property.type === "Identifier" ? node.property.name : undefined;
  return node.property.type === "Literal" && typeof node.property.value === "string" ? node.property.value : undefined;
}

/** `process.env` or `Bun.env`, or `import.meta.env`: what the member read is of, or undefined. */
function envOwner(node: ESTree.MemberExpression): string | undefined {
  if (propertyName(node) !== ENV_PROPERTY) return undefined;
  const { object } = node;
  if (object.type === "Identifier" && GLOBALS.includes(object.name)) return `${object.name}.env`;
  return object.type === "MetaProperty" && object.meta.name === IMPORT_KEYWORD ? "import.meta.env" : undefined;
}

/** `const { env } = process`: a destructuring that pulls `env` off a global. */
function destructured(node: ESTree.VariableDeclarator): string | undefined {
  const { id, init } = node;
  if (id.type !== "ObjectPattern" || init?.type !== "Identifier" || !GLOBALS.includes(init.name)) return undefined;
  const pulls = id.properties.some(
    (property) =>
      property.type === "Property" &&
      (property.key.type === "Identifier"
        ? property.key.name
        : property.key.type === "Literal" && property.key.value) === ENV_PROPERTY,
  );
  return pulls ? `${init.name}.env` : undefined;
}

/** The name an import specifier takes from its module, quoted or not. */
function importedName(imported: ESTree.ModuleExportName): string {
  return imported.type === "Identifier" ? imported.name : imported.value;
}

/** Fails a read of the process environment in any file not named `env.ts`; tests are not exempt. */
export const envInConfig: RepoRule = {
  create(context) {
    if (path.basename(context.filename) === ENV_FILE) return {};
    return {
      ImportDeclaration(node) {
        if (!ENV_MODULES.includes(node.source.value)) return;
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportSpecifier" && importedName(specifier.imported) === ENV_PROPERTY)
            context.report({ message: messageOf(ENV_PROPERTY), node: specifier });
        }
      },
      MemberExpression(node) {
        const what = envOwner(node);
        if (what !== undefined) context.report({ message: messageOf(what), node });
      },
      VariableDeclarator(node) {
        const what = destructured(node);
        if (what !== undefined) context.report({ message: messageOf(what), node });
      },
    };
  },
};
