import { describe, expect, it } from "vitest";

import { context } from "../__fixtures__/release-context.ts";
import { nightly } from "./nightly.ts";
import type { SyncContext } from "./outputs.ts";
import type { PackageJson } from "./workspace.ts";

/** The nightly.yml text for `shards`, `secrets` and a root manifest with or without `test:live`. */
function render(shards: number, secrets: string[] = [], { live = false }: { live?: boolean } = {}): string {
  const base = context(["release"], live ? { scripts: { "test:live": "vitest run -c live.config.ts" } } : {});
  const ctx: SyncContext = { ...base, config: { ...base.config, nightly: { secrets, shards } } };
  const [output] = nightly(ctx).outputs;

  if (output?.kind !== "file") throw new Error("no nightly.yml");

  return output.content;
}

function liveJob(text: string) {
  return text.slice(text.indexOf("  live:"));
}

describe("nightly jobs", () => {
  it("fans the mutate job out over every shard of the config", () => {
    const text = render(8);
    expect(text).toContain("name: mutate (${{ matrix.shard }}/8)");
    expect(text).toContain("shard: [1, 2, 3, 4, 5, 6, 7, 8]");
    expect(text).toContain(
      'cgroup.procs\n          bun repo mutate --shard "$SHARD/8" --report "mutation-$SHARD.json"\n',
    );
  });

  it("names each upload by its shard and downloads by the same prefix", () => {
    const text = render(3);
    expect(text).toContain("name: mutation-${{ matrix.shard }}\n          path: mutation-${{ matrix.shard }}.json");
    expect(text).toContain("pattern: mutation-*\n          merge-multiple: true");
  });
});

const NODE_CONFIG = { "vitest.node.config.ts": "export default {};\n" };
const DEV: PackageJson = { devEngines: { runtime: { name: "node", version: ">=22.12.0" } } };
const SETUP_NODE = "uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0\n        with:\n";

function synced(manifest: PackageJson, files: Record<string, string>) {
  return nightly(context(["release"], manifest, files));
}

/** The nightly.yml text from `manifest` and `files`. */
function syncedText(manifest: PackageJson, files: Record<string, string>): string {
  const [output] = synced(manifest, files).outputs;

  return output?.kind === "file" ? output.content : "";
}

function mutateJob(manifest: PackageJson, files: Record<string, string>) {
  const text = syncedText(manifest, files);

  return text.slice(text.indexOf("  mutate:"), text.indexOf("  mutate-floors:"));
}

describe("nightly mutate job on node", () => {
  it("sets up the devEngines node after bun when the repo holds a node config", () => {
    const job = mutateJob(DEV, NODE_CONFIG);
    expect(job).toContain(`bun-version-file: package.json\n      - ${SETUP_NODE}          node-version: ">=22.12.0"\n`);
  });

  it("sets up the engines.node range before the devEngines one", () => {
    expect(mutateJob({ ...DEV, engines: { node: ">=24" } }, NODE_CONFIG)).toContain('node-version: ">=24"');
  });

  it("sets up no node without a node config, nor in the floors job", () => {
    expect(mutateJob(DEV, {})).not.toContain("setup-node");
    const text = syncedText(DEV, NODE_CONFIG);
    expect(text.slice(text.indexOf("  mutate-floors:"))).not.toContain("setup-node");
  });

  it("leaves engines.node ranges that differ across packages to release's refusal, adding no step", () => {
    const base = context(["release"], { engines: { node: ">=24" } }, NODE_CONFIG);
    const packages = [{ dir: "a", manifest: { engines: { node: ">=22" } } }];
    const differing = nightly({ ...base, workspace: { ...base.workspace, packages } });
    const [output] = differing.outputs;
    expect(differing.errors).toStrictEqual([]);
    expect(output?.kind === "file" ? output.content : "").not.toContain("setup-node");
  });

  it("leaves a node config with no range to release's refusal, adding no step and no error of its own", () => {
    expect(synced({}, NODE_CONFIG).errors).toStrictEqual([]);
    expect(mutateJob({}, NODE_CONFIG)).not.toContain("setup-node");
  });
});

