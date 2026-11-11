import fs from "node:fs";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

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
import { main, setAccount } from "./google-workspace.ts";
import { isRecord } from "./hook-input.ts";

const dirs: string[] = [];

beforeEach(() => {
  writeJson(storePath(plantHome(dirs, "ws-comms-")), freshToken());
});

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { force: true, recursive: true });
  setAccount("default");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const run = (...argv: string[]) => withIo(() => main(argv));
const HOUR = 3_600_000;
const dateTimeOf = (v: unknown) => (isRecord(v) ? String(v.dateTime) : "");

it("mail: sends with a placeholder subject and an empty body", async () => {
  const calls = stubFetch(() => jsonRes({ id: "m9" }));
  const r = await run("mail", "send", "--to", "a@b.c");
  expect(r.logs).toBe("sent id=m9\n");
  const raw = String(sentJson(calls).raw).replace(/-/g, "+").replace(/_/g, "/");
  const text = Buffer.from(raw, "base64").toString();
  expect(text).toBe("To: a@b.c\r\nSubject: (no subject)\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n");
});

it("mail: reports the API's reason or a fallback when send or list fails", async () => {
  stubFetch(() => jsonRes({}, 500));
  expect((await run("mail", "send", "--to", "a@b.c")).errs).toContain("mail send failed");
  expect((await run("mail", "list")).errs).toContain("mail list failed");
  stubFetch(() => jsonRes({ error: { message: "mailbox full" } }, 500));
  expect((await run("mail", "send", "--to", "a@b.c")).errs).toContain("mailbox full");
});

it("mail: lists with a query and count, via ls, and says when there are none", async () => {
  const calls = stubFetch(() => jsonRes({}));
  const none = await run("mail", "ls", "--q", "from:me", "--n", "2");
  expect(none.logs).toBe("no messages\n");
  expect(callAt(calls, 0).url).toContain("maxResults=2");
  expect(callAt(calls, 0).url).toContain("q=from%3Ame");
  await run("mail", "list");
  expect(callAt(calls, 1).url).toContain("maxResults=5");
  expect(callAt(calls, 1).url).not.toContain("q=");
});

it("meeting: starts at --when, ends an hour later and splits --to into attendees", async () => {
  const calls = stubFetch(() => jsonRes({ htmlLink: "l", id: "e", summary: "meeting" }));
  const r = await run("event", "create", "--when", "2030-05-05T08:00:00.000Z", "--to", "a@x.y; b@x.y");
  expect(r.code).toBe(0);
  expect(sentJson(calls)).toStrictEqual({
    attendees: [{ email: "a@x.y" }, { email: "b@x.y" }],
    end: { dateTime: "2030-05-05T09:00:00.000Z" },
    start: { dateTime: "2030-05-05T08:00:00.000Z" },
    summary: "meeting",
  });
});

it("meeting: defaults to an hour from now and sends no attendees", async () => {
  const calls = stubFetch(() => jsonRes({ id: "e" }));
  const before = Date.now();
  await run("meeting", "create");
  const sent = sentJson(calls);
  const start = Date.parse(dateTimeOf(sent.start));
  expect(start).toBeGreaterThanOrEqual(before + HOUR);
  expect(Date.parse(dateTimeOf(sent.end))).toBe(start + HOUR);
  expect(sent).not.toHaveProperty("attendees");
});

it("meeting: falls back to a calendar link without dates when the start is not a date", async () => {
  stubFetch(() => jsonRes({}, 403));
  const r = await run("meeting", "create", "--title", "A B", "--start", "someday", "--end", "2030-01-01T00:00:00Z");
  expect(r.code).toBe(1);
  expect(r.errs).toContain("Calendar API blocked (403)");
  expect(r.errs).toContain("&text=A%20B");
  expect(r.errs).not.toContain("&dates=");
});

it("scopes: prints the tokeninfo error, or a note, when no scopes come back", async () => {
  stubFetch(() => jsonRes({ error: "invalid_token" }));
  expect((await run("scopes")).logs).toBe("invalid_token\n");
  stubFetch(() => jsonRes({}));
  expect((await run("scopes")).logs).toBe("no scopes\n");
});
