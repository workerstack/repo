export const CI_PATH: string = ".github/workflows/ci.yml";
export const E2E_SCRIPT: string = "test:e2e";

/** Action pins, each a full commit SHA with its release as the comment. */
const CHECKOUT: string = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1";
export const UPLOAD: string = "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2";
export const DOWNLOAD: string = "actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2";
const SETUP_BUN: string = "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0";

/** Each OS the test job runs on, in matrix order, and its shard count; one shard runs them whole. */
export const TEST_SHARDS: readonly (readonly [string, number])[] = [
  ["ubuntu-latest", 1],
  ["windows-latest", 5],
  ["macos-latest", 3],
];
/** The e2e job's OSes and shards when the `test:e2e` script takes `--shard`; otherwise each OS runs it whole. */
export const E2E_SHARDS: readonly (readonly [string, number])[] = [
  ["ubuntu-latest", 1],
  ["windows-latest", 3],
  ["macos-latest", 1],
];
/** A `test:e2e` script whose command takes `--shard=i/n`: vitest, after `bun --bun` or `bunx`, or `playwright test`. */
export const E2E_SHARDABLE: RegExp = /^(?:(?:bun --bun|bunx)\s+)?(?:vitest|playwright\s+test)(?:\s|$)/;
/** The matrix jobs' name template, which GitHub expands once per row to the OS and its shard. */
export const MATRIX_LABEL: string = "${{ matrix.label }}";

/** The `name:` each CI job is reported under, the status check name a ruleset requires. */
export const TEST_JOB: string = "test";
export const COMMITS_JOB: string = "commits";
export const SKIPS_JOB: string = "skips";
export const NO_NODE_JOB: string = "no-node";
export const E2E_JOB: string = "e2e";
export const CONSUMER_JOB: string = "consumer";
export const TEST_TIMEOUT_MINUTES: number = 30;
export const SLOW_TIMEOUT_MINUTES: number = 40;
export const CONSUMER_TIMEOUT_MINUTES: number = 15;
export const CONSUMER_STEP: string = "      - run: bun repo release consumer";
export const API_STEP: string = "      - run: bun repo release api";

const ROOT_REFUSAL: string = "CI must run as a non-root user; the suite assumes unprivileged file permissions";

/** The workflow text before the jobs: name, triggers, concurrency and permissions. */
export const PREAMBLE: string = `name: ci

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

jobs:`;

/** The shared checkout, bun and install steps; `fetchDepth` adds full history. */
export const SETUP_BUN_STEP: string = `      - uses: ${SETUP_BUN}
        with:
          bun-version-file: package.json`;
export const CHECKOUT_STEP: string = `      - uses: ${CHECKOUT}`;
export const CHECKOUT_FULL_STEP: string = `      - uses: ${CHECKOUT}
        with:
          fetch-depth: 0`;
export const INSTALL_STEP: string = "      - run: bun install --frozen-lockfile";

export const NON_ROOT_STEP: string = `      - name: Refuse to run as root
        if: runner.os != 'Windows'
        run: |
          if [ "$(id -u)" = "0" ]; then echo "${ROOT_REFUSAL}"; exit 1; fi`;

export const MATRIX: string = `    runs-on: \${{ matrix.os }}
    timeout-minutes: %MINUTES%
    strategy:
      fail-fast: false
      matrix:
        include:`;

export const NO_NODE_STEPS: string = `      - name: Remove node
        run: |
          sudo rm -f $(which -a node nodejs)
          sudo rm -rf /opt/hostedtoolcache/node
          hash -r
      - name: Assert node is gone
        run: |
          if command -v node; then echo "node is still on PATH"; exit 1; fi`;

/** The test job's gates step: it runs the row's shard of the tests and writes that shard's skip report. */
export const GATES_STEP: string = `      - name: Run the gates and write the skip report
        shell: bash
        env:
          REPORT: ci-report-\${{ runner.os }}-\${{ strategy.job-index }}.json
          COVERAGE: \${{ runner.os != 'Linux' && '--no-coverage' || '' }}
          SHARD: \${{ matrix.shard && format('--shard {0}', matrix.shard) || '' }}
        run: bun repo ci --report "$REPORT" $COVERAGE $SHARD`;

