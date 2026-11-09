/**
 * `@workerstack/repo/lint`: the oxlint JS plugin `repo`, which the standards pack's generated `.oxlintrc.json` loads
 * with every rule on. oxlint reads a plugin from its default export.
 */
import type { Plugin } from "@oxlint/plugins";
import { asNeedsReason } from "./as-needs-reason.ts";
import { boundaries } from "./boundaries.ts";
import { classFile } from "./class-file.ts";
import { configFile } from "./config-file.ts";
import { entryFile } from "./entry-file.ts";
import { envInConfig } from "./env-in-config.ts";
import { filenameMatchesExport } from "./filename-matches-export.ts";
import { indexFile } from "./index-file.ts";
import { noCommentedOutCode } from "./no-commented-out-code.ts";
import { noMockOfSubject } from "./no-mock-of-subject.ts";
import { noModuleSideEffects } from "./no-module-side-effects.ts";
import { noModuleState } from "./no-module-state.ts";
import { noSideEffectImport } from "./no-side-effect-import.ts";
import { noV8Ignore } from "./no-v8-ignore.ts";
import { skipOnPlatform } from "./skip-on-platform.ts";
import { todoNeedsId } from "./todo-needs-id.ts";
import { typesFile } from "./types-file.ts";

const plugin: Plugin & { meta: { name: string } } = {
  meta: { name: "repo" },
  rules: {
    "as-needs-reason": asNeedsReason,
    boundaries,
    "class-file": classFile,
    "config-file": configFile,
    "entry-file": entryFile,
    "env-in-config": envInConfig,
    "filename-matches-export": filenameMatchesExport,
    "index-file": indexFile,
    "no-commented-out-code": noCommentedOutCode,
    "no-mock-of-subject": noMockOfSubject,
    "no-module-side-effects": noModuleSideEffects,
    "no-module-state": noModuleState,
    "no-side-effect-import": noSideEffectImport,
    "no-v8-ignore": noV8Ignore,
    "skip-on-platform": skipOnPlatform,
    "todo-needs-id": todoNeedsId,
    "types-file": typesFile,
  },
};

export default plugin;
