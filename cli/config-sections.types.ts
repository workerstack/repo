/** The shape of each section of repo.config.ts, as `defineConfig` takes it, with what each key does and its default. */
import type { BuiltInLabel } from "./ci-schema.constants.ts";
import type { NonEmpty, Taken } from "./config-helpers.types.ts";
import type { LintBoundaries, LintTailwindInput } from "./config-resolved.types.ts";
import type { Host, SkillPack } from "./config-schema.ts";
import type { LinkPush } from "./link.constants.ts";
import type { StockPlugin } from "./lint-schema.ts";
import type { Effort, Approval, Strategy } from "./scripts/strategy.types.ts";
import type { GeneratedTask } from "./turbo-config.constants.ts";
import type { TurboTask } from "./turbo-config.ts";

/** `agents`: what `bun repo sync` writes for coding agents, and how a session runs by default. */
export type AgentsConfig = {
  /**
   * The agent tools `bun repo sync` writes rules, skills and hooks for. Any of `"claude"`, `"codex"`,
   * `"antigravity"`, `"grok"` and `"cursor"`; list at least one.
   *
   * @default ["claude", "codex", "antigravity", "grok", "cursor"]
   */
  hosts?: NonEmpty<Host> | undefined;
  /**
   * Optional skill packs to ship to agents, beside the stock skills. Any of `"google-workspace"` (Sheets, Docs,
   * Calendar, Gmail), `"listen"` (speech to text), `"speak"` (text to speech) and `"clasp"` (Apps Script).
   *
   * @default []
   */
  skills?: readonly SkillPack[] | undefined;
  /**
   * Who runs a new plan's or roadmap's steps when the session and the parent roadmap name none. `"free"`: the
   * session does them itself. `"spawn-fast"`: fast helper agents do each phase and the session reviews.
   * `"spawn-deep"`: the same with deep helper agents.
   *
   * @default "free"
   */
  defaultStrategy?: Strategy | undefined;
  /**
   * Whether a session asks when no session approval and no in-progress plan or roadmap sets it. `"ask"`: it stops
   * once for plan approval. `"away"`: it decides instead of asking and logs each choice.
   *
   * @default "ask"
   */
  defaultApproval?: Approval | undefined;
  /**
   * How much process a change gets when no skill is named. `"deep"`: a reviewed plan of up to 100 lines. `"fast"`:
   * a short plan with no review.
   *
   * @default "deep"
   */
  defaultEffort?: Effort | undefined;
};

/** `ci`: commands `bun repo ci` runs after its own checks. */
export type CiConfig = {
  /**
   * Extra checks by name, each an argv run from the repo root with no shell, in the order written. Each runs after
   * the built-in checks, locally and in every CI test job, and is timed and counted in the exit code like one.
   * Names are kebab-case, like `e2e` or `api-contract`; `check`, `fmt`, `typecheck`, `tests` and `packages` are
   * taken.
   *
   * @default {}
   */
  checks?: (Readonly<Record<string, NonEmpty<string>>> & Taken<BuiltInLabel>) | undefined;
};

/** `clean`: what `bun repo clean --build` removes. */
export type CleanConfig = {
  /**
   * Extra folder names to remove wherever git ignores them, beside `.next`, `.open-next`, `.turbo`, `.wrangler`,
   * `.tanstack`, `.start` and `.vite`. Names only, not paths.
   *
   * @default []
   */
  build?: readonly string[] | undefined;
};

/** `link`: the checkouts `bun repo link` packs from, and what the push check does while one is linked. */
export type LinkConfig = {
  /**
   * Local checkouts `bun repo link` packs a dependency from, by package name, when the checkout is not in a sibling
   * folder. Each path is relative to the repo root.
   *
   * @default {}
   * @example paths: { "@acme/ui": "../../acme/ui" }
   */
  paths?: Readonly<Record<string, string>> | undefined;
  /**
   * What the pre-push check does while a public package depends on a linked package: "block" refuses the push,
   * "allow" prints a warning for each such package and lets the push go.
   *
   * @default "block"
   * @example push: "allow"
   */
  push?: LinkPush | undefined;
};

