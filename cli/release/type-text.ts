import type { ParameterDeclaration } from "typescript/unstable/ast";
import { SymbolFlags, TypeFlags } from "typescript/unstable/async";
import type { Signature, Symbol as TsSymbol, Type } from "typescript/unstable/async";

import { nameOf } from "../ts-nodes.ts";
import { defined, nodeOf, signaturesOf, typeOf } from "./api-diff-nominal.ts";
import type { Ctx } from "./api-diff-nominal.ts";
import { FULL_TYPE_FLAGS, OPTIONAL_MARK, REST_MARK, ID_NAME, TEXT_SEPARATOR } from "./api-diff.constants.ts";

function print(ctx: Ctx, type: Type): Promise<string> {
  return ctx.project.checker.typeToString(type, undefined, FULL_TYPE_FLAGS);
}

/** A member's name as written: `[key]` or `#name` for one whose TypeScript name differs between copies. */
async function memberName(ctx: Ctx, prop: TsSymbol): Promise<string> {
  const handle = prop.valueDeclaration;

  if (!ID_NAME.test(prop.name) || handle === undefined) return prop.name;

  return String(nameOf(await nodeOf(ctx, handle))?.getText());
}

/** A member in text: its name, `?` when optional, and its type. */
async function memberText(ctx: Ctx, prop: TsSymbol): Promise<string> {
  const optional = (prop.flags & SymbolFlags.Optional) === 0 ? "" : OPTIONAL_MARK;

  return `${await memberName(ctx, prop)}${optional}:${await print(ctx, await typeOf(ctx, prop))}`;
}

/** A parameter in text: `...` when it is the rest, its name, `?` when it may be left out, and its type. */
async function parameterText(ctx: Ctx, parameter: TsSymbol, { rest }: { rest: boolean }): Promise<string> {
  const marks: string[] = [];

  for (const handle of parameter.declarations) {
    const node = (await nodeOf(ctx, handle)) /* a parameter symbol is declared by parameters */ as ParameterDeclaration;
    marks.push(
      ...[node.questionToken, node.initializer]
        .filter(defined)
        .map(() => OPTIONAL_MARK)
        .slice(0, 1),
    );
  }

  const head = [...[REST_MARK].filter(() => rest), parameter.name, ...marks].join("");

  return `${head}:${await print(ctx, await typeOf(ctx, parameter))}`;
}

/** A signature in text: its type parameters with their constraints, its parameters, and its return type. */
async function signatureText(ctx: Ctx, signature: Signature): Promise<string> {
  const { checker } = ctx.project;
  const parts: string[] = [];

  for (const parameter of await signature.getTypeParameters()) {
    const texts = [await print(ctx, parameter)];

    for (const constraint of [await checker.getConstraintOfTypeParameter(parameter)].filter(defined))
      texts.push(await print(ctx, constraint));
    parts.push(texts.join(":"));
  }

  const parameters = await signature.getParameters();

  for (const [index, parameter] of parameters.entries()) {
    const rest = signature.hasRestParameter && index === parameters.length - 1;
    parts.push(await parameterText(ctx, parameter, { rest }));
  }

  for (const type of [await checker.getReturnTypeOfSignature(signature)].filter(defined))
    parts.push(await print(ctx, type));

  return parts.join(",");
}

/** The type in text: its name, its members and signatures, and the member names of an enum, class or namespace. */
export async function typeText(ctx: Ctx, type: Type): Promise<string> {
  const { checker } = ctx.project;
  const props = (type.flags & TypeFlags.Object) === 0 ? [] : await checker.getPropertiesOfType(type);
  const members: string[] = [];

  for (const prop of props) members.push(await memberText(ctx, prop));
  const signatures: string[] = [];

  for (const signature of await signaturesOf(ctx, type)) signatures.push(await signatureText(ctx, signature));
  const exported: string[] = [];

  for (const symbol of [await type.getSymbol()].filter(defined)) {
    const exports = await symbol.getExports();
    exported.push(...[...exports.keys()].map(String));
  }

  return [await print(ctx, type), ...members.toSorted(), ...signatures, ...exported].join(TEXT_SEPARATOR);
}
