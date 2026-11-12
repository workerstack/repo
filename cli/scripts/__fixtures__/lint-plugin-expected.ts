/** What real oxlint reports over the planted files of `lint-plugin.test.ts`, sorted. */
export const LINT_PLUGIN_EXPECTED: readonly string[] = [
  "bin/app.ts repo(entry-file): a bin file holds only imports and one main() call; move this into the module main " +
    "comes from",
  "src/block.ts repo(no-block-comment): an own-line comment is written with //; run `bun repo lint --fix`",
  'src/boundaries.ts repo(boundaries): "zod" is not declared in package.json; add it to its dependencies',
  'src/cast.ts repo(as-needs-reason): "as string" needs a reason: write x /* why the type holds */ as string, or ' +
    "narrow with a check or a schema parse",
  "src/cast.ts typescript(consistent-type-assertions): Use `as string` instead of `<string>`.",
  "src/commented.ts repo(no-commented-out-code): this comment is code; delete it, git keeps the old version",
  "src/effects.ts repo(no-module-side-effects): module scope runs no code; move this into a function, or mark a pure " +
    "call /* @__PURE__ */",
  'src/files.ts repo(filename-matches-export): files.ts exports only "readWorkspace"; rename the file ' +
    "read-workspace.ts",
  "src/flag.ts repo(no-boolean-param): `force: boolean` is a positional flag the call cannot name; " +
    "take an options object ({ force }) or split the function in two",
  "src/home.ts repo(env-in-config): process.env is read outside env.ts; add the variable to this package's env.ts " +
    "schema and read it through that module",
  "src/ignore.ts repo(no-v8-ignore): coverage ignore comments hide untested code; delete the code or add a test that " +
    "runs it",
  "src/import.ts import(no-unassigned-import): Imported module should be assigned",
  'src/import.ts repo(no-side-effect-import): import "./clean.ts" runs a module for its effects; import a function ' +
    "from it and call that",
  "src/index.ts repo(index-file): an index file only re-exports; move this into its own module and re-export it",
  "src/names.ts repo(naming-convention): `PROGRAM_TIMEOUT` is a local; name it in camelCase: programTimeout",
  "src/names.ts repo(naming-convention): `found` holds a boolean; name it with is/has/can/should/was, like isFound",
  "src/names.ts repo(naming-convention): `tail` is a module-level literal const; name it TAIL",
  'src/native.ts repo(native-path-separator): `cwd` is a native path, which uses \\ on Windows, so `.endsWith("/…")` ' +
    "misses there; use path.basename, path.dirname, path.relative or split(path.sep), or convert it with " +
    '.replaceAll(path.sep, "/") first',
  'src/old.ts repo(deprecated-replacement): `@deprecated` names no replacement: write "use `newName` instead" or ' +
    "{@link newName}",
  "src/order.ts repo(member-ordering): the constructor comes after a public method; " +
    "order static fields, instance fields, constructor, public methods, non-public methods",
  "src/parse.test.ts repo(no-module-mocking): vi.mock replaces a module for the whole file; pass the fake through " +
    "a parameter, an options field or a real stream instead",
  "src/parse.test.ts repo(no-module-mocking): vi.mock replaces a module for the whole file; pass the fake through " +
    "a parameter, an options field or a real stream instead",
  "src/protocol.ts unicorn(prefer-node-protocol): Prefer using the `node:` protocol when importing Node.js built-in " +
    "modules.",
  'src/public.ts repo(public-jsdoc): `PUBLIC` is public through "." and has no JSDoc: add a /** */ block that says ' +
    "what a caller needs and the type does not",
  "src/skip.test.ts repo(skip-on-platform): skipIf reads isCi; a test may skip only on process.platform, " +
    "process.arch, process.versions or a runtime global, so make it hermetic instead",
  "src/state.ts repo(no-module-state): module-scope state outlives every caller; move it into a function, or make it " +
    "a const with a Readonly type",
  'src/store.ts repo(class-file): a class file holds one class, its imports and its export; move "parseRow" to its ' +
    "own file",
  "src/store.ts typescript(no-extraneous-class): Unexpected empty class.",
  "src/todo.ts repo(todo-needs-id): TODO needs an issue or lesson ID: TODO(#123), TODO(ABC-123) or TODO(<lesson slug>)",
  "src/user.types.ts repo(types-file): a .types.ts file holds only exported types and interfaces; move this into a " +
    "module",
  "src/wide.ts repo(max-line-width): this line is 121 columns, over 120; split the string with + or a join",
  'vite.config.ts repo(config-file): a config file holds only imports and exports; move "PLUGINS" into a module it ' +
    "imports",
];
