import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import {
  freshToken,
  jsonRes,
  plantHome,
  plantLoggedIn,
  resetCase,
  readObject,
  sentJson,
  storePath,
  stubFetch,
  withIo,
  writeJson,
} from "./__fixtures__/google-workspace-kit.ts";
import { accountContext } from "./google-workspace-account.ts";
import { accessToken } from "./google-workspace-auth.ts";
import { createFile } from "./google-workspace-files.ts";
import { main } from "./google-workspace.ts";

useTempDirs();
const CALENDAR_EVENTS = "/calendar/v3/calendars/primary/events";

afterEach(() => resetCase());

function loggedIn(prefix: string): string {
  return plantLoggedIn(prefix);
}

/** Drive answers with the deck, Calendar with the event, anything else 404s. */
function slideOrEvent(url: string) {
  if (url.includes("/drive/v3/files?")) return jsonRes({ id: "sl", name: "Deck", webViewLink: "https://slides/sl" });

  if (url.includes(CALENDAR_EVENTS)) return jsonRes({ htmlLink: "https://cal/ev", id: "ev", summary: "Standup" });

  return jsonRes({ error: { message: url } }, 404);
}

it("main / verbs: slide create and meeting create", async () => {
  loggedIn("ws-meet-");
  const calls = stubFetch(slideOrEvent);
  const slide = await withIo(() => main(["slide", "create", "--title", "Deck"]));
  expect(slide.code).toBe(0);
  expect(slide.logs).toContain("id=sl");
  const meet = await withIo(() =>
    main([
      "meeting",
      "create",
      "--title",
      "Standup",
      "--start",
      "2030-01-01T10:00:00Z",
      "--end",
      "2030-01-01T10:30:00Z",
      "--attendees",
      "a@b.com",
    ]),
  );
  const body = sentJson(
    calls,
    calls.findIndex((c) => c.url.includes(CALENDAR_EVENTS)),
  );
  expect(body.summary).toBe("Standup");
  expect(body.attendees).toStrictEqual([{ email: "a@b.com" }]);
  expect(meet.code).toBe(0);
  expect(meet.logs).toContain("id=ev");
});

it("main / verbs: meeting API fail prints a calendar template", async () => {
  loggedIn("ws-meet-fail-");
  stubFetch(() => jsonRes({ error: { message: "Calendar API blocked" } }, 403));
  const { code, errs } = await withIo(() =>
    main(["meeting", "create", "--title", "X", "--start", "2030-01-01T10:00:00Z", "--end", "2030-01-01T11:00:00Z"]),
  );
  expect(code).toBe(1);
  expect(errs).toMatch(/calendar\/render\?action=TEMPLATE/);
  expect(errs).toMatch(/dates=20300101T100000Z\/20300101T110000Z/);
});

it("main / verbs: mail send needs --to; send and list succeed", async () => {
  loggedIn("ws-mail-");
  const missing = await withIo(() => main(["mail", "send"]));
  expect(missing.code).toBe(1);
  expect(missing.errs).toMatch(/needs --to/);
  stubFetch((url) => {
    if (url.includes("/messages/send")) return jsonRes({ id: "m1" });

    if (url.includes("/messages?")) return jsonRes({ messages: [{ id: "m1" }, { id: "m2" }] });

    return jsonRes({ error: { message: url } }, 404);
  });
  const sent = await withIo(() => main(["mail", "send", "--to", "a@b.com", "--subject", "Hi", "--body", "x"]));
  expect(sent.code).toBe(0);
  expect(sent.logs).toContain("sent id=m1");
  const listed = await withIo(() => main(["mail", "list"]));
  expect(listed.code).toBe(0);
  expect(listed.logs).toContain("m1");
});

it("main / verbs: scopes lists tokeninfo", async () => {
  loggedIn("ws-scopes-");
  stubFetch((url) => {
    if (url.includes("tokeninfo")) return jsonRes({ scope: "https://www.googleapis.com/auth/spreadsheets email" });

    return jsonRes({ error: { message: url } }, 404);
  });
  const { code, logs } = await withIo(() => main(["scopes"]));
  expect(code).toBe(0);
  expect(logs).toMatch(/spreadsheets/);
});

it("main / verbs: login without creds or gcloud prints setup", async () => {
  plantHome("ws-login-");
  const { code, errs } = await withIo(() => main(["login"], () => ({ status: 1 })));
  expect(code).toBe(1);
  expect(errs).toMatch(/missing Desktop OAuth JSON/);
  expect(errs).toMatch(/bun repo setup google-workspace/);
});

it("main / verbs: refreshes an expired store token", async () => {
  const home = plantHome("ws-refresh-");
  const store = storePath(home);
  writeJson(store, { ...freshToken(), access_token: "old", expiry_date: Date.now() - 1000 });
  stubFetch((url) => {
    if (url.includes("oauth2.googleapis.com/token")) return jsonRes({ access_token: "new", expires_in: 3600 });

    return jsonRes({ error: { message: url } }, 404);
  });
  await expect(accessToken()).resolves.toBe("new");
  expect(readObject(store).access_token).toBe("new");
});

it("main / verbs: loads clasprc then ADC when store is empty", async () => {
  const clasprcHome = plantHome("ws-clasp-");
  writeJson(path.join(clasprcHome, ".clasprc.json"), {
    tokens: { default: { ...freshToken(), access_token: "clasp-at" } },
  });
  stubFetch((url) => {
    if (url.includes("oauth2/v2/userinfo")) return jsonRes({ email: "c@x" });
    return jsonRes({ error: { message: url } }, 404);
  });
  const clasp = await withIo(() => main(["whoami"]));
  expect(clasp.code).toBe(0);
  expect(clasp.logs).toContain("c@x");

  const adcHome = plantHome("ws-adc-");
  writeJson(path.join(adcHome, ".config", "gcloud", "application_default_credentials.json"), {
    type: "authorized_user",
    ...freshToken(),
    access_token: "adc-at",
  });
  stubFetch((url) => {
    if (url.includes("oauth2/v2/userinfo")) return jsonRes({ email: "adc@x" });
    return jsonRes({ error: { message: url } }, 404);
  });
  const adc = await withIo(() => main(["whoami"]));
  expect(adc.code).toBe(0);
  expect(adc.logs).toContain("adc@x");
});

it("main / verbs: createFile rejects an unknown kind", async () => {
  await expect(createFile(accountContext(), { kind: "nope" })).rejects.toThrow(/unknown kind/);
});
