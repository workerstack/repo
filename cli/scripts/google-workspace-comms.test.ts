import { expect, it } from "vitest";

import { callAt, jsonRes, sentJson, stubFetch } from "./__fixtures__/google-workspace-kit.ts";
import { runWorkspace, useLoggedInWorkspace } from "./__fixtures__/use-logged-in-workspace.ts";
import { isRecord } from "./hook-input.ts";

useLoggedInWorkspace("ws-comms-");
const HOUR = 3_600_000;
function dateTimeOf(v: unknown) {
  return isRecord(v) ? String(v.dateTime) : "";
}

it("mail: sends with a placeholder subject and an empty body", async () => {
  const calls = stubFetch(() => jsonRes({ id: "m9" }));
  const r = await runWorkspace("mail", "send", "--to", "a@b.c");
  expect(r.logs).toBe("sent id=m9\n");
  const raw = String(sentJson(calls).raw).replaceAll("-", "+").replaceAll("_", "/");
  const text = Buffer.from(raw, "base64").toString();
  expect(text).toBe("To: a@b.c\r\nSubject: (no subject)\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n");
});

it("mail: reports the API's reason or a fallback when send or list fails", async () => {
  stubFetch(() => jsonRes({}, 500));
  const sendFailed = await runWorkspace("mail", "send", "--to", "a@b.c");
  expect(sendFailed.errs).toContain("mail send failed");
  const listFailed = await runWorkspace("mail", "list");
  expect(listFailed.errs).toContain("mail list failed");
  stubFetch(() => jsonRes({ error: { message: "mailbox full" } }, 500));
  const full = await runWorkspace("mail", "send", "--to", "a@b.c");
  expect(full.errs).toContain("mailbox full");
});

it("mail: lists with a query and count, via ls, and says when there are none", async () => {
  const calls = stubFetch(() => jsonRes({}));
  const none = await runWorkspace("mail", "ls", "--q", "from:me", "--n", "2");
  expect(none.logs).toBe("no messages\n");
  expect(callAt(calls, 0).url).toContain("maxResults=2");
  expect(callAt(calls, 0).url).toContain("q=from%3Ame");
  await runWorkspace("mail", "list");
  expect(callAt(calls, 1).url).toContain("maxResults=5");
  expect(callAt(calls, 1).url).not.toContain("q=");
});

it("meeting: starts at --when, ends an hour later and splits --to into attendees", async () => {
  const calls = stubFetch(() => jsonRes({ htmlLink: "l", id: "e", summary: "meeting" }));
  const r = await runWorkspace("event", "create", "--when", "2030-05-05T08:00:00.000Z", "--to", "a@x.y; b@x.y");
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
  await runWorkspace("meeting", "create");
  const sent = sentJson(calls);
  const start = Date.parse(dateTimeOf(sent.start));
  expect(start).toBeGreaterThanOrEqual(before + HOUR);
  expect(Date.parse(dateTimeOf(sent.end))).toBe(start + HOUR);
  expect(sent).not.toHaveProperty("attendees");
});

it("meeting: falls back to a calendar link without dates when the start is not a date", async () => {
  stubFetch(() => jsonRes({}, 403));
  const r = await runWorkspace(
    "meeting",
    "create",
    "--title",
    "A B",
    "--start",
    "someday",
    "--end",
    "2030-01-01T00:00:00Z",
  );
  expect(r.code).toBe(1);
  expect(r.errs).toContain("Calendar API blocked (403)");
  expect(r.errs).toContain("&text=A%20B");
  expect(r.errs).not.toContain("&dates=");
});

it("scopes: prints the tokeninfo error, or a note, when no scopes come back", async () => {
  stubFetch(() => jsonRes({ error: "invalid_token" }));
  const tokenError = await runWorkspace("scopes");
  expect(tokenError.logs).toBe("invalid_token\n");
  stubFetch(() => jsonRes({}));
  const empty = await runWorkspace("scopes");
  expect(empty.logs).toBe("no scopes\n");
});
