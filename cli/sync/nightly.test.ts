import { describe, expect, it } from "vitest";

import { HEADER, context } from "../fixtures/release-context.ts";
import { nightly } from "./nightly.ts";
import { GENERATORS } from "./outputs.ts";

const PATH = ".github/workflows/nightly.yml";
const CHECKOUT = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1";
const SETUP_BUN = "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0";
const UPLOAD = "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2";
const DOWNLOAD = "actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2";

const ONE_SHARD = `name: nightly

on:
  schedule:
    - cron: "0 3 * * *"
  workflow_dispatch:

concurrency:
  group: nightly
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  mutate:
    name: mutate (\${{ matrix.shard }}/1)
    runs-on: ubuntu-latest
    timeout-minutes: 180
    strategy:
      fail-fast: false
      matrix:
        shard: [1]
    steps:
      - uses: ${CHECKOUT}
      - uses: ${SETUP_BUN}
        with:
          bun-version-file: package.json
      - run: bun install --frozen-lockfile
      - name: Mutate this shard
        env:
          SHARD: \${{ matrix.shard }}
        run: bun repo mutate --shard "$SHARD/1" --report "mutation-$SHARD.json"
      - uses: ${UPLOAD}
        if: always()
        with:
          name: mutation-\${{ matrix.shard }}
          path: mutation-\${{ matrix.shard }}.json
          if-no-files-found: error

  mutate-floors:
    name: mutate-floors
    needs: mutate
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
          pattern: mutation-*
          merge-multiple: true
          path: reports
      - run: bun repo mutate check reports
`;

describe("nightly", () => {
  it("is a generator", () => {
    expect(GENERATORS).toContain(nightly);
  });

  it("writes nothing with the pack off", () => {
    expect(nightly(context(["agents", "standards", "docs"]))).toStrictEqual({ errors: [], outputs: [] });
  });

  it("writes the whole nightly.yml for one shard and no live script", () => {
    expect(nightly(context(["release"]))).toStrictEqual({
      errors: [],
      outputs: [{ content: ONE_SHARD, kind: "file", managed: "whole", path: PATH, tracked: true }],
    });
  });

  it("rewrites a nightly.yml that has the generated header on its first line", () => {
    const result = nightly(context(["release"], {}, { [PATH]: `${HEADER}\nname: old\n` }));
    expect(result.errors).toStrictEqual([]);
    expect(result.outputs).toHaveLength(1);
  });

  it("refuses a hand-written nightly.yml", () => {
    expect(nightly(context(["release"], {}, { [PATH]: "name: nightly\n" }))).toStrictEqual({
      errors: [".github/workflows/nightly.yml is hand-written; delete it so repo sync can own it"],
      outputs: [],
    });
  });
});
