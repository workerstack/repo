import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useGitTree } from "./__fixtures__/git-tree.ts";
import { checkEnvValues } from "./check-env-values.ts";

const { repoWith } = useGitTree("check-env-values-");

const FILE = "projects/anyrow/env.ts";
const IMPORT = 'import { defineEnv, sealed } from "@workerstack/repo/env";\n';
const SEAL_HINT = 'seal it: sealed("<base64 of `age -r <recipient in .repo/env.keys.json>`>")';
// A stand-in age cipher: base64 that starts as age's header does.
const CIPHER = btoa("age-encryption.org/v1 fake cipher");

/** A defineEnv file: `before` between the import and the call, `blocks` inside the call. */
function envFile(blocks: string, before = ""): string {
  return `${IMPORT}${before}\nexport const repoEnv = defineEnv({\n${blocks}\n});\n`;
}

/** The lines `repo check` prints for one file at `FILE`. */
function linesFor(content: string, rel = FILE): string[] {
  return checkEnvValues(repoWith({ [rel]: content }));
}

/** A block of scopes where only `prod` holds `KEY: <value>`. */
function prodValue(value: string): string {
  return `local: {}, dev: {}, prod: { KEY: ${JSON.stringify(value)} },`;
}

/** The process-read line for TOKEN, whichever read form it names. */
const UNDECLARED = new RegExp(
  `^env: ${FILE} reads .*TOKEN but its process block does not declare it; add \`TOKEN: "optional"\`$`,
  "u",
);

describe("checkEnvValues, plaintext secrets", () => {
  it("fails a plain value with a secret prefix, naming the prefix and the fix", () => {
    const stripe = ["sk", "live", "FAKEFAKEFAKE0000"].join("_");
    const blocks = `local: {}, dev: {}, prod: { STRIPE_SECRET_KEY: ${JSON.stringify(stripe)} },`;
    expect(linesFor(envFile(blocks))).toStrictEqual([
      `env: ${FILE} prod.STRIPE_SECRET_KEY looks like a secret (sk_ prefix) but is plain; ${SEAL_HINT}`,
    ]);
  });

  it.each(["sk_", "ghp_", "github_pat_", "npm_", "cfat_", "cfk_", "AIza", "whsec_", "sk-ant-", "GOCSPX-"])(
    "fails a plain value that starts %s",
    (prefix) => {
      expect(linesFor(envFile(prodValue(`${prefix}fakevalue`)))).toStrictEqual([
        `env: ${FILE} prod.KEY looks like a secret (${prefix} prefix) but is plain; ${SEAL_HINT}`,
      ]);
    },
  );

  it("fails a plain secret in the global block", () => {
    const blocks = `global: { NPM_TOKEN: ${JSON.stringify(`npm_${"fake".repeat(4)}`)} }, local: {}, dev: {}, prod: {},`;
    expect(linesFor(envFile(blocks))).toStrictEqual([
      `env: ${FILE} global.NPM_TOKEN looks like a secret (npm_ prefix) but is plain; ${SEAL_HINT}`,
    ]);
  });

  it("fails a plain value of high entropy", () => {
    const random = ["aB3dE5fG", "7hJ9kL2m", "N4pQ6rS8", "tV0wX1yZ"].join("");
    const [line] = linesFor(envFile(prodValue(random)));
    expect(line).toMatch(new RegExp(`^env: ${FILE} prod\\.KEY looks like a secret \\(.+\\) but is plain; `, "u"));
    expect(line?.endsWith(SEAL_HINT)).toBe(true);
  });
});

describe("checkEnvValues, plain values that are not secrets", () => {
  it("passes a sealed value", () => {
    const blocks = `local: {}, dev: {}, prod: { STRIPE_SECRET_KEY: sealed(${JSON.stringify(CIPHER)}) },`;
    expect(linesFor(envFile(blocks))).toStrictEqual([]);
  });

  it.each([
    ["a hex id", "0123456789abcdef".repeat(2)],
    ["a UUID", "123e4567-e89b-12d3-a456-426614174000"],
    ["a URL", "https://api.example.com/v1/hooks?region=eu"],
    ["a domain", "anyrow.example.com"],
    ["a short word", "production"],
  ])("passes %s", (_label, value) => {
    expect(linesFor(envFile(prodValue(value)))).toStrictEqual([]);
  });
});

