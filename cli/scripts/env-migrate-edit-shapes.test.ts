/**
 * The shapes of a createScriptEnv file env-migrate-edit.ts's `migrateSource` reads (its signature is spelled out in
 * env-migrate-edit.test.ts): a quoted key, a config `as const` or `satisfies` a type, a call with type arguments, the
 * package imported as a namespace, by a subpath or by a relative path, a default import beside the old names, and an
 * annotated binding. A name the file binds to a secret() refuses like a secret() of one. Every value is a fake.
 */
import { describe, expect, it } from "vitest";

import { fakeSecret, IMPORT, IMPORT_SEALED } from "../__fixtures__/env-repo.ts";
import { editOptions, standInSeal as seal } from "../__fixtures__/script-env/edit-kit.ts";
import { OLD_IMPORT, scriptEnvFile } from "../__fixtures__/script-env/tree.ts";
import { migrateSource } from "./env-migrate-edit.ts";

const SCOPES = ["  local: {},", "  dev: {},"];
const PLAIN = '  prod: { APEX_DOMAIN: "shop.example" },';

function migrated(text: string, extra: Parameters<typeof editOptions>[0] = {}): ReturnType<typeof migrateSource> {
  return migrateSource(text, editOptions(extra));
}

describe("migrateSource, keys", () => {
  it("reads a quoted key without its quotes, so the detector flags it and its count names it", async () => {
    const value = fakeSecret();
    const got = await migrated(scriptEnvFile([...SCOPES, `  prod: { "MAIL_API_KEY": "${value}" },`]));
    expect(got.text).toContain(`  prod: { "MAIL_API_KEY": sealed("${await seal(value)}") },\n`);
    expect(got.counts.credentials).toStrictEqual(["MAIL_API_KEY"]);
  });

  it("names a computed key by its source", async () => {
    const got = await migrated(scriptEnvFile([...SCOPES, '  prod: { [KEY]: "plain" },']));
    expect(got.counts).toMatchObject({ plain: 1, values: 1 });
  });
});

describe("migrateSource, wrapped configs", () => {
  it.each([["as const"], ["satisfies ScriptEnvConfig"]])("migrates a config `%s`", async (wrap) => {
    const value = fakeSecret();
    const config = `({ local: {}, dev: {}, prod: { T: secret("${value}") } }) ${wrap}`;
    const text = `${OLD_IMPORT}\nexport const e = createScriptEnv(${config});\n`;
    const got = await migrated(text);
    const sealed = `sealed("${await seal(value)}")`;
    expect(got.text).toBe(
      `${IMPORT_SEALED}\nexport const e = defineEnv(({ local: {}, dev: {}, prod: { T: ${sealed} } }) ${wrap});\n`,
    );
    expect(got.counts.secrets).toBe(1);
  });

  it("drops a call's type arguments and its binding's old annotation", async () => {
    const head = 'import { createScriptEnv, type ScriptEnv } from "@acme/script-env";\n';

    const got = await migrated(
      scriptEnvFile([...SCOPES, PLAIN], { call: "createScriptEnv<Cfg>", head, name: "e: ScriptEnv" }),
    );

    const after = `import { type ScriptEnv } from "@acme/script-env";\n${IMPORT}`;
    expect(got.text).toBe(scriptEnvFile([...SCOPES, PLAIN], { call: "defineEnv", head: after, name: "e" }));
  });
});

describe("migrateSource, how the package is imported", () => {
  it("follows a namespace import, dropping it once nothing else reads it", async () => {
    const value = fakeSecret();
    const head = 'import * as se from "@acme/script-env";\n';

    const got = await migrated(
      scriptEnvFile([...SCOPES, `  prod: { T: se.secret("${value}") },`], { call: "se.createScriptEnv", head }),
    );

    const after = scriptEnvFile([...SCOPES, `  prod: { T: sealed("${await seal(value)}") },`], {
      call: "defineEnv",
      head: IMPORT_SEALED,
    });

    expect(got.text).toBe(after);
  });
});

describe("migrateSource, a namespace still read", () => {
  it("keeps a namespace import another line still reads", async () => {
    const head = 'import * as se from "@acme/script-env";\n';
    const tail = "export type Shop = se.ScriptEnv;\n";
    const got = await migrated(`${scriptEnvFile([...SCOPES, PLAIN], { call: "se.createScriptEnv", head })}${tail}`);
    const after = `import * as se from "@acme/script-env";\n${IMPORT}`;
    expect(got.text).toBe(`${scriptEnvFile([...SCOPES, PLAIN], { call: "defineEnv", head: after })}${tail}`);
  });

  it.each([
    ["@acme/script-env/core", "a.ts"],
    ["../packages/script-env/src/index.ts", "tools/a.ts"],
  ])("follows the package imported as %s", async (specifier, file) => {
    const head = `import { createScriptEnv } from "${specifier}";\n`;
    const got = await migrated(scriptEnvFile([...SCOPES, PLAIN], { head }), { file });
    expect(got.text).toBe(scriptEnvFile([...SCOPES, PLAIN], { call: "defineEnv", head: IMPORT }));
  });

  it("keeps a default import beside the old names", async () => {
    const head = 'import se, { createScriptEnv } from "@acme/script-env";\n';
    const got = await migrated(`${scriptEnvFile([...SCOPES, PLAIN], { head })}se;\n`);
    const after = `import se from "@acme/script-env";\n${IMPORT}`;
    expect(got.text).toBe(`${scriptEnvFile([...SCOPES, PLAIN], { call: "defineEnv", head: after })}se;\n`);
  });
});

describe("migrateSource, a name bound to a secret()", () => {
  it.each([["  prod: { T },"], ["  prod: { T: T },"]])("refuses `%s`, its value out of reach", async (prod) => {
    const text = scriptEnvFile([...SCOPES, prod], { head: `${OLD_IMPORT}const T = secret("${fakeSecret()}");\n` });
    await expect(migrated(text)).rejects.toThrow(
      new Error("repo env: a.ts prod.T is secret(<non-literal>); seal it by hand with `bun repo env set`"),
    );
  });
});
