import ts from "typescript";
import {
  NOMINAL_MODIFIERS,
  NOMINAL_TYPES,
  OPTIONAL_MARK,
  PACKAGE_OF_FILE,
  SHAPE_FLAGS,
  TEXT_SEPARATOR,
} from "./api-diff.constants.ts";

/** What a comparison reads types through: the checker, and the names the two compared packages are imported by. */
export type Ctx = { checker: ts.TypeChecker; packages: readonly string[] };

/** Whether a class member, constructor or constructor parameter is `private`, `protected` or `#`. */
const nominalMember = (member: ts.Declaration): boolean => {
  const named = ts.getNameOfDeclaration(member);
  return (
    (named !== undefined && ts.isPrivateIdentifier(named)) ||
    (ts.getCombinedModifierFlags(member) & NOMINAL_MODIFIERS) !== 0
  );
};

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

/** Whether one type cannot be told from its twin by structure: nominal, or declared by a dependency. */
function nominalHead(ctx: Ctx, type: ts.Type): boolean {
  if (type.flags & NOMINAL_TYPES) return true;
  const declarations = type.getSymbol()?.declarations ?? [];
  return declarations.some((declaration) => nominalDeclaration(declaration) || foreignDeclaration(ctx, declaration));
}

/** The type, its union members, and what its call signatures return: a function of a nominal class is as nominal. */
function heads(type: ts.Type): ts.Type[] {
  const returned = type.getCallSignatures().map((signature) => signature.getReturnType());
  return [type, ...(type.isUnion() ? type.types : []), ...returned];
}

/** Whether the type, or what it is made of one level down, is nominal or a dependency's. */
export const isNominal = (ctx: Ctx, type: ts.Type): boolean => heads(type).some((head) => nominalHead(ctx, head));

/** The type in text: its name, its members and signatures, and the member names of an enum, class or namespace. */
export function typeText(ctx: Ctx, type: ts.Type): string {
  const { checker } = ctx;
  const print = (of: ts.Type): string => checker.typeToString(of, undefined, SHAPE_FLAGS);
  const props = type.flags & ts.TypeFlags.Object ? checker.getPropertiesOfType(type) : [];
  const members = props
    .map((prop) => {
      const optional = prop.flags & ts.SymbolFlags.Optional ? OPTIONAL_MARK : "";
      return `${prop.name}${optional}:${print(checker.getTypeOfSymbol(prop))}`;
    })
    .sort();
  const signatures = [...type.getCallSignatures(), ...type.getConstructSignatures()];
  const exported = [...(type.getSymbol()?.exports?.keys() ?? [])].map(String);
  return [print(type), ...members, ...signatures.map((s) => checker.signatureToString(s)), ...exported].join(
    TEXT_SEPARATOR,
  );
}
