/**
 * `@workerstack/repo/lint`: the oxlint JS plugin `repo`, which the standards pack's generated `.oxlintrc.json` loads
 * with every rule on. oxlint reads a plugin from its default export.
 */
import type { TSESLint } from "@typescript-eslint/utils";

import { asNeedsReason } from "./as-needs-reason.ts";
import { boundaries } from "./boundaries.ts";
import { classFile } from "./class-file.ts";
import { configFile } from "./config-file.ts";
import { deprecatedReplacement } from "./deprecated-replacement.ts";
import { entryFile } from "./entry-file.ts";
import { envInConfig } from "./env-in-config.ts";
import { filenameMatchesExport } from "./filename-matches-export.ts";
import { indexFile } from "./index-file.ts";
import { maxLineWidth } from "./max-line-width.ts";
import { memberOrdering } from "./member-ordering.ts";
import { namingConvention } from "./naming-convention.ts";
import { nativePathSeparator } from "./native-path-separator.ts";
import { noBlockComment } from "./no-block-comment.ts";
import { noBooleanParam } from "./no-boolean-param.ts";
import { noChainedTypeAssertions } from "./no-chained-type-assertions.ts";
import { noCommentedOutCode } from "./no-commented-out-code.ts";
import { noForbiddenTermInSymbolNames } from "./no-forbidden-term-in-symbol-names.ts";
import { noKnownValueWidening } from "./no-known-value-widening.ts";
import { noModuleMocking } from "./no-module-mocking.ts";
import { noModuleSideEffects } from "./no-module-side-effects.ts";
import { noModuleState } from "./no-module-state.ts";
import { noObjectParameters } from "./no-object-parameters.ts";
import { noReflectApply } from "./no-reflect-apply.ts";
import { noReflectGet } from "./no-reflect-get.ts";
import { noSideEffectImport } from "./no-side-effect-import.ts";
import { noUnknownParameters } from "./no-unknown-parameters.ts";
import { noUnknownReturns } from "./no-unknown-returns.ts";
import { noUnknownTypeAliases } from "./no-unknown-type-aliases.ts";
import { noUnsafeDictionaryType } from "./no-unsafe-dictionary-type.ts";
import { noV8Ignore } from "./no-v8-ignore.ts";
import { noWidenThenAssert } from "./no-widen-then-assert.ts";
import { publicJsdoc } from "./public-jsdoc.ts";
import { requireReadableSpacing } from "./require-readable-spacing.ts";
import { skipOnPlatform } from "./skip-on-platform.ts";
import { todoNeedsId } from "./todo-needs-id.ts";
import { typesFile } from "./types-file.ts";

/**
 * The oxlint plugin `repo`, which a generated `.oxlintrc.json` loads from `@workerstack/repo/lint` with every rule
 * on.
 */
const plugin: TSESLint.FlatConfig.Plugin & {
  /** Always set: oxlint prefixes each rule with this name, as in `repo/boundaries`. */
  meta: {
    /** The plugin name, `repo`. */
    name: string;
  };

  /** Every repo rule, keyed by its name without the `repo/` prefix. */
  rules: Record<string, TSESLint.LooseRuleDefinition>;
} = {
  meta: { name: "repo" },
  rules: {
    "as-needs-reason": asNeedsReason,
    boundaries,
    "class-file": classFile,
    "config-file": configFile,
    "deprecated-replacement": deprecatedReplacement,
    "entry-file": entryFile,
    "env-in-config": envInConfig,
    "filename-matches-export": filenameMatchesExport,
    "index-file": indexFile,
    "max-line-width": maxLineWidth,
    "member-ordering": memberOrdering,
    "naming-convention": namingConvention,
    "native-path-separator": nativePathSeparator,
    "no-block-comment": noBlockComment,
    "no-boolean-param": noBooleanParam,
    "no-chained-type-assertions": noChainedTypeAssertions,
    "no-commented-out-code": noCommentedOutCode,
    "no-known-value-widening": noKnownValueWidening,
    "no-module-mocking": noModuleMocking,
    "no-module-side-effects": noModuleSideEffects,
    "no-module-state": noModuleState,
    "no-object-parameters": noObjectParameters,
    "no-reflect-apply": noReflectApply,
    "no-reflect-get": noReflectGet,
    "no-shape-in-symbol-names": noForbiddenTermInSymbolNames,
    "no-side-effect-import": noSideEffectImport,
    "no-unknown-parameters": noUnknownParameters,
    "no-unknown-returns": noUnknownReturns,
    "no-unknown-type-aliases": noUnknownTypeAliases,
    "no-unsafe-dictionary-type": noUnsafeDictionaryType,
    "no-v8-ignore": noV8Ignore,
    "no-widen-then-assert": noWidenThenAssert,
    "public-jsdoc": publicJsdoc,
    "require-readable-spacing": requireReadableSpacing,
    "skip-on-platform": skipOnPlatform,
    "todo-needs-id": todoNeedsId,
    "types-file": typesFile,
  },
};

export default plugin;
