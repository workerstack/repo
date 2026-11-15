import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { API, type Project } from "typescript/unstable/async";
import { describe, expect, it, vi } from "vitest";

import { put, tempDir, useTempDirs } from "./sync/__fixtures__/temp-dirs.ts";
import { configOf, lineOf, messageOf, type TsRun, withFiles, withTsApi } from "./ts-api.ts";

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
  return withTsApi(dir, (run) => configOf(run, `${dir}/${name}`));
}

/** Each of `names` in `dir`, read one at a time on one API, in order. */
function readAll(dir: string, names: readonly string[]) {
  return withTsApi(dir, async (run) => {
    const reads = [];

    for (const name of names) reads.push(await configOf(run, `${dir}/${name}`));

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
      `await withTsApi(".", async (run) => [await configOf(run, "broken.json"), await configOf(run, "good.json")]);`,
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

/** A file whose parameter has no type, which only a strict config rejects. */
const UNTYPED = "export function id(x) {\n  return x;\n}\n";
const IMPLICIT_ANY = "TS7006: Parameter 'x' implicitly has an 'any' type.";

/** The semantic errors of `file` in `project`, as messageOf prints them. */
async function semanticErrors(project: Project, file: string): Promise<string[]> {
  const diagnostics = await project.program.getSemanticDiagnostics(file);

  return diagnostics.map((diagnostic) => messageOf(diagnostic));
}

/** The semantic errors of `src/b.ts` in `dir`, checked with the given base config beside it. */
function errorsOf(dir: string, base: string | null): Promise<string[]> {
  const file = `${dir}/src/b.ts`;

  const spec = { base, dir, files: [file] };

  return withTsApi(dir, (run) => withFiles(run, spec, (project) => semanticErrors(project, file)));
}

/** The files under `dir/src` in a project of `files` over `dir`'s tsconfig.json. */
async function sourcesOf(dir: string, files: readonly string[]): Promise<string[]> {
  const spec = { base: "tsconfig.json", dir, files };
  const names = await withTsApi(dir, (run) => withFiles(run, spec, (project) => project.program.getSourceFileNames()));

  return names.filter((name) => name.startsWith(`${dir}/src/`));
}

/** Work that only says it ran. */
function opened(): Promise<string> {
  return Promise.resolve("opened");
}

/** How many configs `run` still holds after a withFiles whose work threw `message`. */
async function heldAfterThrow(run: TsRun, dir: string, message: string): Promise<number> {
  const work = withFiles(run, { base: "tsconfig.json", dir, files: [`${dir}/src/a.ts`] }, () => {
    throw new Error(message);
  });

  await expect(work).rejects.toThrow(message);

  return run.virtual.size;
}

describe("withFiles", () => {
  it("checks a listed file under the options of the config it extends", async () => {
    const strict = folder({ "tsconfig.json": BASE });
    const loose = folder({ "tsconfig.json": '{"compilerOptions":{"strict":false}}' });
    put(strict, "src/b.ts", UNTYPED);
    put(loose, "src/b.ts", UNTYPED);

    expect(await errorsOf(strict, "tsconfig.json")).toStrictEqual([IMPLICIT_ANY]);
    expect(await errorsOf(loose, "tsconfig.json")).toStrictEqual([]);
  });

  it("checks a file with no owner under strict defaults", async () => {
    const dir = folder({});
    put(dir, "src/b.ts", UNTYPED);

    expect(await errorsOf(dir, null)).toStrictEqual([IMPLICIT_ANY]);
  });

  it("leaves a listed file that is gone out of the project", async () => {
    const dir = folder({ "tsconfig.json": BASE });

    expect(await sourcesOf(dir, [`${dir}/src/a.ts`, `${dir}/src/gone.ts`])).toStrictEqual([`${dir}/src/a.ts`]);
  });
});

describe("withFiles when it ends", () => {
  it("drops its config when the work throws, and passes the throw on", async () => {
    const dir = folder({ "tsconfig.json": BASE });

    expect(await withTsApi(dir, (run) => heldAfterThrow(run, dir, "work failed"))).toBe(0);
  });

  it("names the config of a relative dir, which TypeScript opens no project for", async () => {
    const dir = folder({});
    const spec = { base: null, dir: "src", files: [] };

    const work = withTsApi(dir, (run) => withFiles(run, spec, opened));

    await expect(work).rejects.toThrow("TypeScript opened no project for src/tsconfig.repo-1.json");
  });

  it("lets the process exit after it checks files twice on one API", () => {
    const dir = folder({ "tsconfig.json": BASE });
    const api = JSON.stringify(path.join(import.meta.dirname, "ts-api.ts"));
    const spec = JSON.stringify({ base: "tsconfig.json", dir, files: [`${dir}/src/a.ts`] });

    const script = [
      `const { withFiles, withTsApi } = await import(${api});`,
      `const names = (project) => project.program.getSourceFileNames();`,
      `const twice = async (run) => [await withFiles(run, ${spec}, names), await withFiles(run, ${spec}, names)];`,
      `await withTsApi(".", twice);`,
    ].join("\n");

    const run = spawnSync(process.execPath, ["-e", script], { cwd: dir, encoding: "utf8", timeout: EXIT_TIMEOUT });

    expect({ signal: run.signal, status: run.status }).toStrictEqual({ signal: null, status: 0 });
  });
});

describe("messageOf and lineOf", () => {
  it("flattens a chained error as tsc prints it on one line", async () => {
    const dir = folder({ "tsconfig.json": '{"compilerOptions":{"strict":true,"exactOptionalPropertyTypes":true}}' });
    put(dir, "src/b.ts", "export const o: { a?: number } = { a: undefined };\n");

    expect(await errorsOf(dir, "tsconfig.json")).toStrictEqual([
      "TS2375: Type '{ a: undefined; }' is not assignable to type '{ a?: number; }' with " +
        "'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the types of the target's properties.   " +
        "Types of property 'a' are incompatible.     Type 'undefined' is not assignable to type 'number'.",
    ]);
  });

  it("counts lines from one", () => {
    const text = "a\nb\nc";

    expect([lineOf(text, 0), lineOf(text, 2), lineOf(text, 4)]).toStrictEqual([1, 2, 3]);
  });
});
