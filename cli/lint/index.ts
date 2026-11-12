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
import { noCommentedOutCode } from "./no-commented-out-code.ts";
import { noModuleMocking } from "./no-module-mocking.ts";
import { noModuleSideEffects } from "./no-module-side-effects.ts";
import { noModuleState } from "./no-module-state.ts";
import { noReflectApply } from "./no-reflect-apply.ts";
import { noSideEffectImport } from "./no-side-effect-import.ts";
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
    "no-commented-out-code": noCommentedOutCode,
    "no-module-mocking": noModuleMocking,
    "no-module-side-effects": noModuleSideEffects,
    "no-module-state": noModuleState,
    "no-reflect-apply": noReflectApply,
    "no-side-effect-import": noSideEffectImport,
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
