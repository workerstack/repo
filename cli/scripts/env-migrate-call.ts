/**
 * How `bun repo env migrate` rewrites one createScriptEnv call. Most become `defineEnv(` (type arguments and the old
 * annotation of the binding dropped, every other byte kept). Where the nearest tsconfig sets isolatedDeclarations, a
 * call that one statement binds with an inline config splits in two so its export has a type a declaration emit can
 * write: `const <binding>Config = {…} as const;` (a suffix when the name is taken), then the binding, `let` or `const`
 * as it was, typed `EnvInstance<typeof <binding>Config>`; its `parent` is cast to its own type, and a spread in a
 * block refuses, as isolatedDeclarations cannot type it.
 */
import type ts from "typescript";

import { DEFINE_ENV } from "../check-env-values.constants.ts";
import { CONFIG_SUFFIX, FIRST_SUFFIX, PARENT_KEY } from "./env-command.constants.ts";
import { propertiesOf } from "./env-files.ts";
import { refuse } from "./env-io.ts";
import { bindingOf, configBlocks, configsOf, type Binding, type Edit } from "./env-migrate-source.ts";

/** What a call's rewrite takes: the file as a refusal names it, whether it is isolated, and the names it holds. */
export type CallContext = { readonly file: string; readonly isolated: boolean; readonly taken: Set<string> };

/** An isolated rewrite's site: the call, where it is bound and its inline config. */
type Site = {
  readonly call: ts.CallExpression;
  readonly binding: Binding;
  readonly config: ts.ObjectLiteralExpression;
};

/** Where `call` takes the isolated shape; undefined when the file is not isolated or the call has no such site. */
function siteOf(call: ts.CallExpression, { isolated }: Pick<CallContext, "isolated">): Site | undefined {
  const binding = bindingOf(call);
  const [config] = configsOf(call);

  return isolated && binding !== undefined && config !== undefined ? { binding, call, config } : undefined;
}

/** Whether `call` takes the isolated shape, and so its file imports `type EnvInstance`. */
export function isTyped(call: ts.CallExpression, at: Pick<CallContext, "isolated">): boolean {
  return siteOf(call, at) !== undefined;
}

/** `base`, or with the first number from 2 that makes it a name `taken` lacks; the name taken. */
function freeName(base: string, taken: Set<string>): string {
  const tries = [base, ...Array.from({ length: taken.size }, (_, index) => `${base}${index + FIRST_SUFFIX}`)];
  const name = String(tries.find((each) => !taken.has(each)));
  taken.add(name);

  return name;
}

/** The edits of an isolated site; see the file comment. */
function isolatedEdits(text: string, site: Site, at: CallContext): Edit[] {
  const spread = configBlocks(site.call).find(({ members }) => members.some((member) => member.spread));

  if (spread !== undefined) {
    const why = "isolatedDeclarations needs each value written out";
    refuse(`${at.file} ${spread.block} has a spread; ${why}`);
  }

  const { binding, config } = site;
  const { declaration, statement } = binding;
  const name = declaration.name.getText();
  const configName = freeName(`${name}${CONFIG_SUFFIX}`, at.taken);
  const modifiers = text.slice(statement.getStart(), declaration.parent.getStart());
  const keyword = text.slice(declaration.parent.getStart(), declaration.getStart());
  const typed = `${modifiers}${keyword}${name}: EnvInstance<typeof ${configName}>`;

  const parents = [propertiesOf(config).get(PARENT_KEY)?.initializer]
    .filter((node): node is ts.Expression => node !== undefined)
    .map((node): Edit => ({
      end: node.end,
      insert: `${node.getText()} as typeof ${node.getText()}`,
      start: node.getStart(),
    }));

  return [
    { end: config.getStart(), insert: `const ${configName} = `, start: statement.getStart() },
    ...parents,
    { end: statement.end, insert: ` as const;\n${typed} = ${DEFINE_ENV}(${configName});`, start: config.end },
  ];
}

/** The edits that turn `call` into defineEnv; see the file comment. */
export function callEdits(text: string, call: ts.CallExpression, at: CallContext): Edit[] {
  const site = siteOf(call, at);

  if (site !== undefined) return isolatedEdits(text, site, at);
  // The arguments start after the `(`: the callee and any type arguments go.
  const renamed: Edit = { end: call.arguments.pos - 1, insert: DEFINE_ENV, start: call.expression.getStart() };

  const annotation = [bindingOf(call)?.declaration].flatMap((declaration): Edit[] =>
    declaration?.type === undefined ? [] : [{ end: declaration.type.end, insert: "", start: declaration.name.end }],
  );

  return [renamed, ...annotation];
}