describe("checkEnvValues, keys one scope lacks", () => {
  it.each(["APEX_DOMAIN", '"APEX_DOMAIN"'])("fails a key the dev block has as %s and the prod block lacks", (key) => {
    const blocks = `local: {}, dev: { ${key}: "dev.example.com", SITE: "dev" }, prod: { SITE: "prod" },`;
    expect(linesFor(envFile(blocks))).toStrictEqual([
      `env: ${FILE} prod.APEX_DOMAIN is missing (dev has it); add it to prod or remove it from dev`,
    ]);
  });

  it("skips a block with a spread", () => {
    const blocks = 'local: {}, dev: { ...base, APEX_DOMAIN: "dev.example.com" }, prod: { SITE: "prod" },';
    expect(linesFor(envFile(blocks, 'const base = { SITE: "dev" };\n'))).toStrictEqual([]);
  });

  it("passes scopes that hold the same keys", () => {
    const blocks = 'local: { SITE: "local" }, dev: { SITE: "dev" }, prod: { SITE: "prod" },';
    expect(linesFor(envFile(blocks))).toStrictEqual([]);
  });
});

const PROCESS_BLOCKS = 'local: {}, dev: {}, prod: {}, process: { HOME: "required" },';

describe("checkEnvValues, process reads", () => {
  it("fails process.env.X the process block does not declare", () => {
    expect(linesFor(envFile(PROCESS_BLOCKS, "export const token = process.env.TOKEN;\n"))).toStrictEqual([
      `env: ${FILE} reads process.env.TOKEN but its process block does not declare it; add \`TOKEN: "optional"\``,
    ]);
  });

  it.each([
    ["process.env[name]", 'export const token = process.env["TOKEN"];\n'],
    ["Bun.env", "export const token = Bun.env.TOKEN;\n"],
    ["import.meta.env", "export const token = import.meta.env.TOKEN;\n"],
    ["a destructure of process.env", "export const { TOKEN } = process.env;\n"],
    ["env from process", 'import { env } from "process";\nexport const token = env.TOKEN;\n'],
    ["env from node:process", 'import { env } from "node:process";\nexport const token = env.TOKEN;\n'],
    ["env from cloudflare:workers", 'import { env } from "cloudflare:workers";\nexport const token = env.TOKEN;\n'],
  ])("fails an undeclared read through %s", (_label, around) => {
    const lines = linesFor(envFile(PROCESS_BLOCKS, around));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(UNDECLARED);
  });
});

describe("checkEnvValues, process reads that pass", () => {
  it("passes a read the process block declares", () => {
    expect(linesFor(envFile(PROCESS_BLOCKS, "export const home = process.env.HOME;\n"))).toStrictEqual([]);
  });

  it("passes a whole-object read, which names no key", () => {
    expect(linesFor(envFile(PROCESS_BLOCKS, "export const all = { ...process.env };\n"))).toStrictEqual([]);
  });

  it("passes a read in a file that does not call defineEnv", () => {
    expect(linesFor("export const token = process.env.TOKEN;\n", "projects/anyrow/other.ts")).toStrictEqual([]);
  });
});

describe("checkEnvValues, files it skips", () => {
  const leak = envFile(prodValue(`ghp_${"fake".repeat(4)}`));

  it("skips a test file", () => {
    expect(linesFor(leak, "projects/anyrow/env.test.ts")).toStrictEqual([]);
  });

  it("skips a file under __fixtures__", () => {
    expect(linesFor(leak, "projects/anyrow/__fixtures__/env.ts")).toStrictEqual([]);
  });

  it("skips a listed file deleted from the working tree", () => {
    const cwd = repoWith({ [FILE]: leak });
    fs.rmSync(path.join(cwd, FILE));
    expect(checkEnvValues(cwd)).toStrictEqual([]);
  });

  it("scans a defineEnv file of any name", () => {
    expect(linesFor(leak, "projects/anyrow/repo.script-env.ts")).toHaveLength(1);
  });
});

describe("checkEnvValues, the key forms it reads", () => {
  it("skips a block with a computed key, as it does a spread", () => {
    const blocks = 'local: {}, dev: { [name]: "dev.example.com" }, prod: { SITE: "prod" },';
    expect(linesFor(envFile(blocks, 'const name = "SITE";\n'))).toStrictEqual([]);
  });

  it("skips a scope block held in a variable", () => {
    const blocks = 'local: base, dev: { SITE: "dev" }, prod: { SITE: "prod" },';
    expect(linesFor(envFile(blocks, 'const base = { APEX_DOMAIN: "local.example.com" };\n'))).toStrictEqual([]);
  });
});

