import { describe, expect, it } from "vitest";

import { HEADER, context } from "../fixtures/release-context.ts";
import { GENERATORS } from "./outputs.ts";
import { release } from "./release.ts";
import type { PackageJson } from "./workspace.ts";

const CI_PATH = ".github/workflows/ci.yml";
const CHECKOUT = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1";
const SETUP_BUN = "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0";
const CACHE = "actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0";
const BUN_CACHE = `      - name: Find bun's install cache
        id: bun-cache
        shell: bash
        run: echo "dir=$(bun pm cache)" >> "$GITHUB_OUTPUT"
      - uses: ${CACHE}
        with:
          path: \${{ steps.bun-cache.outputs.dir }}
          key: bun-\${{ runner.os }}-\${{ hashFiles('bun.lock') }}
      - run: bun install --frozen-lockfile
`;
const E2E_MATRIX_SHARDED = `          - { os: windows-latest, shard: 1/2, label: windows-latest 1/2 }
          - { os: windows-latest, shard: 2/2, label: windows-latest 2/2 }
`;
const E2E_RUN_SHARDED = `      - name: Run the e2e tests
        env:
          SHARD: \${{ matrix.shard && format('--shard={0}', matrix.shard) || '' }}
        run: bun run test:e2e $SHARD
`;
const E2E_JOB = `      - run: bun run test:e2e

  e2e:
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
${BUN_CACHE}${E2E_RUN_SHARDED}`;
const UNSHARDED_JOB = E2E_JOB.replace(
  E2E_MATRIX_SHARDED,
  '          - { os: windows-latest, shard: "", label: windows-latest }\n',
).replace(E2E_RUN_SHARDED, "      - run: bun run test:e2e\n");

const yaml = (manifest: PackageJson = {}) => {
  const [output] = release(context(["release"], manifest)).outputs;
  return output?.kind === "file" ? output.content : "";
};
const e2e = (script: string) => yaml({ scripts: { "test:e2e": script } });
const job = (ci: string, name: string, next: string) => ci.slice(ci.indexOf(`  ${name}:`), ci.indexOf(`  ${next}:`));

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
  it.each([
    "vitest",
    "bun --bun vitest run -c vitest.e2e.config.ts",
    "bunx vitest run",
    "playwright test",
    "  bunx playwright test --project=chromium",
  ])("runs Windows in 2 shards and the other OSes whole for the script %j", (script) => {
    expect(e2e(script).endsWith(E2E_JOB)).toBe(true);
  });

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
  it("the test and e2e jobs restore bun's install cache before the install; the single jobs do not", () => {
    const ci = e2e("vitest");
    expect(job(ci, "test", "commits")).toContain(BUN_CACHE);
    expect(ci.slice(ci.indexOf("  e2e:"))).toContain(BUN_CACHE);
    expect(ci.split(BUN_CACHE)).toHaveLength(3);
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
