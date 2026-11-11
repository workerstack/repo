import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useTempDirs } from "../sync/fixtures/temp-dirs.ts";
import {
  callAt,
  freshToken,
  jsonRes,
  plantHome,
  sentJson,
  storePath,
  stubFetch,
  textRes,
  withIo,
  writeJson,
} from "./fixtures/google-workspace-kit.ts";
import { accountContext } from "./google-workspace-account.ts";
import { createFile } from "./google-workspace-files.ts";
import { main } from "./google-workspace.ts";

useTempDirs();

beforeEach(() => {
  writeJson(storePath(plantHome("ws-create-")), freshToken());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const run = (...argv: string[]) => withIo(() => main(argv));

const failing: [string[], string][] = [
  [["sheet", "create"], "create failed"],
  [["sheet", "create", "--csv", "a,b"], "upload failed"],
  [["doc", "create", "--body", "hi"], "upload failed"],
  [["doc", "create"], "create failed"],
  [["slide", "create"], "create failed"],
  [["sheet", "get", "--id", "s"], "sheet get failed"],
  [["sheet", "set", "--id", "s", "--cell", "A1"], "sheet set failed"],
  [["sheet", "append", "--id", "s", "--csv", "a"], "sheet append failed"],
  [["sheet", "clear", "--id", "s"], "sheet clear failed"],
  [["doc", "append", "--id", "d"], "doc append failed"],
  [["drive", "list"], "drive list failed"],
  [["whoami"], "whoami failed"],
];

it.each(failing)("failure: %j reports the API's reason, or its own fallback", async (argv, fallback) => {
  stubFetch(() => jsonRes({}, 500));
  const bare = await run(...argv);
  expect(bare.code).toBe(1);
  expect(bare.errs).toContain(fallback);
  stubFetch(() => jsonRes({ error: { message: "quota gone" } }, 429));
  const named = await run(...argv);
  expect(named.code).toBe(1);
  expect(named.errs).toContain("quota gone");
});

it("create: prints the file's id when Drive returns no link", async () => {
  stubFetch(() => jsonRes({ id: "x1", name: "N" }));
  const r = await run("slides", "create", "--title", "N");
  expect(r.code).toBe(0);
  expect(r.logs).toBe("N\nx1\nid=x1\n");
});

it("create: names an untitled file after its kind", async () => {
  const calls = stubFetch(() => jsonRes({ id: "x1", name: "repo-slide" }));
  await run("slide", "create");
  expect(sentJson(calls)).toMatchObject({ name: "repo-slide" });
});

it("create: uploads a sheet's csv and a doc's body as multipart", async () => {
  const calls = stubFetch(() => jsonRes({ id: "x", name: "n", webViewLink: "l" }));
  await createFile(accountContext(), { csv: "a,b", kind: "sheet" });
  await createFile(accountContext(), { body: "hello", kind: "doc", title: "Memo" });
  expect(String(callAt(calls, 0).init?.body)).toContain("text/csv");
  expect(String(callAt(calls, 1).init?.body)).toContain("hello");
  expect(String(callAt(calls, 1).init?.body)).toContain('"name":"Memo"');
});

it("reply: keeps a text body's start as the reply when it is not JSON", async () => {
  stubFetch(() => textRes("<html>gateway</html>", 502));
  const r = await run("whoami");
  expect(r.code).toBe(1);
  expect(r.errs).toContain("whoami failed");
});

it("reply: treats an empty body as an empty reply", async () => {
  stubFetch(() => textRes("", 200));
  const r = await run("whoami");
  expect(r.logs).toBe("{}\n");
});
