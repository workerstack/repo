import type { Host, LintSkip, Pack, SkillPack } from "./config.ts";
import type { KnipIgnoreEntry } from "./knip-schema.ts";

/** What workerstack.config.ts default-exports, as `defineConfig` takes it; config.ts checks its schema against it. */
export type WorkerstackConfig = {
  packs?: readonly Pack[] | undefined;
  agents?: { hosts?: readonly Host[] | undefined; skills?: readonly SkillPack[] | undefined } | undefined;
  commit?: { maxChangedLines?: number | undefined } | undefined;
  coverage?:
    | {
        floors?: string | undefined;
        knownFailures?: string | undefined;
        mutate?: readonly string[] | undefined;
        mutationFloors?: string | undefined;
      }
    | undefined;
  nightly?: { shards?: number | undefined; secrets?: readonly string[] | undefined } | undefined;
  tdd?: boolean | undefined;
  owner?: { name: string; github: string } | undefined;
  lint?: { skip?: readonly LintSkip[] | undefined } | undefined;
  knip?: { ignore?: readonly KnipIgnoreEntry[] | undefined } | undefined;
};
