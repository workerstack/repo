import ts from "typescript";

import { isNominal, typeText } from "./api-diff-nominal.ts";
import type { Ctx } from "./api-diff-nominal.ts";

/** How one name changed: it now needs more of its users, or asks less of them; null when it did not change. */
export type Verdict = "widened" | "narrowed" | null;

/** One side of a name: its declared type, or the type of its value. */
type Facet = { mask: ts.SymbolFlags; value: boolean };
const TYPE_FACET: Facet = { mask: ts.SymbolFlags.Type, value: false };
const VALUE_FACET: Facet = { mask: ts.SymbolFlags.Value, value: true };

/** Zips two lists to the shorter one's length. */
const pairs = <T>(first: readonly T[], second: readonly T[]): [T, T][] =>
  first.flatMap((item, index) => second.slice(index, index + 1).map((other): [T, T] => [item, other]));

/** Applies `map` to both of a pair. */
const both = <T, U>(pair: readonly [T, T], map: (item: T) => U): [U, U] => [map(pair[0]), map(pair[1])];

const defined = <T>(value: T | undefined): value is T => value !== undefined;

/** Whether a type is a union, a literal or an enum, which loses and gains members. */
const isMemberType = (type: ts.Type): boolean =>
  (type.flags & (ts.TypeFlags.Union | ts.TypeFlags.Literal | ts.TypeFlags.EnumLike)) !== 0;

/** Whether not being assignable both ways loses something: a value that no longer fits, a member or a field gone. */
function lost(facet: Facet, types: [ts.Type, ts.Type], fits: { a: boolean; b: boolean }): boolean {
  if (facet.value) return !fits.a;
  return types.some(isMemberType) ? !fits.b : true;
}

/**
 * The verdict of two types by assignability, `a` being new to old and `b` old to new. Assignable both ways, they are
 * unchanged when printed alike and widened (an optional field) when not; twin copies of a nominal type are unchanged.
 */
function byAssignability(ctx: Ctx, facet: Facet, types: [ts.Type, ts.Type]): Verdict {
  const [old, next] = types;
  const fits = { a: ctx.checker.isTypeAssignableTo(next, old), b: ctx.checker.isTypeAssignableTo(old, next) };
  const same = typeText(ctx, old) === typeText(ctx, next);
  if (fits.a && fits.b) return same ? null : "widened";
  if (same && isNominal(ctx, old) && isNominal(ctx, next)) return null;
  return lost(facet, types, fits) ? "narrowed" : "widened";
}

/** Whether a method's parameters differ in some overload: shorthand methods are bivariant, so assignability misses it. */
function parametersDiffer(ctx: Ctx, old: ts.Symbol, next: ts.Symbol): boolean {
  const [before, after] = both([old, next], (method) => ctx.checker.getTypeOfSymbol(method).getCallSignatures());
  const typeOf = (parameter: ts.Symbol): ts.Type => ctx.checker.getTypeOfSymbol(parameter);
  return pairs(before, after).some(([first, second]) =>
    pairs(first.getParameters(), second.getParameters()).some(
      ([x, y]) => byAssignability(ctx, TYPE_FACET, [typeOf(x), typeOf(y)]) !== null,
    ),
  );
}

/** Whether a method of the old type has a parameter the new one's method does not take both ways. */
function methodsNarrowed(ctx: Ctx, old: ts.Type, next: ts.Type): boolean {
  const methods = ctx.checker.getPropertiesOfType(old).filter((prop) => prop.flags & ts.SymbolFlags.Method);
  return methods.some((method) => {
    const other = ctx.checker.getPropertyOfType(next, method.name);
    return [other]
      .filter(defined)
      .some((twin) => twin.flags & ts.SymbolFlags.Method && parametersDiffer(ctx, method, twin));
  });
}

/** The verdict of two types of one facet, a method narrowed counting over what assignability says. */
function typeVerdict(ctx: Ctx, facet: Facet, types: [ts.Type, ts.Type]): Verdict {
  return methodsNarrowed(ctx, ...types) ? "narrowed" : byAssignability(ctx, facet, types);
}

/** Whether a symbol declares a type with type parameters, which cannot be given arguments here. */
const isGeneric = (symbol: ts.Symbol): boolean =>
  symbol.declarations?.some(
    (declaration) =>
      (ts.isTypeAliasDeclaration(declaration) ||
        ts.isInterfaceDeclaration(declaration) ||
        ts.isClassLike(declaration)) &&
      declaration.typeParameters !== undefined,
  ) === true;

/** The element union of a tuple of literals; an empty list for any other type. */
function literalElements(ctx: Ctx, type: ts.Type): ts.Type[] {
  if (!ctx.checker.isTupleType(type)) return [];
  const literals = (element: ts.Type): boolean =>
    (element.isUnion() ? element.types : [element]).every((member) => member.isLiteral());
  return [type.getNumberIndexType()].filter(defined).filter(literals);
}

/** The verdict of the value of a name: a tuple of literals counts as the union of its elements. */
function valueVerdict(ctx: Ctx, old: ts.Type, next: ts.Type): Verdict {
  const [first, second] = [literalElements(ctx, old)[0], literalElements(ctx, next)[0]];
  if (first !== undefined && second !== undefined) return byAssignability(ctx, TYPE_FACET, [first, second]);
  return typeVerdict(ctx, VALUE_FACET, [old, next]);
}

/** The verdict of the declared type of a name; a generic one compares by its text. */
function declaredVerdict(ctx: Ctx, old: ts.Symbol, next: ts.Symbol): Verdict {
  const [before, after] = both([old, next], (symbol) => ctx.checker.getDeclaredTypeOfSymbol(symbol));
  if (!isGeneric(old) && !isGeneric(next)) return typeVerdict(ctx, TYPE_FACET, [before, after]);
  return typeText(ctx, before) === typeText(ctx, after) ? null : "narrowed";
}

/** The verdict of one facet of a name that has it on both sides, or that gained or lost it. */
function facetVerdict(ctx: Ctx, facet: Facet, symbols: [ts.Symbol, ts.Symbol]): Verdict {
  const [old, next] = symbols;
  const [had, has] = both([old, next], (symbol) => symbol.flags & facet.mask);
  if (!had) return has ? "widened" : null;
  if (!has) return "narrowed";
  if (!facet.value) return declaredVerdict(ctx, old, next);
  return valueVerdict(ctx, ctx.checker.getTypeOfSymbol(old), ctx.checker.getTypeOfSymbol(next));
}

const isEnum = (symbol: ts.Symbol): boolean => (symbol.flags & ts.SymbolFlags.Enum) !== 0;

/** An enum compares by member names: one lost, or renamed, narrows it; only new ones widen it. */
function enumVerdict(ctx: Ctx, old: ts.Symbol, next: ts.Symbol): Verdict {
  const [was, is] = both([old, next], (symbol) =>
    ctx.checker.getPropertiesOfType(ctx.checker.getTypeOfSymbol(symbol)).map((member) => member.name),
  );
  if (was.some((name) => !is.includes(name))) return "narrowed";
  return is.length > was.length ? "widened" : null;
}

/** How a name changed between two versions, as the worse of its type and its value; null when it did not. */
export function classify(ctx: Ctx, old: ts.Symbol, next: ts.Symbol): Verdict {
  if (isEnum(old) && isEnum(next)) return enumVerdict(ctx, old, next);
  const verdicts = [TYPE_FACET, VALUE_FACET].map((facet) => facetVerdict(ctx, facet, [old, next]));
  if (verdicts.includes("narrowed")) return "narrowed";
  return verdicts.includes("widened") ? "widened" : null;
}