/** `commit`: what the commit-msg hook holds each commit to. */
export type CommitConfig = {
  /**
   * The most lines a commit may change with no body. A bigger commit needs exactly one body line that says why;
   * a smaller one takes no free text in its body. A whole number above 0.
   *
   * @default 1000
   */
  maxChangedLines?: number | undefined;
  /**
   * The people a commit may credit with a `Co-authored-by: <identity>` line, each written exactly as that line names
   * them: `"Name <email>"`. The lines go in the message's last paragraph, which holds only them. An AI tool is never a
   * co-author.
   *
   * @default []
   * @example coAuthors: ["Ada Lovelace <ada@example.com>"]
   */
  coAuthors?: readonly string[] | undefined;
};

/** `coverage`: the files that hold the test ratchets, and what mutation testing changes. */
export type CoverageConfig = {
  /**
   * The coverage floors file, relative to the repo root. `bun repo coverage` raises its numbers and never lowers
   * them; `bun repo check` fails when a floor is lower than on the default branch.
   *
   * @default "coverage-floors.json"
   */
  floors?: string | undefined;
  /**
   * The list of `it.fails` tests a run accepts, relative to the repo root. It may only shrink.
   *
   * @default "known-failures.json"
   */
  knownFailures?: string | undefined;
  /**
   * Globs of the tracked files `bun repo mutate` changes to test the tests, nightly and by hand.
   *
   * @default ["src/**\/*.ts"]
   */
  mutate?: NonEmpty<string> | undefined;
  /**
   * Globs of the test files `bun repo mutate` leaves out. A run writes every mutant into the source files at once, so a
   * test that reads the repo's own source, such as a scan of every file, fails there and can kill no mutant.
   *
   * @default []
   */
  mutateExclude?: readonly string[] | undefined;
  /**
   * The mutation score floors file, relative to the repo root. The nightly run fails when a score drops below it.
   *
   * @default "mutation-floors.json"
   */
  mutationFloors?: string | undefined;
};

/** One `knip.ignore` entry: exactly one of `file`, `dependency` or `binary`, with the reason knip cannot see it. */
export type KnipIgnoreEntry =
  | {
      /** A file knip is not to report as unused, relative to the repo root. */
      file: string;
      /** Not beside `file`: an entry names one thing. */
      dependency?: never;
      /** Not beside `file`: an entry names one thing. */
      binary?: never;
      /** Why knip cannot see the use. `bun repo check` fails the entry once knip would report nothing for it. */
      reason: string;
    }
  | {
      /** Not beside `dependency`: an entry names one thing. */
      file?: never;
      /** A package knip is not to report as an unused dependency. */
      dependency: string;
      /** Not beside `dependency`: an entry names one thing. */
      binary?: never;
      /** Why knip cannot see the use. `bun repo check` fails the entry once knip would report nothing for it. */
      reason: string;
    }
  | {
      /** Not beside `binary`: an entry names one thing. */
      file?: never;
      /** Not beside `binary`: an entry names one thing. */
      dependency?: never;
      /** A command knip is not to report as an unlisted binary. */
      binary: string;
      /** Why knip cannot see the use. `bun repo check` fails the entry once knip would report nothing for it. */
      reason: string;
    };

/** `knip`: what the unused-code check may skip. */
export type KnipConfig = {
  /**
   * Files, dependencies and binaries knip is not to report, each with the reason it cannot see the use.
   *
   * @default []
   */
  ignore?: readonly KnipIgnoreEntry[] | undefined;
};

/** One `lint.skip` entry: rules turned off for some files, and why. */
export type LintSkipEntry = {
  /** Globs of the files, relative to the repo root, like `"src/legacy/**"`. */
  files: NonEmpty<string>;
  /**
   * The rules to turn off, as lint prints them: `"repo/no-module-state"`, `"eslint/no-await-in-loop"`,
   * `"typescript/no-unsafe-call"`, `"stylelint/<rule>"`, `"tailwindcss/<rule>"` or a consumer plugin's
   * `"<name>/<rule>"`.
   */
  rules: NonEmpty<string>;
  /**
   * Why the rules cannot hold here, in three words or more. `bun repo check` fails the entry once it turns nothing
   * off.
   */
  reason: string;
};

