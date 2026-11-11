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
  withIo,
  writeJson,
} from "./fixtures/google-workspace-kit.ts";
import { main } from "./google-workspace.ts";

useTempDirs();

beforeEach(() => {
  writeJson(storePath(plantHome("ws-docs-")), freshToken());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const run = (...argv: string[]) => withIo(() => main(argv));

it("docs: append needs an id", async () => {
  const r = await run("doc", "append");
  expect(r.code).toBe(1);
  expect(r.errs).toContain("doc append needs --id");
});

it("docs: append sends an empty text without a body", async () => {
  const calls = stubFetch(() => jsonRes({}));
  const r = await run("doc", "append", "--id", "d");
  expect(r.logs).toBe("appended id=d\n");
  expect(JSON.stringify(sentJson(calls))).toContain('"text":""');
});

it("drive: lists files with the link, the mime type or nothing", async () => {
  const files = [
    { id: "1", name: "a", webViewLink: "link" },
    { id: "2", mimeType: "text/x", name: "b" },
    { id: "3", name: "c" },
  ];
  const calls = stubFetch(() => jsonRes({ files }));
  const r = await run("drive", "--q", "name='a'", "--n", "3");
  expect(r.logs).toBe("a\t1\tlink\nb\t2\ttext/x\nc\t3\n");
  expect(callAt(calls, 0).url).toContain("pageSize=3");
  expect(callAt(calls, 0).url).toContain("q=name%3D%27a%27");
});

it("drive: says no files, via the ls alias and the default page size", async () => {
  const calls = stubFetch(() => jsonRes({}));
  const r = await run("drive", "ls");
  expect(r.logs).toBe("no files\n");
  expect(callAt(calls, 0).url).toContain("pageSize=10");
});
