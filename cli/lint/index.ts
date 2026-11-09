/**
 * `@workerstack/repo/lint`: the oxlint JS plugin `repo`, which the standards pack's generated `.oxlintrc.json` loads
 * with every rule on. oxlint reads a plugin from its default export.
 */
import type { Plugin } from "@oxlint/plugins";
import { asNeedsReason } from "./as-needs-reason.ts";
import { boundaries } from "./boundaries.ts";
import { filenameMatchesExport } from "./filename-matches-export.ts";
import { noCommentedOutCode } from "./no-commented-out-code.ts";
import { noMockOfSubject } from "./no-mock-of-subject.ts";
import { noModuleSideEffects } from "./no-module-side-effects.ts";
import { noModuleState } from "./no-module-state.ts";
import { noSideEffectImport } from "./no-side-effect-import.ts";
import { noV8Ignore } from "./no-v8-ignore.ts";
import { todoNeedsId } from "./todo-needs-id.ts";

const plugin = {
  meta: { name: "repo" },
  rules: {
    "as-needs-reason": asNeedsReason,
    boundaries,
    "filename-matches-export": filenameMatchesExport,
    "no-commented-out-code": noCommentedOutCode,
    "no-mock-of-subject": noMockOfSubject,
    "no-module-side-effects": noModuleSideEffects,
    "no-module-state": noModuleState,
    "no-side-effect-import": noSideEffectImport,
    "no-v8-ignore": noV8Ignore,
    "todo-needs-id": todoNeedsId,
  },
} satisfies Plugin;

export default plugin;