/** A consumer rule turned on: `"error"`, or `["error", options]` where the options are JSON, which load checks. */
export type RuleSetting = "error" | readonly ["error", ...unknown[]];

/** The rule keys of plugins `N`: any key while the names are not known, none while no plugin is registered. */
export type LintRules<N extends string> = string extends N
  ? Readonly<Record<string, RuleSetting>>
  : [N] extends [never]
    ? Readonly<Record<string, never>>
    : { readonly [K in `${N}/${string}`]?: RuleSetting };

/** One `lint.rules` entry: rules of a registered plugin turned on, for some files or all. `N` is the plugin names. */
export type LintRuleEntry<N extends string = string> = {
  /**
   * Globs of the files the rules cover, relative to the repo root, like `"src/**"`. Every file when omitted.
   *
   * @default undefined
   */
  files?: NonEmpty<string> | undefined;
  /**
   * The rules to turn on, each `"<plugin>/<rule>"` with a plugin from `lint.plugins`: `"error"`, or `["error",
   * options]` for a rule that takes options. Turn a rule off with `lint.skip`.
   */
  rules: LintRules<NoInfer<N>>;
};

/** `lint`: exceptions and extra settings for `bun repo lint`. `N` is the names of `plugins`. */
export type LintConfig<N extends string = string> = {
  /**
   * Rules turned off for named files, each with a reason. Lint, `bun repo check` and the commit hook all honor them.
   *
   * @default []
   */
  skip?: readonly LintSkipEntry[] | undefined;
  /**
   * Your own oxlint plugins, by name to the repo-relative `.js`, `.mjs` or `.ts` file that default-exports each. The
   * name is lowercase kebab-case and is the prefix of its rules; oxlint's own plugin names and `repo`, `tailwindcss`,
   * `stylelint`, `clippy` and `rust` are taken. Turn its rules on with `rules`.
   *
   * @default {}
   * @example plugins: { app: "lint/app.js" }
   */
  plugins?:
    | { readonly [K in N]: K extends StockPlugin ? `"${K}" is a stock plugin name; pick another, like "app"` : string }
    | undefined;
  /**
   * Rules of your `plugins` to turn on at error severity, for the files each entry's globs match or for every file.
   * A key is `"<plugin>/<rule>"`; a value is `"error"` or `["error", options]`.
   *
   * @default []
   * @example rules: [{ files: ["src/**"], rules: { "app/no-x": "error", "app/max-y": ["error", { max: 3 }] } }]
   */
  rules?: readonly LintRuleEntry<N>[] | undefined;
  /**
   * Which layer each workspace package sits on, and which layers each may import. The `repo/boundaries` rule fails
   * an import outside them. Off when omitted.
   *
   * @default undefined
   */
  boundaries?: LintBoundaries | undefined;
  /**
   * The Tailwind sheet lint checks class names and css vars against, and the vars code sets at runtime. Needed only
   * when two or more sheets import tailwindcss, or for `vars`; with one sheet, the entry is found by itself.
   *
   * @default undefined
   */
  tailwind?: LintTailwindInput | undefined;
};

/** `nightly`: the scheduled run of mutation testing and live tests. */
export type NightlyConfig = {
  /**
   * How many parallel jobs the nightly mutation run is split into: a whole number from 1 to 32.
   *
   * @default 1
   */
  shards?: number | undefined;
  /**
   * Names of repo secrets the nightly live-test job gets as environment variables, like `"CLOUDFLARE_API_TOKEN"`.
   * Capital letters, digits and underscores, not starting with a digit or `GITHUB_`.
   *
   * @default []
   */
  secrets?: readonly string[] | undefined;
};

/** `owner`: who a public package names as its author. */
export type OwnerConfig = {
  /** The owner's name, as `author` in package.json and the holder in LICENSE. */
  name: string;
  /** The owner's GitHub login, which CODEOWNERS names. */
  github: string;
};

/** `turbo`: extra turbo tasks for a workspace. */
export type TurboConfig = {
  /**
   * Extra tasks by name, written into turbo.json after the generated `typecheck` and `test`, which are taken.
   *
   * @default {}
   */
  tasks?: (Readonly<Record<string, TurboTask>> & Taken<GeneratedTask>) | undefined;
};
