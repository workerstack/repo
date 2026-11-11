import { describe, expect, it } from "vitest";

import { context } from "../__fixtures__/release-context.ts";
import { type SyncContext } from "./outputs.ts";
import { release } from "./release.ts";
import type { PackageJson } from "./workspace.ts";

const ROOT_GUARD =
  'if [ "$(id -u)" = "0" ]; then echo "CI must run as a non-root user; ' +
  'the suite assumes unprivileged file permissions"; exit 1; fi';
const CI_PATH = ".github/workflows/ci.yml";

const CHECKOUT = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1";
const SETUP_BUN = "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0";
const UPLOAD = "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2";
const DOWNLOAD = "actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2";
const CACHE = "actions/cache/%@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0";

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

const HEAD = `name: ci

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

concurrency:
  group: ci-\${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  test:
    name: test (\${{ matrix.label }})
    runs-on: \${{ matrix.os }}
    timeout-minutes: 30
    strategy:
      fail-fast: false
      matrix:
        include:
          - { os: ubuntu-latest, shard: "", label: ubuntu-latest }
          - { os: windows-latest, shard: 1/6, label: windows-latest 1/6 }
          - { os: windows-latest, shard: 2/6, label: windows-latest 2/6 }
          - { os: windows-latest, shard: 3/6, label: windows-latest 3/6 }
          - { os: windows-latest, shard: 4/6, label: windows-latest 4/6 }
          - { os: windows-latest, shard: 5/6, label: windows-latest 5/6 }
          - { os: windows-latest, shard: 6/6, label: windows-latest 6/6 }
          - { os: macos-latest, shard: 1/3, label: macos-latest 1/3 }
          - { os: macos-latest, shard: 2/3, label: macos-latest 2/3 }
          - { os: macos-latest, shard: 3/3, label: macos-latest 3/3 }
    steps:
      - uses: ${CHECKOUT}
      - uses: ${SETUP_BUN}
        with:
          bun-version-file: package.json
${NODE_STEPS}      - name: Refuse to run as root
        if: runner.os != 'Windows'
        run: |
          ${ROOT_GUARD}
      - run: bun install --frozen-lockfile
      - uses: ${CACHE.replace("%", "restore")}
        with:
          path: .tmp/repo/tsbuildinfo
          key: tsbuildinfo-\${{ runner.os }}-\${{ github.sha }}
          restore-keys: tsbuildinfo-\${{ runner.os }}-
      - name: Run the gates and write the skip report
        shell: bash
        env:
          REPORT: ci-report-\${{ runner.os }}-\${{ strategy.job-index }}.json
          COVERAGE: \${{ runner.os != 'Linux' && '--no-coverage' || '' }}
          SHARD: \${{ matrix.shard && format('--shard {0}', matrix.shard) || '' }}
        run: bun repo ci --report "$REPORT" $COVERAGE $SHARD
      - uses: ${CACHE.replace("%", "save")}
        if: always() && github.ref == 'refs/heads/main'
        with:
          path: .tmp/repo/tsbuildinfo
          key: tsbuildinfo-\${{ runner.os }}-\${{ github.sha }}
      - uses: ${UPLOAD}
        if: always()
        with:
          name: ci-report-\${{ matrix.os }}-\${{ strategy.job-index }}
          path: ci-report-\${{ runner.os }}-\${{ strategy.job-index }}.json
          if-no-files-found: error

  commits:
    name: commits
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: ${CHECKOUT}
        with:
          fetch-depth: 0
      - uses: ${SETUP_BUN}
        with:
          bun-version-file: package.json
      - run: bun install --frozen-lockfile
      - name: Check every pushed commit
        env:
          BASE: \${{ github.event.pull_request.base.sha || github.event.before }}
        run: bun repo commit-msg --range "$BASE..HEAD"

  skips:
    name: skips
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
          pattern: ci-report-*
          merge-multiple: true
          path: reports
      - run: bun repo ci skips reports
`;

const CONSUMER_JOB = `
  consumer:
    name: consumer
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: ${CHECKOUT}
        with:
          fetch-depth: 0
      - uses: ${SETUP_BUN}
        with:
          bun-version-file: package.json
      - run: bun install --frozen-lockfile
      - run: bun repo release consumer
      - run: bun repo release api
`;

function lookup(ctx: SyncContext) {
  return release(ctx).outputs[0];
}

describe("release", () => {
  it("writes the whole tracked ci.yml without an e2e job when the root has no test:e2e script", () => {
    expect(release(context(["release"]))).toStrictEqual({
      errors: [],
      outputs: [{ content: HEAD, kind: "file", managed: "whole", path: CI_PATH, tracked: true }],
    });
  });

  it("adds the e2e job, which removes node on Linux, when the root has a test:e2e script", () => {
    const manifest: PackageJson = { scripts: { "test:e2e": "vitest" } };
    const output = lookup(context(["release"], manifest));
    const text = output?.kind === "file" ? output.content : "";
    expect(text.startsWith(HEAD)).toBe(true);
    expect(text.slice(text.indexOf("  e2e:"))).toContain(`          bun-version-file: package.json\n${NODE_STEPS}`);
    expect(text).not.toContain("no-node");
  });

  it("ignores a scripts field that is not an object with a test:e2e string", () => {
    expect(lookup(context(["release"], { scripts: "nope" }))).toMatchObject({ content: HEAD });
    expect(lookup(context(["release"], { scripts: { "test:e2e": 1 } }))).toMatchObject({ content: HEAD });
    expect(lookup(context(["release"], { scripts: null }))).toMatchObject({ content: HEAD });
  });

  it("never uses setup-node", () => {
    const manifest: PackageJson = { scripts: { "test:e2e": "vitest" } };
    const output = lookup(context(["release"], manifest));
    expect(output?.kind === "file" && output.content.includes("setup-node")).toBe(false);
  });
});

describe("release consumer job", () => {
  it("adds the consumer job last for a public root with a name", () => {
    const manifest: PackageJson = { name: "pkg", private: false };
    expect(lookup(context(["release"], manifest))).toMatchObject({ content: HEAD + CONSUMER_JOB });
  });

  it("adds no consumer job for a private root, a missing private or a missing name", () => {
    expect(lookup(context(["release"], { name: "pkg", private: true }))).toMatchObject({ content: HEAD });
    expect(lookup(context(["release"], { name: "pkg" }))).toMatchObject({ content: HEAD });
    expect(lookup(context(["release"], { private: false }))).toMatchObject({ content: HEAD });
  });
});
