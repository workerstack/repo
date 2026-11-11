import { describe, expect, it } from "vitest";
import { context } from "../fixtures/release-context.ts";
import { type SyncContext } from "./outputs.ts";
import { release } from "./release.ts";
import type { PackageJson } from "./workspace.ts";

const CI_PATH = ".github/workflows/ci.yml";

const CHECKOUT = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1";
const SETUP_BUN = "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0";
const UPLOAD = "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2";
const DOWNLOAD = "actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2";

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
    name: test (\${{ matrix.os }})
    runs-on: \${{ matrix.os }}
    timeout-minutes: 30
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    steps:
      - uses: ${CHECKOUT}
      - uses: ${SETUP_BUN}
        with:
          bun-version-file: package.json
      - name: Refuse to run as root
        if: runner.os != 'Windows'
        run: |
          if [ "$(id -u)" = "0" ]; then echo "CI must run as a non-root user; the suite assumes unprivileged file permissions"; exit 1; fi
      - run: bun install --frozen-lockfile
      - name: Run the gates and write the skip report
        shell: bash
        env:
          REPORT: ci-report-\${{ runner.os }}.json
          COVERAGE: \${{ runner.os != 'Linux' && '--no-coverage' || '' }}
        run: bun repo ci --report "$REPORT" $COVERAGE
      - uses: ${UPLOAD}
        if: always()
        with:
          name: ci-report-\${{ matrix.os }}
          path: ci-report-\${{ runner.os }}.json
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

  no-node:
    name: no-node
    runs-on: ubuntu-latest
    timeout-minutes: 40
    steps:
      - uses: ${CHECKOUT}
      - uses: ${SETUP_BUN}
        with:
          bun-version-file: package.json
      - name: Remove node
        run: |
          sudo rm -f $(which -a node nodejs)
          sudo rm -rf /opt/hostedtoolcache/node
          hash -r
      - name: Assert node is gone
        run: |
          if command -v node; then echo "node is still on PATH"; exit 1; fi
      - run: bun install --frozen-lockfile
      - run: bun repo ci
`;

const NO_NODE_SHALLOW = `    steps:
      - uses: ${CHECKOUT}
      - uses: ${SETUP_BUN}
        with:
          bun-version-file: package.json
      - name: Remove node`;
const NO_NODE_FULL = NO_NODE_SHALLOW.replace(
  `- uses: ${CHECKOUT}`,
  `- uses: ${CHECKOUT}\n        with:\n          fetch-depth: 0`,
);

const E2E_IN_NO_NODE = `      - run: bun run test:e2e
`;

const E2E_JOB = `
  e2e:
    name: e2e (\${{ matrix.os }})
    runs-on: \${{ matrix.os }}
    timeout-minutes: 40
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
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
      - run: bun install --frozen-lockfile
      - run: bun run test:e2e
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

const lookup = (ctx: SyncContext) => release(ctx).outputs[0];

describe("release", () => {
  it("writes the whole tracked ci.yml without an e2e job when the root has no test:e2e script", () => {
    expect(release(context(["release"]))).toStrictEqual({
      outputs: [{ kind: "file", path: CI_PATH, content: HEAD, tracked: true, managed: "whole" }],
      errors: [],
    });
  });

  it("adds the e2e step and job when the root has a test:e2e script", () => {
    const manifest: PackageJson = { scripts: { "test:e2e": "vitest" } };
    expect(lookup(context(["release"], manifest))).toStrictEqual({
      kind: "file",
      path: CI_PATH,
      content: HEAD.replace(NO_NODE_SHALLOW, NO_NODE_FULL) + E2E_IN_NO_NODE + E2E_JOB,
      tracked: true,
      managed: "whole",
    });
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
    const e2e: PackageJson = { name: "pkg", private: false, scripts: { "test:e2e": "vitest" } };
    const output = lookup(context(["release"], e2e));
    expect(output?.kind === "file" && output.content.endsWith(E2E_JOB + CONSUMER_JOB)).toBe(true);
  });

  it("adds no consumer job for a private root, a missing private or a missing name", () => {
    expect(lookup(context(["release"], { name: "pkg", private: true }))).toMatchObject({ content: HEAD });
    expect(lookup(context(["release"], { name: "pkg" }))).toMatchObject({ content: HEAD });
    expect(lookup(context(["release"], { private: false }))).toMatchObject({ content: HEAD });
  });
});
