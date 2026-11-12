/**
 * The pure transform behind `bun repo env migrate`, env-migrate-edit.ts:
 *
 *   migrateSource(text: string, options: {
 *     file: string;                              // repo-relative, as a refusal names it
 *     isolated: boolean;                         // the nearest tsconfig sets isolatedDeclarations
 *     seal: (value: string) => Promise<string>;  // a value's base64 cipher
 *     packages: { name: string; dir: string }[]; // the packages that define createScriptEnv, by name and folder
 *   }): Promise<{
 *     text: string;                              // the file rewritten; equal to `text` when nothing migrates
 *     counts: {
 *       values: number;                          // keys of the global and scope blocks; a spread is not one
 *       secrets: number;                         // secret("v") turned sealed
 *       credentials: string[];                   // keys of the plain literals secretReason flags, sealed, in order
 *       plain: number;                           // values kept as they are
 *       spreads: Record<string, number>;         // spreads left, by block
 *     };
 *     helpers: { line: number; name: "secretKeysOf" | "unwrapSecrets" }[];  // 1-based line of each call
 *   }>
 *
 * It rejects with the one refusal line, `repo env: <file> <block>.<KEY> is secret(<non-literal>); ...`. The seal
 * here is a stand-in (the sha256 of the value, base64), so a cipher is known without a key; every value is a fake.
 * secretKeysOf(x, s) → x.sealedKeys(s) and unwrapSecrets(x) → x are in env-migrate-edit-helpers.test.ts.
 */
import { describe, expect, it } from "vitest";

import { fakeSecret, IMPORT, IMPORT_SEALED } from "../__fixtures__/env-repo.ts";
import { editOptions, NONE_COUNTED as COUNTED, standInSeal as seal } from "../__fixtures__/script-env/edit-kit.ts";
import { OLD_IMPORT, scriptEnvFile } from "../__fixtures__/script-env/tree.ts";
import { migrateSource } from "./env-migrate-edit.ts";

const NEW = { call: "defineEnv" };
const SCOPES = ["  local: {},", "  dev: {},"];

/** Blocks whose global holds a plain value and `stripe` as STRIPE_SECRET_KEY, and prod a plain value. */
function withStripe(stripe: string): string[] {
  return [
    `  global: { CLOUDFLARE_ACCOUNT_ID: "fake-account", STRIPE_SECRET_KEY: ${stripe} },`,
    ...SCOPES,
    '  prod: { APEX_DOMAIN: "shop.example" },',
  ];
}

/** `line` and then the import of a parent. */
function withParent(line: string): string {
  return `${line}import { repoEnv } from "./repo.ts";\n`;
}

function migrated(text: string, extra: Parameters<typeof editOptions>[0] = {}): ReturnType<typeof migrateSource> {
  return migrateSource(text, editOptions(extra));
}

describe("migrateSource, values sealed", () => {
  it("turns secret() into sealed and the old import into defineEnv's", async () => {
    const value = fakeSecret();
    const got = await migrated(scriptEnvFile([...SCOPES, `  prod: { HOOK_TOKEN: secret("${value}") },`]));

    const after = scriptEnvFile([...SCOPES, `  prod: { HOOK_TOKEN: sealed("${await seal(value)}") },`], {
      ...NEW,
      head: IMPORT_SEALED,
    });

    expect(got).toStrictEqual({ counts: { ...COUNTED, secrets: 1, values: 1 }, helpers: [], text: after });
  });

  it("seals a plain literal the detector flags, naming its key, and keeps the rest plain", async () => {
    const value = fakeSecret();
    const head = 'import { createScriptEnv } from "@acme/script-env";\n';
    const got = await migrated(scriptEnvFile(withStripe(`"${value}"`), { head }));
    const after = scriptEnvFile(withStripe(`sealed("${await seal(value)}")`), { ...NEW, head: IMPORT_SEALED });
    expect(got.text).toBe(after);
    expect(got.counts).toStrictEqual({ ...COUNTED, credentials: ["STRIPE_SECRET_KEY"], plain: 2, values: 3 });
  });
});

