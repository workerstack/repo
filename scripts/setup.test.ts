import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  ELEVENLABS_KEY_URL,
  OPENAI_KEY_URL,
  USAGE,
  findDownloadedOAuthJson,
  firstMissing,
  formatStatus,
  installOAuthJson,
  main,
  menuOptions,
  mergeSpeakJson,
  normalizeTarget,
  oauthWritePath,
  parseArgv,
  parseDesktopOAuth,
  setupBrowser,
  setupGoogleWorkspace,
  setupListen,
  setupSpeak,
  targetStatuses,
  workspaceConsoleUrls,
} from "./setup.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "setup.mjs");

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmp(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function captureIo() {
  const logs: string[] = [];
  const errs: string[] = [];
  const opened: string[] = [];
  return {
    logs,
    errs,
    opened,
    log: (s: string) => logs.push(String(s)),
    error: (s: string) => errs.push(String(s)),
  };
}

const desktopOauth = {
  installed: {
    client_id: "cid.apps.googleusercontent.com",
    client_secret: "cs",
    redirect_uris: ["http://127.0.0.1"],
  },
};

describe("parseArgv / normalizeTarget", () => {
  it("reads target and key flags", () => {
    expect(
      parseArgv(["speak", "--elevenlabs-key", "sk_el", "--skip-verify"]),
    ).toEqual({
      _: ["speak"],
      flags: { "elevenlabs-key": "sk_el", "skip-verify": "1" },
    });
  });

  it("reads --key=value", () => {
    expect(parseArgv(["speak", "--openai-key=sk-oa"])).toEqual({
      _: ["speak"],
      flags: { "openai-key": "sk-oa" },
    });
  });

  it("aliases google targets", () => {
    expect(normalizeTarget("gw")).toBe("google-workspace");
    expect(normalizeTarget("google")).toBe("google-workspace");
    expect(normalizeTarget("speak")).toBe("speak");
    expect(normalizeTarget("nope")).toBe("");
  });
});

describe("speak.json / oauth helpers", () => {
  it("merges providers without dropping the other", () => {
    const home = tmp("setup-merge-");
    mergeSpeakJson(home, { elevenlabs: { apiKey: "sk_el" } });
    const dest = mergeSpeakJson(home, { openai: { apiKey: "sk_oa" } });
    const j = JSON.parse(fs.readFileSync(dest, "utf8"));
    expect(j.elevenlabs.apiKey).toBe("sk_el");
    expect(j.openai.apiKey).toBe("sk_oa");
  });

  it("rejects web OAuth clients", () => {
    expect(() =>
      parseDesktopOAuth({ web: { client_id: "cid" } }),
    ).toThrow(/Desktop client/);
  });

  it("installs Desktop JSON to dest", () => {
    const home = tmp("setup-oauth-");
    const src = path.join(home, "client_secret_x.json");
    fs.writeFileSync(src, JSON.stringify(desktopOauth));
    const dest = path.join(home, ".grunt", "google-oauth.json");
    installOAuthJson({ src, dest });
    const j = JSON.parse(fs.readFileSync(dest, "utf8"));
    expect(j.installed.client_id).toBe("cid.apps.googleusercontent.com");
  });

  it("finds newest client_secret in Downloads", () => {
    const home = tmp("setup-dl-");
    const dir = path.join(home, "Downloads");
    fs.mkdirSync(dir);
    const a = path.join(dir, "client_secret_old.json");
    const b = path.join(dir, "client_secret_new.json");
    fs.writeFileSync(a, "{}");
    fs.writeFileSync(b, "{}");
    const t = Date.now();
    fs.utimesSync(a, t / 1000, (t - 5000) / 1000);
    fs.utimesSync(b, t / 1000, t / 1000);
    expect(findDownloadedOAuthJson(home)).toBe(b);
  });

  it("default oauth write path is ~/.grunt/google-oauth.json", () => {
    const home = tmp("setup-owp-");
    expect(oauthWritePath(home, "default")).toBe(
      path.join(home, ".grunt", "google-oauth.json"),
    );
    expect(oauthWritePath(home, "work")).toBe(
      path.join(home, ".grunt", "workspace", "work", "google-oauth.json"),
    );
  });

  it("workspace URLs include project id", () => {
    const u = workspaceConsoleUrls("my-proj");
    expect(u.projectCreate).toMatch(/projectcreate/);
    expect(u.branding).toContain("project=my-proj");
    expect(u.enableApis).toContain("gmail.googleapis.com");
    expect(u.clientCreate).toContain("project=my-proj");
  });
});

describe("targetStatuses / menu", () => {
  it("marks speak and workspace from ~/.grunt files", () => {
    const home = tmp("setup-st-");
    mergeSpeakJson(home, { openai: { apiKey: "sk_x" } });
    fs.mkdirSync(path.join(home, ".grunt"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".grunt", "google-oauth.json"),
      JSON.stringify(desktopOauth),
    );
    const st = targetStatuses({
      home,
      env: {},
      whichFn: () => "",
      pathEnv: "/none",
      platform: "linux",
    });
    expect(st.speak.ok).toBe(true);
    expect(st["google-workspace"].ok).toBe(true);
    expect(st.listen.ok).toBe(true);
    expect(st.listen.extra).toMatch(/openai/);
    expect(st.browser.ok).toBe(false);
    expect(formatStatus(st)).toMatch(/speak  ok/);
    expect(formatStatus(st)).toMatch(/browser  missing/);
    expect(firstMissing(st)).toBe("browser");
    const labels = menuOptions(st).map((o) => o.label);
    expect(labels[0]).toMatch(/ok/);
    expect(labels[3]).toMatch(/missing/);
  });
});

describe("setupSpeak", () => {
  it("writes elevenlabs key, verifies, does not echo the secret", async () => {
    const home = tmp("setup-speak-");
    const io = captureIo();
    const r = await setupSpeak({
      flags: { "elevenlabs-key": "sk_secret_el", "skip-verify": "1" },
      home,
      io,
    });
    expect(r.ok).toBe(true);
    const j = JSON.parse(fs.readFileSync(path.join(home, ".grunt", "speak.json"), "utf8"));
    expect(j.elevenlabs.apiKey).toBe("sk_secret_el");
    expect(io.logs.join("\n")).toMatch(/speak\.json/);
    expect(io.logs.join("\n")).not.toContain("sk_secret_el");
  });

  it("verifies openai via fetch", async () => {
    const home = tmp("setup-speak-oa-");
    const io = captureIo();
    const r = await setupSpeak({
      flags: { "openai-key": "sk-oa", provider: "openai" },
      home,
      io,
      fetchFn: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
        text: async () => "",
      }),
    });
    expect(r.verified).toBe(true);
    expect(io.logs.join("\n")).toMatch(/openai ok/);
    expect(io.logs.join("\n")).not.toContain("sk-oa");
  });

  it("interactive elevenlabs opens the key page and takes a password", async () => {
    const home = tmp("setup-speak-tty-");
    const io = {
      ...captureIo(),
      select: async () => "elevenlabs",
      password: async () => "sk_from_prompt",
    };
    const opened: string[] = [];
    await setupSpeak({
      flags: { "skip-verify": "1" },
      home,
      io,
      interactive: true,
      openUrlFn: (u: string) => opened.push(u),
    });
    expect(opened).toEqual([ELEVENLABS_KEY_URL]);
    const j = JSON.parse(fs.readFileSync(path.join(home, ".grunt", "speak.json"), "utf8"));
    expect(j.elevenlabs.apiKey).toBe("sk_from_prompt");
  });
});

