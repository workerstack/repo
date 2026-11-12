/**
 * The helper sites env-migrate-edit.ts's `migrateSource` rewrites (its signature is spelled out in
 * env-migrate-edit.test.ts): for names imported from one of `packages`, `secretKeysOf(x, s)` becomes
 * `x.sealedKeys(s)` and `unwrapSecrets(x)` becomes `x`, each reported by the 1-based line of the call. An import left
 * with no name is dropped with its line, and with the blank line after it when it opened the file or its import group.
 */
import { describe, expect, it } from "vitest";

import { editOptions, NONE_COUNTED } from "../__fixtures__/script-env/edit-kit.ts";
import { HELPER_FILE } from "../__fixtures__/script-env/tree.ts";
import { migrateSource } from "./env-migrate-edit.ts";

describe("migrateSource, helper sites", () => {
  it("rewrites secretKeysOf and unwrapSecrets and drops their emptied import", async () => {
    const after = [
      'import { shopEnv } from "./shop.worker-env.ts";',
      "",
      'export const secretKeys = shopEnv.sealedKeys("prod");',
      "export const vars = shopEnv.prod;",
      "",
    ].join("\n");

    expect(await migrateSource(HELPER_FILE, editOptions())).toStrictEqual({
      counts: NONE_COUNTED,
      helpers: [
        { line: 5, name: "secretKeysOf" },
        { line: 6, name: "unwrapSecrets" },
      ],
      text: after,
    });
  });

  it("follows an alias and wraps an argument that needs parentheses", async () => {
    const before = [
      'import { secretKeysOf as keysOf } from "@acme/script-env";',
      "",
      "export const keys = keysOf(envs.shop ?? fallback, scope);",
      "",
    ].join("\n");

    const got = await migrateSource(before, editOptions());
    expect(got.text).toBe("export const keys = (envs.shop ?? fallback).sealedKeys(scope);\n");
    expect(got.helpers).toStrictEqual([{ line: 3, name: "secretKeysOf" }]);
  });
});

describe("migrateSource, helper imports in a group", () => {
  it("drops an emptied import inside a group with its line alone, and keeps each name still used", async () => {
    const before = [
      'import { shopEnv } from "./shop.worker-env.ts";',
      'import { unwrapSecrets } from "@acme/script-env";',
      'import { secretKeysOf, type ScriptScope } from "@acme/script-env";',
      'import type { ScriptEnv } from "@acme/script-env";',
      "",
      'export const keys = secretKeysOf(shopEnv, "prod" satisfies ScriptScope);',
      'export const vars: ScriptEnv["prod"] = unwrapSecrets(shopEnv.prod);',
      "",
    ];

    const after = [
      before[0],
      'import { type ScriptScope } from "@acme/script-env";',
      before[3],
      "",
      'export const keys = shopEnv.sealedKeys("prod" satisfies ScriptScope);',
      'export const vars: ScriptEnv["prod"] = shopEnv.prod;',
      "",
    ];

    const got = await migrateSource(before.join("\n"), editOptions());
    expect(got.text).toBe(after.join("\n"));
  });
});

describe("migrateSource, helper names from elsewhere", () => {
  it("leaves the same names imported from another module as they are", async () => {
    const text = [
      'import { secretKeysOf, unwrapSecrets } from "./keys.ts";',
      "",
      'export const keys = secretKeysOf(shopEnv, "prod");',
      "export const vars = unwrapSecrets(shopEnv.prod);",
      "",
    ].join("\n");

    expect(await migrateSource(text, editOptions())).toStrictEqual({ counts: NONE_COUNTED, helpers: [], text });
  });
});

describe("migrateSource, helper arguments", () => {
  it("rewrites a helper nested in another's argument, and reads secretKeysOf of a scope as of its env", async () => {
    const before = [
      'import { secretKeysOf, unwrapSecrets } from "@acme/script-env";',
      "",
      'export const keys = secretKeysOf(unwrapSecrets(shopEnv), "prod");',
      'export const prodKeys = secretKeysOf(shopEnv.prod, "prod");',
      "",
    ].join("\n");

    const got = await migrateSource(before, editOptions());

    expect(got.text).toBe(
      'export const keys = shopEnv.sealedKeys("prod");\nexport const prodKeys = shopEnv.sealedKeys("prod");\n',
    );

    expect(got.helpers.map(({ name }) => name)).toStrictEqual(["secretKeysOf", "unwrapSecrets", "secretKeysOf"]);
  });
});
