import { describe, expect, it } from "vitest";

import { useGitTree } from "./__fixtures__/git-tree.ts";
import { checkEnvValues } from "./check-env-values.ts";

const { repoWith } = useGitTree("check-env-values-config-");

const FILE = "projects/anyrow/env.ts";
const IMPORT = 'import { defineEnv } from "@workerstack/repo/env";\n';
const SEAL_HINT = 'seal it: sealed("<base64 of `age -r <recipient in .repo/env.keys.json>`>")';

/** The lines `repo check` prints for one file at `FILE`. */
function linesFor(content: string): string[] {
  return checkEnvValues(repoWith({ [FILE]: content }));
}

/** A defineEnv file whose config is `const config = <init>`, passed to the call by name. */
function constEnvFile(init: string): string {
  return `${IMPORT}\nconst config = ${init};\nexport const repoEnv = defineEnv(config);\nprocess.env.TOKEN;\n`;
}

const NPM_TOKEN = JSON.stringify(`npm_${"fake".repeat(4)}`);
const CONFIG_BLOCKS = `{ local: {}, dev: { SITE: "dev" }, prod: { KEY: ${NPM_TOKEN} }, process: {} }`;

describe("checkEnvValues, a config held in a same-file const", () => {
  it.each([
    ["a plain const", CONFIG_BLOCKS],
    ["as const", `${CONFIG_BLOCKS} as const`],
    ["satisfies", `${CONFIG_BLOCKS} satisfies EnvConfig`],
    ["parentheses", `(${CONFIG_BLOCKS} as const) satisfies EnvConfig`],
  ])("applies every rule through %s", (_form, init) => {
    expect(linesFor(constEnvFile(init))).toStrictEqual([
      `env: ${FILE} prod.KEY looks like a secret (npm_ prefix) but is plain; ${SEAL_HINT}`,
      `env: ${FILE} dev.KEY is missing (prod has it); add it to dev or remove it from prod`,
      `env: ${FILE} prod.SITE is missing (dev has it); add it to prod or remove it from dev`,
      `env: ${FILE} reads process.env.TOKEN but its process block does not declare it; add \`TOKEN: "optional"\``,
    ]);
  });

  it("reads the process block of the const", () => {
    expect(linesFor(constEnvFile('{ local: {}, dev: {}, prod: {}, process: { TOKEN: "optional" } }'))).toStrictEqual(
      [],
    );
  });

  it("skips an identifier no same-file const holds", () => {
    const file = `${IMPORT}import { config } from "./config.ts";\nexport const repoEnv = defineEnv(config);\n`;
    expect(linesFor(file)).toStrictEqual([]);
  });

  it("skips a const that holds no object literal", () => {
    expect(linesFor(constEnvFile("makeConfig()"))).toHaveLength(1);
  });
});
