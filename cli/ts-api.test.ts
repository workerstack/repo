import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { API } from "typescript/unstable/async";
import { describe, expect, it, vi } from "vitest";

import { put, tempDir, useTempDirs } from "./sync/__fixtures__/temp-dirs.ts";
import { configOf, withTsApi } from "./ts-api.ts";

useTempDirs();

/** A folder with `src/a.ts`, each config of `configs` written at its name. */
function folder(configs: Record<string, string>): string {
  const dir = tempDir("ts-api-");
  put(dir, "src/a.ts", "export const a = 1;\n");

  for (const [name, text] of Object.entries(configs)) put(dir, name, text);

  return dir.split(path.sep).join("/");
}

const BASE = '{"compilerOptions":{"strict":true},"include":["src"]}';
const CUT = '{"compilerOptions":{';

/** How long a child that reads two configs may run; one that never exits is killed at this mark. */
const EXIT_TIMEOUT = 20_000;

/** `name` in `dir`, read on an API of its own. */
function readOne(dir: string, name: string) {
  return withTsApi(dir, (api) => configOf(api, `${dir}/${name}`));
}

/** Each of `names` in `dir`, read one at a time on one API, in order. */
function readAll(dir: string, names: readonly string[]) {
  return withTsApi(dir, async (api) => {
    const reads = [];

    for (const name of names) reads.push(await configOf(api, `${dir}/${name}`));

    return reads;
  });
}

describe("configOf", () => {
  it("gives an extending config's resolved options and root files", async () => {
    const dir = folder({
      "base.json": BASE,
      "tsconfig.json": '{"extends":"./base.json","compilerOptions":{"noEmit":true}}',
    });

    expect(await readOne(dir, "tsconfig.json")).toMatchObject({
      ok: true,
      value: { fileNames: [`${dir}/src/a.ts`], options: { noEmit: true, strict: true } },
    });
  });

  it("names the syntax error of a config cut short", async () => {
    const dir = folder({ "tsconfig.json": CUT });

    expect(await readOne(dir, "tsconfig.json")).toStrictEqual({ error: "'}' expected.", ok: false });
  });

  it("names a config that is not there", async () => {
    const dir = folder({});

    expect(await readOne(dir, "tsconfig.json")).toStrictEqual({
      error: `api: client error: could not read file "${dir}/tsconfig.json"`,
      ok: false,
    });
  });

  it("leaves a parent's syntax error to the parent", async () => {
    const dir = folder({ "child.json": '{"extends":"./cut.json"}', "cut.json": CUT });

    expect(await readOne(dir, "child.json")).toMatchObject({ ok: true });
  });
});

describe("configOf on one API", () => {
  it("reads an empty config, which TypeScript takes as no settings", async () => {
    const dir = folder({ "tsconfig.json": "" });

    expect(await readOne(dir, "tsconfig.json")).toMatchObject({ ok: true });
  });

  it("reads a config with an unknown option, which only the type check reports", async () => {
    const dir = folder({ "tsconfig.json": '{"compilerOptions":{"bogus":true},"include":["src"]}' });

    expect(await readOne(dir, "tsconfig.json")).toMatchObject({ ok: true });
  });

  it("reads each config on its own after a broken and a missing one", async () => {
    const dir = folder({ "broken.json": CUT, "good.json": BASE });

    const reads = await readAll(dir, ["broken.json", "absent.json", "good.json"]);

    expect(reads.map((read) => read.ok)).toStrictEqual([false, false, true]);
  });

  it("names the panic of a config tsgo cannot parse, and reads the next config", async () => {
    const dir = folder({ "bad.json": '{"include":["src"],"references":[{"path":1}]}', "good.json": BASE });

    expect(await readAll(dir, ["bad.json", "good.json"])).toMatchObject([
      { error: "panic: interface conversion: interface {} is float64, not string", ok: false },
      { ok: true },
    ]);
  });
});

describe("configOf on a config removed mid-read", () => {
  it("keeps the parsed read of a broken config removed before its project opens", async () => {
    const dir = folder({ "broken.json": CUT });

    const spy = vi.spyOn(API.prototype, "updateSnapshot").mockImplementationOnce(function (this: API, change) {
      fs.rmSync(`${dir}/broken.json`);
      spy.mockRestore();

      return this.updateSnapshot(change);
    });

    expect(await readOne(dir, "broken.json")).toMatchObject({ ok: true });
    expect(fs.existsSync(`${dir}/broken.json`)).toBe(false);
  });
});

describe("withTsApi", () => {
  it("lets the process exit after it reads a broken and a good config", () => {
    const dir = folder({ "broken.json": CUT, "good.json": BASE });
    const api = JSON.stringify(path.join(import.meta.dirname, "ts-api.ts"));

    const script = [
      `const { configOf, withTsApi } = await import(${api});`,
      `await withTsApi(".", async (api) => [await configOf(api, "broken.json"), await configOf(api, "good.json")]);`,
    ].join("\n");

    const run = spawnSync(process.execPath, ["-e", script], { cwd: dir, encoding: "utf8", timeout: EXIT_TIMEOUT });

    expect({ signal: run.signal, status: run.status }).toStrictEqual({ signal: null, status: 0 });
  });

  it("closes the API when the work throws, and passes the throw on", async () => {
    const close = vi.spyOn(API.prototype, "close");
    const dir = folder({});

    await expect(
      withTsApi(dir, () => {
        throw new Error("work failed");
      }),
    ).rejects.toThrow("work failed");
    expect(close).toHaveBeenCalledOnce();
    close.mockRestore();
  });
});
