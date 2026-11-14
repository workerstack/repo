import type { Gated } from "./config-helpers.types.ts";
import type { DEFAULT_PACKS, Pack } from "./config-schema.ts";
import type {
  AgentsConfig,
  CiConfig,
  CleanConfig,
  CommitConfig,
  CoverageConfig,
  KnipConfig,
  LintConfig,
  NightlyConfig,
  OwnerConfig,
  TurboConfig,
} from "./config-sections.types.ts";
import type { Workflow } from "./workflow.ts";

/** One of the packs a config gets when it omits `packs`: agents, standards and docs. */
export type DefaultPack = (typeof DEFAULT_PACKS)[number];

/**
 * What repo.config.ts default-exports. `P` is the packs it turns on; with no argument every section is allowed. Hover
 * any key in the editor for what it does, its values, its default and an example.
 */
export type RepoConfig<P extends Pack = Pack> = {
  /**
   * The feature packs to turn on. `"agents"`: agent rules, skills and hooks. `"standards"`: format, lint, typecheck,
   * the commit hooks and `bun repo check`. `"docs"`: the docs checks. `"release"`: versioning, CHANGELOG, publish
   * and the nightly run. `"workspace"`: turbo for a monorepo. `"benchmark"`: `bun repo bench`. `"evals"`: agent evals.
   *
   * @default ["agents", "standards", "docs"]
   * @example packs: ["agents", "standards", "docs", "release"]
   */
  packs?: readonly P[] | undefined;
  /**
   * What `bun repo sync` writes for coding agents, and how a session runs by default. Needs the `agents` pack.
   *
   * @example agents: { hosts: ["claude", "codex"], skills: ["speak"], defaultApproval: "away" }
   */
  agents?: Gated<P, "agents", AgentsConfig> | undefined;
  /**
   * What the commit-msg hook holds each commit to. Needs the `standards` pack.
   *
   * @example commit: { maxChangedLines: 400 }
   */
  commit?: Gated<P, "commit", CommitConfig> | undefined;
  /**
   * The files that hold the test ratchets, and what `bun repo mutate` changes.
   *
   * @example coverage: { mutate: ["src/**\/*.ts", "lib/**\/*.ts"] }
   */
  coverage?: CoverageConfig | undefined;
  /**
   * The nightly run of mutation testing and live tests. Needs the `release` pack.
   *
   * @example nightly: { shards: 8, secrets: ["CLOUDFLARE_API_TOKEN"] }
   */
  nightly?: Gated<P, "nightly", NightlyConfig> | undefined;
  /**
   * Whether a `feat` or `fix` commit in a private package must also bring a test that fails on the old code, as one
   * in a public package always must. Needs the `standards` pack.
   *
   * @default false
   * @example tdd: true
   */
  tdd?: Gated<P, "tdd", boolean> | undefined;
  /**
   * Where changes are made and how they reach the default branch. `"worktree"`: each change is made in a worktree
   * that `bun repo worktree finish` merges locally, then the default branch is pushed. `"pull-request"`: each change
   * is made in a worktree and lands through a pull request; the default branch is never pushed. `"main"`: commit
   * on the default branch in the main checkout and push.
   *
   * @default "worktree"
   * @example workflow: "pull-request"
   */
  workflow?: Workflow | undefined;
  /**
   * Who a public package names as its author, LICENSE holder and code owner. Without it, public packages have no
   * owner to name.
   *
   * @example owner: { name: "Ada Lovelace", github: "ada" }
   */
  owner?: OwnerConfig | undefined;
  /**
   * Exceptions and extra settings for `bun repo lint`. Needs the `standards` pack.
   *
   * @example lint: { skip: [{ files: ["src/legacy/**"], rules: ["eslint/max-lines"], reason: "split in issue 12" }] }
   */
  lint?: Gated<P, "lint", LintConfig> | undefined;
  /**
   * What the unused-code check may skip. Needs the `standards` pack.
   *
   * @example knip: { ignore: [{ dependency: "turbo", reason: "spawned by path, never imported" }] }
   */
  knip?: Gated<P, "knip", KnipConfig> | undefined;
  /**
   * Extra turbo tasks for a workspace. Needs the `workspace` pack.
   *
   * @example turbo: { tasks: { build: { dependsOn: ["^build"], outputs: ["dist/**"] } } }
   */
  turbo?: Gated<P, "turbo", TurboConfig> | undefined;
  /**
   * Local checkouts `bun repo link` packs a dependency from, by package name, when the checkout is not in a sibling
   * folder. Each path is relative to the repo root.
   *
   * @default {}
   * @example link: { "@acme/ui": "../../acme/ui" }
   */
  link?: Readonly<Record<string, string>> | undefined;
  /**
   * What `bun repo clean --build` removes.
   *
   * @example clean: { build: [".astro", "storybook-static"] }
   */
  clean?: CleanConfig | undefined;
  /**
   * Commands `bun repo ci` runs after its own checks, locally and in every CI test job.
   *
   * @example ci: { checks: { e2e: ["bun", "run", "test:e2e"] } }
   */
  ci?: CiConfig | undefined;
};
