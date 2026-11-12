import { afterEach, expect, it } from "vitest";

import { useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import {
  jsonRes,
  plantHome,
  plantLoggedIn,
  resetCase,
  stubFetch,
  withIo,
} from "./__fixtures__/google-workspace-kit.ts";
import { main } from "./google-workspace.ts";

useTempDirs();

afterEach(() => resetCase());

function loggedIn(prefix: string): string {
  return plantLoggedIn(prefix);
}

it("main / verbs: usage on unknown verb", async () => {
  const { code, errs } = await withIo(() => main(["nope"]));
  expect(code).toBe(1);
  expect(errs).toMatch(/usage: google-workspace/);
});

it("main / verbs: whoami without tokens fails", async () => {
  plantHome("ws-notok-");
  const { code, errs } = await withIo(() => main(["whoami"]));
  expect(code).toBe(1);
  expect(errs).toMatch(/not logged in/);
});

it("main / verbs: whoami prints email", async () => {
  loggedIn("ws-who-");
  stubFetch((url) => {
    if (url.includes("oauth2/v2/userinfo")) return jsonRes({ email: "me@example.com" });

    return jsonRes({ error: { message: url } }, 404);
  });
  const { code, logs } = await withIo(() => main(["whoami"]));
  expect(code).toBe(0);
  expect(logs).toContain("me@example.com");
});

it("main / verbs: accounts lists default when its tokens exist", async () => {
  loggedIn("ws-accts-");
  const { code, logs } = await withIo(() => main(["accounts"]));
  expect(code).toBe(0);
  expect(logs).toMatch(/default\s+-+\s+tokens/);
});

it("main / verbs: sheet create posts a Drive file", async () => {
  loggedIn("ws-sheet-c-");

  const calls = stubFetch((url) => {
    if (url.includes("/drive/v3/files?")) {
      return jsonRes({
        id: "sid",
        name: "Q3",
        webViewLink: "https://docs.google.com/spreadsheets/d/sid",
      });
    }

    return jsonRes({ error: { message: url } }, 404);
  });

  const { code, logs } = await withIo(() => main(["sheet", "create", "--title", "Q3"]));
  expect(code).toBe(0);
  expect(logs).toContain("Q3");
  expect(logs).toContain("id=sid");
  expect(calls.some((c) => c.url.includes("/drive/v3/files?"))).toBe(true);
});

it("main / verbs: sheet create --csv uploads multipart", async () => {
  loggedIn("ws-sheet-csv-");
  stubFetch((url) => {
    if (url.includes("uploadType=multipart"))
      return jsonRes({ id: "sid", name: "csv", webViewLink: "https://sheet/csv" });

    return jsonRes({ error: { message: url } }, 404);
  });
  const { code, logs } = await withIo(() => main(["sheet", "create", "--title", "csv", "--csv", "a,b\n1,2"]));
  expect(code).toBe(0);
  expect(logs).toContain("id=sid");
});

it("main / verbs: sheet get/set/append/clear", async () => {
  loggedIn("ws-sheet-crud-");
  stubFetch((url) => {
    if (url.includes(":append")) return jsonRes({ updates: { updatedRows: 2 } });

    if (url.includes(":clear")) return jsonRes({ clearedRange: "A1:Z" });

    if (url.includes("/values/") && url.includes("valueInputOption")) return jsonRes({ updatedRange: "Sheet1!A1" });

    if (url.includes("/values/")) {
      return jsonRes({
        values: [
          ["a", "b"],
          ["1", "2"],
        ],
      });
    }

    return jsonRes({ error: { message: url } }, 404);
  });
  const get = await withIo(() => main(["sheet", "get", "--id", "sid"]));
  expect(get.code).toBe(0);
  expect(get.logs).toContain("a\tb");
  const set = await withIo(() => main(["sheet", "set", "--id", "sid", "--cell", "A1", "--value", "x"]));
  expect(set.code).toBe(0);
  expect(set.logs).toMatch(/updated/);
  const append = await withIo(() => main(["sheet", "append", "--id", "sid", "--csv", "a,b\n1,2"]));
  expect(append.code).toBe(0);
  expect(append.logs).toMatch(/appended 2/);
  const clear = await withIo(() => main(["sheet", "clear", "--id", "sid"]));
  expect(clear.code).toBe(0);
  expect(clear.logs).toMatch(/cleared/);
});

it("main / verbs: sheet get without --id fails; set SERVICE_DISABLED is rewritten", async () => {
  loggedIn("ws-sheet-err-");
  const missing = await withIo(() => main(["sheet", "get"]));
  expect(missing.code).toBe(1);
  expect(missing.errs).toMatch(/needs --id/);
  stubFetch(() => jsonRes({ error: { message: "Sheets API has not been used" } }, 403));
  const off = await withIo(() => main(["sheet", "set", "--id", "sid", "--cell", "A1", "--value", "x"]));
  expect(off.code).toBe(1);
  expect(off.errs).toMatch(/Sheets API is off/);
});

it("main / verbs: doc create/append and drive list", async () => {
  loggedIn("ws-doc-");

  const listed = {
    id: "did",
    mimeType: "application/vnd.google-apps.document",
    name: "Note",
    webViewLink: "https://doc/did",
  };

  stubFetch((url) => {
    if (url.includes("uploadType=multipart"))
      return jsonRes({ id: "did", name: "Note", webViewLink: "https://doc/did" });

    if (url.includes(":batchUpdate")) return jsonRes({ documentId: "did" });

    if (url.includes("/drive/v3/files?")) return jsonRes({ files: [listed] });

    return jsonRes({ error: { message: url } }, 404);
  });
  const created = await withIo(() => main(["doc", "create", "--title", "Note", "--body", "hi"]));
  expect(created.code).toBe(0);
  expect(created.logs).toContain("id=did");
  const appended = await withIo(() => main(["doc", "append", "--id", "did", "--body", "more"]));
  expect(appended.code).toBe(0);
  const drive = await withIo(() => main(["drive", "list"]));
  expect(drive.code).toBe(0);
  expect(drive.logs).toContain("Note");
});
