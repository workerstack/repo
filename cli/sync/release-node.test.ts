import { describe, expect, it } from "vitest";

import { context, job } from "../__fixtures__/release-context.ts";
import type { Pack } from "../config.ts";
import type { SyncContext } from "./outputs.ts";
import { release } from "./release.ts";
import type { PackageJson } from "./workspace.ts";

const SETUP_NODE = "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0";

const SETUP_NODE_STEP = `      - uses: ${SETUP_NODE}
        with:
          node-version: ">=22"
`;

const NODE_STEPS = `      - name: Remove node
        if: runner.os == 'Linux'
        run: |
          sudo rm -f $(which -a node nodejs)
          sudo rm -rf /opt/hostedtoolcache/node
          hash -r
      - name: Assert node is gone
        if: runner.os == 'Linux'
        run: |
          if command -v node; then echo "node is still on PATH"; exit 1; fi
`;

const AFTER_BUN = "          bun-version-file: package.json\n";

/** A root with vitest, so Ubuntu shards coverage, and a test:e2e script, so the e2e job is written. */
const BASE: PackageJson = { devDependencies: { vitest: "^5.1.0" }, scripts: { "test:e2e": "vitest" } };

/** `ctx` with its workspace packages set to `packages`, each dir with its engines.node range. */
function withPackages(ctx: SyncContext, packages: Record<string, string>): SyncContext {
  const list = Object.entries(packages).map(([dir, node]) => ({ dir, manifest: { engines: { node }, name: dir } }));

  return { ...ctx, workspace: { ...ctx.workspace, packages: list } };
}

function text(ctx: SyncContext) {
  const [output] = release(ctx).outputs;

  return output?.kind === "file" ? output.content : "";
}

function ranged(packs: Pack[] = ["release"]) {
  return context(packs, { ...BASE, engines: { node: ">=22" } });
}

describe("a repo that declares one engines.node range", () => {
  it("sets up node right after setup-bun in the test, coverage and e2e jobs, removing node in none", () => {
    const ci = text(ranged());

    for (const name of ["test", "coverage", "e2e"]) expect(job(ci, name)).toContain(`${AFTER_BUN}${SETUP_NODE_STEP}`);

    expect(ci).not.toContain("Remove node");
    expect(ci).not.toContain("Assert node is gone");
    expect(ci.split(SETUP_NODE_STEP)).toHaveLength(4);
  });

  it("sets up node when the range is declared only in a workspace package", () => {
    const ci = text(withPackages(context(["release", "workspace"], BASE), { "packages/api": ">=22" }));
    expect(job(ci, "test")).toContain(`${AFTER_BUN}${SETUP_NODE_STEP}`);
    expect(job(ci, "e2e")).toContain(`${AFTER_BUN}${SETUP_NODE_STEP}`);
    expect(ci).not.toContain("Remove node");
  });

  it("sets up node in no job that does not run the tests", () => {
    const ci = text(ranged());
    expect(job(ci, "commits")).not.toContain("setup-node");
    expect(job(ci, "skips")).not.toContain("setup-node");
  });
});

it("keeps removing node and never sets it up when no package declares engines.node", () => {
  const ci = text(withPackages(context(["release"], BASE), {}));
  expect(job(ci, "test")).toContain(`${AFTER_BUN}${NODE_STEPS}`);
  expect(job(ci, "e2e")).toContain(`${AFTER_BUN}${NODE_STEPS}`);
  expect(job(ci, "coverage")).not.toContain("node");
  expect(ci).not.toContain("setup-node");
});

it("refuses to write ci.yml when the root and a workspace package declare different ranges", () => {
  const ctx = withPackages(ranged(["release", "workspace"]), { "packages/api": ">=20" });
  expect(release(ctx)).toStrictEqual({
    errors: ["engines.node differs across packages (. >=22, packages/api >=20); set one range in each"],
    outputs: [],
  });
});
