import { z } from "zod";

import { tryJson, type JsonObject } from "../json.ts";
import type { SyncContext } from "./outputs.ts";
import {
  BUN_FORMAT_COMMAND,
  BUN_FORMAT_LANGUAGES,
  BUN_FORMATTER_EXTENSION,
  NATIVE_TYPESCRIPT_EXTENSION,
  NATIVE_TYPESCRIPT_MAJOR,
  OXC_EXTENSION,
  TAILWIND_EXTENSION,
  TYPESCRIPT_PACKAGE,
  VITEST_EXTENSION,
  VITEST_PACKAGE,
} from "./vscode-defaults.constants.ts";

/** The editor settings and extension recommendations sync adds when they are missing. */
export type VscodeDefaults = { settings: JsonObject; recommendations: string[] };

/** The keys every standards-pack repo gets, whatever it installs. */
const BASE_SETTINGS = {
  "editor.codeActionsOnSave": { "source.fixAll.oxc": "explicit" },
  "editor.defaultFormatter": BUN_FORMATTER_EXTENSION,
  "editor.formatOnSave": true,
  "editor.formatOnSaveMode": "file",
  "files.eol": "\n",
  "files.insertFinalNewline": true,
  "files.trimTrailingWhitespace": true,
  "files.watcherExclude": { "**/.turbo/**": true, "**/.worktrees/**": true },
  // Bun formats; the oxc extension only lints, since it needs an oxfmt this package no longer installs.
  "oxc.enable.oxfmt": false,
  "search.exclude": { "**/.turbo": true, "**/.worktrees": true, "**/coverage": true },
} satisfies JsonObject;

const TAILWIND_SETTINGS = {
  "css.lint.unknownAtRules": "ignore",
  "files.associations": { "*.css": "tailwindcss" },
} satisfies JsonObject;

const NATIVE_TYPESCRIPT_SETTINGS = {
  "js/ts.experimental.useTsgo": true,
  "js/ts.tsdk.path": "./node_modules/typescript",
} satisfies JsonObject;

const CLASSIC_TYPESCRIPT_SETTINGS = {
  "js/ts.tsdk.path": "./node_modules/typescript/lib",
} satisfies JsonObject;

const NONE: VscodeDefaults = { recommendations: [], settings: {} };
const DECIMAL = 10;

function versionSchema() {
  return z.object({ version: z.string() });
}

/** The leading integer of the installed typescript's version; null when it is missing, unreadable or not numeric. */
function typescriptMajor(ctx: SyncContext): number | null {
  const text = ctx.read(TYPESCRIPT_PACKAGE);
  const manifest = text === null ? undefined : tryJson(versionSchema(), text);
  const major = Number.parseInt(manifest?.version ?? "", DECIMAL);

  return Number.isNaN(major) ? null : major;
}

function typescriptDefaults(ctx: SyncContext): VscodeDefaults {
  const major = typescriptMajor(ctx);

  if (major === null) return NONE;

  return major >= NATIVE_TYPESCRIPT_MAJOR
    ? { recommendations: [NATIVE_TYPESCRIPT_EXTENSION], settings: { ...NATIVE_TYPESCRIPT_SETTINGS } }
    : { recommendations: [], settings: { ...CLASSIC_TYPESCRIPT_SETTINGS } };
}

/**
 * What a standards-pack repo's editor should hold: Bun as the formatter (it has no language server, so the bridge
 * extension pipes the file through `bun fmt`), the oxc extension for lint only, and the settings and recommendations
 * that follow what is installed: Tailwind, TypeScript, Vitest. Nothing without the standards pack.
 */
export function vscodeDefaults(ctx: SyncContext): VscodeDefaults {
  if (!ctx.config.packs.includes("standards")) return NONE;
  const typescript = typescriptDefaults(ctx);
  const isTailwind = ctx.config.lint.tailwind !== undefined;
  const isVitest = ctx.read(VITEST_PACKAGE) !== null;

  return {
    recommendations: [
      OXC_EXTENSION,
      BUN_FORMATTER_EXTENSION,
      ...typescript.recommendations,
      ...(isTailwind ? [TAILWIND_EXTENSION] : []),
      ...(isVitest ? [VITEST_EXTENSION] : []),
    ],
    settings: {
      ...BASE_SETTINGS,
      "simpleLspClient.formatters": {
        bun: { cmd: [...BUN_FORMAT_COMMAND], filetypes: [...BUN_FORMAT_LANGUAGES] },
      },
      ...typescript.settings,
      ...(isTailwind ? TAILWIND_SETTINGS : {}),
    },
  };
}
