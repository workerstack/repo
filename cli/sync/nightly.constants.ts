import { CI_HEADER, DOWNLOAD, UPLOAD } from "./release.constants.ts";

/** The generated header, which must be the first line of a nightly.yml sync owns. */
export const NIGHTLY_HEADER: string = CI_HEADER;
export const NIGHTLY_PATH: string = ".github/workflows/nightly.yml";
export const LIVE_SCRIPT: string = "test:live";
/** A mutation shard runs about 30 to 40 minutes on 8 shards; one shard is the whole run. */
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

/** The mutate job's steps after the install; `%TOTAL%` is the shard count. */
export const MUTATE_STEPS: string = `      - name: Mutate this shard
        env:
          SHARD: \${{ matrix.shard }}
        run: bun repo mutate --shard "$SHARD/%TOTAL%" --report "${REPORT_PREFIX}$SHARD.json"
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