describe("checkEnvValues, the read forms it reads", () => {
  it("fails a renamed destructure of process.env", () => {
    const lines = linesFor(envFile(PROCESS_BLOCKS, 'export const { "TOKEN": token } = process.env;\n'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(UNDECLARED);
  });

  it("passes a rest destructure of process.env, which names no key", () => {
    expect(linesFor(envFile(PROCESS_BLOCKS, "export const { ...all } = process.env;\n"))).toStrictEqual([]);
  });

  it("passes reads of an env that is not the process's", () => {
    const around = [
      'import proc from "node:process";',
      'import * as all from "process";',
      'import { argv } from "node:process";',
      'const config = { env: { TOKEN: "t" } };',
      "export const { TOKEN } = config.env;",
      "export const used = [proc, all, argv, config.env.TOKEN];",
      "",
    ].join("\n");
    expect(linesFor(envFile(PROCESS_BLOCKS, around))).toStrictEqual([]);
  });
});

/** The lines for one `prod` value under `key`. */
function linesForKey(key: string, value: string): string[] {
  return linesFor(envFile(`local: {}, dev: {}, prod: { ${key}: ${JSON.stringify(value)} },`));
}

/** The line a plain `prod.<key>` value flagged for `reason` prints. */
function secretLine(key: string, reason: string): string {
  return `env: ${FILE} prod.${key} looks like a secret (${reason}) but is plain; ${SEAL_HINT}`;
}

// Shapes measured on real sealed values (3.2); each value here is synthetic.
const ENTROPY = ["high entropy"];
const NAMED = ["credential name"];
const NONE: string[] = [];

describe("checkEnvValues, secret shapes measured on real values", () => {
  it.each([
    ["EDIT_CODE", "aB3dE5fG7hJ9kLaB3dE5fG", ENTROPY], // a 22-character mixed-case code of 3.7 bits
    ["CLIENT_VALUE", "Qx8~Lm2.Rt5-Vw9~Kp3.Zn7-Hy4~Bd6.Fs1-Jc0~", ENTROPY], // an OAuth client secret with . ~ -
    ["BOT", "123456789:AAHf3kLm9Qx2Rt5Vw8Zn1Bd4Fs7Jc0Py6", ENTROPY], // a bot token of digits, a colon and base64url
    ["RECEIVER_TOKEN", "0123456789abcdef".repeat(4), NAMED], // a hex token
    ["HASHNODE_TOKEN", "123e4567-e89b-12d3-a456-426614174000", NAMED], // a UUID token
    ["ADMIN_TOTP_SECRET", "JBSWY3DPEHPK3PXP".repeat(2), NAMED], // a base32 TOTP secret
    ["ACCESS_TOKEN", "aB3$dE5%fG7)hJ9^kL2mN4pQ6rS8tV0wX1yZ", NAMED], // a password with symbols
    ["TESTER_KEY", "0123456789abcdef".repeat(4), NAMED], // a hex key
    ["ADMIN_USER_ID", "user_2abc9def8ghi7jkl6mno5pqr4", NONE], // a single-case id of high entropy
    ["HOOK", "https://Api.Example.com/V1/Hooks/Ab12Cd34", NONE], // a mixed-case URL
    ["API_TOKEN_URL", "https://api.example.com/v1/token", NONE], // a URL under a credential name
    ["BUILD", "Ab1".repeat(8), NONE], // a mixed-case repeat of low entropy
    ["SECRET_VERSION", "v2", NONE], // a short value under a credential name
    ["PASSWORD_HINT", "the name of 1 pet dog", NONE], // a phrase under a credential name
    ["TOKEN_TTL", "1234567890123456", NONE], // digits only under a credential name
    ["STRIPE_PUBLISHABLE_KEY", "pk_live_51AbCdEfGhIjKlMn0123", NONE], // a live Stripe publishable key
    ["STRIPE_PUBLISHABLE_KEY", "pk_test_51AbCdEfGhIjKlMn0123", NONE], // a test Stripe publishable key
  ])("flags %s = %s as %j", (key, value, reasons) => {
    expect(linesForKey(key, value)).toStrictEqual(reasons.map((reason) => secretLine(key, reason)));
  });
});
