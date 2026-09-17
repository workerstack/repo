import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHROMIUM_BINS,
  installHints,
  mapsRequired,
  nodeMajor,
  runDoctor as runDoctorImpl,
  whichBin,
} from "./doctor.mjs";

function runDoctor(opts: Record<string, unknown> = {}) {
  return runDoctorImpl({
    env: {},
    home: path.join(os.tmpdir(), "grunt-doctor-no-speak"),
    ...opts,
  });
}

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "doctor.mjs");

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

function writeBin(dir: string, name: string, body = "#!/bin/sh\nexit 0\n") {
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, name);
  fs.writeFileSync(dest, body, { mode: 0o755 });
  return dest;
}

function writeNode(dir: string, version = "v22.11.0") {
  return writeBin(
    dir,
    "node",
    `#!/bin/sh\n[ "$1" = "-v" ] && echo ${version} && exit 0\nexit 0\n`,
  );
}

const REQUIRED = ["node", "npm", "git", "rtk", "rulesync", "lightpanda", "chromium"];

function writeRequired(dir: string, extra: Record<string, string> = {}) {
  writeNode(dir, extra.nodeVersion || "v22.11.0");
  writeBin(dir, "npm");
  writeBin(dir, "git");
  writeBin(dir, "rtk");
  writeBin(dir, "rulesync");
  writeBin(dir, extra.lightpandaName || "lightpanda");
  writeBin(dir, extra.chromiumName || "chromium");
}

const REQUIRED_MAPS = ["INDEX.md", "skills-map.md", "refs-map.md", "law.md"];

function writeRequiredMaps(cwd: string) {
  const dir = path.join(cwd, ".rulesync", "reference");
  fs.mkdirSync(dir, { recursive: true });
  for (const name of REQUIRED_MAPS) {
    fs.writeFileSync(path.join(dir, name), `# ${name}\n`);
  }
}

describe("nodeMajor", () => {
  it("parses v-prefixed and bare", () => {
    expect(nodeMajor("v22.11.0")).toBe(22);
    expect(nodeMajor("22.0.0")).toBe(22);
    expect(nodeMajor("v18.20.8")).toBe(18);
    expect(nodeMajor("nope")).toBe(0);
  });
});

