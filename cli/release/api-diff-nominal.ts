import ts from "typescript";

import {
  NOMINAL_MODIFIERS,
  NOMINAL_TYPES,
  OPTIONAL_MARK,
  PACKAGE_OF_FILE,
  FULL_TYPE_FLAGS,
  TEXT_SEPARATOR,
} from "./api-diff.constants.ts";

/** What a comparison reads types through: the checker, and the names the two compared packages are imported by. */
export type Ctx = { checker: ts.TypeChecker; packages: readonly string[] };

/** Whether a class member, constructor or constructor parameter is `private`, `protected` or `#`. */
function nominalMember(member: ts.Declaration): boolean {
  const named = ts.getNameOfDeclaration(member);

  return (
    (named !== undefined && ts.isPrivateIdentifier(named)) ||
    (ts.getCombinedModifierFlags(member) & NOMINAL_MODIFIERS) !== 0
  );
}

/** Whether a declaration is a class with a `private`, `protected` or `#` member. */
function nominalDeclaration(declaration: ts.Declaration): boolean {
  if (!ts.isClassLike(declaration)) return false;

  const nodes: ts.Declaration[] = declaration.members.flatMap<ts.Declaration>((member) =>
    ts.isConstructorDeclaration(member) ? [member, ...member.parameters] : [member],
  );

  return nodes.some(nominalMember);
}

/** Whether a declaration sits in a package other than the two compared. */
function foreignDeclaration(ctx: Ctx, declaration: ts.Declaration): boolean {
  const owner = PACKAGE_OF_FILE.exec(declaration.getSourceFile().fileName)?.[1];

  return !ctx.packages.some((name) => name === owner);
}

/** Whether a declaration is the TypeScript library's, which both compared packages share as one copy. */
function libraryDeclaration(declaration: ts.Declaration): boolean {
  return declaration.getSourceFile().hasNoDefaultLib;
}

/**
 * Whether a property is keyed by a unique symbol, which each copy of its module declares anew; the library's own keys,
 * such as `Symbol.iterator`, are one copy for both.
 */
function symbolKeyed(ctx: Ctx, prop: ts.Symbol): boolean {
  const declaration = prop.valueDeclaration;

  if (declaration === undefined || libraryDeclaration(declaration)) return false;
  const name = ts.getNameOfDeclaration(declaration);

  if (name === undefined || !ts.isComputedPropertyName(name)) return false;

  return (ctx.checker.getTypeAtLocation(name.expression).flags & ts.TypeFlags.UniqueESSymbol) !== 0;
}

/** Whether one type cannot be told from its twin by structure: nominal, keyed by a unique symbol, or a dependency's. */
function nominalHead(ctx: Ctx, type: ts.Type): boolean {
  if ((type.flags & NOMINAL_TYPES) !== 0) return true;
  const declarations = (type.getSymbol()?.declarations ?? []).filter((declaration) => !libraryDeclaration(declaration));

  if (declarations.some((declaration) => nominalDeclaration(declaration) || foreignDeclaration(ctx, declaration)))
    return true;

  return ctx.checker.getPropertiesOfType(type).some((prop) => symbolKeyed(ctx, prop));
}

/** Whether a type is declared only by the TypeScript library, whose members are the same for both copies. */
function isLibraryType(type: ts.Type): boolean {
  const declarations = type.getSymbol()?.declarations ?? [];

  return declarations.length > 0 && declarations.every(libraryDeclaration);
}

/** The type arguments of a generic reference, such as the `T` of `T[]`; none for any other type. */
function typeArguments(ctx: Ctx, type: ts.Type): readonly ts.Type[] {
  if ((type.flags & ts.TypeFlags.Object) === 0) return [];
  const object = type /* the Object flag marks an ObjectType */ as ts.ObjectType;

  if ((object.objectFlags & ts.ObjectFlags.Reference) === 0) return [];

  return ctx.checker.getTypeArguments(object /* the Reference object flag marks a TypeReference */ as ts.TypeReference);
}

/** What a type is made of: union and intersection members, type arguments, and, outside the library, its members. */
function parts(ctx: Ctx, type: ts.Type): ts.Type[] {
  const { checker } = ctx;
  const members = type.isUnionOrIntersection() ? type.types : [];
  const args = typeArguments(ctx, type);

  if (isLibraryType(type)) return [...members, ...args];
  const props = checker.getPropertiesOfType(type).map((prop) => checker.getTypeOfSymbol(prop));

  const signatures = [...type.getCallSignatures(), ...type.getConstructSignatures()].flatMap((signature) => [
    signature.getReturnType(),
    ...signature.getParameters().map((parameter) => checker.getTypeOfSymbol(parameter)),
  ]);

  return [...members, ...args, ...props, ...signatures];
}

/**
 * Whether the type, or anything it is made of at any depth, is nominal or a dependency's: a field of a nominal type
 * is as nominal.
 */
export function isNominal(ctx: Ctx, type: ts.Type): boolean {
  const seen = new Set<ts.Type>();
  const queue = [type];

  for (const next of queue) {
    if (seen.has(next)) continue;
    seen.add(next);

    if (nominalHead(ctx, next)) return true;
    queue.push(...parts(ctx, next));
  }

  return false;
}

/** The type in text: its name, its members and signatures, and the member names of an enum, class or namespace. */
export function typeText(ctx: Ctx, type: ts.Type): string {
  const { checker } = ctx;

  function print(of: ts.Type): string {
    return checker.typeToString(of, undefined, FULL_TYPE_FLAGS);
  }

  const props = (type.flags & ts.TypeFlags.Object) === 0 ? [] : checker.getPropertiesOfType(type);

  const members = props
    .map((prop) => {
      const optional = (prop.flags & ts.SymbolFlags.Optional) === 0 ? "" : OPTIONAL_MARK;

      return `${checker.symbolToString(prop)}${optional}:${print(checker.getTypeOfSymbol(prop))}`;
    })
    .toSorted();

  const signatures = [...type.getCallSignatures(), ...type.getConstructSignatures()];
  const exported = [...(type.getSymbol()?.exports?.keys() ?? [])].map(String);

  return [print(type), ...members, ...signatures.map((s) => checker.signatureToString(s)), ...exported].join(
    TEXT_SEPARATOR,
  );
}
