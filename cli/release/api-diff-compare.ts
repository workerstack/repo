import type { Node } from "typescript/unstable/ast";
import { isInterfaceDeclaration, isTypeAliasDeclaration } from "typescript/unstable/ast/is";
import { isUnionType, SignatureKind, SymbolFlags, TypeFlags } from "typescript/unstable/async";
import type { Symbol as TsSymbol, Type } from "typescript/unstable/async";

import { isClassLike } from "../ts-nodes.ts";
import { defined, isNominal, nodeOf, typeOf } from "./api-diff-nominal.ts";
import type { Ctx } from "./api-diff-nominal.ts";
import { typeText } from "./type-text.ts";

/** How one name changed: it now needs more of its users, or asks less of them; null when it did not change. */
export type Verdict = "widened" | "narrowed" | null;

/** One side of a name: its declared type, or the type of its value. */
type Facet = { mask: SymbolFlags; value: boolean };

const typeFacet: Facet = { mask: SymbolFlags.Type, value: false };
const valueFacet: Facet = { mask: SymbolFlags.Value, value: true };

/** Zips two lists to the shorter one's length. */
function pairs<T>(first: readonly T[], second: readonly T[]): [T, T][] {
  return first.flatMap((item, index) => second.slice(index, index + 1).map((other): [T, T] => [item, other]));
}

/** Whether a type is a union, a literal or an enum, which loses and gains members. */
function isMemberType(type: Type): boolean {
  return (type.flags & (TypeFlags.Union | TypeFlags.Literal | TypeFlags.EnumLike)) !== 0;
}

/** Whether not being assignable both ways loses something: a value that no longer fits, a member or a field gone. */
function lost(facet: Facet, types: [Type, Type], fits: { a: boolean; b: boolean }): boolean {
  if (facet.value) return !fits.a;

  return types.some(isMemberType) ? !fits.b : true;
}

/**
 * The verdict of two types by assignability, `a` being new to old and `b` old to new. Assignable both ways, they are
 * unchanged when printed alike and widened (an optional field) when not; twin copies of a nominal type are unchanged.
 */
async function byAssignability(ctx: Ctx, facet: Facet, types: [Type, Type]): Promise<Verdict> {
  const { checker } = ctx.project;
  const [old, next] = types;
  const fits = { a: await checker.isTypeAssignableTo(next, old), b: await checker.isTypeAssignableTo(old, next) };
  const isSame = (await typeText(ctx, old)) === (await typeText(ctx, next));

  if (fits.a && fits.b) return isSame ? null : "widened";

  if (isSame && (await isNominal(ctx, old)) && (await isNominal(ctx, next))) return null;

  return lost(facet, types, fits) ? "narrowed" : "widened";
}

/** Whether a method's parameters differ in some overload: shorthand methods are bivariant, assignability misses it. */
async function parametersDiffer(ctx: Ctx, old: TsSymbol, next: TsSymbol): Promise<boolean> {
  const { checker } = ctx.project;
  const before = await checker.getSignaturesOfType(await typeOf(ctx, old), SignatureKind.Call);
  const after = await checker.getSignaturesOfType(await typeOf(ctx, next), SignatureKind.Call);

  for (const [first, second] of pairs(before, after)) {
    for (const [x, y] of pairs(await first.getParameters(), await second.getParameters())) {
      const verdict = await byAssignability(ctx, typeFacet, [await typeOf(ctx, x), await typeOf(ctx, y)]);

      if (verdict !== null) return true;
    }
  }

  return false;
}

function isMethod(symbol: TsSymbol): boolean {
  return (symbol.flags & SymbolFlags.Method) !== 0;
}

/** Whether a method of the old type has a parameter the new one's method does not take both ways. */
async function methodsNarrowed(ctx: Ctx, old: Type, next: Type): Promise<boolean> {
  const { checker } = ctx.project;

  const props = await checker.getPropertiesOfType(old);

  for (const method of props.filter(isMethod)) {
    const twins = [await checker.getPropertyOfType(next, method.name)].filter(defined).filter(isMethod);

    for (const twin of twins) if (await parametersDiffer(ctx, method, twin)) return true;
  }

  return false;
}

/** The verdict of two types of one facet, a method narrowed counting over what assignability says. */
async function typeVerdict(ctx: Ctx, facet: Facet, types: [Type, Type]): Promise<Verdict> {
  return (await methodsNarrowed(ctx, ...types)) ? "narrowed" : byAssignability(ctx, facet, types);
}

