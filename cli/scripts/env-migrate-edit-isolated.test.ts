/**
 * env-migrate-edit.ts's `migrateSource` (its signature is spelled out in env-migrate-edit.test.ts) where the nearest
 * tsconfig sets isolatedDeclarations: a call one statement binds with an inline config splits into
 * `const <binding>Config = {…} as const;` (a suffix when the name is taken) and the binding, `let` or `const` as it
 * was, typed `EnvInstance<typeof <binding>Config>`; a seal is cast `as Sealed`, a `parent` to its own type, and a
 * spread in a block refuses. Every value is a fake.
 */
import { describe, expect, it } from "vitest";

import { fakeSecret, IMPORT } from "../__fixtures__/env-repo.ts";
import { editOptions } from "../__fixtures__/script-env/edit-kit.ts";
import { OLD_IMPORT } from "../__fixtures__/script-env/tree.ts";
import { migrateSource } from "./env-migrate-edit.ts";

const IMPORT_TYPED = 'import { defineEnv, type EnvInstance } from "@workerstack/repo/env";\n';
const CONFIG = "{ local: {}, dev: {}, prod: {} }";

function isolated(text: string): ReturnType<typeof migrateSource> {
  return migrateSource(text, editOptions({ file: "projects/a.ts", isolated: true }));
}

describe("migrateSource, isolated, two calls", () => {
  it("names each config after its binding and casts the parent to its own type", async () => {
    const before = [
      OLD_IMPORT,
      `const base = createScriptEnv(${CONFIG});`,
      `export const e = createScriptEnv({ parent: base, local: {}, dev: {}, prod: {} }) satisfies object;`,
      "",
    ].join("\n");

    const after = [
      IMPORT_TYPED,
      `const baseConfig = ${CONFIG} as const;`,
      "const base: EnvInstance<typeof baseConfig> = defineEnv(baseConfig);",
      "const eConfig = { parent: base as typeof base, local: {}, dev: {}, prod: {} } as const;",
      "export const e: EnvInstance<typeof eConfig> = defineEnv(eConfig);",
      "",
    ].join("\n");

    const got = await isolated(before);
    expect(got.text).toBe(after);
  });
});

describe("migrateSource, isolated, the binding", () => {
  it("keeps `let`, takes the next free config name, and puts EnvInstance in place of the old annotation", async () => {
    const before = `${OLD_IMPORT}\nconst eConfig = 1;\nexport let e: ScriptEnv = createScriptEnv(${CONFIG});\n`;

    const after = [
      `${IMPORT_TYPED}\nconst eConfig = 1;`,
      `const eConfig2 = ${CONFIG} as const;`,
      "export let e: EnvInstance<typeof eConfig2> = defineEnv(eConfig2);",
      "",
    ].join("\n");

    const got = await isolated(before);
    expect(got.text).toBe(after);
  });

  it("renames the call alone when its config is not written inline", async () => {
    const got = await isolated(`${OLD_IMPORT}\nexport const e = createScriptEnv(base);\n`);
    expect(got.text).toBe(`${IMPORT}\nexport const e = defineEnv(base);\n`);
  });
});

describe("migrateSource, isolated, refusals", () => {
  it("refuses a spread, naming the file and block", async () => {
    const before = `${OLD_IMPORT}\nexport const e = createScriptEnv({ local: { ...vars() }, dev: {}, prod: {} });\n`;
    await expect(isolated(before)).rejects.toThrow(
      new Error("repo env: projects/a.ts local has a spread; isolatedDeclarations needs each value written out"),
    );
  });

  it("casts each seal to Sealed and imports the type", async () => {
    const config = `{ local: {}, dev: {}, prod: { T: secret("${fakeSecret()}") } }`;
    const before = `${OLD_IMPORT}\nexport const e = createScriptEnv(${config});\n`;
    const got = await isolated(before);
    expect(got.text).toMatch(/^import \{ defineEnv, sealed, type EnvInstance, type Sealed \} from /u);
    expect(got.text).toMatch(/prod: \{ T: sealed\("[^"]+"\) as Sealed \}/u);
  });
});
