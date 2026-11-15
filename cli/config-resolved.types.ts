import type { Host, Pack, SkillPack } from "./config.ts";
import type { ResolvedCoverage } from "./coverage-config.ts";
import type { Json } from "./json.ts";
import type { ResolvedKnip } from "./knip-schema.ts";
import type { LinkPush } from "./link.constants.ts";
import type { ResolvedNightly } from "./nightly-config.ts";
import type { ResolvedOwner } from "./owner-config.ts";
import type { Effort, Approval, Strategy } from "./scripts/strategy.types.ts";
import type { ResolvedTurbo } from "./turbo-config.ts";
import type { Workflow } from "./workflow.ts";

/** What an agent session starts from when nothing else names it: the hooks and the root `AGENTS.md` read these. */
export type AgentDefaults = {
  /** The strategy a new plan or roadmap saved without a `strategy:` line gets. */
  readonly defaultStrategy: Strategy;
  /** The mode a session runs when no /ask or /away stamp and no in-progress item names one. */
  readonly defaultApproval: Approval;
  /** The plan skills the root `AGENTS.md` points a change at when no skill was named. */
  readonly defaultEffort: Effort;
};

/** The agent setup a config resolves to. */
export type ResolvedAgents = AgentDefaults & {
  /** The hosts `repo sync` lays an agent tree out for: every host unless the config lists some. */
  readonly hosts: readonly Host[];
  /** The optional skill packs shipped to the agents: none unless the config lists some. */
  readonly skills: readonly SkillPack[];
};

/** What the commit-msg hook checks a commit against. */
export type ResolvedCommit = {
  /** The most lines one commit may change before the commit-msg hook refuses it. */
  readonly maxChangedLines: number;
};

/** One `lint.skip` entry: the rules (oxlint keys) it turns off, for the files its globs match, and why. */
export type LintSkip = {
  /** Globs of the files the exception covers, relative to the repo root. */
  files: readonly string[];
  /** The oxlint rule keys turned off for those files, like `repo/no-module-state`. */
  rules: readonly string[];
  /** Why the rule cannot hold here; `repo check` fails the entry when it no longer silences anything. */
  reason: string;
};

/** `lint.boundaries`: which layer each package sits on, and which layers each may import. */
export type LintBoundaries = {
  /** Package name to its one tag, like `{ "@app/web": "app" }`; an untagged package is not judged. */
  readonly tags: Readonly<Record<string, string>>;
  /** Tag to the other tags its packages may import, like `{ app: ["ui"], ui: [] }`; a tag may import its own. */
  readonly allow: Readonly<Record<string, readonly string[]>>;
};

/** `lint.tailwind`: the Tailwind v4 entry sheet oxlint checks class names against. */
export type LintTailwind = {
  /** The repo-relative `.css` file that imports tailwindcss, like `apps/web/src/app.css`. */
  readonly entryPoint: string;
};

/** One consumer rule's setting: on at error severity, with the options a rule takes after `"error"`. */
export type LintRuleSetting = "error" | readonly ["error", ...Json[]];

/** One `lint.rules` entry: consumer plugin rules turned on, for the files its globs match or everywhere. */
export type LintRuleEntry = {
  /** Globs of the files the rules cover, relative to the repo root; absent when they cover every file. */
  readonly files?: readonly string[] | undefined;
  /** Rule key, `<plugin>/<rule>` with a plugin from `lint.plugins`, to its setting. */
  readonly rules: Readonly<Record<string, LintRuleSetting>>;
};

/** What the generated oxlint config and `repo check` read from `lint`. */
export type ResolvedLint = {
  /** The consumer's oxlint plugins by name to their repo-relative file, without a leading `./`; empty when none. */
  readonly plugins: Readonly<Record<string, string>>;
  /** The consumer plugin rules turned on, in config order; empty when the config lists none. */
  readonly rules: readonly LintRuleEntry[];
  /** The reasoned exceptions to lint rules; empty when the config lists none. */
  readonly skip: readonly LintSkip[];
  /** The package tags `repo/boundaries` judges imports by; absent when the config sets none. */
  readonly boundaries?: LintBoundaries | undefined;
  /** The entry sheet the tailwindcss class rules load the theme from; absent when there is none. */
  readonly tailwind?: LintTailwind | undefined;
};

/** A validated repo.config.ts with every omitted value filled in, as the `repo` commands read it. */
export type ResolvedConfig = {
  /** The packs that are on: the defaults when the config omits `packs`. */
  readonly packs: readonly Pack[];
  /** The agent hosts and skills that are on. */
  readonly agents: ResolvedAgents;
  /** The limits a commit is held to. */
  readonly commit: ResolvedCommit;
  /** The lint exceptions the config records. */
  readonly lint: ResolvedLint;
  /** The knip ignores the config sanctions. */
  readonly knip: ResolvedKnip;
  /** Where the coverage ratchet files live and what `repo mutate` mutates. */
  readonly coverage: ResolvedCoverage;
  /** The nightly workflow's shard count and secret names. */
  readonly nightly: ResolvedNightly;
  /**
   * Whether a feat or fix in a private package must also fail its tests on HEAD's source; public packages always
   * do.
   */
  readonly tdd: boolean;
  /** Where changes are made and how they reach the default branch: worktree when the config omits `workflow`. */
  readonly workflow: Workflow;
  /** The owner a public package under the release pack is checked against; `repo check` asks for it when missing. */
  readonly owner?: ResolvedOwner | undefined;
  /** The extra turbo tasks of the workspace pack; absent when the config has no `turbo`. */
  readonly turbo?: ResolvedTurbo | undefined;
  /** The `link` section with its defaults filled: no paths, and a push check that blocks. */
  readonly link: {
    /** The checkouts `repo link` takes a package from instead of a sibling, by package name. */
    readonly paths: Readonly<Record<string, string>>;
    /** "block" refuses a push while a public package uses a linked one; "allow" warns and lets it go. */
    readonly push: LinkPush;
  };
  /** What `repo clean --build` removes beyond its built-in dirs; absent when the config has no `clean`. */
  readonly clean?:
    | {
        /** Extra dir names removed wherever git ignores them, beside the built-in build dirs. */
        readonly build?: readonly string[] | undefined;
      }
    | undefined;
  /** The commands `repo ci` runs after its own gates. */
  readonly ci: {
    /** Named commands run from the root after the gates, in config order; none when the config has no `ci`. */
    readonly checks: Readonly<Record<string, readonly string[]>>;
  };
};

/** What loading a config gives back: the resolved config, or every problem found, each starting with the file name. */
export type LoadResult =
  | {
      /** True when the config loaded and passed validation. */
      ok: true;
      /** The validated config. */
      config: ResolvedConfig;
    }
  | {
      /** False when the config is missing, unreadable or invalid. */
      ok: false;
      /** One line per problem, naming the key at fault and the fix. */
      errors: string[];
    };
