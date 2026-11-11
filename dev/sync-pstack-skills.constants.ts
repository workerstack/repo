/** The upstream pstack source, its files, flags and the skills this repo ports. */
export const DEFAULT_REPO = "backnotprop/pstack";
export const DEFAULT_REF = "main";

export const CHECK_FLAG = "--check";
export const NO_GENERATE_FLAG = "--no-generate";
export const REF_FLAG = "--ref";
export const REPO_FLAG = "--repo";
const SKILL_FLAG = "--skill";
export const VALUE_FLAGS: readonly string[] = [REF_FLAG, REPO_FLAG, SKILL_FLAG];

export const SKILL_REL = "SKILL.md";
export const PATTERNS_REL = "references/patterns.md";
export const FENCE = "---";
export const TYPESCRIPT_SKILL = "typescript-best-practices";
export const BRO_SKILL = "bro";
export const PRINCIPLE_PREFIX = "principle-";
export const TEACH_NOT_EXPLAIN = " Not `/explain` (that is a longer recap of this session's work).";
/** Frontmatter keys upstream sets that this repo does not keep. */
export const DROP_FM: readonly string[] = ["disable-model-invocation", "paths"];

/** What a synced file did: matched the SSOT, differs under `--check`, or was written. */
export type Status = "ok" | "drift" | "write";
export const STATUS_OK: Status = "ok";
export const STATUS_DRIFT: Status = "drift";
export const STATUS_WRITE: Status = "write";

export const PRINCIPLE_SKILL_NAMES: readonly string[] = [
  "principle-attack-the-premise",
  "principle-boundary-discipline",
  "principle-build-the-lever",
  "principle-encode-lessons-in-structure",
  "principle-exhaust-the-design-space",
  "principle-experience-first",
  "principle-explain-the-number",
  "principle-fix-root-causes",
  "principle-foundational-thinking",
  "principle-guard-the-context-window",
  "principle-laziness-protocol",
  "principle-make-operations-idempotent",
  "principle-migrate-callers-then-delete-legacy-apis",
  "principle-minimize-reader-load",
  "principle-model-the-domain",
  "principle-never-block-on-the-human",
  "principle-outcome-oriented-execution",
  "principle-prove-it-works",
  "principle-redesign-from-first-principles",
  "principle-separate-before-serializing-shared-state",
  "principle-sequence-verifiable-units",
  "principle-subtract-before-you-add",
  "principle-test-behavior-not-implementation",
  "principle-type-system-discipline",
];

/** One ported pstack skill: its files, and whether it is a slash command. */
export type PstackSkill = {
  name: string;
  files: string[];
  slash: boolean;
};

export const PSTACK_SKILLS: readonly PstackSkill[] = [
  { files: [SKILL_REL], name: "blast-radius", slash: true },
  { files: [SKILL_REL], name: "bro", slash: true },
  { files: [SKILL_REL], name: "correct", slash: true },
  { files: [SKILL_REL], name: "teach", slash: true },
  { files: [SKILL_REL, PATTERNS_REL], name: TYPESCRIPT_SKILL, slash: false },
  { files: [SKILL_REL], name: "unslop", slash: true },
  .../* @__PURE__ */ PRINCIPLE_SKILL_NAMES.map((name) => ({ files: [SKILL_REL], name, slash: true })),
];

/** The status of a successful fetch response. */
export const HTTP_OK = 200;
/** Where the first argument is on a script's command line, after the runtime and the script. */
export const ARGV_START = 2;
/** The slice end that drops the last character of a quoted scalar. */
export const QUOTE_END = -1;
