import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const child = vi.hoisted(() => ({
  impl: null as null | typeof spawnSync,
  mock: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:child_process")>();
  child.impl = orig.spawnSync;
  child.mock = vi.fn((...args: Parameters<typeof orig.spawnSync>) =>
    orig.spawnSync(...args),
  );
  return {
    ...orig,
    spawnSync: child.mock,
  };
});

import {
  EXTRA_SCOPES,
  accessToken,
  createFile,
  loginArgs,
  main,
  parseArgv,
  parseCsv,
  setAccount,
} from "./google-workspace.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "google-workspace.mjs");

const tmpDirs: string[] = [];
const spies: { mockRestore(): void }[] = [];

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  setAccount("default");
  vi.unstubAllGlobals();
  child.mock.mockReset();
  child.mock.mockImplementation((...args: Parameters<typeof spawnSync>) => {
    if (!child.impl) throw new Error("spawnSync original missing");
    return child.impl(...args);
  });
});

function tmp(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function jsonRes(obj: unknown, status = 200) {
  const body = JSON.stringify(obj);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => obj,
  };
}

function writeJson(p: string, obj: unknown) {
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", { mode: 0o600 });
}

function freshToken() {
  return {
    refresh_token: "rt",
    client_id: "cid",
    client_secret: "cs",
    access_token: "at",
    expiry_date: Date.now() + 3_600_000,
  };
}

function useHome(home: string) {
  spies.push(vi.spyOn(os, "homedir").mockReturnValue(home));
}

async function withIo(fn: () => Promise<number>) {
  const logs: string[] = [];
  const errs: string[] = [];
  const out = vi.spyOn(process.stdout, "write").mockImplementation((s) => {
    logs.push(String(s));
    return true;
  });
  const err = vi.spyOn(process.stderr, "write").mockImplementation((s) => {
    errs.push(String(s));
    return true;
  });
  spies.push(out, err);
  const code = await fn();
  return { code, logs: logs.join(""), errs: errs.join("") };
}

function stubFetch(
  handler: (url: string, init?: RequestInit) => ReturnType<typeof jsonRes>,
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    return handler(u, init);
  });
  return calls;
}

describe("parseArgv", () => {
  it("reads verb noun and flags", () => {
    expect(
      parseArgv(["sheet", "create", "--title", "Q3", "--csv", "a,b"]),
    ).toEqual({
      _: ["sheet", "create"],
      flags: { title: "Q3", csv: "a,b" },
    });
  });

  it("parses --account", () => {
    expect(parseArgv(["--account", "work", "whoami"])).toEqual({
      _: ["whoami"],
      flags: { account: "work" },
    });
  });

  it("treats bare --flag as set and stops at --", () => {
    expect(parseArgv(["drive", "list", "--n", "3", "--"])).toEqual({
      _: ["drive", "list"],
      flags: { n: "3" },
    });
    expect(parseArgv(["mail", "list", "--q", "from:a", "--"])).toEqual({
      _: ["mail", "list"],
      flags: { q: "from:a" },
    });
    expect(parseArgv(["whoami", "--clip"])).toEqual({
      _: ["whoami"],
      flags: { clip: "1" },
    });
  });

  it("parseCsv splits rows", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("")).toEqual([]);
  });

  it("rejects a bad account id", () => {
    expect(() => setAccount("../x")).toThrow(/bad --account/);
    expect(setAccount("work")).toBe("work");
    setAccount("default");
  });
});

describe("loginArgs", () => {
  it("passes extra Workspace scopes to clasp login", () => {
    const args = loginArgs();
    expect(args[0]).toBe("login");
    expect(args[1]).toBe("--extra-scopes");
    expect(args[2]).toContain("https://www.googleapis.com/auth/spreadsheets");
    expect(args[2]).toContain("https://www.googleapis.com/auth/gmail.send");
    expect(EXTRA_SCOPES.length).toBeGreaterThan(5);
  });
});

