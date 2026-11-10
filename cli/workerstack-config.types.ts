import type { Host, LintSkip, Pack, SkillPack } from "./config.ts";
import type { KnipIgnoreEntry } from "./knip-schema.ts";

/** What workerstack.config.ts default-exports, as `defineConfig` takes it; config.ts checks its schema against it. */
export type WorkerstackConfig = {
  /** The packs to turn on; omit it for agents, standards and docs. */
  packs?: readonly Pack[] | undefined;
  /** Which agent trees `repo sync` generates. */
  agents?:
    | {
        /** The hosts to generate for; omit it for every host. */
        hosts?: readonly Host[] | undefined;
        /** The optional skill packs to ship; omit it for none. */
        skills?: readonly SkillPack[] | undefined;
      }
    | undefined;
  /** Limits the commit-msg hook holds a commit to. */
  commit?:
    | {
        /** The most lines one commit may change before the hook refuses it. */
        maxChangedLines?: number | undefined;
      }
    | undefined;
  /** Where the ratchet files live and what `repo mutate` mutates. */
  coverage?:
    | {
        /** The coverage floors file, relative to the repo root. */
        floors?: string | undefined;
        /** The list of `it.fails` cases a test run tolerates, relative to the repo root. */
        knownFailures?: string | undefined;
        /** Globs of the tracked files `repo mutate` mutates. */
        mutate?: readonly string[] | undefined;
        /** The mutation score floors file, relative to the repo root. */
        mutationFloors?: string | undefined;
      }
    | undefined;
  /** The nightly workflow, written under the release pack. */
  nightly?:
    | {
        /** How many parallel shards the nightly mutation run is split into. */
        shards?: number | undefined;
        /** Names of the repo secrets the nightly live-test job receives as environment variables. */
        secrets?: readonly string[] | undefined;
      }
    | undefined;
  /** Whether a feat or fix in a private package must also fail its tests on the old source; public packages always do. */
  tdd?: boolean | undefined;
  /** Who a public package names as its author, LICENSE holder and code owner. */
  owner?:
    | {
        /** The owner's name, as it should read in package.json and LICENSE. */
        name: string;
        /** The owner's GitHub login, which CODEOWNERS names. */
        github: string;
      }
    | undefined;
  /** Reasoned exceptions to lint rules. */
  lint?:
    | {
        /** The exceptions: each turns named rules off for named files, with a reason. */
        skip?: readonly LintSkip[] | undefined;
      }
    | undefined;
  /** Sanctioned knip ignores. */
  knip?:
    | {
        /** The files, dependencies and binaries knip is not to report, each with the reason it cannot see the use. */
        ignore?: readonly KnipIgnoreEntry[] | undefined;
      }
    | undefined;
};
