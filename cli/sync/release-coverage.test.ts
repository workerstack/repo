import { describe, expect, it } from "vitest";

import { context, job } from "../__fixtures__/release-context.ts";
import type { Pack } from "../config.ts";
import { ciJobNames, release } from "./release.ts";
import type { PackageJson } from "./workspace.ts";

const DOWNLOAD = "actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2";
const UPLOAD = "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2";
const CHECKOUT = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1";
const SETUP_BUN = "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0";

const BLOB_STEP = `      - uses: ${UPLOAD}
        if: runner.os == 'Linux'
        with:
          name: blob-\${{ strategy.job-index }}
          path: .repo/tmp/blob/
          if-no-files-found: error
`;

const COVERAGE_JOB = `  coverage:
    name: coverage
    needs: test
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: ${CHECKOUT}
      - uses: ${SETUP_BUN}
        with:
          bun-version-file: package.json
      - run: bun install --frozen-lockfile
      - uses: ${DOWNLOAD}
        with:
          pattern: blob-*
          merge-multiple: true
          path: blobs
      - run: bun repo ci merge blobs
`;

const UBUNTU_SHARDED = `          - { os: ubuntu-latest, shard: 1/2, label: ubuntu-latest 1/2 }
          - { os: ubuntu-latest, shard: 2/2, label: ubuntu-latest 2/2 }
`;

const UBUNTU_WHOLE = '          - { os: ubuntu-latest, shard: "", label: ubuntu-latest }\n';

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

const AFTER_BUN = `          bun-version-file: package.json\n${NODE_STEPS}`;

const VITEST_DEV: PackageJson = { devDependencies: { vitest: "^5.1.0" } };
const VITEST_PROD: PackageJson = { dependencies: { vitest: "^5.1.0" } };
const CARGO = { "Cargo.toml": "[package]\n" };

function text(manifest: PackageJson, packs: Pack[] = ["release"], files: Record<string, string> = {}) {
  const [output] = release(context(packs, manifest, files)).outputs;

  return output?.kind === "file" ? output.content : "";
}

const NAMES = [
  "test (ubuntu-latest 1/2)",
  "test (ubuntu-latest 2/2)",
  "test (windows-latest 1/6)",
  "test (windows-latest 2/6)",
  "test (windows-latest 3/6)",
  "test (windows-latest 4/6)",
  "test (windows-latest 5/6)",
  "test (windows-latest 6/6)",
  "test (macos-latest 1/3)",
  "test (macos-latest 2/3)",
  "test (macos-latest 3/3)",
  "commits",
  "skips",
  "coverage",
];

describe("a repo that shards coverage: vitest in the root, no workspace pack, no Rust", () => {
  it.each([VITEST_DEV, VITEST_PROD])("runs Ubuntu in 2 shards for the manifest %j", (manifest) => {
    expect(job(text(manifest), "test")).toContain(UBUNTU_SHARDED);
    expect(job(text(manifest), "test")).not.toContain(UBUNTU_WHOLE);
  });

  it("uploads the blob from Linux rows after the skip report and adds the coverage job right after skips", () => {
    const ci = text(VITEST_DEV);
    const test = job(ci, "test");
    expect(test.endsWith(BLOB_STEP)).toBe(true);
    expect(test.indexOf(BLOB_STEP)).toBeGreaterThan(test.indexOf("name: ci-report-"));
    expect(ci).toContain(`bun repo ci skips reports\n\n${COVERAGE_JOB}`);
    expect(ci.split(COVERAGE_JOB)).toHaveLength(2);
  });

  it("lists the two Ubuntu rows and the coverage job after skips in ciJobNames", () => {
    expect(ciJobNames(context(["release"], VITEST_DEV))).toStrictEqual(NAMES);
  });
});

const SINGLE: [string, PackageJson, Pack[], Record<string, string>][] = [
  ["the workspace pack", VITEST_DEV, ["release", "workspace"], {}],
  ["Rust", VITEST_DEV, ["release"], CARGO],
  ["no vitest dependency", { dependencies: { other: "1" }, devDependencies: {} }, ["release"], {}],
  ["no dependencies", {}, ["release"], {}],
];

it.each(SINGLE)("a repo with %s keeps one whole Ubuntu row, no blob upload and no coverage job", (_, ...args) => {
  const [manifest, packs, files] = args;
  const ci = text(manifest, packs, files);
  const names = ciJobNames(context(packs, manifest, files));
  expect(job(ci, "test")).toContain(UBUNTU_WHOLE);
  expect(ci).not.toContain("blob-");
  expect(ci).not.toContain("  coverage:");
  expect(names).not.toContain("coverage");
  expect(names).toContain("test (ubuntu-latest)");
});

describe("node removal", () => {
  it("has no no-node job for any repo", () => {
    for (const ci of [text({}), text(VITEST_DEV), text({}, ["release"], CARGO), text({ scripts: { "test:e2e": "x" } })])
      expect(ci).not.toContain("no-node");
    expect(ciJobNames(context(["release"]))).not.toContain("no-node");
  });

  it("removes node on Linux right after setup-bun in the test job and the e2e job", () => {
    const ci = text({ scripts: { "test:e2e": "vitest" } });
    expect(job(ci, "test")).toContain(AFTER_BUN);
    expect(job(ci, "e2e")).toContain(AFTER_BUN);
    expect(ci.split("Remove node")).toHaveLength(3);
  });
});