describe("migrateSource, values kept", () => {
  it("imports defineEnv alone when nothing is sealed", async () => {
    const blocks = [...SCOPES, '  prod: { APEX_DOMAIN: "shop.example" },'];
    const got = await migrated(scriptEnvFile(blocks));
    expect(got).toStrictEqual({
      counts: { ...COUNTED, plain: 1, values: 1 },
      helpers: [],
      text: scriptEnvFile(blocks, { ...NEW, head: IMPORT }),
    });
  });

  it("keeps a spread and the parent as they are, counting each spread by its block", async () => {
    const blocks = [
      "  parent: repoEnv,",
      '  local: { ...localVars("shop"), PORT: "8787" },',
      "  dev: { ...devVars() },",
      "  prod: {},",
    ];

    const got = await migrated(scriptEnvFile(blocks, { head: withParent(OLD_IMPORT) }));
    expect(got.text).toBe(scriptEnvFile(blocks, { ...NEW, head: withParent(IMPORT) }));
    expect(got.counts).toStrictEqual({ ...COUNTED, plain: 1, spreads: { dev: 1, local: 1 }, values: 1 });
  });
});

describe("migrateSource, imports", () => {
  it("keeps an old name still in use, the new import on the line after it", async () => {
    const blocks = [...SCOPES, '  prod: { APEX_DOMAIN: "shop.example" },'];
    const tail = "export type Shop = ScriptEnv;\n";
    const old = 'import { createScriptEnv, secret, type ScriptEnv } from "@acme/script-env";\n';
    const got = await migrated(`${scriptEnvFile(blocks, { head: old })}${tail}`);
    const head = `import { type ScriptEnv } from "@acme/script-env";\n${IMPORT}`;
    expect(got.text).toBe(`${scriptEnvFile(blocks, { ...NEW, head })}${tail}`);
  });
});

describe("migrateSource, other bytes", () => {
  it("keeps every byte outside the rewritten call, values and imports", async () => {
    const value = fakeSecret();

    const before = [
      "/** The shop's env. */",
      OLD_IMPORT,
      "const PORT = String(8787); // kept",
      "",
      "export const shopEnv = createScriptEnv( {",
      "  // Values every scope shares.",
      `  global: { PORT,   HOOK_TOKEN: secret( "${value}" ) /* hook */ },`,
      "  local: {}, dev: {},",
      "  prod: {} ,",
      "} );",
      "",
      "export default   shopEnv;",
      "",
    ].join("\n");

    const after = before
      .replace(OLD_IMPORT, IMPORT_SEALED)
      .replace("createScriptEnv(", "defineEnv(")
      .replace(`secret( "${value}" )`, `sealed("${await seal(value)}")`);

    const got = await migrated(before);
    expect(got.text).toBe(after);
  });
});

describe("migrateSource, isolatedDeclarations", () => {
  it("declares the config `as const` and types the export where isolatedDeclarations is set", async () => {
    const value = fakeSecret();

    const got = await migrated(scriptEnvFile([...SCOPES, `  prod: { HOOK_TOKEN: secret("${value}") },`]), {
      isolated: true,
    });

    const after = [
      'import { defineEnv, sealed, type EnvInstance, type Sealed } from "@workerstack/repo/env";',
      "",
      "const shopEnvConfig = {",
      ...SCOPES,
      `  prod: { HOOK_TOKEN: sealed("${await seal(value)}") as Sealed },`,
      "} as const;",
      "export const shopEnv: EnvInstance<typeof shopEnvConfig> = defineEnv(shopEnvConfig);",
      "",
    ].join("\n");

    expect(got.text).toBe(after);
  });

  it("renames the call alone where no one declaration binds it, even with isolatedDeclarations set", async () => {
    const call = "createScriptEnv({ local: {}, dev: {}, prod: {} });\n";
    const got = await migrated(`${OLD_IMPORT}\nexport default ${call}`, { isolated: true });
    expect(got.text).toBe(`${IMPORT}\nexport default ${call.replace("createScriptEnv", "defineEnv")}`);
  });
});

describe("migrateSource, refusals and no-ops", () => {
  it("refuses a secret() of anything but a string literal, naming the file, block and key", async () => {
    const text = scriptEnvFile(["  global: { K: secret(process.env.K ?? '') },", ...SCOPES, "  prod: {},"]);
    await expect(migrated(text, { file: "projects/a.ts" })).rejects.toThrow(
      new Error("repo env: projects/a.ts global.K is secret(<non-literal>); seal it by hand with `bun repo env set`"),
    );
  });

  it("leaves a file with nothing to migrate as it is", async () => {
    const text = 'import { defineEnv } from "@workerstack/repo/env";\n\nexport const x = defineEnv({ prod: {} });\n';
    expect(await migrated(text)).toStrictEqual({ counts: COUNTED, helpers: [], text });
  });
});
