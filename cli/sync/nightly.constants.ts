import { DOWNLOAD, UPLOAD } from "./release.constants.ts";

export const NIGHTLY_PATH: string = ".github/workflows/nightly.yml";
export const LIVE_SCRIPT: string = "test:live";

/** A mutation shard's limit, under GitHub's 6 hours a job; a repo raises `nightly.shards` until each fits. */
export const MUTATE_TIMEOUT_MINUTES: number = 180;

/** The report a shard writes, named by its number; the floors job downloads them all by the prefix. */
const REPORT_PREFIX: string = "mutation-";
const REPORTS_DIR: string = "reports";

/** The workflow text before the jobs: name, triggers, concurrency and permissions. */
export const PREAMBLE: string = `name: nightly

on:
  schedule:
    - cron: "0 3 * * *"
  workflow_dispatch:

concurrency:
  group: nightly
  cancel-in-progress: false

permissions:
  contents: read

jobs:`;

/**
 * The first lines of a mutate step's script. A mutant that loops while it allocates fills memory long before its
 * timeout, and a full machine loses its runner and the job's log. The step's shell moves into a cgroup capped 2 GiB
 * under the machine's memory, with no swap, so the kernel ends the biggest process in it, the test worker running that
 * mutant, and the run counts the mutant and goes on.
 */
const MEMORY_CAP: string = `          sudo mkdir -p /sys/fs/cgroup/mutate
          awk '/^MemTotal:/ { print $2 - 2097152 "K" }' /proc/meminfo | sudo tee /sys/fs/cgroup/mutate/memory.max
          echo 0 | sudo tee /sys/fs/cgroup/mutate/memory.swap.max
          echo $$ | sudo tee /sys/fs/cgroup/mutate/cgroup.procs`;

/** The mutate job's steps after the install; `%TOTAL%` is the shard count. */
export const MUTATE_STEPS: string = `      - name: Mutate this shard
        env:
          SHARD: \${{ matrix.shard }}
        run: |
${MEMORY_CAP}
          bun repo mutate --shard "$SHARD/%TOTAL%" --report "${REPORT_PREFIX}$SHARD.json"
      - uses: ${UPLOAD}
        if: always()
        with:
          name: ${REPORT_PREFIX}\${{ matrix.shard }}
          path: ${REPORT_PREFIX}\${{ matrix.shard }}.json
          if-no-files-found: error`;

/** The floors job's steps after the install: every shard's report is downloaded into one directory and scored. */
export const FLOORS_STEPS: string = `      - uses: ${DOWNLOAD}
        with:
          pattern: ${REPORT_PREFIX}*
          merge-multiple: true
          path: ${REPORTS_DIR}
      - run: bun repo mutate check ${REPORTS_DIR}`;

/** The mutate-rust job's last steps, after the cargo-mutants install; `%TOTAL%` is the shard count. */
export const MUTATE_RUST_RUN: string = `      - name: Mutate this shard
        env:
          SHARD: \${{ matrix.shard }}
        run: |
${MEMORY_CAP}
          bun repo mutate --rust --shard "$SHARD/%TOTAL%" --report "${REPORT_PREFIX}rust-$SHARD.json"
      - uses: ${UPLOAD}
        if: always()
        with:
          name: ${REPORT_PREFIX}rust-\${{ matrix.shard }}
          path: ${REPORT_PREFIX}rust-\${{ matrix.shard }}.json
          if-no-files-found: error`;
