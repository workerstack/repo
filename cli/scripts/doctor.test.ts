import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { bunPath } from "../../dev/test-paths";
import { childEnv } from "../env.ts";
import {
  BUN_MIN_FALLBACK,
  type ListResult,
  type ListRunner,
  CHROMIUM_BINS,
  agentModelsLines,
  globalsRow,
  installHints,
  loadOptionalConsumerEnv,
  runDoctor as runDoctorImpl,
  whichBin,
} from "./doctor.ts";
import { syncGlobals } from "./sync-global-settings.ts";

function runDoctor(opts: Record<string, unknown> = {}) {
  return runDoctorImpl({
    env: {},
    home: path.join(os.tmpdir(), "repo-doctor-no-speak"),
    skills,
    ...opts,
  });
}

const here = path.dirname(fileURLToPath(import.meta.url));
const script = fileURLToPath(new URL("../../bin/repo.ts", import.meta.url));

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { force: true, recursive: true });
  }
});

function tmp(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

/** The skill packs the next `runDoctor` call sees as `agents.skills`. */
let skills: readonly string[] = [];
afterEach(() => {
  skills = [];
});

function enablePacks(packs = ["clasp", "google-workspace", "listen", "speak"]) {
  skills = packs;
}

function expectStdoutPath(stdout: string, abs: string) {
  expect(stdout.toLowerCase()).toContain(abs.toLowerCase());
}

function writeBin(dir: string, name: string, body = "#!/bin/sh\nexit 0\n") {
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === "win32") {
    const dest = path.join(dir, `${name}.cmd`);
    fs.writeFileSync(dest, "@echo off\r\nexit /b 0\r\n");
    return dest;
  }
  const dest = path.join(dir, name);
  fs.writeFileSync(dest, body, { mode: 0o755 });
  return dest;
}

function writeBun(dir: string, version = "1.4.4") {
  if (process.platform === "win32") {
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, "bun.cmd");
    fs.writeFileSync(dest, `@echo off\r\nif "%~1"=="--version" echo ${version}\r\nexit /b 0\r\n`);
    return dest;
  }
  return writeBin(dir, "bun", `#!/bin/sh\n[ "$1" = "--version" ] && echo ${version} && exit 0\nexit 0\n`);
}

const REQUIRED = ["bun", "git", "rtk", "lightpanda", "chromium"];

function writeRequired(dir: string, extra: Record<string, string> = {}) {
  writeBun(dir);
  writeBin(dir, "git");
  writeBin(dir, "rtk");
  writeBin(dir, extra.lightpandaName || "lightpanda");
  writeBin(dir, extra.chromiumName || "chromium");
}

const BOTH_MARKERS = [
  "# Index",
  "<!-- repo:skills -->",
  "<!-- /repo:skills -->",
  "<!-- repo:refs -->",
  "<!-- /repo:refs -->",
  "<!-- repo:stack -->",
  "<!-- /repo:stack -->",
  "",
].join("\n");

function writeSelfPackage(cwd: string, name = "@workerstack/repo") {
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name }));
}

function writeRequiredMaps(cwd: string, index = BOTH_MARKERS) {
  writeSelfPackage(cwd);
  fs.mkdirSync(path.join(cwd, "references"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "references", "INDEX.md"), index);
}

describe("CHROMIUM_BINS", () => {
  it("matches browser family names", () => {
    expect(CHROMIUM_BINS).toStrictEqual([
      "chromium",
      "chromium-browser",
      "google-chrome",
      "google-chrome-stable",
      "chrome",
      "msedge",
      "microsoft-edge",
    ]);
  });
});

describe("installHints", () => {
  it("linux/darwin/win32 print-only strings; no playwright install", () => {
    const linux = installHints("all", "linux").join("\n");
    const darwin = installHints("all", "darwin").join("\n");
    const win = installHints("all", "win32").join("\n");
    for (const t of [linux, darwin, win]) {
      expect(t).not.toMatch(/playwright install/);
      expect(t).not.toMatch(/nodejs|node/i);
      expect(t).not.toMatch(/rulesync/);
    }
    expect(linux).toMatch(/apt install git|apt install.*git/);
    expect(linux).toMatch(/curl -fsSL https:\/\/raw\.githubusercontent\.com\/rtk-ai\/rtk\/master\/install\.sh \| sh/);
    expect(linux).toMatch(/pkg\.lightpanda\.io\/install\.sh/);
    expect(linux).toMatch(/apt install chromium/);
    expect(darwin).toMatch(/brew install git/);
    expect(darwin).toMatch(/brew install rtk/);
    expect(darwin).toMatch(/brew tap lightpanda-io\/browser/);
    expect(darwin).toMatch(/brew install --cask chromium|brew install --cask google-chrome/);
    expect(win).toMatch(/winget install Git\.Git/);
    expect(win).toMatch(/rtk\.exe|WSL/);
    expect(win).toMatch(/rtk-ai\.app\/docs\/getting-started\/installation/);
    expect(win).toMatch(/winget install Google\.Chrome/);
    expect(win).toMatch(/winget install Microsoft\.Edge/);
    expect(win).toMatch(/WSL/i);
    expect(linux).toMatch(/bun\.sh\/install/);
    expect(installHints("bun", "linux").join("\n")).toMatch(/bun\.sh/);
  });
});

describe("installHints for optional tools", () => {
  it("points whisper-cli at the release on win32, brew on darwin, the repo elsewhere; an unknown tool gets none", () => {
    expect(installHints("whisper-cli", "win32")).toStrictEqual([
      "whisper.cpp release: whisper-cli.exe on PATH",
      "https://github.com/ggml-org/whisper.cpp",
    ]);
    expect(installHints("whisper-cli", "darwin")).toStrictEqual(["brew install whisper-cpp"]);
    expect(installHints("whisper-cli", "linux")).toStrictEqual(["https://github.com/ggml-org/whisper.cpp"]);
    expect(installHints("nope", "linux")).toStrictEqual([]);
  });
});

