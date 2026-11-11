import { describe, expect, it } from "vitest";

import { HEADER, context } from "../fixtures/release-context.ts";
import { GENERATORS } from "./outputs.ts";
import { releaseWorkflow } from "./release-workflow.ts";

const PATH = ".github/workflows/release.yml";
const CHECKOUT = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1";
const SETUP_BUN = "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0";
const SETUP_NODE = "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0";
const PUBLIC = { name: "@acme/app", private: false };

const EXPECTED = `name: release

on:
  push:
    tags:
      - "@acme/app@*"
  workflow_dispatch:
    inputs:
      tag:
        description: "Existing tag to release, e.g. @acme/app@1.0.0"
        required: true

concurrency:
  group: release-\${{ inputs.tag || github.ref_name }}
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  gate:
    name: gate
    runs-on: ubuntu-latest
    timeout-minutes: 60
    permissions:
      actions: read
      contents: read
    env:
      TAG: \${{ inputs.tag || github.ref_name }}
      GH_TOKEN: \${{ github.token }}
    steps:
      - uses: ${CHECKOUT}
        with:
          ref: \${{ inputs.tag || github.ref }}
          fetch-depth: 0
      - uses: ${SETUP_BUN}
        with:
          bun-version-file: package.json
      - run: bun install --frozen-lockfile
      - run: bun repo release gate "$TAG"

  publish:
    name: publish
    needs: gate
    runs-on: ubuntu-latest
    timeout-minutes: 25
    permissions:
      contents: read
      id-token: write
    env:
      TAG: \${{ inputs.tag || github.ref_name }}
    steps:
      - uses: ${CHECKOUT}
        with:
          ref: \${{ inputs.tag || github.ref }}
      - uses: ${SETUP_BUN}
        with:
          bun-version-file: package.json
      - run: bun install --frozen-lockfile
      - uses: ${SETUP_NODE}
        with:
          node-version: "24"
          package-manager-cache: false
      - run: npm install --global npm@12.2.2
      - run: bun repo release publish "$TAG"

  github:
    name: github
    needs: publish
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: write
    env:
      TAG: \${{ inputs.tag || github.ref_name }}
      GH_TOKEN: \${{ github.token }}
    steps:
      - uses: ${CHECKOUT}
        with:
          ref: \${{ inputs.tag || github.ref }}
      - uses: ${SETUP_BUN}
        with:
          bun-version-file: package.json
      - run: bun install --frozen-lockfile
      - run: bun repo release github "$TAG"
`;

const generated = (): string => {
  const output = releaseWorkflow(context(["release"], PUBLIC)).outputs[0];
  return output?.kind === "file" ? output.content : "";
};

/** The text of the job `name`, from its heading to the next job's. */
const job = (name: string): string => {
  const rest = generated().split(`\n  ${name}:\n`)[1] ?? "";
  return rest.split(/\n  [a-z]+:\n/)[0] ?? "";
};

describe("release workflow", () => {
  it("is a generator", () => {
    expect(GENERATORS).toContain(releaseWorkflow);
  });

  it("writes the whole release.yml for a public root package", () => {
    expect(releaseWorkflow(context(["release"], PUBLIC))).toStrictEqual({
      errors: [],
      outputs: [{ content: EXPECTED, kind: "file", managed: "whole", path: PATH, tracked: true }],
    });
  });

  it.each([
    ["a private root", { name: "@acme/app", private: true }],
    ["a root that does not say it is public", { name: "@acme/app" }],
    ["a root with no name", { private: false }],
  ])("writes nothing for %s", (_, manifest) => {
    expect(releaseWorkflow(context(["release"], manifest))).toStrictEqual({ errors: [], outputs: [] });
  });

  it("writes nothing with the pack off", () => {
    expect(releaseWorkflow(context(["agents", "standards", "docs"], PUBLIC))).toStrictEqual({
      errors: [],
      outputs: [],
    });
  });
});

describe("release workflow owns its file", () => {
  it("rewrites a release.yml that has the generated header on its first line", () => {
    const result = releaseWorkflow(context(["release"], PUBLIC, { [PATH]: `${HEADER}\nname: old\n` }));
    expect(result.errors).toStrictEqual([]);
    expect(result.outputs).toHaveLength(1);
  });

  it("refuses a hand-written release.yml", () => {
    expect(releaseWorkflow(context(["release"], PUBLIC, { [PATH]: "name: Release\n" }))).toStrictEqual({
      errors: [".github/workflows/release.yml is hand-written; delete it so repo sync can own it"],
      outputs: [],
    });
  });
});

describe("release workflow safety", () => {
  it.each(["gate", "publish", "github"])("checks out the tag in the %s job", (name) => {
    expect(job(name)).toContain("ref: ${{ inputs.tag || github.ref }}");
  });

  it("gives gh the token in the gate and github jobs", () => {
    expect(job("gate")).toContain("GH_TOKEN: ${{ github.token }}");
    expect(job("github")).toContain("GH_TOKEN: ${{ github.token }}");
  });

  it("holds no npm token anywhere", () => {
    expect(generated()).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|secrets\./);
  });
});

describe("release workflow publishing", () => {
  it("grants id-token: write to the publish job only", () => {
    expect(generated().match(/id-token: write/g)).toHaveLength(1);
    expect(job("publish")).toContain("id-token: write");
  });

  it("pins every action to a 40-character sha", () => {
    const uses = generated().match(/uses: .*/g) ?? [];
    expect(uses).toHaveLength(7);
    for (const line of uses) expect(line).toMatch(/^uses: [\w./-]+@[0-9a-f]{40} # v\d/);
  });
});

describe("release workflow triggers", () => {
  it("runs only on the tag and by hand", () => {
    const on = generated().split("\njobs:")[0]?.split("\non:\n")[1]?.split("\n\nconcurrency")[0] ?? "";
    expect(on.match(/^ {2}\w+:/gm)).toStrictEqual(["  push:", "  workflow_dispatch:"]);
  });

  it("runs the release commands through bun repo, never a root repo.ts", () => {
    expect(generated().match(/bun repo release \w+/g)).toStrictEqual([
      "bun repo release gate",
      "bun repo release publish",
      "bun repo release github",
    ]);
  });
});