describe("nightly live job", () => {
  it("has no live job without a test:live script, secrets or not", () => {
    expect(render(1)).not.toContain("live");
    expect(render(1, ["API_TOKEN"])).not.toContain("live");
  });

  it("adds a live job with a 40-minute limit that runs test:live", () => {
    const job = liveJob(render(1, [], { live: true }));
    expect(job).toContain("timeout-minutes: 40");
    expect(job).toContain("      - run: bun run test:live\n");
    expect(job).not.toContain("env:");
    expect(job).not.toContain("needs:");
  });

  it("maps each secret by name in the live job's env, never inside run", () => {
    const job = liveJob(render(1, ["API_TOKEN", "OTHER_KEY"], { live: true }));
    expect(job).toContain(
      "    env:\n      API_TOKEN: ${{ secrets.API_TOKEN }}\n      OTHER_KEY: ${{ secrets.OTHER_KEY }}\n",
    );
    expect(job).not.toMatch(/run:.*secrets/);
  });

  it("never triggers on a push or a pull request", () => {
    expect(render(1)).not.toMatch(/push|pull_request/);
  });

  it("pins every action to a full commit SHA", () => {
    const uses = render(2, [], { live: true }).match(/uses: \S+/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);

    for (const line of uses) expect(line).toMatch(/@[0-9a-f]{40}$/);
  });
});

const STRYKER = {
  devDependencies: { "@stryker-mutator/core": "10.1.1", "@stryker-mutator/vitest-runner": "10.1.1" },
};

/** The nightly.yml text for a repo with `manifest` and, when `rust`, a root Cargo.toml. */
function renderRepo({ rust }: { rust: boolean }, manifest: PackageJson = {}, shards = 2): string {
  const base = context(["release"], manifest, rust ? { "Cargo.toml": "[workspace]\n" } : {});
  const ctx: SyncContext = { ...base, config: { ...base.config, nightly: { secrets: [], shards } } };
  const [output] = nightly(ctx).outputs;

  if (output?.kind !== "file") throw new Error("no nightly.yml");

  return output.content;
}

describe("nightly mutate-rust job", () => {
  it("gives a Rust-only repo mutate-rust shards and no Stryker job", () => {
    const text = renderRepo({ rust: true });
    expect(text).toContain("  mutate-rust:\n    name: mutate-rust (${{ matrix.shard }}/2)\n    runs-on: ubuntu-latest");
    expect(text).toContain("timeout-minutes: 180");
    expect(text).toContain("shard: [1, 2]");
    expect(text).toContain("cargo-mutants@27.1.0");
    expect(text).toContain(
      `cgroup.procs\n          bun repo mutate --rust --shard "$SHARD/2" --report "mutation-rust-$SHARD.json"\n`,
    );
    expect(text).toContain(
      "name: mutation-rust-${{ matrix.shard }}\n          path: mutation-rust-${{ matrix.shard }}.json",
    );
    expect(text).toContain("if-no-files-found: error");
    expect(text).not.toContain("  mutate:\n");
    expect(text).toContain("    needs: mutate-rust\n");
    expect(text).toContain("pattern: mutation-*");
  });
});

describe("nightly mutate jobs by repo kind", () => {
  it("keeps both jobs for a Rust repo with Stryker, and floors needs both", () => {
    const text = renderRepo({ rust: true }, STRYKER);
    expect(text).toContain("  mutate:\n");
    expect(text).toContain("  mutate-rust:\n");
    expect(text).toContain("    needs: [mutate, mutate-rust]\n");
  });

  it("leaves a non-Rust repo with only the Stryker job, Stryker installed or not", () => {
    for (const manifest of [{}, STRYKER]) {
      const text = renderRepo({ rust: false }, manifest);
      expect(text).toContain("  mutate:\n");
      expect(text).toContain("    needs: mutate\n");
      expect(text).not.toContain("mutate-rust");
      expect(text).not.toContain("cargo");
    }
  });
});