/** Whether a declaration is a type alias, an interface or a class with type parameters. */
function declaresGeneric(declaration: Node): boolean {
  const isType = isTypeAliasDeclaration(declaration) || isInterfaceDeclaration(declaration);

  return (isType || isClassLike(declaration)) && declaration.typeParameters !== undefined;
}

/** Whether a symbol declares a type with type parameters, which cannot be given arguments here. */
async function isGeneric(ctx: Ctx, symbol: TsSymbol): Promise<boolean> {
  for (const handle of symbol.declarations) if (declaresGeneric(await nodeOf(ctx, handle))) return true;

  return false;
}

function isLiteral(type: Type): boolean {
  return (type.flags & TypeFlags.Literal) !== 0;
}

/** Whether every member of an element type (a union or one type) is a literal. */
async function isLiterals(element: Type): Promise<boolean> {
  return (isUnionType(element) ? await element.getTypes() : [element]).every(isLiteral);
}

/** The element union of a tuple of literals; an empty list for any other type. */
async function literalElements(ctx: Ctx, type: Type): Promise<Type[]> {
  const { checker } = ctx.project;

  if (!(await checker.isTupleType(type))) return [];
  const indexes = await checker.getIndexInfosOfType(type);
  const infos = indexes.filter((info) => (info.keyType.flags & TypeFlags.Number) !== 0);
  const elements: Type[] = [];

  for (const { valueType } of infos) if (await isLiterals(valueType)) elements.push(valueType);

  return elements;
}

/** The verdict of the value of a name: a tuple of literals counts as the union of its elements. */
async function valueVerdict(ctx: Ctx, old: Type, next: Type): Promise<Verdict> {
  const [[first], [second]] = [await literalElements(ctx, old), await literalElements(ctx, next)];

  if (first !== undefined && second !== undefined) return byAssignability(ctx, typeFacet, [first, second]);

  return typeVerdict(ctx, valueFacet, [old, next]);
}

/** The verdict of the declared type of a name; a generic one compares by its text. */
async function declaredVerdict(ctx: Ctx, old: TsSymbol, next: TsSymbol): Promise<Verdict> {
  const { checker } = ctx.project;
  const [before, after] = [await checker.getDeclaredTypeOfSymbol(old), await checker.getDeclaredTypeOfSymbol(next)];

  const isPlain = !(await isGeneric(ctx, old)) && !(await isGeneric(ctx, next));

  if (isPlain) return typeVerdict(ctx, typeFacet, [before, after]);

  return (await typeText(ctx, before)) === (await typeText(ctx, after)) ? null : "narrowed";
}

/** The verdict of one facet of a name that has it on both sides, or that gained or lost it. */
async function facetVerdict(ctx: Ctx, facet: Facet, symbols: [TsSymbol, TsSymbol]): Promise<Verdict> {
  const [old, next] = symbols;
  const [had, has] = [(old.flags & facet.mask) !== 0, (next.flags & facet.mask) !== 0];

  if (!had) return has ? "widened" : null;

  if (!has) return "narrowed";

  if (!facet.value) return declaredVerdict(ctx, old, next);

  return valueVerdict(ctx, await typeOf(ctx, old), await typeOf(ctx, next));
}

function isEnum(symbol: TsSymbol): boolean {
  return (symbol.flags & SymbolFlags.Enum) !== 0;
}

/** The member names of an enum. */
async function enumMembers(ctx: Ctx, symbol: TsSymbol): Promise<string[]> {
  const members = await ctx.project.checker.getPropertiesOfType(await typeOf(ctx, symbol));

  return members.map((member) => member.name);
}

/** An enum compares by member names: one lost, or renamed, narrows it; only new ones widen it. */
async function enumVerdict(ctx: Ctx, old: TsSymbol, next: TsSymbol): Promise<Verdict> {
  const [was, is] = [await enumMembers(ctx, old), await enumMembers(ctx, next)];

  if (was.some((name) => !is.includes(name))) return "narrowed";

  return is.length > was.length ? "widened" : null;
}

/** How a name changed between two versions, as the worse of its type and its value; null when it did not. */
export async function classify(ctx: Ctx, old: TsSymbol, next: TsSymbol): Promise<Verdict> {
  if (isEnum(old) && isEnum(next)) return enumVerdict(ctx, old, next);
  const verdicts = [await facetVerdict(ctx, typeFacet, [old, next]), await facetVerdict(ctx, valueFacet, [old, next])];

  if (verdicts.includes("narrowed")) return "narrowed";

  return verdicts.includes("widened") ? "widened" : null;
}
