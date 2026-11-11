import { describe, expect, it } from "vitest";

import { HEADER, context } from "../fixtures/release-context.ts";
import { GENERATORS } from "./outputs.ts";
import { release } from "./release.ts";
import type { PackageJson } from "./workspace.ts";

const CI_PATH = ".github/workflows/ci.yml";
const CHECKOUT = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1";
const SETUP_BUN = "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0";
const INSTALL = "      - run: bun install --frozen-lockfile\n";
const E2E_MATRIX_SHARDED = `          - { os: windows-latest, shard: 1/3, label: windows-latest 1/3 }
          - { os: windows-latest, shard: 2/3, label: windows-latest 2/3 }
          - { os: windows-latest, shard: 3/3, label: windows-latest 3/3 }
`;
const E2E_RUN_SHARDED = `      - name: Run the e2e tests
        env:
          SHARD: \${{ matrix.shard && format('--shard={0} --passWithNoTests', matrix.shard) || '' }}
        run: bun run test:e2e $SHARD
`;
const PLAYWRIGHT_RUN_SHARDED = E2E_RUN_SHARDED.replace("--passWithNoTests", "--pass-with-no-tests");
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
const E2E_JOB = `  e2e:
    name: e2e (\${{ matrix.label }})
    runs-on: \${{ matrix.os }}
    timeout-minutes: 40
    strategy:
      fail-fast: false
      matrix:
        include:
          - { os: ubuntu-latest, shard: "", label: ubuntu-latest }
${E2E_MATRIX_SHARDED}          - { os: macos-latest, shard: "", label: macos-latest }
    defaults:
      run:
        shell: bash
    steps:
      - uses: ${CHECKOUT}
        with:
          fetch-depth: 0
      - uses: ${SETUP_BUN}
        with:
          bun-version-file: package.json
${NODE_STEPS}${INSTALL}${E2E_RUN_SHARDED}`;
const UNSHARDED_JOB = E2E_JOB.replace(
  E2E_MATRIX_SHARDED,
  '          - { os: windows-latest, shard: "", label: windows-latest }\n',
).replace(E2E_RUN_SHARDED, "      - run: bun run test:e2e\n");

function yaml(manifest: PackageJson = {}) {
  const [output] = release(context(["release"], manifest)).outputs;
  return output?.kind === "file" ? output.content : "";
}
function e2e(script: string) {
  return yaml({ scripts: { "test:e2e": script } });
}
function job(ci: string, name: string, next: string) {
  return ci.slice(ci.indexOf(`  ${name}:`), ci.indexOf(`  ${next}:`));
}

describe("release gates", () => {
  it("is a generator", () => {
    expect(GENERATORS).toContain(release);
  });

  it("writes nothing with the pack off", () => {
    expect(release(context(["agents", "standards", "docs"]))).toStrictEqual({ errors: [], outputs: [] });
  });

  it("rewrites a ci.yml that has the generated header on its first line", () => {
    const result = release(context(["release"], {}, { [CI_PATH]: `${HEADER}\nname: old\n` }));
    expect(result.errors).toStrictEqual([]);
    expect(result.outputs).toHaveLength(1);
  });

  it("refuses a hand-written ci.yml", () => {
    expect(release(context(["release"], {}, { [CI_PATH]: "name: ci\n" }))).toStrictEqual({
      errors: [".github/workflows/ci.yml is hand-written; delete it so repo sync can own it"],
      outputs: [],
    });
  });
});

describe("release e2e job", () => {
  it.each(["vitest", "bun --bun vitest run -c vitest.e2e.config.ts", "bunx vitest run"])(
    "runs Windows in 3 shards, an empty one passing via --passWithNoTests, and other OSes whole, for the script %j",
    (script) => {
      expect(e2e(script).endsWith(E2E_JOB)).toBe(true);
    },
  );

  it.each(["playwright test", "  bunx playwright test --project=chromium"])(
    "runs Windows in 3 shards, an empty one passing via --pass-with-no-tests, and other OSes whole, for the script %j",
    (script) => {
      expect(e2e(script).endsWith(E2E_JOB.replace(E2E_RUN_SHARDED, PLAYWRIGHT_RUN_SHARDED))).toBe(true);
    },
  );

  it.each(["tsx e2e.ts", "playwright", "bun run e2e.ts", "bunx", "bun --bun", "vitest-e2e run"])(
    "runs one job per OS for the script %j, which takes no --shard",
    (script) => {
      expect(e2e(script).endsWith(UNSHARDED_JOB)).toBe(true);
    },
  );

  it("puts the consumer job right after the e2e job", () => {
    expect(yaml({ name: "pkg", private: false, scripts: { "test:e2e": "vitest" } })).toContain(
      `${E2E_RUN_SHARDED}\n  consumer:\n`,
    );
  });
});

describe("release caches", () => {
  it("the test and e2e jobs carry no bun install cache step", () => {
    const ci = e2e("vitest");
    expect(ci).not.toContain("Find bun's install cache");
    expect(ci).not.toContain("bun-cache");
    expect(ci).not.toContain("bun pm cache");
    expect(ci).not.toContain("key: bun-");
  });

  it("the tsbuildinfo is restored from the OS's latest run before the gates and saved after them only on main", () => {
    const test = job(yaml(), "test", "commits");
    const gates = test.indexOf("bun repo ci --report");
    const restore = test.indexOf("restore-keys: tsbuildinfo-${{ runner.os }}-\n");
    const save = test.indexOf(
      "if: always() && github.ref == 'refs/heads/main'\n        with:\n          path: .tmp/repo",
    );
    expect([restore > test.indexOf("bun install"), restore < gates, save > gates]).toStrictEqual([true, true, true]);
    expect(yaml().split(".tmp/repo/tsbuildinfo")).toHaveLength(3);
  });
});
