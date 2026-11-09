/**
 * `@workerstack/repo/lint`: the oxlint JS plugin `repo`, which the standards pack's generated `.oxlintrc.json` loads
 * with every rule on. oxlint reads a plugin from its default export.
 */
import type { Plugin } from "@oxlint/plugins";
import { boundaries } from "./boundaries.ts";
import { noModuleSideEffects } from "./no-module-side-effects.ts";
import { noModuleState } from "./no-module-state.ts";
import { noSideEffectImport } from "./no-side-effect-import.ts";
import { noV8Ignore } from "./no-v8-ignore.ts";

const plugin = {
  meta: { name: "repo" },
  rules: {
    boundaries,
    "no-module-side-effects": noModuleSideEffects,
    "no-module-state": noModuleState,
    "no-side-effect-import": noSideEffectImport,
    "no-v8-ignore": noV8Ignore,
  },
} satisfies Plugin;

export default plugin;
