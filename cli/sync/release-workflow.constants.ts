import { CHECKOUT_STEP, INSTALL_STEP, SETUP_BUN_STEP } from "./release.constants.ts";

export const RELEASE_PATH: string = ".github/workflows/release.yml";

/** Action pin, a full commit SHA with its release as the comment. */
const SETUP_NODE: string = "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0";
/** Trusted publishing needs npm 11.5.1 and Node 22.14; dist-tags under it need npm 11.21. */
const NPM_VERSION: string = "12.2.2";
const NODE_VERSION: string = "24";
export const GATE_TIMEOUT_MINUTES: number = 60;
export const PUBLISH_TIMEOUT_MINUTES: number = 25;
export const GITHUB_TIMEOUT_MINUTES: number = 10;

/** The tag every job works on: the pushed tag, or the one given by hand. */
const TAG_ENV: string = "      TAG: ${{ inputs.tag || github.ref_name }}";
const TOKEN_ENV: string = "      GH_TOKEN: ${{ github.token }}";
const CHECKOUT_REF: string = "          ref: ${{ inputs.tag || github.ref }}";

/** Every job checks out the tag, not the default branch a dispatch runs on. */
export const CHECKOUT_TAG_STEP: string = `${CHECKOUT_STEP}
        with:
${CHECKOUT_REF}`;
export const CHECKOUT_TAG_FULL_STEP: string = `${CHECKOUT_TAG_STEP}
          fetch-depth: 0`;
export const BUN_STEPS: readonly string[] = [SETUP_BUN_STEP, INSTALL_STEP];
export const NODE_STEPS: readonly string[] = [
  `      - uses: ${SETUP_NODE}
        with:
          node-version: "${NODE_VERSION}"
          package-manager-cache: false`,
  `      - run: npm install --global npm@${NPM_VERSION}`,
];
export const GATE_ENV: string = `    env:\n${TAG_ENV}\n${TOKEN_ENV}`;
export const PUBLISH_ENV: string = `    env:\n${TAG_ENV}`;
export const GATE_PERMISSIONS: string = "    permissions:\n      actions: read\n      contents: read";
export const PUBLISH_PERMISSIONS: string = "    permissions:\n      contents: read\n      id-token: write";
export const GITHUB_PERMISSIONS: string = "    permissions:\n      contents: write";

/** The workflow text before the jobs; `%NAME%` is the package name, which the tags are prefixed with. */
export const PREAMBLE: string = `name: release

on:
  push:
    tags:
      - "%NAME%@*"
  workflow_dispatch:
    inputs:
      tag:
        description: "Existing tag to release, e.g. %NAME%@1.0.0"
        required: true

concurrency:
  group: release-\${{ inputs.tag || github.ref_name }}
  cancel-in-progress: false

permissions:
  contents: read

jobs:`;