describe("CHROMIUM_BINS", () => {
  it("matches browser family names", () => {
    expect(CHROMIUM_BINS).toEqual([
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
      expect(t).toMatch(/https:\/\/nodejs\.org/);
      expect(t).toMatch(/≥22|>=22/);
      expect(t).toMatch(/npm i -D rulesync/);
    }
    expect(linux).toMatch(/apt install git|apt install.*git/);
    expect(linux).toMatch(/curl -fsSL https:\/\/raw\.githubusercontent\.com\/rtk-ai\/rtk\/master\/install\.sh \| sh/);
    expect(linux).toMatch(/pkg\.lightpanda\.io\/install\.sh/);
    expect(linux).toMatch(/apt install chromium/);
    expect(darwin).toMatch(/brew install git/);
    expect(darwin).toMatch(/brew install rtk/);
    expect(darwin).toMatch(/brew tap lightpanda-io\/browser/);
    expect(darwin).toMatch(/brew install --cask chromium|brew install --cask google-chrome/);
    expect(win).toMatch(/winget install OpenJS\.NodeJS\.LTS/);
    expect(win).toMatch(/winget install Git\.Git/);
    expect(win).toMatch(/rtk\.exe|WSL/);
    expect(win).toMatch(/rtk-ai\.app\/docs\/getting-started\/installation/);
    expect(win).toMatch(/winget install Google\.Chrome/);
    expect(win).toMatch(/winget install Microsoft\.Edge/);
    expect(win).toMatch(/WSL/i);
  });
});

describe("runDoctor", () => {
  it("empty PATH + no running node fallback → exit 1; all required missing; OS hints; optional gh; no playwright", () => {
    const cwd = tmp("doc-empty-");
    const linux = runDoctor({
      cwd,
      pathEnv: "",
      platform: "linux",
      execPath: "",
    });
    const darwin = runDoctor({
      cwd,
      pathEnv: "",
      platform: "darwin",
      execPath: "",
    });
    const win = runDoctor({
      cwd,
      pathEnv: "",
      platform: "win32",
      execPath: "",
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
      expect(r.stdout).toMatch(/rulesync schema doctor: npm run rulesync:doctor/);
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
      execPath: "",
    });
    expect(r.code).toBe(0);
    expect(mapsRequired(cwd)).toBe(false);
    expect(r.stdout).toMatch(/node\s+ok/);
    expect(r.stdout).toMatch(/v22\.11\.0/);
    expect(r.stdout).toContain(path.join(bin, "git"));
    expect(r.stdout).toMatch(/gh\s+missing \(optional\)/);
    expect(r.stdout).not.toMatch(/node\s+missing/);
    expect(r.stdout).not.toMatch(/INDEX\.md/);
    expect(r.stdout).not.toMatch(/maps missing/);
    expect(r.stdout).not.toMatch(/install \(print-only; not run\)/);
    expect(r.stdout).toMatch(/rulesync schema doctor: npm run rulesync:doctor/);
  });

  it("gh present is ok not a required miss", () => {
    const cwd = tmp("doc-gh-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    const gh = writeBin(bin, "gh");
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux", execPath: "" });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(gh);
    expect(r.stdout).not.toMatch(/gh\s+missing/);
  });

  it("clasp present is ok not a required miss", () => {
    const cwd = tmp("doc-clasp-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    const clasp = writeBin(bin, "clasp");
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux", execPath: "" });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(clasp);
    expect(r.stdout).not.toMatch(/clasp\s+missing/);
  });

  it("ffmpeg present is ok not a required miss", () => {
    const cwd = tmp("doc-ffmpeg-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    const ffmpeg = writeBin(bin, "ffmpeg");
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux", execPath: "" });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(ffmpeg);
    expect(r.stdout).not.toMatch(/ffmpeg\s+missing/);
  });

  it("whisper-cli present is ok not a required miss", () => {
    const cwd = tmp("doc-whisper-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    const w = writeBin(bin, "whisper-cli");
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux", execPath: "" });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(w);
    expect(r.stdout).not.toMatch(/whisper-cli\s+missing/);
  });

  it("google-workspace oauth/tokens/adc/clasprc are optional ok and do not echo secrets", () => {
    const cwd = tmp("doc-ws-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    const missing = runDoctor({ cwd, pathEnv: bin, platform: "linux", execPath: "" });
    expect(missing.code).toBe(0);
    expect(missing.stdout).toMatch(/google-workspace\s+missing \(optional\)/);

    const oauthHome = tmp("doc-ws-oauth-");
    const oauthSecret = "oauth-client-secret-do-not-print";
    fs.mkdirSync(path.join(oauthHome, ".grunt"), { recursive: true });
    fs.writeFileSync(
      path.join(oauthHome, ".grunt", "google-oauth.json"),
      JSON.stringify({ installed: { client_id: "cid", client_secret: oauthSecret } }),
    );
    const oauth = runDoctor({
      cwd,
      pathEnv: bin,
      platform: "linux",
      execPath: "",
      home: oauthHome,
    });
    expect(oauth.code).toBe(0);
    expect(oauth.stdout).toMatch(/google-workspace\s+ok\s+oauth/);
    expect(oauth.stdout).not.toContain(oauthSecret);
    expect(oauth.stdout).not.toContain("cid");
    expect(oauth.stdout).not.toMatch(/google-workspace\s+missing/);

    const tokHome = tmp("doc-ws-tok-");
    const refresh = "refresh-token-secret";
    fs.mkdirSync(path.join(tokHome, ".grunt"), { recursive: true });
    fs.writeFileSync(
      path.join(tokHome, ".grunt", "workspace-tokens.json"),
      JSON.stringify({ refresh_token: refresh, client_id: "tok-cid" }),
    );
    const tokens = runDoctor({
      cwd,
      pathEnv: bin,
      platform: "linux",
      execPath: "",
      home: tokHome,
    });
    expect(tokens.stdout).toMatch(/google-workspace\s+ok\s+tokens/);
    expect(tokens.stdout).not.toContain(refresh);
    expect(tokens.stdout).not.toContain("tok-cid");

    const namedHome = tmp("doc-ws-named-");
    fs.mkdirSync(path.join(namedHome, ".grunt", "workspace", "work"), { recursive: true });
    fs.writeFileSync(
      path.join(namedHome, ".grunt", "workspace", "work", "google-oauth.json"),
      JSON.stringify({ installed: { client_id: "work-cid", client_secret: "work-secret" } }),
    );
    fs.writeFileSync(
      path.join(namedHome, ".grunt", "workspace", "work", "tokens.json"),
      JSON.stringify({ refresh_token: "work-refresh" }),
    );
    const named = runDoctor({
      cwd,
      pathEnv: bin,
      platform: "linux",
      execPath: "",
      home: namedHome,
    });
    expect(named.stdout).toMatch(/google-workspace\s+ok\s+oauth,tokens/);
    expect(named.stdout).not.toContain("work-secret");
    expect(named.stdout).not.toContain("work-refresh");
    expect(named.stdout).not.toContain("work-cid");

    const adcHome = tmp("doc-ws-adc-");
    fs.mkdirSync(path.join(adcHome, ".config", "gcloud"), { recursive: true });
    fs.writeFileSync(
      path.join(adcHome, ".config", "gcloud", "application_default_credentials.json"),
      JSON.stringify({ type: "authorized_user", refresh_token: "adc-refresh" }),
    );
    const adc = runDoctor({
      cwd,
      pathEnv: bin,
      platform: "linux",
      execPath: "",
      home: adcHome,
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
      pathEnv: bin,
      platform: "linux",
      execPath: "",
      home: claspHome,
    });
    expect(clasprc.stdout).toMatch(/google-workspace\s+ok\s+clasprc/);
    expect(clasprc.stdout).not.toContain("clasp-refresh");
  });

  it("speak dummy key is optional ok and does not echo the secret", () => {
    const cwd = tmp("doc-speak-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    const secret = "sk_secret_do_not_print";
    const r = runDoctor({
      cwd,
      pathEnv: bin,
      platform: "linux",
      execPath: "",
      env: { ELEVENLABS_API_KEY: secret },
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/speak\s+ok\s+elevenlabs/);
    expect(r.stdout).not.toContain(secret);
    expect(r.stdout).not.toMatch(/speak\s+missing/);
  });

  it("speak openai key and speak.json config do not print secrets", () => {
    const cwd = tmp("doc-speak-oa-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    const home = tmp("doc-speak-home-");
    fs.mkdirSync(path.join(home, ".grunt"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".grunt", "speak.json"),
      JSON.stringify({ openai: { apiKey: "sk_file_secret" } }),
    );
    const oa = runDoctor({
      cwd,
      pathEnv: bin,
      platform: "linux",
      execPath: "",
      env: { OPENAI_API_KEY: "sk_oa_secret" },
    });
    expect(oa.stdout).toMatch(/speak\s+ok\s+openai/);
    expect(oa.stdout).not.toContain("sk_oa_secret");
    const file = runDoctor({
      cwd,
      pathEnv: bin,
      platform: "linux",
      execPath: "",
      env: {},
      home,
    });
    expect(file.stdout).toMatch(/speak\s+ok\s+config/);
    expect(file.stdout).not.toContain("sk_file_secret");
  });

  it("node <22 is required fail even if bin exists", () => {
    const cwd = tmp("doc-old-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin, { nodeVersion: "v18.20.0" });
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux", execPath: "" });
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/node\s+.*need ≥22|node\s+.*need >=22/);
    expect(r.stdout).toMatch(/https:\/\/nodejs\.org/);
  });

  it("rulesync / rtk from node_modules/.bin counts as npx-able", () => {
    const cwd = tmp("doc-npx-");
    const bin = path.join(cwd, "bin");
    writeNode(bin);
    writeBin(bin, "npm");
    writeBin(bin, "git");
    writeBin(bin, "lightpanda");
    writeBin(bin, "chromium");
    const nm = path.join(cwd, "node_modules", ".bin");
    const rtk = writeBin(nm, "rtk");
    const rs = writeBin(nm, "rulesync");
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux", execPath: "" });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(rtk);
    expect(r.stdout).toContain(rs);
  });

  it("chromium family name google-chrome satisfies chromium", () => {
    const cwd = tmp("doc-chrome-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin, { chromiumName: "google-chrome" });
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux", execPath: "" });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(path.join(bin, "google-chrome"));
    expect(r.stdout).not.toMatch(/chromium\s+missing/);
  });

  it("tools ok, no .rulesync → skip maps; exit 0; no INDEX missing", () => {
    const cwd = tmp("doc-nomaps-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux", execPath: "" });
    expect(r.code).toBe(0);
    expect(mapsRequired(cwd)).toBe(false);
    expect(r.stdout).not.toMatch(/INDEX\.md/);
    expect(r.stdout).not.toMatch(/maps missing/);
  });

  it("empty .rulesync without reference/skills → skip maps", () => {
    const cwd = tmp("doc-empty-rs-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    fs.mkdirSync(path.join(cwd, ".rulesync"));
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux", execPath: "" });
    expect(r.code).toBe(0);
    expect(mapsRequired(cwd)).toBe(false);
    expect(r.stdout).not.toMatch(/maps missing/);
  });

  it("tools ok but .rulesync/reference/ without INDEX/skills-map/refs-map/law → exit 1", () => {
    const cwd = tmp("doc-maps-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    fs.mkdirSync(path.join(cwd, ".rulesync", "reference"), { recursive: true });
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux", execPath: "" });
    expect(r.code).toBe(1);
    expect(mapsRequired(cwd)).toBe(true);
    for (const name of REQUIRED_MAPS) {
      expect(r.stdout).toMatch(new RegExp(`${name.replace(".", "\\.")}\\s+missing`));
    }
    expect(r.stdout).toMatch(/maps missing: INDEX\.md, skills-map\.md, refs-map\.md, law\.md/);
  });

  it("tools ok but .rulesync/skills/ without maps → exit 1", () => {
    const cwd = tmp("doc-skills-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    fs.mkdirSync(path.join(cwd, ".rulesync", "skills"), { recursive: true });
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux", execPath: "" });
    expect(r.code).toBe(1);
    expect(mapsRequired(cwd)).toBe(true);
    expect(r.stdout).toMatch(/maps missing: INDEX\.md, skills-map\.md, refs-map\.md, law\.md/);
  });

  it("product SoT with all four maps present → exit 0", () => {
    const cwd = tmp("doc-maps-ok-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    writeRequiredMaps(cwd);
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux", execPath: "" });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/INDEX\.md\s+ok/);
    expect(r.stdout).toMatch(/law\.md\s+ok/);
    expect(r.stdout).not.toMatch(/maps missing/);
  });

  it("each required map file missing is a fail even if the others exist", () => {
    const cwd = tmp("doc-map-one-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    writeRequiredMaps(cwd);
    fs.rmSync(path.join(cwd, ".rulesync/reference/law.md"));
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux", execPath: "" });
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/law\.md\s+missing/);
    expect(r.stdout).toMatch(/maps missing: law\.md/);
    expect(r.stdout).not.toMatch(/INDEX\.md\s+missing/);
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
    const wsSkill = path.join(cwd, ".rulesync", "skills", "parent");
    const pkgSkill = path.join(
      cwd,
      "node_modules",
      "@lovrozagar",
      "grunt",
      ".rulesync",
      "skills",
      "parent",
    );
    fs.mkdirSync(wsSkill, { recursive: true });
    fs.mkdirSync(pkgSkill, { recursive: true });
    fs.writeFileSync(path.join(wsSkill, "SKILL.md"), "custom\n");
    fs.writeFileSync(path.join(pkgSkill, "SKILL.md"), "packaged\n");
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux", execPath: "" });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/skill conflicts \(warn/);
    expect(r.stdout).toMatch(/skill `parent` differs from packaged grunt; re-init overwrites/);
  });

  it("identical packaged skill → no conflict lines", () => {
    const cwd = tmp("doc-sk-same-");
    const bin = path.join(cwd, "bin");
    writeRequired(bin);
    writeRequiredMaps(cwd);
    const wsSkill = path.join(cwd, ".rulesync", "skills", "parent");
    const pkgSkill = path.join(
      cwd,
      "node_modules",
      "@lovrozagar",
      "grunt",
      ".rulesync",
      "skills",
      "parent",
    );
    fs.mkdirSync(wsSkill, { recursive: true });
    fs.mkdirSync(pkgSkill, { recursive: true });
    fs.writeFileSync(path.join(wsSkill, "SKILL.md"), "same\n");
    fs.writeFileSync(path.join(pkgSkill, "SKILL.md"), "same\n");
    const r = runDoctor({ cwd, pathEnv: bin, platform: "linux", execPath: "" });
    expect(r.code).toBe(0);
    expect(r.stdout).not.toMatch(/skill conflicts/);
  });
});

describe("doctor cli", () => {
  it("main empty PATH + no node on PATH exits 1", () => {
    const cwd = tmp("doc-cli-");
    const r = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      cwd,
      env: { ...process.env, PATH: "/nonexistent-grunt-doctor" },
      timeout: 15_000,
    });
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toMatch(/missing/);
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/playwright install/);
  });
});