/** The test job's last step: the shard's skip report is uploaded under its own name, even when a gate failed. */
export const UPLOAD_STEP: string = `      - uses: ${UPLOAD}
        if: always()
        with:
          name: ci-report-\${{ matrix.os }}-\${{ strategy.job-index }}
          path: ci-report-\${{ runner.os }}-\${{ strategy.job-index }}.json
          if-no-files-found: error`;

/** Vitest's flag that lets a shard handed no test file pass; without it vitest throws on more shards than files. */
const VITEST_NO_TESTS: string = "--passWithNoTests";
/**
 * The sharded e2e job's run under vitest: a shard row passes `--shard=i/n` and the no-tests flag, the others
 * nothing.
 */
export const E2E_SHARD_STEP: string = `      - name: Run the e2e tests
        env:
          SHARD: \${{ matrix.shard && format('--shard={0} ${VITEST_NO_TESTS}', matrix.shard) || '' }}
        run: bun run ${E2E_SCRIPT} $SHARD`;
/** The same run under `playwright test`, whose no-tests flag is `--pass-with-no-tests`. */
export const E2E_PLAYWRIGHT_SHARD_STEP: string = /* @__PURE__ */ E2E_SHARD_STEP.replace(
  VITEST_NO_TESTS,
  "--pass-with-no-tests",
);
/** A shardable `test:e2e` script that runs `playwright test` rather than vitest. */
export const E2E_PLAYWRIGHT: RegExp = /^(?:(?:bun --bun|bunx)\s+)?playwright\s/;

/** The cache action's pin: a full commit SHA with its release as the comment. */
const CACHE_PIN: string = "55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0";

/** Under the workspace pack, before the gates: the shard's turbo cache of the latest run with this key prefix. */
export const TURBO_RESTORE_STEP: string = `      - uses: actions/cache/restore@${CACHE_PIN}
        with:
          path: .turbo/cache
          key: turbo-\${{ runner.os }}-\${{ strategy.job-index }}-\${{ github.sha }}
          restore-keys: turbo-\${{ runner.os }}-\${{ strategy.job-index }}-`;

/** Under the workspace pack, after the gates: only a run on main saves the shard's cache, even when a gate failed. */
export const TURBO_SAVE_STEP: string = `      - uses: actions/cache/save@${CACHE_PIN}
        if: always() && github.ref == 'refs/heads/main'
        with:
          path: .turbo/cache
          key: turbo-\${{ runner.os }}-\${{ strategy.job-index }}-\${{ github.sha }}`;

/** Before the gates: the typecheck's incremental build info of the OS's latest run, whose key starts the same. */
export const TSBUILDINFO_RESTORE_STEP: string = `      - uses: actions/cache/restore@${CACHE_PIN}
        with:
          path: .tmp/repo/tsbuildinfo
          key: tsbuildinfo-\${{ runner.os }}-\${{ github.sha }}
          restore-keys: tsbuildinfo-\${{ runner.os }}-`;

/** After the gates: only a run on main saves the build info, even when a gate failed. */
export const TSBUILDINFO_SAVE_STEP: string = `      - uses: actions/cache/save@${CACHE_PIN}
        if: always() && github.ref == 'refs/heads/main'
        with:
          path: .tmp/repo/tsbuildinfo
          key: tsbuildinfo-\${{ runner.os }}-\${{ github.sha }}`;

/** The step that checks every commit of the push or pull request; an empty BASE leaves HEAD alone to be checked. */
export const COMMITS_STEP: string = `      - name: Check every pushed commit
        env:
          BASE: \${{ github.event.pull_request.base.sha || github.event.before }}
        run: bun repo commit-msg --range "$BASE..HEAD"`;

/** The skips job's steps after the install: the per-OS reports are downloaded into one directory and compared. */
export const SKIPS_STEPS: string = `      - uses: ${DOWNLOAD}
        with:
          pattern: ci-report-*
          merge-multiple: true
          path: reports
      - run: bun repo ci skips reports`;