describe("main / verbs", () => {
  it("usage on unknown verb", async () => {
    const { code, errs } = await withIo(() => main(["nope"]));
    expect(code).toBe(1);
    expect(errs).toMatch(/usage: google-workspace/);
  });

  it("whoami without tokens fails", async () => {
    const home = tmp("ws-notok-");
    useHome(home);
    const { code, errs } = await withIo(() => main(["whoami"]));
    expect(code).toBe(1);
    expect(errs).toMatch(/not logged in/);
  });

  it("whoami prints email", async () => {
    const home = tmp("ws-who-");
    useHome(home);
    writeJson(path.join(home, ".grunt", "workspace-tokens.json"), freshToken());
    stubFetch((url) => {
      if (url.includes("oauth2/v2/userinfo")) {
        return jsonRes({ email: "me@example.com" });
      }
      return jsonRes({ error: { message: url } }, 404);
    });
    const { code, logs } = await withIo(() => main(["whoami"]));
    expect(code).toBe(0);
    expect(logs).toContain("me@example.com");
  });

  it("accounts lists default when legacy tokens exist", async () => {
    const home = tmp("ws-accts-");
    useHome(home);
    writeJson(path.join(home, ".grunt", "workspace-tokens.json"), freshToken());
    const { code, logs } = await withIo(() => main(["accounts"]));
    expect(code).toBe(0);
    expect(logs).toMatch(/default\s+-+\s+tokens/);
  });

  it("sheet create posts a Drive file", async () => {
    const home = tmp("ws-sheet-c-");
    useHome(home);
    writeJson(path.join(home, ".grunt", "workspace-tokens.json"), freshToken());
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
    const { code, logs } = await withIo(() =>
      main(["sheet", "create", "--title", "Q3"]),
    );
    expect(code).toBe(0);
    expect(logs).toContain("Q3");
    expect(logs).toContain("id=sid");
    expect(calls.some((c) => c.url.includes("/drive/v3/files?"))).toBe(true);
  });

  it("sheet create --csv uploads multipart", async () => {
    const home = tmp("ws-sheet-csv-");
    useHome(home);
    writeJson(path.join(home, ".grunt", "workspace-tokens.json"), freshToken());
    stubFetch((url) => {
      if (url.includes("uploadType=multipart")) {
        return jsonRes({
          id: "sid",
          name: "csv",
          webViewLink: "https://sheet/csv",
        });
      }
      return jsonRes({ error: { message: url } }, 404);
    });
    const { code, logs } = await withIo(() =>
      main(["sheet", "create", "--title", "csv", "--csv", "a,b\n1,2"]),
    );
    expect(code).toBe(0);
    expect(logs).toContain("id=sid");
  });

  it("sheet get/set/append/clear", async () => {
    const home = tmp("ws-sheet-crud-");
    useHome(home);
    writeJson(path.join(home, ".grunt", "workspace-tokens.json"), freshToken());
    stubFetch((url) => {
      if (url.includes(":append")) {
        return jsonRes({ updates: { updatedRows: 2 } });
      }
      if (url.includes(":clear")) {
        return jsonRes({ clearedRange: "A1:Z" });
      }
      if (url.includes("/values/") && url.includes("valueInputOption")) {
        return jsonRes({ updatedRange: "Sheet1!A1" });
      }
      if (url.includes("/values/")) {
        return jsonRes({ values: [["a", "b"], ["1", "2"]] });
      }
      return jsonRes({ error: { message: url } }, 404);
    });
    const get = await withIo(() => main(["sheet", "get", "--id", "sid"]));
    expect(get.code).toBe(0);
    expect(get.logs).toContain("a\tb");
    const set = await withIo(() =>
      main(["sheet", "set", "--id", "sid", "--cell", "A1", "--value", "x"]),
    );
    expect(set.code).toBe(0);
    expect(set.logs).toMatch(/updated/);
    const append = await withIo(() =>
      main(["sheet", "append", "--id", "sid", "--csv", "a,b\n1,2"]),
    );
    expect(append.code).toBe(0);
    expect(append.logs).toMatch(/appended 2/);
    const clear = await withIo(() => main(["sheet", "clear", "--id", "sid"]));
    expect(clear.code).toBe(0);
    expect(clear.logs).toMatch(/cleared/);
  });

  it("sheet get without --id fails; set SERVICE_DISABLED is rewritten", async () => {
    const home = tmp("ws-sheet-err-");
    useHome(home);
    writeJson(path.join(home, ".grunt", "workspace-tokens.json"), freshToken());
    const missing = await withIo(() => main(["sheet", "get"]));
    expect(missing.code).toBe(1);
    expect(missing.errs).toMatch(/needs --id/);
    stubFetch(() =>
      jsonRes({ error: { message: "Sheets API has not been used" } }, 403),
    );
    const off = await withIo(() =>
      main(["sheet", "set", "--id", "sid", "--cell", "A1", "--value", "x"]),
    );
    expect(off.code).toBe(1);
    expect(off.errs).toMatch(/Sheets API is off/);
  });

  it("doc create/append and drive list", async () => {
    const home = tmp("ws-doc-");
    useHome(home);
    writeJson(path.join(home, ".grunt", "workspace-tokens.json"), freshToken());
    stubFetch((url) => {
      if (url.includes("uploadType=multipart")) {
        return jsonRes({
          id: "did",
          name: "Note",
          webViewLink: "https://doc/did",
        });
      }
      if (url.includes(":batchUpdate")) {
        return jsonRes({ documentId: "did" });
      }
      if (url.includes("/drive/v3/files?")) {
        return jsonRes({
          files: [
            {
              id: "did",
              name: "Note",
              webViewLink: "https://doc/did",
              mimeType: "application/vnd.google-apps.document",
            },
          ],
        });
      }
      return jsonRes({ error: { message: url } }, 404);
    });
    const created = await withIo(() =>
      main(["doc", "create", "--title", "Note", "--body", "hi"]),
    );
    expect(created.code).toBe(0);
    expect(created.logs).toContain("id=did");
    const appended = await withIo(() =>
      main(["doc", "append", "--id", "did", "--body", "more"]),
    );
    expect(appended.code).toBe(0);
    const listed = await withIo(() => main(["drive", "list"]));
    expect(listed.code).toBe(0);
    expect(listed.logs).toContain("Note");
  });

  it("slide create and meeting create", async () => {
    const home = tmp("ws-meet-");
    useHome(home);
    writeJson(path.join(home, ".grunt", "workspace-tokens.json"), freshToken());
    stubFetch((url, init) => {
      if (url.includes("/drive/v3/files?")) {
        return jsonRes({
          id: "sl",
          name: "Deck",
          webViewLink: "https://slides/sl",
        });
      }
      if (url.includes("/calendar/v3/calendars/primary/events")) {
        const body = JSON.parse(String(init?.body || "{}"));
        expect(body.summary).toBe("Standup");
        expect(body.attendees).toEqual([{ email: "a@b.com" }]);
        return jsonRes({
          id: "ev",
          summary: "Standup",
          htmlLink: "https://cal/ev",
        });
      }
      return jsonRes({ error: { message: url } }, 404);
    });
    const slide = await withIo(() =>
      main(["slide", "create", "--title", "Deck"]),
    );
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
    expect(meet.code).toBe(0);
    expect(meet.logs).toContain("id=ev");
  });

  it("meeting API fail prints a calendar template", async () => {
    const home = tmp("ws-meet-fail-");
    useHome(home);
    writeJson(path.join(home, ".grunt", "workspace-tokens.json"), freshToken());
    stubFetch(() => jsonRes({ error: { message: "Calendar API blocked" } }, 403));
    const { code, errs } = await withIo(() =>
      main([
        "meeting",
        "create",
        "--title",
        "X",
        "--start",
        "2030-01-01T10:00:00Z",
        "--end",
        "2030-01-01T11:00:00Z",
      ]),
    );
    expect(code).toBe(1);
    expect(errs).toMatch(/calendar\/render\?action=TEMPLATE/);
    expect(errs).toMatch(/dates=20300101T100000Z\/20300101T110000Z/);
  });

  it("mail send needs --to; send and list succeed", async () => {
    const home = tmp("ws-mail-");
    useHome(home);
    writeJson(path.join(home, ".grunt", "workspace-tokens.json"), freshToken());
    const missing = await withIo(() => main(["mail", "send"]));
    expect(missing.code).toBe(1);
    expect(missing.errs).toMatch(/needs --to/);
    stubFetch((url) => {
      if (url.includes("/messages/send")) {
        return jsonRes({ id: "m1" });
      }
      if (url.includes("/messages?")) {
        return jsonRes({ messages: [{ id: "m1" }, { id: "m2" }] });
      }
      return jsonRes({ error: { message: url } }, 404);
    });
    const sent = await withIo(() =>
      main(["mail", "send", "--to", "a@b.com", "--subject", "Hi", "--body", "x"]),
    );
    expect(sent.code).toBe(0);
    expect(sent.logs).toContain("sent id=m1");
    const listed = await withIo(() => main(["mail", "list"]));
    expect(listed.code).toBe(0);
    expect(listed.logs).toContain("m1");
  });

  it("scopes lists tokeninfo", async () => {
    const home = tmp("ws-scopes-");
    useHome(home);
    writeJson(path.join(home, ".grunt", "workspace-tokens.json"), freshToken());
    stubFetch((url) => {
      if (url.includes("tokeninfo")) {
        return jsonRes({
          scope: "https://www.googleapis.com/auth/spreadsheets email",
        });
      }
      return jsonRes({ error: { message: url } }, 404);
    });
    const { code, logs } = await withIo(() => main(["scopes"]));
    expect(code).toBe(0);
    expect(logs).toMatch(/spreadsheets/);
  });

  it("login without creds or gcloud prints setup", async () => {
    const home = tmp("ws-login-");
    useHome(home);
    child.mock.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "",
    } as ReturnType<typeof spawnSync>);
    const { code, errs } = await withIo(() => main(["login"]));
    expect(code).toBe(1);
    expect(errs).toMatch(/Desktop OAuth client/);
    expect(errs).toMatch(/google-oauth\.json/);
  });

  it("refreshes an expired store token", async () => {
    const home = tmp("ws-refresh-");
    useHome(home);
    const store = path.join(home, ".grunt", "workspace-tokens.json");
    writeJson(store, {
      ...freshToken(),
      access_token: "old",
      expiry_date: Date.now() - 1000,
    });
    stubFetch((url) => {
      if (url.includes("oauth2.googleapis.com/token")) {
        return jsonRes({ access_token: "new", expires_in: 3600 });
      }
      return jsonRes({ error: { message: url } }, 404);
    });
    await expect(accessToken()).resolves.toBe("new");
    const saved = JSON.parse(fs.readFileSync(store, "utf8"));
    expect(saved.access_token).toBe("new");
  });

  it("loads clasprc then ADC when store is empty", async () => {
    const clasprcHome = tmp("ws-clasp-");
    useHome(clasprcHome);
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

    const adcHome = tmp("ws-adc-");
    useHome(adcHome);
    writeJson(
      path.join(
        adcHome,
        ".config",
        "gcloud",
        "application_default_credentials.json",
      ),
      { type: "authorized_user", ...freshToken(), access_token: "adc-at" },
    );
    stubFetch((url) => {
      if (url.includes("oauth2/v2/userinfo")) return jsonRes({ email: "adc@x" });
      return jsonRes({ error: { message: url } }, 404);
    });
    const adc = await withIo(() => main(["whoami"]));
    expect(adc.code).toBe(0);
    expect(adc.logs).toContain("adc@x");
  });

  it("createFile rejects an unknown kind", async () => {
    await expect(createFile({ kind: "nope" })).rejects.toThrow(/unknown kind/);
  });
});

describe("google-workspace cli", () => {
  it("no args prints usage and exits 1", () => {
    if (!child.impl) throw new Error("spawnSync original missing");
    const r = child.impl(process.execPath, [script], {
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(r.status).toBe(1);
    expect(String(r.stderr)).toContain("usage: google-workspace");
  });
});
