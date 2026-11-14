// A sync context over in-memory files and the INDEX fixtures the references-index suites share.
import { AGENT_DEFAULTS } from "../../agent-defaults.constants.ts";
import type { Host, Pack } from "../../config.ts";
import { BASE_CONFIG } from "../../__fixtures__/base-config.ts";
import type { Output, SyncContext } from "../outputs.ts";
import { index } from "../outputs.ts";
import { regionHash } from "../region.ts";
import type { PackageJson, WorkspacePackage } from "../workspace.ts";

type Fixture = {
  hosts?: Host[];
  packs?: Pack[];
  manifest?: PackageJson;
  packages?: WorkspacePackage[];
  files?: Record<string, string>;
};

/** A sync context over in-memory files; `read` sees only `files`. */
export function context({
  hosts = [],
  packs = ["agents", "docs"],
  manifest = {},
  packages = [],
  files = {},
}: Fixture = {}): SyncContext {
  return {
    config: {
      agents: { ...AGENT_DEFAULTS, hosts, skills: [] },
      packs,
      ...BASE_CONFIG,
    },
    read: (rel) => files[rel] ?? null,
    root: "/repo",
    workspace: { manifest, packages, root: "/repo" },
  };
}

/** The text of a file output. */
export function contentOf(output: Output | undefined): string | undefined {
  return output?.kind === "file" ? output.content : undefined;
}

export const API: WorkspacePackage = { dir: "packages/api", manifest: { name: "@acme/api" } };
export const WEB: WorkspacePackage = { dir: "apps/web", manifest: { name: "web" } };
export const PACKAGE_INDEXES = {
  "apps/web/references/INDEX.md": "Web app\r\n",
  "packages/api/references/INDEX.md": "\n\n# API worker\n\nMore.\n",
};
/** The markdown region `name` holding `body`, as sync writes it, with no trailing newline. */
export function section(name: string, body: string): string {
  return `<!-- repo:${name} ${regionHash(body)} -->\n${body === "" ? "" : `${body}\n`}<!-- /repo:${name} -->`;
}
export const PACKAGES_SECTION = section(
  "packages",
  "- [web](../apps/web/references/INDEX.md): Web app\n- [@acme/api](../packages/api/references/INDEX.md): API worker",
);
export const REPO_STACK = section("stack", "- [@workerstack/repo](../node_modules/@workerstack/repo/references/INDEX.md)");
export const EMPTY_STACK = section("stack", "");
export const EMPTY_DEPS = section("deps", "");
/** The repairs the index generator reports on `rel`. */
export function repairsOf(ctx: SyncContext, rel: string) {
  const found = index(ctx).outputs.find((output) => output.path === rel);
  return found?.kind === "file" ? found.repairs : undefined;
}
