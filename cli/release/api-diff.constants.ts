import ts from "typescript";

/** The generated file whose imports put both versions of every subpath in one program. */
export const ENTRY_FILE: string = "api-entry.ts";
/** The package that owns a file: the name after the last `node_modules` directory in its path. */
export const PACKAGE_OF_FILE: RegExp = /^.*\/node_modules\/((?:@[^/]+\/)?[^/]+)\//;
/** Prints a type in full, an alias as what it stands for, so two copies of it compare by the same text. */
export const SHAPE_FLAGS: ts.TypeFormatFlags = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias;
/** Modifiers that make a class member nominal: two declarations of the class are two types. */
export const NOMINAL_MODIFIERS: ts.ModifierFlags = ts.ModifierFlags.Private | ts.ModifierFlags.Protected;
/** Types that are one type per declaration, wherever the declaration is copied. */
export const NOMINAL_TYPES: ts.TypeFlags = ts.TypeFlags.UniqueESSymbol | ts.TypeFlags.EnumLike;
export const TEXT_SEPARATOR: string = ";";
export const OPTIONAL_MARK: string = "?";
export const noModule = (spec: string): string => `cannot resolve ${spec} to a module`;
