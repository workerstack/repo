import type { Node } from "typescript/unstable/ast";
import { isComputedPropertyName, isConstructorDeclaration, isPrivateIdentifier } from "typescript/unstable/ast/is";
import { isIntersectionType, isTypeReference, isUnionType, SignatureKind, TypeFlags } from "typescript/unstable/async";
import type { Project, Signature, Symbol as TsSymbol, Type } from "typescript/unstable/async";

import { isClassLike, modifierFlagsOf, nameOf } from "../ts-nodes.ts";
import { NOMINAL_MODIFIERS, NOMINAL_TYPES, noNode, noType, PACKAGE_OF_FILE } from "./api-diff.constants.ts";

/** What a comparison reads types through: the project of the entry, and the names the two compared packages have. */
export type Ctx = { project: Project; packages: readonly string[] };

export function defined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/** What typeOf reads: a checker that gives a symbol's type. */
type TypeReader<S> = { project: { checker: { getTypeOfSymbol(symbol: S): Promise<Type | undefined> } } };

/** The type of a symbol's value; an Error when the checker has none, which no exported name lacks. */
export async function typeOf<S extends { name: string }>(ctx: TypeReader<S>, symbol: S): Promise<Type> {
  const type = await ctx.project.checker.getTypeOfSymbol(symbol);

  if (type === undefined) throw new Error(noType(symbol.name));

  return type;
}

/** A type's call signatures, then its construct signatures. */
export async function signaturesOf(ctx: Ctx, type: Type): Promise<Signature[]> {
  const { checker } = ctx.project;

  return [
    ...(await checker.getSignaturesOfType(type, SignatureKind.Call)),
    ...(await checker.getSignaturesOfType(type, SignatureKind.Construct)),
  ];
}

/** What nodeOf reads of a declaration handle: its file, and the node it resolves to in a project. */
type Handle<P> = { path: string; resolve(project: P): Promise<Node | undefined> };

/** The node a declaration handle stands for in the entry's project; an Error when its file is not in the project. */
export async function nodeOf<P>(ctx: { project: P }, handle: Handle<P>): Promise<Node> {
  const node = await handle.resolve(ctx.project);

  if (node === undefined) throw new Error(noNode(handle.path));

  return node;
}

/** Whether a class member, constructor or constructor parameter is `private`, `protected` or `#`. */
function nominalMember(member: Node): boolean {
  const named = nameOf(member);

  return (named !== undefined && isPrivateIdentifier(named)) || (modifierFlagsOf(member) & NOMINAL_MODIFIERS) !== 0;
}

/** Whether a declaration is a class with a `private`, `protected` or `#` member. */
function nominalDeclaration(declaration: Node): boolean {
  if (!isClassLike(declaration)) return false;

  const nodes = declaration.members.flatMap<Node>((member) =>
    isConstructorDeclaration(member) ? [member, ...member.parameters] : [member],
  );

  return nodes.some(nominalMember);
}

/** Whether a declaration sits in a package other than the two compared. */
function foreignDeclaration(ctx: Ctx, declaration: Node): boolean {
  const owner = PACKAGE_OF_FILE.exec(declaration.getSourceFile().fileName)?.[1];

  return !ctx.packages.some((name) => name === owner);
}

/** Whether a declaration is the TypeScript library's, which both compared packages share as one copy. */
function libraryDeclaration(ctx: Ctx, declaration: Node): Promise<boolean> {
  return ctx.project.program.isSourceFileDefaultLibrary(declaration.getSourceFile());
}

/** The declarations of a type's symbol that are not the library's; none for a type with no symbol. */
async function ownDeclarations(ctx: Ctx, type: Type): Promise<{ own: Node[]; all: number }> {
  const handles = [await type.getSymbol()].filter(defined).flatMap((symbol) => symbol.declarations);
  const own: Node[] = [];

  for (const handle of handles) {
    const node = await nodeOf(ctx, handle);

    if (!(await libraryDeclaration(ctx, node))) own.push(node);
  }

  return { all: handles.length, own };
}

/**
 * Whether a property is keyed by a unique symbol, which each copy of its module declares anew; the library's own keys,
 * such as `Symbol.iterator`, are one copy for both.
 */
async function symbolKeyed(ctx: Ctx, prop: TsSymbol): Promise<boolean> {
  const handle = prop.valueDeclaration;

  if (handle === undefined) return false;
  const declaration = await nodeOf(ctx, handle);

  if (await libraryDeclaration(ctx, declaration)) return false;
  const name = nameOf(declaration);

  if (name === undefined || !isComputedPropertyName(name)) return false;
  const type = await ctx.project.checker.getTypeAtLocation(name.expression);

  return [type].filter(defined).some((key) => (key.flags & TypeFlags.UniqueESSymbol) !== 0);
}

/** Whether one type cannot be told from its twin by structure: nominal, keyed by a unique symbol, or a dependency's. */
async function nominalHead(ctx: Ctx, type: Type): Promise<boolean> {
  if ((type.flags & NOMINAL_TYPES) !== 0) return true;
  const { own } = await ownDeclarations(ctx, type);

  if (own.some((declaration) => nominalDeclaration(declaration) || foreignDeclaration(ctx, declaration))) return true;

  for (const prop of await ctx.project.checker.getPropertiesOfType(type)) if (await symbolKeyed(ctx, prop)) return true;

  return false;
}

/** The type arguments of a generic reference, such as the `T` of `T[]`; none for any other type. */
function typeArguments(ctx: Ctx, type: Type): Promise<readonly Type[]> {
  return isTypeReference(type) ? ctx.project.checker.getTypeArguments(type) : Promise.resolve([]);
}

/** What a type is made of: union and intersection members, type arguments, and, outside the library, its members. */
async function parts(ctx: Ctx, type: Type): Promise<Type[]> {
  const { checker } = ctx.project;
  const members = isUnionType(type) || isIntersectionType(type) ? await type.getTypes() : [];
  const args = await typeArguments(ctx, type);
  const { own, all } = await ownDeclarations(ctx, type);

  if (all > 0 && own.length === 0) return [...members, ...args];
  const props: Type[] = [];

  for (const prop of await checker.getPropertiesOfType(type)) props.push(await typeOf(ctx, prop));
  const signatures: Type[] = [];

  for (const signature of await signaturesOf(ctx, type)) {
    signatures.push(...[await checker.getReturnTypeOfSignature(signature)].filter(defined));

    for (const parameter of await signature.getParameters()) signatures.push(await typeOf(ctx, parameter));
  }

  return [...members, ...args, ...props, ...signatures];
}

/**
 * Whether the type, or anything it is made of at any depth, is nominal or a dependency's: a field of a nominal type
 * is as nominal.
 */
export async function isNominal(ctx: Ctx, type: Type): Promise<boolean> {
  const seen = new Set<Type>();
  const queue = [type];

  for (const next of queue) {
    if (seen.has(next)) continue;
    seen.add(next);

    if (await nominalHead(ctx, next)) return true;
    queue.push(...(await parts(ctx, next)));
  }

  return false;
}