describe("setupListen", () => {
  it("openai fallback writes speak.json and does not echo the key", async () => {
    const home = tmp("setup-listen-");
    const io = captureIo();
    const r = await setupListen({
      flags: { "openai-key": "sk_listen", "skip-download": "1" },
      home,
      io,
      env: {},
      whichFn: () => "",
      pathEnv: "/none",
      platform: "linux",
    });
    expect(r.stt?.kind).toBe("openai");
    const j = JSON.parse(fs.readFileSync(path.join(home, ".grunt", "speak.json"), "utf8"));
    expect(j.openai.apiKey).toBe("sk_listen");
    expect(io.logs.join("\n")).toMatch(/stt=openai/);
    expect(io.logs.join("\n")).not.toContain("sk_listen");
    expect(io.logs.join("\n")).toMatch(/ffmpeg missing/);
  });

  it("re-checks PATH after install confirm", async () => {
    const home = tmp("setup-listen-re-");
    const seen = { ffmpeg: 0 };
    const io = {
      ...captureIo(),
      confirm: async () => true,
    };
    await setupListen({
      flags: { "openai-key": "sk_re", "skip-download": "1" },
      home,
      io,
      env: {},
      interactive: true,
      whichFn: (name: string) => {
        if (name === "ffmpeg") {
          seen.ffmpeg += 1;
          return seen.ffmpeg > 1 ? "/usr/bin/ffmpeg" : "";
        }
        return "";
      },
      pathEnv: "/none",
      platform: "linux",
    });
    expect(seen.ffmpeg).toBeGreaterThan(1);
    expect(io.logs.join("\n")).toMatch(/ffmpeg ok/);
  });

  it("non-interactive without local STT or key fails", async () => {
    const home = tmp("setup-listen-miss-");
    await expect(
      setupListen({
        flags: { "skip-download": "1" },
        home,
        io: captureIo(),
        env: {},
        whichFn: () => "",
        pathEnv: "/none",
        platform: "linux",
      }),
    ).rejects.toThrow(/whisper-cli or --openai-key/);
  });
});

