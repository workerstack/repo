import type { Host, Pack, SkillPack } from "./config.ts";
import type { ResolvedCoverage } from "./coverage-config.ts";
import type { ResolvedKnip } from "./knip-schema.ts";
import type { ResolvedNightly } from "./nightly-config.ts";
import type { ResolvedOwner } from "./owner-config.ts";
import type { ResolvedTurbo } from "./turbo-config.ts";

/** The agent setup a config resolves to. */
export type ResolvedAgents = {
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
/** What the generated oxlint config and `repo check` read from `lint`. */
export type ResolvedLint = {
  /** The reasoned exceptions to lint rules; empty when the config lists none. */
  readonly skip: readonly LintSkip[];
};
/** A validated workerstack.config.ts with every omitted value filled in, as the `repo` commands read it. */
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
  /** Whether a feat or fix in a private package must also fail its tests on HEAD's source; public packages always do. */
  readonly tdd: boolean;
  /** The owner a public package under the release pack is checked against; `repo check` asks for it when missing. */
  readonly owner?: ResolvedOwner | undefined;
  /** The extra turbo tasks of the workspace pack; absent when the config has no `turbo`. */
  readonly turbo?: ResolvedTurbo | undefined;
  /** The checkouts `repo link` takes a package from instead of a sibling, by package name; absent when the config has no `link`. */
  readonly link?: Readonly<Record<string, string>> | undefined;
  /** What `repo clean --build` removes beyond its built-in dirs; absent when the config has no `clean`. */
  readonly clean?:
    | {
        /** Extra dir names removed wherever git ignores them, beside the built-in build dirs. */
        readonly build?: readonly string[] | undefined;
      }
    | undefined;
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
