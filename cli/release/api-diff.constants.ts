import { ModifierFlags } from "typescript/unstable/ast";
import { NodeBuilderFlags, TypeFlags } from "typescript/unstable/async";

/** The generated file whose imports put both versions of every subpath in one program. */
export const ENTRY_FILE: string = "api-entry.ts";

/** The package that owns a file: the name after the last `node_modules` directory in its path. */
export const PACKAGE_OF_FILE: RegExp = /^.*\/node_modules\/((?:@[^/]+\/)?[^/]+)\//;

/** Prints a type in full, an alias as what it stands for, so two copies of it compare by the same text. */
export const FULL_TYPE_FLAGS: NodeBuilderFlags = NodeBuilderFlags.NoTruncation | NodeBuilderFlags.InTypeAlias;

/** Modifiers that make a class member nominal: two declarations of the class are two types. */
export const NOMINAL_MODIFIERS: ModifierFlags = ModifierFlags.Private | ModifierFlags.Protected;

/** Types that are one type per declaration, wherever the declaration is copied. */
export const NOMINAL_TYPES: TypeFlags = TypeFlags.UniqueESSymbol | TypeFlags.EnumLike;
export const TEXT_SEPARATOR: string = ";";
export const OPTIONAL_MARK: string = "?";

export function noModule(spec: string): string {
  return `cannot resolve ${spec} to a module`;
}

export function noNode(file: string): string {
  return `TypeScript found no declaration in ${file}`;
}

export function noType(name: string): string {
  return `TypeScript gave no type for ${name}`;
}

/** The name TypeScript gives a member keyed by a symbol or named with `#`, which holds an id each copy has its own. */
export const ID_NAME: RegExp = /^__[#@]/;
export const REST_MARK: string = "...";
