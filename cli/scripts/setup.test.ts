import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { bunPath } from "../../dev/test-paths";
import { childEnv } from "../env.ts";
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
  setupJev,
  setupListen,
  setupSpeak,
  targetStatuses,
  workspaceConsoleUrls,
} from "./setup.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoCli = path.join(here, "..", "..", "bin", "repo.ts");

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { force: true, recursive: true });
  }
});

function enablePacks(cwd: string, packs = ["speak", "listen", "google-workspace", "clasp"]) {
  fs.writeFileSync(
    path.join(cwd, "workerstack.config.ts"),
    `export default { packs: ["agents"], agents: { skills: ${JSON.stringify(packs)} } }\n`,
  );
  return cwd;
}

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
    error: (s: string) => errs.push(String(s)),
    errs,
    log: (s: string) => logs.push(String(s)),
    logs,
    opened,
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
    expect(parseArgv(["speak", "--elevenlabs-key", "sk_el", "--skip-verify"])).toStrictEqual({
      _: ["speak"],
      flags: { "elevenlabs-key": "sk_el", "skip-verify": "1" },
    });
  });

  it("reads --key=value", () => {
    expect(parseArgv(["speak", "--openai-key=sk-oa"])).toStrictEqual({
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
    const j = JSON.parse(fs.readFileSync(dest, "utf8")) as {
      elevenlabs: { apiKey: string };
      openai: { apiKey: string };
    };
    expect(j.elevenlabs.apiKey).toBe("sk_el");
    expect(j.openai.apiKey).toBe("sk_oa");
  });

  it("rejects web OAuth clients", () => {
    expect(() => parseDesktopOAuth({ web: { client_id: "cid" } })).toThrow(/Desktop client/);
  });

  it("installs Desktop JSON to dest", () => {
    const home = tmp("setup-oauth-");
    const src = path.join(home, "client_secret_x.json");
    fs.writeFileSync(src, JSON.stringify(desktopOauth));
    const dest = path.join(home, ".workerstack", "workspace", "default", "google-oauth.json");
    installOAuthJson({ dest, src });
    const j = JSON.parse(fs.readFileSync(dest, "utf8")) as { installed: { client_id: string } };
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

  it("oauth write path is ~/.workerstack/workspace/NAME/google-oauth.json", () => {
    const home = tmp("setup-owp-");
    expect(oauthWritePath(home, "default")).toBe(
      path.join(home, ".workerstack", "workspace", "default", "google-oauth.json"),
    );
    expect(oauthWritePath(home, "work")).toBe(
      path.join(home, ".workerstack", "workspace", "work", "google-oauth.json"),
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
  it("marks speak and workspace from ~/.workerstack files", async () => {
    const home = tmp("setup-st-");
    mergeSpeakJson(home, { openai: { apiKey: "sk_x" } });
    fs.mkdirSync(path.join(home, ".workerstack", "workspace", "default"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".workerstack", "workspace", "default", "google-oauth.json"),
      JSON.stringify(desktopOauth),
    );
    const st = await targetStatuses({
      env: {},
      home,
      pathEnv: "/none",
      platform: "linux",
      whichFn: () => "",
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

describe("setupJev", () => {
  it("writes jev.json mode 0600 and does not echo the key", async () => {
    const home = tmp("setup-jev-");
    const io = captureIo();
    const secret = "ts_live_do_not_print";
    const r = await setupJev({ flags: { "api-key": secret }, home, io });
    expect(r.ok).toBe(true);
    const raw = fs.readFileSync(r.dest, "utf8");
    expect((JSON.parse(raw) as { apiKey: string }).apiKey).toBe(secret);
    if (process.platform !== "win32") {
      expect(fs.statSync(r.dest).mode & 0o777).toBe(0o600);
    }
    expect(io.logs.join("\n")).not.toContain(secret);
    expect(normalizeTarget("jev")).toBe("jev");
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
    const j = JSON.parse(fs.readFileSync(path.join(home, ".workerstack", "speak.json"), "utf8")) as {
      elevenlabs: { apiKey: string };
    };
    expect(j.elevenlabs.apiKey).toBe("sk_secret_el");
    expect(io.logs.join("\n")).toMatch(/speak\.json/);
    expect(io.logs.join("\n")).not.toContain("sk_secret_el");
  });

  it("verifies openai via fetch", async () => {
    const home = tmp("setup-speak-oa-");
    const io = captureIo();
    const r = await setupSpeak({
      fetchFn: async () => ({
        json: async () => ({ data: [] }),
        ok: true,
        status: 200,
        text: async () => "",
      }),
      flags: { "openai-key": "sk-oa", provider: "openai" },
      home,
      io,
    });
    expect(r.verified).toBe(true);
    expect(io.logs.join("\n")).toMatch(/openai ok/);
    expect(io.logs.join("\n")).not.toContain("sk-oa");
  });

  it("interactive elevenlabs opens the key page and takes a password", async () => {
    const home = tmp("setup-speak-tty-");
    const io = {
      ...captureIo(),
      password: async () => "sk_from_prompt",
      select: async () => "elevenlabs",
    };
    const opened: string[] = [];
    await setupSpeak({
      flags: { "skip-verify": "1" },
      home,
      interactive: true,
      io,
      openUrlFn: (u: string) => opened.push(u),
    });
    expect(opened).toStrictEqual([ELEVENLABS_KEY_URL]);
    const j = JSON.parse(fs.readFileSync(path.join(home, ".workerstack", "speak.json"), "utf8")) as {
      elevenlabs: { apiKey: string };
    };
    expect(j.elevenlabs.apiKey).toBe("sk_from_prompt");
  });
});

describe("setupListen", () => {
  it("openai fallback writes speak.json and does not echo the key", async () => {
    const home = tmp("setup-listen-");
    const io = captureIo();
    const r = await setupListen({
      env: {},
      flags: { "openai-key": "sk_listen", "skip-download": "1" },
      home,
      io,
      pathEnv: "/none",
      platform: "linux",
      whichFn: () => "",
    });
    expect(r.stt?.kind).toBe("openai");
    const j = JSON.parse(fs.readFileSync(path.join(home, ".workerstack", "speak.json"), "utf8")) as {
      openai: { apiKey: string };
    };
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
      env: {},
      flags: { "openai-key": "sk_re", "skip-download": "1" },
      home,
      interactive: true,
      io,
      pathEnv: "/none",
      platform: "linux",
      whichFn: (name: string) => {
        if (name === "ffmpeg") {
          seen.ffmpeg += 1;
          return seen.ffmpeg > 1 ? "/usr/bin/ffmpeg" : "";
        }
        return "";
      },
    });
    expect(seen.ffmpeg).toBeGreaterThan(1);
    expect(io.logs.join("\n")).toMatch(/ffmpeg ok/);
  });

  it("non-interactive without local STT or key fails", async () => {
    const home = tmp("setup-listen-miss-");
    await expect(
      setupListen({
        env: {},
        flags: { "skip-download": "1" },
        home,
        io: captureIo(),
        pathEnv: "/none",
        platform: "linux",
        whichFn: () => "",
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
    expect(logins).toStrictEqual([path.join(home, ".workerstack", "workspace", "default", "google-oauth.json")]);
    const saved = JSON.parse(
      fs.readFileSync(path.join(home, ".workerstack", "workspace", "default", "google-oauth.json"), "utf8"),
    ) as { installed: { client_id: string } };
    expect(saved.installed.client_id).toContain("cid");
  });

  it("lands the tokens under the home it was given and writes nothing under the real home", async () => {
    const home = tmp("setup-gw-home-");
    const src = path.join(home, "client_secret.json");
    fs.writeFileSync(src, JSON.stringify(desktopOauth));
    const realTokens = path.join(os.homedir(), ".workerstack", "workspace", "default", "tokens.json");
    const mtime = () => (fs.existsSync(realTokens) ? fs.statSync(realTokens).mtimeMs : null);
    const before = mtime();
    const r = await setupGoogleWorkspace({
      flags: { creds: src },
      home,
      io: captureIo(),
      loginFn: (_dest: string, loginHome: string) => {
        const tokens = path.join(loginHome, ".workerstack", "workspace", "default", "tokens.json");
        fs.mkdirSync(path.dirname(tokens), { recursive: true });
        fs.writeFileSync(tokens, "{}");
        return Promise.resolve();
      },
    });
    expect(r.tokens).toBe(path.join(home, ".workerstack", "workspace", "default", "tokens.json"));
    expect(fs.existsSync(r.tokens)).toBe(true);
    expect(mtime()).toBe(before);
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
      interactive: true,
      io,
      loginFn: async () => {},
      openUrlFn: (u: string) => opened.push(u),
    });
    expect(opened[0]).toMatch(/projectcreate/);
    expect(opened.some((u) => u.includes("project=proj-1"))).toBe(true);
    expect(opened.some((u) => u.includes("enableapi"))).toBe(true);
    expect(opened.some((u) => u.includes("clients/create"))).toBe(true);
    expect(fs.existsSync(path.join(home, ".workerstack", "workspace", "default", "google-oauth.json"))).toBe(true);
  });
});

describe("setupBrowser", () => {
  it("prints install hints when engines are missing", async () => {
    const io = captureIo();
    const r = await setupBrowser({
      io,
      pathEnv: "/none",
      platform: "linux",
      whichFn: () => "",
    });
    expect(r.ok).toBe(false);
    expect(io.logs.join("\n")).toMatch(/lightpanda missing/);
    expect(io.logs.join("\n")).toMatch(/chromium missing/);
    expect(io.logs.join("\n")).toMatch(/\.tmp\/repo\/browser/);
  });

  it("chromium-only on linux is not done; advises Lightpanda", async () => {
    const io = captureIo();
    const r = await setupBrowser({
      io,
      pathEnv: "/none",
      platform: "linux",
      whichFn: (name: string) => (name === "chromium" ? "/home/ecomet/bin/chromium" : ""),
    });
    expect(r.ok).toBe(false);
    expect(r.chromium).toBe("/home/ecomet/bin/chromium");
    expect(io.logs.join("\n")).toMatch(/Install Lightpanda as well/);
    const st = await targetStatuses({
      env: {},
      home: tmp("setup-br-st-"),
      pathEnv: "/none",
      platform: "linux",
      whichFn: (name: string) => (name === "chromium" ? "/home/ecomet/bin/chromium" : ""),
    });
    expect(st.browser.ok).toBe(false);
    expect(st.browser.extra).toMatch(/need lightpanda/);
  });

  it("re-checks PATH after install confirm", async () => {
    let n = 0;
    const io = { ...captureIo(), confirm: async () => true };
    const r = await setupBrowser({
      interactive: true,
      io,
      pathEnv: "/none",
      platform: "linux",
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
      env: { CI: "1" },
      home: tmp("setup-main-"),
      interactive: false,
      io,
      pathEnv: "/none",
      platform: "linux",
      stdin: { isTTY: false },
      stdout: { isTTY: false },
      whichFn: () => "",
    });
    expect(code).toBe(1);
    expect(io.errs.join("\n")).toContain("usage: setup");
  });

  it("TTY menu labels include status and prefers first missing", async () => {
    const home = tmp("setup-menu-");
    const cwd = enablePacks(tmp("setup-menu-cwd-"));
    mergeSpeakJson(home, { elevenlabs: { apiKey: "sk_el" } });
    const io = {
      ...captureIo(),
      select: async (opts: { options: { value: string; label: string }[]; initialValue: string }) => {
        expect(opts.initialValue).toBe("listen");
        expect(opts.options[0]!.label).toMatch(/ok/);
        expect(opts.options[1]!.label).toMatch(/missing/);
        return "browser";
      },
    };
    const code = await main([], {
      cwd,
      env: { HOME: home },
      home,
      interactive: true,
      io,
      pathEnv: "/none",
      platform: "linux",
      whichFn: () => "",
    });
    expect(code).toBe(0);
    expect(io.logs.join("\n")).toMatch(/browser  missing/);
  });

  it("skips already-ok speak unless redo", async () => {
    const home = tmp("setup-skip-");
    const cwd = enablePacks(tmp("setup-skip-cwd-"), ["speak"]);
    mergeSpeakJson(home, { openai: { apiKey: "sk_old" } });
    const io = { ...captureIo(), confirm: async () => false };
    const code = await main(["speak"], {
      cwd,
      env: { HOME: home },
      home,
      interactive: true,
      io,
      pathEnv: "/none",
      platform: "linux",
      whichFn: () => "",
    });
    expect(code).toBe(0);
    expect(io.logs.join("\n")).toMatch(/skip speak/);
  });

  it("speak flag path through main", async () => {
    const home = tmp("setup-main-speak-");
    const cwd = enablePacks(tmp("setup-main-speak-cwd-"), ["speak"]);
    const io = captureIo();
    const code = await main(["speak", "--elevenlabs-key", "sk_m", "--skip-verify"], {
      cwd,
      env: { HOME: home },
      home,
      interactive: false,
      io,
      pathEnv: "/none",
      platform: "linux",
      whichFn: () => "",
    });
    expect(code).toBe(0);
    expect(
      (
        JSON.parse(fs.readFileSync(path.join(home, ".workerstack", "speak.json"), "utf8")) as {
          elevenlabs: { apiKey: string };
        }
      ).elevenlabs.apiKey,
    ).toBe("sk_m");
  });

  it("menu without a features file lists browser and jev only", async () => {
    const cwd = tmp("setup-menu-off-");
    const io = {
      ...captureIo(),
      select: async (opts: { options: { value: string }[] }) => {
        expect(opts.options.map((o) => o.value)).toStrictEqual(["browser", "jev"]);
        return "browser";
      },
    };
    const code = await main([], {
      cwd,
      home: tmp("setup-menu-off-home-"),
      interactive: true,
      io,
      pathEnv: "/none",
      platform: "linux",
      whichFn: () => "",
    });
    expect(code).toBe(0);
  });

  it("a disabled pack prints how to enable it", async () => {
    const io = captureIo();
    const code = await main(["listen"], {
      cwd: tmp("setup-listen-off-"),
      env: { CI: "1" },
      home: tmp("setup-listen-off-home-"),
      interactive: false,
      io,
      pathEnv: "/none",
      platform: "linux",
      whichFn: () => "",
    });
    expect(code).toBe(1);
    expect(io.errs.join("\n")).toMatch(/agents\.skills/);
    expect(io.errs.join("\n")).toMatch(/bun repo sync/);
  });

  it("CLI no args exits 1", () => {
    const r = spawnSync(bunPath(), [repoCli, "setup"], {
      encoding: "utf8",
      env: childEnv({ CI: "1" }),
      timeout: 15_000,
    });
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toContain("usage: setup");
    expect(USAGE).toMatch(/speak/);
    expect(OPENAI_KEY_URL).toMatch(/openai/);
  });
});