describe("runDoctor", () => {
  it("empty PATH → exit 1; all required missing; OS hints; optional gh; no playwright", () => {
    const cwd = tmp("doc-empty-");
    enablePacks();
    const linux = runDoctor({
      cwd,
      pathEnv: "",
      platform: "linux",
    });
    const darwin = runDoctor({
      cwd,
      pathEnv: "",
      platform: "darwin",
    });
    const win = runDoctor({
      cwd,
      pathEnv: "",
      platform: "win32",
    });
    for (const r of [linux, darwin, win]) {
      expect(r.code).toBe(1);
      expect(r.stderr).toBe("");
      for (const name of REQUIRED) {
        expect(r.stdout).toMatch(new RegExp(`${name}\\s+missing`));
      }
      expect(r.stdout).toMatch(/gh\s+missing \(optional\)/);
      expect(r.stdout).toMatch(/clasp\s+missing \(optional\)/);
      expect(r.stdout).toMatch(/google-workspace\s+missing \(optional\)/);
      expect(r.stdout).toMatch(/speak\s+missing \(optional\)/);
      expect(r.stdout).toMatch(/ffmpeg\s+missing \(optional\)/);
      expect(r.stdout).toMatch(/whisper-cli\s+missing \(optional\)/);
      expect(r.stdout).toMatch(/install \(print-only; not run\)/);
      expect(r.stdout).not.toMatch(/playwright install/);
    }
    expect(linux.stdout).toMatch(/curl -fsSL https:\/\/pkg\.lightpanda\.io\/install\.sh \| bash/);
    expect(darwin.stdout).toMatch(/brew tap lightpanda-io\/browser/);
    expect(win.stdout).toMatch(/winget install Google\.Chrome/);
    expect(win.stdout).toMatch(/PATH|shim/i);
    expect(win.stdout).toMatch(/WSL/i);
  });

  it("all required present, gh missing → exit 0; gh optional only; no required install dump", () => {
    const cwd = tmp("doc-ok-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    const r = runDoctor({
      cwd,
      pathEnv: bin,
      platform: "linux",
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/bun\s+ok/);
    expect(r.stdout).toMatch(/git\s+ok/);
    expect(r.stdout).toMatch(/gh\s+missing \(optional\)/);
    expect(r.stdout).not.toMatch(/^maps /m);
    expect(r.stdout).not.toMatch(/maps missing/);
    expect(r.stdout).not.toMatch(/install \(print-only; not run\)/);
  });

  it("gh present is ok not a required miss", () => {
    const cwd = tmp("doc-gh-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    const gh = writeBin(bin, "gh");
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux" });
    expect(r.code).toBe(0);
    expectStdoutPath(r.stdout, gh);
    expect(r.stdout).not.toMatch(/gh\s+missing/);
  });

  it("clasp present is ok not a required miss", () => {
    const cwd = tmp("doc-clasp-");
    enablePacks(["clasp"]);
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    const clasp = writeBin(bin, "clasp");
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux" });
    expect(r.code).toBe(0);
    expectStdoutPath(r.stdout, clasp);
    expect(r.stdout).not.toMatch(/clasp\s+missing/);
  });

  it("ffmpeg present is ok not a required miss", () => {
    const cwd = tmp("doc-ffmpeg-");
    enablePacks(["listen"]);
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    const ffmpeg = writeBin(bin, "ffmpeg");
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux" });
    expect(r.code).toBe(0);
    expectStdoutPath(r.stdout, ffmpeg);
    expect(r.stdout).not.toMatch(/ffmpeg\s+missing/);
  });

  it("whisper-cli present is ok not a required miss", () => {
    const cwd = tmp("doc-whisper-");
    enablePacks(["listen"]);
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    const w = writeBin(bin, "whisper-cli");
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux" });
    expect(r.code).toBe(0);
    expectStdoutPath(r.stdout, w);
    expect(r.stdout).not.toMatch(/whisper-cli\s+missing/);
  });

  it("google-workspace oauth/tokens/adc/clasprc are optional ok and do not echo secrets", () => {
    const cwd = tmp("doc-ws-");
    enablePacks(["google-workspace"]);
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    const missing = runDoctor({ cwd, pathEnv: bin, platform: "linux" });
    expect(missing.code).toBe(0);
    expect(missing.stdout).toMatch(/google-workspace\s+missing \(optional\)/);

    const oauthHome = tmp("doc-ws-oauth-");
    const oauthSecret = "oauth-client-secret-do-not-print";
    fs.mkdirSync(path.join(oauthHome, ".workerstack", "workspace", "default"), { recursive: true });
    fs.writeFileSync(
      path.join(oauthHome, ".workerstack", "workspace", "default", "google-oauth.json"),
      JSON.stringify({ installed: { client_id: "cid", client_secret: oauthSecret } }),
    );
    const oauth = runDoctor({
      cwd,
      home: oauthHome,
      pathEnv: bin,
      platform: "linux",
    });
    expect(oauth.code).toBe(0);
    expect(oauth.stdout).toMatch(/google-workspace\s+ok\s+oauth/);
    expect(oauth.stdout).not.toContain(oauthSecret);
    expect(oauth.stdout).not.toContain("cid");
    expect(oauth.stdout).not.toMatch(/google-workspace\s+missing/);

    const tokHome = tmp("doc-ws-tok-");
    const refresh = "refresh-token-secret";
    fs.mkdirSync(path.join(tokHome, ".workerstack", "workspace", "default"), { recursive: true });
    fs.writeFileSync(
      path.join(tokHome, ".workerstack", "workspace", "default", "tokens.json"),
      JSON.stringify({ client_id: "tok-cid", refresh_token: refresh }),
    );
    const tokens = runDoctor({
      cwd,
      home: tokHome,
      pathEnv: bin,
      platform: "linux",
    });
    expect(tokens.stdout).toMatch(/google-workspace\s+ok\s+tokens/);
    expect(tokens.stdout).not.toContain(refresh);
    expect(tokens.stdout).not.toContain("tok-cid");

    const namedHome = tmp("doc-ws-named-");
    fs.mkdirSync(path.join(namedHome, ".workerstack", "workspace", "work"), { recursive: true });
    fs.writeFileSync(
      path.join(namedHome, ".workerstack", "workspace", "work", "google-oauth.json"),
      JSON.stringify({ installed: { client_id: "work-cid", client_secret: "work-secret" } }),
    );
    fs.writeFileSync(
      path.join(namedHome, ".workerstack", "workspace", "work", "tokens.json"),
      JSON.stringify({ refresh_token: "work-refresh" }),
    );
    const named = runDoctor({
      cwd,
      home: namedHome,
      pathEnv: bin,
      platform: "linux",
    });
    expect(named.stdout).toMatch(/google-workspace\s+ok\s+oauth,tokens/);
    expect(named.stdout).not.toContain("work-secret");
    expect(named.stdout).not.toContain("work-refresh");
    expect(named.stdout).not.toContain("work-cid");

    const adcHome = tmp("doc-ws-adc-");
    fs.mkdirSync(path.join(adcHome, ".config", "gcloud"), { recursive: true });
    fs.writeFileSync(
      path.join(adcHome, ".config", "gcloud", "application_default_credentials.json"),
      JSON.stringify({ refresh_token: "adc-refresh", type: "authorized_user" }),
    );
    const adc = runDoctor({
      cwd,
      home: adcHome,
      pathEnv: bin,
      platform: "linux",
    });
    expect(adc.stdout).toMatch(/google-workspace\s+ok\s+adc/);
    expect(adc.stdout).not.toContain("adc-refresh");

    const claspHome = tmp("doc-ws-clasprc-");
    fs.writeFileSync(
      path.join(claspHome, ".clasprc.json"),
      JSON.stringify({ tokens: { default: { refresh_token: "clasp-refresh" } } }),
    );
    const clasprc = runDoctor({
      cwd,
      home: claspHome,
      pathEnv: bin,
      platform: "linux",
    });
    expect(clasprc.stdout).toMatch(/google-workspace\s+ok\s+clasprc/);
    expect(clasprc.stdout).not.toContain("clasp-refresh");
  });

  it("speak dummy key is optional ok and does not echo the secret", () => {
    const cwd = tmp("doc-speak-");
    enablePacks(["speak"]);
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    const secret = "sk_secret_do_not_print";
    const r = runDoctor({
      cwd,
      env: { ELEVENLABS_API_KEY: secret },
      pathEnv: bin,
      platform: "linux",
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/speak\s+ok\s+elevenlabs/);
    expect(r.stdout).not.toContain(secret);
    expect(r.stdout).not.toMatch(/speak\s+missing/);
  });

  it("speak openai key and speak.json config do not print secrets", () => {
    const cwd = tmp("doc-speak-oa-");
    enablePacks(["speak"]);
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    const home = tmp("doc-speak-home-");
    fs.mkdirSync(path.join(home, ".workerstack"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".workerstack", "speak.json"),
      JSON.stringify({ openai: { apiKey: "sk_file_secret" } }),
    );
    const oa = runDoctor({
      cwd,
      env: { OPENAI_API_KEY: "sk_oa_secret" },
      pathEnv: bin,
      platform: "linux",
    });
    expect(oa.stdout).toMatch(/speak\s+ok\s+openai/);
    expect(oa.stdout).not.toContain("sk_oa_secret");
    const file = runDoctor({
      cwd,
      env: {},
      home,
      pathEnv: bin,
      platform: "linux",
    });
    expect(file.stdout).toMatch(/speak\s+ok\s+config/);
    expect(file.stdout).not.toContain("sk_file_secret");
  });

  it("hides optional pack rows when no features file enables them", () => {
    const cwd = tmp("doc-packs-off-");
    const r = runDoctor({ cwd, pathEnv: "", platform: "linux" });
    expect(r.stdout).toMatch(/gh\s+missing \(optional\)/);
    expect(r.stdout).toMatch(/jev\s+missing \(optional\)/);
    expect(r.stdout).not.toMatch(/clasp\s+/);
    expect(r.stdout).not.toMatch(/google-workspace\s+/);
    expect(r.stdout).not.toMatch(/speak\s+/);
    expect(r.stdout).not.toMatch(/ffmpeg\s+/);
    expect(r.stdout).not.toMatch(/whisper-cli\s+/);
  });

  it("jev env or jev.json is optional ok and does not echo the secret", () => {
    const cwd = tmp("doc-jev-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    const secret = "ts_live_do_not_print";
    const fromEnv = runDoctor({
      cwd,
      env: { TYPESAFE_API_KEY: secret },
      pathEnv: bin,
      platform: "linux",
    });
    expect(fromEnv.code).toBe(0);
    expect(fromEnv.stdout).toMatch(/jev\s+ok\s+env/);
    expect(fromEnv.stdout).not.toContain(secret);
    const home = tmp("doc-jev-home-");
    fs.mkdirSync(path.join(home, ".workerstack"), { recursive: true });
    fs.writeFileSync(path.join(home, ".workerstack", "jev.json"), JSON.stringify({ apiKey: secret }));
    const fromFile = runDoctor({
      cwd,
      env: {},
      home,
      pathEnv: bin,
      platform: "linux",
    });
    expect(fromFile.code).toBe(0);
    expect(fromFile.stdout).toMatch(/jev\s+ok\s+config/);
    expect(fromFile.stdout).not.toContain(secret);
  });

  it("prints the bun version and path on the bun row", () => {
    const cwd = tmp("doc-bun-ok-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux" });
    expect(r.stdout).toMatch(/^bun\s+ok\s+1\.4\.4 \(.*bun.*\)$/m);
  });

  it("needs the bun in package.json engines: 1.3.0 fails, a newer bun passes", () => {
    const cwd = tmp("doc-bun-old-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    const pkg = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "package.json"), "utf8")) as {
      engines: { bun: string };
    };
    expect(pkg.engines.bun).toBe(`>=${BUN_MIN_FALLBACK}`);
    writeBun(bin, "1.3.0");
    const old = runDoctor({ cwd, pathEnv: bin, platform: "linux" });
    expect(old.code).toBe(1);
    expect(old.stdout).toMatch(/^bun\s+need ≥1\.4\.4\s+1\.3\.0 \(.*bun.*\)$/m);
    writeBun(bin, "1.10.0");
    const newer = runDoctor({ cwd, pathEnv: bin, platform: "linux" });
    expect(newer.stdout).toMatch(/^bun\s+ok\s+1\.10\.0 /m);
  });

  it("rtk from node_modules/.bin counts as bunx-able", () => {
    const cwd = tmp("doc-bunx-");
    const bin = path.join(cwd, "bin");
    writeBun(bin);
    writeBin(bin, "git");
    writeBin(bin, "lightpanda");
    writeBin(bin, "chromium");
    const nm = path.join(cwd, "node_modules", ".bin");
    const rtk = writeBin(nm, "rtk");
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux" });
    expect(r.code).toBe(0);
    expectStdoutPath(r.stdout, rtk);
    expect(r.stdout).not.toMatch(/rulesync/);
  });

  it("chromium family name google-chrome satisfies chromium", () => {
    const cwd = tmp("doc-chrome-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin, { chromiumName: "google-chrome" });
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux" });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/chromium\s+ok/);
    expect(r.stdout).not.toMatch(/chromium\s+missing/);
  });

  it("tools ok, not this package → skip maps; exit 0; no INDEX missing", () => {
    const cwd = tmp("doc-nomaps-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux" });
    expect(r.code).toBe(0);
    expect(r.stdout).not.toMatch(/^maps /m);
    expect(r.stdout).not.toMatch(/maps missing/);
  });

  it("consumer with .agents/skills and no references/ gets no maps row", () => {
    const cwd = tmp("doc-consumer-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    writeSelfPackage(cwd, "some-consumer");
    fs.mkdirSync(path.join(cwd, ".agents", "skills"), { recursive: true });
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux" });
    expect(r.code).toBe(0);
    expect(r.stdout).not.toMatch(/^maps /m);
  });

  it("@workerstack/repo with both markers → maps ok row, exit 0", () => {
    const cwd = tmp("doc-maps-ok-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    writeRequiredMaps(cwd);
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux" });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^maps\s+ok\s+references\/INDEX\.md repo:skills, repo:refs$/m);
  });

  it("@workerstack/repo with the hashed markers sync writes → maps ok row, exit 0", () => {
    const cwd = tmp("doc-maps-hashed-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    writeRequiredMaps(cwd, BOTH_MARKERS.replace(/<!-- repo:(\w+) -->/g, "<!-- repo:$1 e3b0c442 -->"));
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux" });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^maps\s+ok\s+references\/INDEX\.md repo:skills, repo:refs$/m);
  });

  it.each(["skills", "refs"])("@workerstack/repo missing repo:%s → exit 1 naming it", (name) => {
    const cwd = tmp("doc-map-one-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    writeRequiredMaps(cwd, BOTH_MARKERS.replace(`<!-- repo:${name} -->\n<!-- /repo:${name} -->\n`, ""));
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux" });
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(`references/INDEX.md has no repo:${name} section; run bun repo sync`);
    expect(r.stdout).toMatch(/^maps\s+missing/m);
  });

  it("@workerstack/repo without references/INDEX.md → exit 1", () => {
    const cwd = tmp("doc-map-none-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    writeSelfPackage(cwd);
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux" });
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^maps\s+missing\s+references\/INDEX\.md is missing; run bun repo sync$/m);
  });

  it("whichBin finds chrome.exe on win32 PATH dir", () => {
    const dir = tmp("which-win-");
    const exe = path.join(dir, "chrome.exe");
    fs.writeFileSync(exe, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    expect(whichBin("chrome", dir, "win32")?.toLowerCase()).toBe(exe.toLowerCase());
  });

  it("skill content conflict vs packaged warns; exit still 0 when tools+maps ok", () => {
    const cwd = tmp("doc-sk-conflict-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    writeRequiredMaps(cwd);
    const wsSkill = path.join(cwd, ".agents", "skills", "parent");
    const pkgSkill = path.join(cwd, "node_modules", "@workerstack", "repo", "agents", "skills", "parent");
    fs.mkdirSync(wsSkill, { recursive: true });
    fs.mkdirSync(pkgSkill, { recursive: true });
    fs.writeFileSync(path.join(wsSkill, "SKILL.md"), "custom\n");
    fs.writeFileSync(path.join(pkgSkill, "SKILL.md"), "packaged\n");
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux" });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/skill conflicts \(warn/);
    expect(r.stdout).toMatch(/skill `parent` differs from packaged repo; re-init overwrites/);
  });

  it("identical packaged skill → no conflict lines", () => {
    const cwd = tmp("doc-sk-same-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    writeRequiredMaps(cwd);
    const wsSkill = path.join(cwd, ".agents", "skills", "parent");
    const pkgSkill = path.join(cwd, "node_modules", "@workerstack", "repo", "agents", "skills", "parent");
    fs.mkdirSync(wsSkill, { recursive: true });
    fs.mkdirSync(pkgSkill, { recursive: true });
    fs.writeFileSync(path.join(wsSkill, "SKILL.md"), "same\n");
    fs.writeFileSync(path.join(pkgSkill, "SKILL.md"), "same\n");
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux" });
    expect(r.code).toBe(0);
    expect(r.stdout).not.toMatch(/skill conflicts/);
  });
});

describe("globals row", async () => {
  const repoRoot = path.resolve(here, "..", "..");

  function setup() {
    const cwd = tmp("doc-globals-");
    fs.cpSync(path.join(repoRoot, "agents/global-settings"), path.join(cwd, "agents/global-settings"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(cwd, ".grok"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".grok/config.toml"), "[plugins]\nenabled = []\n");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    const home = tmp("doc-globals-home-");
    // as main() does: the row is computed first, then printed among the others
    const run = async () =>
      runDoctor({ cwd, globals: await globalsRow(cwd, home, cwd), home, pathEnv: bin, platform: "linux" });
    return { cwd, home, run };
  }

  it("is ok once the globals were applied", async () => {
    const { cwd, home, run } = setup();
    expect(syncGlobals({ apply: true, home, workspaceRoot: cwd }).ok).toBe(true);
    const r = await run();
    expect(r.stdout).toMatch(/^globals\s+ok\s*$/m);
    expect(r.code).toBe(0);
  });

  it("shows the first drift line with the apply hint", async () => {
    const { cwd, home, run } = setup();
    expect(syncGlobals({ apply: true, home, workspaceRoot: cwd }).ok).toBe(true);
    fs.writeFileSync(path.join(home, ".cursor/cli-config.json"), "{}");
    const r = await run();
    expect(r.stdout).toMatch(/^globals\s+drift: cursor \.cursor\/cli-config\.json approvalMode; run `bun repo yolo`$/m);
    expect(r.stdout.match(/^globals/gm)).toHaveLength(1);
    expect(r.code).toBe(0);
  });

  it("shows the first drift line when nothing was applied", async () => {
    const { run } = setup();
    expect((await run()).stdout).toMatch(/^globals\s+drift: grok \.grok\/config\.toml ui\.permission_mode;/m);
  });

  it("shows a check error", async () => {
    const { cwd, run } = setup();
    fs.rmSync(path.join(cwd, "agents/global-settings/cursor.json"));
    expect((await run()).stdout).toMatch(/^globals\s+missing payload: agents\/global-settings\/cursor\.json$/m);
  });

  it("reads the manifest from the package root, not from the workspace", async () => {
    const { cwd, home } = setup();
    const bin = path.join(cwd, "bin");
    const empty = tmp("doc-empty-pkg-");
    expect(await globalsRow(cwd, home, empty)).toBeNull();
    const other = tmp("doc-work-");
    const ws = runDoctor({
      cwd: other,
      globals: await globalsRow(other, home, cwd),
      home,
      pathEnv: bin,
      platform: "linux",
    });
    expect(ws.stdout).toMatch(/^globals\s/m);
  });

  it("says unavailable with the install hint when check-globals cannot load", async () => {
    const { cwd, home } = setup();
    vi.doMock(new URL("./check-globals.ts", import.meta.url).href, () => {
      throw new Error("Cannot find package 'smol-toml'");
    });
    try {
      // vitest wraps the factory's error; the row keeps the first line of whatever the load threw
      expect(await globalsRow(cwd, home, cwd)).toMatch(/^globals\s+unavailable\s+[^\n]+; run bun install$/);
    } finally {
      vi.doUnmock(new URL("./check-globals.ts", import.meta.url).href);
    }
    expect(await globalsRow(cwd, home, cwd)).toMatch(/^globals\s+drift/);
  });

  it("has no row when the repo ships no globals manifest", async () => {
    const cwd = tmp("doc-no-globals-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    expect(await globalsRow(cwd, undefined, cwd)).toBeNull();
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux" });
    expect(r.stdout).not.toMatch(/^globals/m);
  });
});

describe("loadOptionalConsumerEnv", () => {
  it("no-ops when lib/env.mjs is missing", async () => {
    const dir = tmp("opt-env-miss-");
    const base = pathToFileURL(path.join(dir, "cli", "scripts", "dummy.mjs")).href;
    expect(await loadOptionalConsumerEnv(base)).toBe(false);
  });

  it("calls loadEnv when present", async () => {
    const dir = tmp("opt-env-hit-");
    fs.mkdirSync(path.join(dir, "scripts", "lib"), { recursive: true });
    const marker = path.join(dir, "marker.txt");
    fs.writeFileSync(
      path.join(dir, "scripts", "lib", "env.mjs"),
      `import fs from "node:fs";
export function loadEnv() { fs.writeFileSync(${JSON.stringify(marker)}, "ok"); }
`,
    );
    const base = pathToFileURL(path.join(dir, "cli", "scripts", "dummy.mjs")).href;
    expect(await loadOptionalConsumerEnv(base)).toBe(true);
    expect(fs.readFileSync(marker, "utf8")).toBe("ok");
  });

  it("imports a module that does not export loadEnv", async () => {
    const dir = tmp("opt-env-noload-");
    fs.mkdirSync(path.join(dir, "scripts", "lib"), { recursive: true });
    fs.writeFileSync(path.join(dir, "scripts", "lib", "env.mjs"), `export const x = 1;\n`);
    const base = pathToFileURL(path.join(dir, "cli", "scripts", "dummy.mjs")).href;
    expect(await loadOptionalConsumerEnv(base)).toBe(true);
  });

  it("propagates a thrown import", async () => {
    const dir = tmp("opt-env-boom-");
    fs.mkdirSync(path.join(dir, "scripts", "lib"), { recursive: true });
    fs.writeFileSync(path.join(dir, "scripts", "lib", "env.mjs"), `throw new Error("env-boom");\n`);
    const base = pathToFileURL(path.join(dir, "cli", "scripts", "dummy.mjs")).href;
    await expect(loadOptionalConsumerEnv(base)).rejects.toThrow(/env-boom/);
  });
});

describe("doctor cli", () => {
  it("main empty PATH exits 1", () => {
    const cwd = tmp("doc-cli-");
    const r = spawnSync(bunPath(), [script, "doctor"], {
      cwd,
      encoding: "utf8",
      env: childEnv({ PATH: "/nonexistent-repo-doctor" }),
      timeout: 15_000,
    });
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toMatch(/missing/);
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/playwright install/);
  });
});

describe("workspace report", () => {
  const git = (cwd: string, ...args: string[]) =>
    spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      env: childEnv({
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_AUTHOR_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
      }),
    });
  function put(root: string, rel: string, body = "x\n") {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    return file;
  }
  function gitRepo(prefix: string, ignore: string) {
    const r = fs.realpathSync(tmp(prefix));
    git(r, "init", "-q", "-b", "main");
    put(r, ".gitignore", ignore);
    git(r, "add", "-A");
    git(r, "commit", "-qm", "init");
    fs.mkdirSync(path.join(r, "packages", "a"), { recursive: true });
    return r;
  }
  function commitIn(dir: string, name: string) {
    put(dir, name);
    git(dir, "add", name);
    git(dir, "commit", "-qm", name);
  }
  function doctor(cwd: string) {
    const bin = tmp("doc-ws-bin-");
    writeRequired(bin);
    return runDoctor({ cwd, pathEnv: bin, platform: "linux" });
  }
  function section(stdout: string) {
    const lines = stdout.split("\n");
    const at = lines.findIndex((l) => l.startsWith("workspace "));
    expect(at, stdout).toBeGreaterThan(-1);
    const items: string[] = [];
    for (let i = at + 1; i < lines.length && lines[i]!.startsWith("- "); i++) items.push(lines[i]!); // i < lines.length
    return { head: lines[at]!, items }; // at was asserted above
  }

  it("lists each leftover with the command that clears it, groups worktrees, and deletes nothing", async () => {
    const { addWorktree } = await import("./worktree-lifecycle.ts");
    const r = gitRepo("doc-ws-", ".tmp\n.tmp/\n.worktrees/\n");
    expect(doctor(path.join(r, "packages", "a")).code).toBe(0);
    const seeded = [
      put(r, "packages/b/.tmp/repo/x.txt"),
      put(r, "apps/x/.tmp/repo/plans/1-p.md"),
      put(r, "packages/b/.gitignore", ".tmp/\n"),
      put(r, "packages/u/.gitignore", ".tmp/\n"),
    ];
    git(r, "add", "packages/b/.gitignore");
    git(r, "commit", "-qm", "nested ignore");
    const outside = `${r}-outside`;
    tmpDirs.push(outside);
    git(r, "worktree", "add", "-q", "-b", "spike", outside);
    const gone = addWorktree(r, "gone").path;
    fs.rmSync(gone, { force: true, recursive: true });
    const m = addWorktree(r, "m").path;
    commitIn(m, "m.txt");
    git(r, "merge", "-q", "wt/m");

    const res = doctor(path.join(r, "packages", "a"));
    expect(res.code).toBe(0);
    const { head, items } = section(res.stdout);
    expect(head).toMatch(/^workspace\s+8 to clear\s+report only; nothing was deleted$/);
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const at = (...rel: string[]) => path.join(r, ...rel);
    const rule = `ignored by ${esc(at(".gitignore"))}:\\d+ \\.tmp/?`;
    const want = [
      `^${esc(`- stray .tmp/repo ${at("apps", "x", ".tmp", "repo")} (holds plans): rm -r ${at("apps", "x", ".tmp", "repo")}`)}$`,
      `^${esc(`- stray .tmp/repo ${at("packages", "b", ".tmp", "repo")}: rm -r ${at("packages", "b", ".tmp", "repo")}`)}$`,
      `^${esc(`- redundant .gitignore ${at("packages", "b", ".gitignore")} (".tmp/" `)}${rule}${esc(`): git -C ${r} rm -q packages/b/.gitignore`)}$`,
      `^${esc(`- redundant .gitignore ${at("packages", "u", ".gitignore")} (".tmp/" `)}${rule}${esc(`): rm ${at("packages", "u", ".gitignore")}`)}$`,
      `^${esc(`- duplicate .gitignore line ${at(".gitignore")}:2 ".tmp/" (".tmp" on line 1 covers it): delete line 2 of ${at(".gitignore")}`)}$`,
      `^${esc(`- missing worktree ${at(".worktrees", "gone")} (wt/gone): git -C ${r} worktree prune`)}$`,
      `^${esc(`- worktree outside .worktrees ${outside} (spike): git -C ${r} worktree remove ${outside}`)}$`,
      `^${esc(`- merged worktree ${at(".worktrees", "m")} (wt/m): bun repo worktree prune`)}$`,
    ];
    expect(items.length, res.stdout).toBe(want.length);
    want.forEach((re, i) => expect(items[i]).toMatch(new RegExp(re)));
    for (const f of seeded) expect(fs.existsSync(f), f).toBe(true);
    expect(fs.existsSync(outside)).toBe(true);
    expect(fs.existsSync(m)).toBe(true);
    expect(git(r, "worktree", "list").stdout).toContain(gone.split(path.sep).join("/"));
  });

  it("lists an unmerged managed worktree whose last commit is 7 or more days old, with its finish command", async () => {
    const { addWorktree } = await import("./worktree-lifecycle.ts");
    const r = gitRepo("doc-ws-stale-", ".tmp/\n.worktrees/\n");
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    const commitAt = (dir: string, name: string, when: string) => {
      put(dir, name);
      git(dir, "add", name);
      spawnSync("git", ["commit", "-qm", name], {
        cwd: dir,
        env: childEnv({
          GIT_AUTHOR_EMAIL: "t@t",
          GIT_AUTHOR_NAME: "t",
          GIT_COMMITTER_DATE: when,
          GIT_COMMITTER_EMAIL: "t@t",
          GIT_COMMITTER_NAME: "t",
        }),
      });
    };
    const old = addWorktree(r, "old").path;
    commitAt(old, "old.txt", daysAgo(9));
    commitAt(addWorktree(r, "today").path, "today.txt", daysAgo(0));
    commitAt(addWorktree(r, "week").path, "week.txt", daysAgo(6));
    const edge = addWorktree(r, "edge").path;
    commitAt(edge, "edge.txt", daysAgo(7));
    const dirty = addWorktree(r, "dirty").path;
    commitAt(dirty, "dirty.txt", daysAgo(12));
    put(dirty, "wip.txt");
    commitAt(addWorktree(r, "landed").path, "landed.txt", daysAgo(20));
    git(r, "merge", "-q", "wt/landed");
    addWorktree(r, "empty");
    const res = doctor(path.join(r, "packages", "a"));
    const { head, items } = section(res.stdout);
    const line = (name: string, days: number) =>
      `- stale worktree ${path.join(r, ".worktrees", name)} (wt/${name}, last commit ${days} days ago): bun repo worktree finish ${name}`;
    expect(items, res.stdout).toStrictEqual([
      `- merged worktree ${path.join(r, ".worktrees", "landed")} (wt/landed): bun repo worktree prune`,
      line("dirty", 12),
      line("edge", 7),
      line("old", 9),
    ]);
    expect(head).toMatch(/^workspace\s+4 to clear\s+report only; nothing was deleted$/);
    expect(fs.existsSync(old)).toBe(true);
    expect(git(r, "rev-parse", "--verify", "-q", "refs/heads/wt/old").status).toBe(0);
  });

  it("skips repo's own scratch, nested repos, partly useful or glob ignores, fresh and dirty worktrees", async () => {
    const { addWorktree } = await import("./worktree-lifecycle.ts");
    const r = gitRepo("doc-ws-quiet-", ".tmp/\n.worktrees/\n");
    expect(section(doctor(r).stdout).head).toMatch(/^workspace\s+ok\s*$/);
    put(r, ".tmp/repo/verify/S/.tmp/repo/x");
    fs.mkdirSync(path.join(r, "vendor", "sub"), { recursive: true });
    git(path.join(r, "vendor", "sub"), "init", "-q");
    put(r, "vendor/sub/.tmp/repo/x");
    put(r, "packages/c/.gitignore", ".tmp/\ndist-local/\n");
    put(r, "packages/g/.gitignore", "*.log\n");
    addWorktree(r, "f");
    const d = addWorktree(r, "d").path;
    commitIn(d, "d.txt");
    git(r, "merge", "-q", "wt/d");
    put(d, "dirty.txt");
    const res = doctor(path.join(r, "packages", "a"));
    expect(section(res.stdout), res.stdout).toStrictEqual({
      head: expect.stringMatching(/^workspace\s+ok\s*$/),
      items: [],
    });
    expect(section(doctor(tmp("doc-ws-nogit-")).stdout).head).toMatch(/^workspace\s+ok\s*$/);
  });

  it("reads the git top's .gitignore for a repo install in a subpackage", () => {
    const r = gitRepo("doc-ws-sub-", ".tmp\n.tmp/\n");
    const web = path.join(r, "apps", "web");
    put(web, "workerstack.config.ts", "");
    put(web, ".gitignore", ".tmp/\n");
    const { items } = section(doctor(web).stdout);
    const top = path.join(r, ".gitignore");
    expect(
      items.some((l) =>
        l.startsWith(`- redundant .gitignore ${path.join(web, ".gitignore")} (".tmp/" ignored by ${top}:`),
      ),
    ).toBe(true);
    expect(items).toContain(
      `- duplicate .gitignore line ${top}:2 ".tmp/" (".tmp" on line 1 covers it): delete line 2 of ${top}`,
    );
  });
});

describe("agent models row", () => {
  const LISTS = {
    cursor:
      "Available models\n\nauto - Auto (current, default)\nclaude-sonnet-5-5-medium - Sonnet 5.5\n\nTip: use --model <id> to switch.\n",
    grok: "You are logged in with grok.com.\n\nDefault model: grok-4.7\n\nAvailable models:\n  * grok-4.7 (default)\n",
  };
  type Reply = { code?: number; stdout?: string; stderr?: string; delay?: number } | "not-installed" | "hang";
  const OK: Record<string, Reply> = {
    "cursor-agent": { stdout: LISTS.cursor },
    grok: { stdout: LISTS.grok },
  };
  function fakeRun(replies: Record<string, Reply> = OK) {
    const calls: string[] = [];
    const run: ListRunner = (bin, args, { signal }) => {
      calls.push([bin, ...args].join(" "));
      const reply = replies[bin];
      return new Promise<ListResult>((resolve, reject) => {
        if (!reply || reply === "not-installed") {
          reject(Object.assign(new Error(`spawn ${bin} ENOENT`), { code: "ENOENT" }));
          return;
        }
        if (reply === "hang") {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
          return;
        }
        setTimeout(
          () => resolve({ code: reply.code ?? 0, stderr: reply.stderr ?? "", stdout: reply.stdout ?? "" }),
          reply.delay ?? 0,
        );
      });
    };
    return { calls, run };
  }
  function put(cwd: string, rel: string, body: string) {
    const file = path.join(cwd, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  const md = (model: string) => `---\nname: x\nmodel: ${model}\n---\nbody\n`;
  const toml = (model: string) => `name = "x"\nmodel = "${model}"\nmodel_reasoning_effort = "low"\n`;
  function checkout(files: Record<string, string>) {
    const cwd = fs.realpathSync(tmp("doc-models-"));
    for (const [rel, body] of Object.entries(files)) put(cwd, rel, body);
    return cwd;
  }
  function codexHome(slugs: string[] | string) {
    const home = fs.realpathSync(tmp("doc-models-home-"));
    put(
      home,
      ".codex/models_cache.json",
      typeof slugs === "string" ? slugs : JSON.stringify({ models: slugs.map((slug) => ({ slug })) }),
    );
    return home;
  }
  const GOOD_HOME_SLUGS = ["gpt-6-luna", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-reserve"];
  const ALL_OFFERED = {
    ".agents/agents/scout.md": md("flash_lite"),
    ".codex/agents/scout.toml": toml("gpt-6-luna"),
    ".cursor/agents/scout.md": md("claude-sonnet-5-5-medium"),
    ".grok/agents/scout.md": md("grok-4.7"),
    ".grok/roles/scout.toml": toml("grok-4.7"),
  };
  async function rowOf(
    files: Record<string, string>,
    {
      home = codexHome(GOOD_HOME_SLUGS),
      replies = OK,
      capMs,
    }: { home?: string; replies?: Record<string, Reply>; capMs?: number } = {},
  ) {
    const cwd = checkout(files);
    const { run, calls } = fakeRun(replies);
    const lines = await agentModelsLines({ capMs, cwd, env: {}, home, run, sourceRoot: cwd });
    return { calls, cwd, lines, text: lines.join("\n") };
  }

  it("is ok when every agent model is offered, and never checks Claude agents", async () => {
    const r = await rowOf({ ...ALL_OFFERED, ".claude/agents/scout.md": md("haiku") });
    expect(r.text).toMatch(/^agent models\s+ok\s*$/);
    expect(r.lines).toHaveLength(1);
  });

  // The default runner spawns the real CLI: PATH holds only a fake grok, so no machine's own grok or cursor-agent answers.
  describe("with the real list runner", () => {
    function fakeGrok(ids: string[]) {
      const bin = tmp("doc-fake-grok-");
      const out = ["Available models:", ...ids.map((id) => `  ${id}`)];
      if (process.platform === "win32") {
        fs.writeFileSync(path.join(bin, "grok.cmd"), `@echo off\r\n${out.map((l) => `echo ${l}`).join("\r\n")}\r\n`);
      } else {
        fs.writeFileSync(path.join(bin, "grok"), `#!/bin/sh\n${out.map((l) => `echo "${l}"`).join("\n")}\n`, {
          mode: 0o755,
        });
      }
      return bin;
    }
    const grokAgent = (model: string) => ({ ".grok/agents/scout.md": md(model) });

    it("reads the ids the CLI prints", async () => {
      vi.stubEnv("PATH", fakeGrok(["grok-4.7"]));
      const cwd = checkout(grokAgent("grok-4.7"));
      expect((await agentModelsLines({ cwd, env: {}, home: "/nonexistent", sourceRoot: cwd })).join("\n")).toMatch(
        /^agent models\s+ok\s*$/,
      );
      const bad = checkout(grokAgent("grok-9"));
      expect((await agentModelsLines({ cwd: bad, env: {}, home: "/nonexistent", sourceRoot: bad })).join("\n")).toMatch(
        /to fix[\s\S]*model grok-9 is not offered by grok; offered: grok-4\.7/,
      );
    });

    it("skips a CLI that is not on PATH", async () => {
      vi.stubEnv("PATH", tmp("doc-no-grok-"));
      const cwd = checkout(grokAgent("grok-4.7"));
      expect((await agentModelsLines({ cwd, env: {}, home: "/nonexistent", sourceRoot: cwd })).join("\n")).toMatch(
        /skipped: .*grok/,
      );
    });
  });

  it("is ok and runs no list command when the checkout has no agent files", async () => {
    const r = await rowOf({ ".claude/agents/scout.md": md("haiku") });
    expect(r.text).toMatch(/^agent models\s+ok\s*$/);
    expect(r.calls).toStrictEqual([]);
  });

  it("asks only the CLIs that have an agent file to check", async () => {
    const r = await rowOf({ ".grok/agents/scout.md": md("grok-4.7") });
    expect(r.calls).toStrictEqual(["grok models"]);
  });

  it("flags a codex, a grok, an agy and a cursor agent naming a dropped model, with the offered ids", async () => {
    const r = await rowOf({
      ".agents/agents/scout.md": md("gemini-3.8-flash-low"),
      ".codex/agents/scout.toml": toml("gpt-5.4-mini"),
      ".cursor/agents/scout.md": md("claude-sonnet-5-thinking-high"),
      ".grok/agents/scout.md": md("grok-4.5"),
    });
    expect(r.lines[0]).toMatch(/^agent models\s+4 to fix\s*$/);
    expect(r.lines.slice(1)).toStrictEqual([
      "- .codex/agents/scout.toml: model gpt-5.4-mini is not offered by codex; offered: gpt-6-luna, gpt-5.6-terra, gpt-5.6-luna, gpt-reserve",
      "- .grok/agents/scout.md: model grok-4.5 is not offered by grok; offered: grok-4.7",
      "- .agents/agents/scout.md: model gemini-3.8-flash-low is not offered by agy; offered: inherit, flash, pro, flash_lite",
      "- .cursor/agents/scout.md: model claude-sonnet-5-thinking-high is not offered by cursor; offered: auto, claude-sonnet-5-5-medium",
    ]);
  });

  it("checks agy agents against the fixed set without running any command", async () => {
    const r = await rowOf({
      ".agents/agents/a.md": md("inherit"),
      ".agents/agents/b.md": md("flash"),
      ".agents/agents/c.md": md("pro"),
      ".agents/agents/d.md": md("flash_lite"),
    });
    expect(r.text).toMatch(/^agent models\s+ok\s*$/);
    expect(r.lines).toHaveLength(1);
    expect(r.calls).toStrictEqual([]);
  });

  it("lists only the first 6 offered ids", async () => {
    const many = Array.from({ length: 9 }, (_, i) => `m${i + 1}`);
    const r = await rowOf({ ".codex/agents/scout.toml": toml("gone") }, { home: codexHome(many) });
    expect(r.lines[1]).toBe(
      "- .codex/agents/scout.toml: model gone is not offered by codex; offered: m1, m2, m3, m4, m5, m6",
    );
  });

  it("flags grok-4.5 in the grok role file and in the global settings [subagents.models]", async () => {
    const r = await rowOf({
      ".grok/roles/scout.toml": toml("grok-4.5"),
      "agents/global-settings/grok.toml":
        '[ui]\nmodel = "not-a-subagent"\n\n[subagents.toggle]\nexplore = true\n\n[subagents.models]\nexplore = "grok-4.5"\nscout = "grok-4.7"\n\n[memory]\nenabled = false\n',
    });
    expect(r.lines[0]).toMatch(/^agent models\s+2 to fix\s*$/);
    expect(r.lines.slice(1)).toStrictEqual([
      "- .grok/roles/scout.toml: model grok-4.5 is not offered by grok; offered: grok-4.7",
      "- agents/global-settings/grok.toml: model grok-4.5 is not offered by grok; offered: grok-4.7",
    ]);
  });

  it("leaves a cursor agent on `model: inherit` unchecked, since it runs the parent's model", async () => {
    const r = await rowOf({ ...ALL_OFFERED, ".cursor/agents/scout.md": md("inherit") });
    expect(r.text).toMatch(/^agent models\s+ok\s*$/);
    expect(r.calls.some((c) => c.startsWith("cursor-agent"))).toBe(false);
  });

  it("skips a CLI that is not installed", async () => {
    const r = await rowOf(ALL_OFFERED, { replies: { ...OK, "cursor-agent": "not-installed" } });
    expect(r.text).toMatch(/^agent models\s+ok\s+\(skipped: cursor not installed\)$/);
  });

  it("skips a failing list with the first line of its stderr", async () => {
    const r = await rowOf(ALL_OFFERED, {
      replies: { ...OK, "cursor-agent": { code: 1, stderr: "not signed in\nrun cursor-agent login\n" } },
    });
    expect(r.text).toMatch(/^agent models\s+ok\s+\(skipped: cursor models failed: not signed in\)$/);
  });

  it("skips a list that exits 0 but names no model", async () => {
    const r = await rowOf(ALL_OFFERED, { replies: { ...OK, grok: { stdout: "You are logged out.\n" } } });
    expect(r.text).toMatch(/\(skipped: grok models failed: no models listed\)$/);
  });

  it("skips a list that takes over the cap, kills it, and still checks the rest", async () => {
    const r = await rowOf(
      { ...ALL_OFFERED, ".agents/agents/scout.md": md("gemini-3.8-flash-low") },
      { capMs: 100, replies: { ...OK, grok: "hang" } },
    );
    expect(r.lines[0]).toMatch(/^agent models\s+1 to fix\s+\(skipped: grok models took over 0\.1 s\)$/);
    expect(r.lines[1]).toContain(".agents/agents/scout.md: model gemini-3.8-flash-low is not offered by agy");
  });

  it("names the 20 s cap by default", async () => {
    const cwd = checkout({ ".grok/agents/scout.md": md("grok-4.7") });
    vi.useFakeTimers();
    try {
      const { run } = fakeRun({ grok: "hang" });
      const pending = agentModelsLines({ cwd, env: {}, home: "/nonexistent", run, sourceRoot: cwd });
      await vi.advanceTimersByTimeAsync(20_000);
      expect((await pending).join("\n")).toMatch(/\(skipped: grok models took over 20 s\)$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs the lists in parallel: two slow lists both finish inside the one cap", async () => {
    const delay = 400;
    const slow = (stdout: string): Reply => ({ delay, stdout });
    const started = Date.now();
    const r = await rowOf(ALL_OFFERED, {
      capMs: 1000,
      replies: { "cursor-agent": slow(LISTS.cursor), grok: slow(LISTS.grok) },
    });
    expect(r.text).toMatch(/^agent models\s+ok\s*$/);
    // Run one after the other, the two lists take at least 2 * delay; spawn overhead stays under the gap.
    expect(Date.now() - started).toBeLessThan(2 * delay);
  });

  it("returns within the cap when two lists never answer", async () => {
    const started = Date.now();
    const r = await rowOf(ALL_OFFERED, { capMs: 150, replies: { ...OK, "cursor-agent": "hang", grok: "hang" } });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(r.text).toMatch(/\(skipped: grok models took over 0\.15 s; cursor models took over 0\.15 s\)$/);
  });

  it("skips codex when the models cache is missing or malformed", async () => {
    const files = { ".codex/agents/scout.toml": toml("gpt-6-luna") };
    const missing = path.join(fs.realpathSync(tmp("doc-models-empty-")), ".codex", "models_cache.json");
    const none = await rowOf(files, { home: path.dirname(path.dirname(missing)) });
    expect(none.text).toMatch(/^agent models\s+ok\s+/);
    expect(none.text).toContain(`(skipped: codex models cache missing at ${missing})`);
    for (const bad of ["{not json", JSON.stringify({ models: "x" }), JSON.stringify({ models: [] })]) {
      const home = codexHome(bad);
      const r = await rowOf(files, { home });
      expect(r.text).toContain(
        `(skipped: codex models cache malformed at ${path.join(home, ".codex", "models_cache.json")})`,
      );
    }
  });

  it("is report only: the doctor run prints the row before the schema line and keeps its exit code", () => {
    if (process.platform === "win32") return;
    const cwd = checkout({ ".grok/agents/scout.md": md("grok-4.5") });
    const bin = tmp("doc-models-bin-");
    writeBin(bin, "grok", `#!/bin/sh\nprintf '%s' '${LISTS.grok}'\n`);
    const r = spawnSync(bunPath(), [script, "doctor"], {
      cwd,
      encoding: "utf8",
      env: childEnv({ HOME: fs.realpathSync(tmp("doc-models-h-")), PATH: bin }),
      timeout: 15_000,
    });
    const lines = r.stdout.split("\n");
    const at = lines.findIndex((l) => /^agent models\s+1 to fix/.test(l));
    expect(at, r.stdout).toBeGreaterThan(-1);
    expect(lines[at + 1]).toBe("- .grok/agents/scout.md: model grok-4.5 is not offered by grok; offered: grok-4.7");
    expect(r.status).toBe(1);
  });
});
