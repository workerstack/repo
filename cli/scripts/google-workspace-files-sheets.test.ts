import fs from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { main, setAccount } from "./google-workspace.ts";
import {
  callAt,
  freshToken,
  jsonRes,
  plantHome,
  sentJson,
  storePath,
  stubFetch,
  withIo,
  writeJson,
} from "./fixtures/google-workspace-kit.ts";

const dirs: string[] = [];

beforeEach(() => {
  writeJson(storePath(plantHome(dirs, "ws-sheets-")), freshToken());
});

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  setAccount("default");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const run = (...argv: string[]) => withIo(() => main(argv));

it("sheets: get, append and clear fail without an id", async () => {
  const get = await run("sheet", "get");
  const append = await run("sheet", "append");
  const clear = await run("sheet", "clear");
  expect([get.code, append.code, clear.code]).toStrictEqual([1, 1, 1]);
  expect(get.errs).toContain("sheet get needs --id");
  expect(append.errs).toContain("sheet append needs --id");
  expect(clear.errs).toContain("sheet clear needs --id");
});

it("sheets: get reads the requested range and prints ragged rows", async () => {
  const calls = stubFetch(() => jsonRes({ values: [["a", "b"], "oops", ["c"]] }));
  const r = await run("sheet", "get", "--id", "s", "--cell", "B2:C3");
  expect(r.logs).toBe("a\tb\n\nc\n");
  expect(callAt(calls, 0).url).toContain("/spreadsheets/s/values/B2%3AC3");
});

it("sheets: get says (empty) when the range has no values", async () => {
  const calls = stubFetch(() => jsonRes({}));
  const r = await run("sheet", "get", "--id", "s");
  expect(r.logs).toBe("(empty)\n");
  expect(callAt(calls, 0).url).toContain("A1%3AZ50");
});

it("sheets: append needs rows, then counts the server's rows or its own", async () => {
  const calls = stubFetch(() => jsonRes({}));
  expect((await run("sheet", "append", "--id", "s")).errs).toContain("sheet append needs --csv");
  const ours = await run("sheet", "append", "--id", "s", "--csv", "a,b\n1,2", "--range", "Tab!A1");
  expect(ours.logs).toBe("appended 2\n");
  expect(callAt(calls, 0).url).toContain("Tab!A1:append");
  stubFetch(() => jsonRes({ updates: { updatedRows: 7 } }));
  expect((await run("sheet", "append", "--id", "s", "--csv", "x")).logs).toBe("appended 7\n");
});

it("sheets: clear echoes the named range when the server does not", async () => {
  const calls = stubFetch(() => jsonRes({}));
  const named = await run("sheet", "clear", "--id", "s", "--range", "B:B");
  expect(named.logs).toBe("cleared B:B\n");
  expect(callAt(calls, 0).url).toContain("B%3AB:clear");
  expect((await run("sheet", "clear", "--id", "s")).logs).toBe("cleared A1:Z\n");
});

it("sheets: set takes --range and --a1, defaulting to A1 and an empty value", async () => {
  const calls = stubFetch(() => jsonRes({}));
  const r = await run("sheet", "set", "--id", "s", "--range", "C3", "--a1", "v");
  expect(r.logs).toBe("updated C3\n");
  expect(sentJson(calls)).toStrictEqual({ values: [["v"]] });
  await run("sheet", "set", "--id", "s");
  expect(callAt(calls, 1).url).toContain("/values/A1?");
  expect(sentJson(calls, 1)).toStrictEqual({ values: [[""]] });
});

it("sheets: set turns a disabled Sheets API into advice", async () => {
  stubFetch(() => jsonRes({ error: { message: "SERVICE_DISABLED for project" } }, 403));
  const r = await run("sheet", "set", "--id", "s");
  expect(r.errs).toContain("Sheets API is off");
});