describe("setupGoogleWorkspace", () => {
  it("copies --creds and calls login", async () => {
    const home = tmp("setup-gw-");
    const src = path.join(home, "client_secret.json");
    fs.writeFileSync(src, JSON.stringify(desktopOauth));
    const io = captureIo();
    const logins: string[] = [];
    const r = await setupGoogleWorkspace({
      flags: { creds: src },
      home,
      io,
      loginFn: async (p: string) => {
        logins.push(p);
      },
    });
    expect(r.ok).toBe(true);
    expect(logins).toEqual([path.join(home, ".grunt", "google-oauth.json")]);
    const saved = JSON.parse(
      fs.readFileSync(path.join(home, ".grunt", "google-oauth.json"), "utf8"),
    );
    expect(saved.installed.client_id).toContain("cid");
  });

  it("interactive walk opens console URLs then installs JSON", async () => {
    const home = tmp("setup-gw-tty-");
    const src = path.join(home, "dl.json");
    fs.writeFileSync(src, JSON.stringify(desktopOauth));
    const opened: string[] = [];
    const io = {
      ...captureIo(),
      confirm: async () => true,
      text: async (opts: { message?: string }) => {
        if (String(opts.message || "").includes("Project ID")) return "proj-1";
        return src;
      },
    };
    await setupGoogleWorkspace({
      flags: {},
      home,
      io,
      interactive: true,
      openUrlFn: (u: string) => opened.push(u),
      loginFn: async () => {},
    });
    expect(opened[0]).toMatch(/projectcreate/);
    expect(opened.some((u) => u.includes("project=proj-1"))).toBe(true);
    expect(opened.some((u) => u.includes("enableapi"))).toBe(true);
    expect(opened.some((u) => u.includes("clients/create"))).toBe(true);
    expect(
      fs.existsSync(path.join(home, ".grunt", "google-oauth.json")),
    ).toBe(true);
  });
});

describe("setupBrowser", () => {
  it("prints install hints when engines are missing", async () => {
    const io = captureIo();
    const r = await setupBrowser({
      io,
      platform: "linux",
      pathEnv: "/none",
      whichFn: () => "",
    });
    expect(r.ok).toBe(false);
    expect(io.logs.join("\n")).toMatch(/lightpanda missing/);
    expect(io.logs.join("\n")).toMatch(/chromium missing/);
    expect(io.logs.join("\n")).toMatch(/\.tmp\/grunt\/browser/);
  });

  it("chromium-only on linux is not done; advises Lightpanda", async () => {
    const io = captureIo();
    const r = await setupBrowser({
      io,
      platform: "linux",
      pathEnv: "/none",
      whichFn: (name: string) => (name === "chromium" ? "/home/ecomet/bin/chromium" : ""),
    });
    expect(r.ok).toBe(false);
    expect(r.chromium).toBe("/home/ecomet/bin/chromium");
    expect(io.logs.join("\n")).toMatch(/Install Lightpanda as well/);
    const st = targetStatuses({
      home: tmp("setup-br-st-"),
      env: {},
      whichFn: (name: string) => (name === "chromium" ? "/home/ecomet/bin/chromium" : ""),
      pathEnv: "/none",
      platform: "linux",
    });
    expect(st.browser.ok).toBe(false);
    expect(st.browser.extra).toMatch(/need lightpanda/);
  });

  it("re-checks PATH after install confirm", async () => {
    let n = 0;
    const io = { ...captureIo(), confirm: async () => true };
    const r = await setupBrowser({
      io,
      interactive: true,
      platform: "linux",
      pathEnv: "/none",
      whichFn: (name: string) => {
        if (name === "lightpanda") {
          n += 1;
          return n > 1 ? "/usr/bin/lightpanda" : "";
        }
        return "";
      },
    });
    expect(r.lightpanda).toBe("/usr/bin/lightpanda");
    expect(io.logs.join("\n")).toMatch(/lightpanda ok/);
    expect(io.logs.join("\n")).toMatch(/chromium still missing/);
  });
});

describe("main", () => {
  it("no target non-interactive prints usage", async () => {
    const io = captureIo();
    const code = await main([], {
      io,
      interactive: false,
      home: tmp("setup-main-"),
      stdin: { isTTY: false },
      stdout: { isTTY: false },
      env: { CI: "1" },
    });
    expect(code).toBe(1);
    expect(io.errs.join("\n")).toContain("usage: setup");
  });

  it("TTY menu labels include status and prefers first missing", async () => {
    const home = tmp("setup-menu-");
    mergeSpeakJson(home, { elevenlabs: { apiKey: "sk_el" } });
    const io = {
      ...captureIo(),
      select: async (opts: { options: { value: string; label: string }[]; initialValue: string }) => {
        expect(opts.initialValue).toBe("listen");
        expect(opts.options[0].label).toMatch(/ok/);
        expect(opts.options[1].label).toMatch(/missing/);
        return "browser";
      },
    };
    const code = await main([], {
      io,
      interactive: true,
      home,
      env: { HOME: home },
      whichFn: () => "",
      pathEnv: "/none",
      platform: "linux",
    });
    expect(code).toBe(0);
    expect(io.logs.join("\n")).toMatch(/browser  missing/);
  });

  it("skips already-ok speak unless redo", async () => {
    const home = tmp("setup-skip-");
    mergeSpeakJson(home, { openai: { apiKey: "sk_old" } });
    const io = { ...captureIo(), confirm: async () => false };
    const code = await main(["speak"], {
      io,
      interactive: true,
      home,
      env: { HOME: home },
    });
    expect(code).toBe(0);
    expect(io.logs.join("\n")).toMatch(/skip speak/);
  });

  it("speak flag path through main", async () => {
    const home = tmp("setup-main-speak-");
    const io = captureIo();
    const code = await main(
      ["speak", "--elevenlabs-key", "sk_m", "--skip-verify"],
      { io, interactive: false, home, env: { HOME: home } },
    );
    expect(code).toBe(0);
    expect(
      JSON.parse(fs.readFileSync(path.join(home, ".grunt", "speak.json"), "utf8"))
        .elevenlabs.apiKey,
    ).toBe("sk_m");
  });

  it("CLI no args exits 1", () => {
    const r = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, CI: "1" },
      timeout: 15_000,
    });
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toContain("usage: setup");
    expect(USAGE).toMatch(/speak/);
    expect(OPENAI_KEY_URL).toMatch(/openai/);
  });
});
