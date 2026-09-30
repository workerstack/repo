import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { emitMaps, parseArgv } from "./emit-maps.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "emit-maps.mjs");
const fixtureWs = path.join(here, "fixtures/emit-maps/ws");
const goldenSkills = path.join(here, "fixtures/emit-maps/golden/skills-map.md");
const goldenRefs = path.join(here, "fixtures/emit-maps/golden/refs-map.md");
const goldenIndex = path.join(here, "fixtures/emit-maps/golden/INDEX.md");

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function writeStubLaw(ws: string) {
  const dir = path.join(ws, ".rulesync/reference");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "law.md"), "# Law\n\nProtocol stays cascade/overview; domain fills this.\n");
}

function copyFixtureWs() {
  const dest = tmpDir("emit-maps-ws-");
  fs.cpSync(fixtureWs, dest, { recursive: true });
  const packaged = path.join(
    dest,
    "node_modules/@lovrozagar/grunt/.rulesync/skills/beta",
  );
  fs.mkdirSync(packaged, { recursive: true });
  fs.writeFileSync(path.join(packaged, "SKILL.md"), "---\nname: beta\n---\n");
  return dest;
}

describe("parseArgv", () => {
  it("defaults and --check", () => {
    expect(parseArgv([])).toEqual({ ok: true, check: false });
    expect(parseArgv(["--check"])).toEqual({ ok: true, check: true });
    expect(parseArgv(["--wat"]).ok).toBe(false);
  });
});

describe("emitMaps", () => {
  it("emits golden INDEX, skills-map, and refs-map from 2 skills + 2 refs", () => {
    const ws = copyFixtureWs();
    const r = emitMaps({ workspaceRoot: ws, check: false });
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(path.join(ws, ".rulesync/reference/INDEX.md"), "utf8")).toBe(
      fs.readFileSync(goldenIndex, "utf8"),
    );
    expect(fs.readFileSync(path.join(ws, ".rulesync/reference/skills-map.md"), "utf8")).toBe(
      fs.readFileSync(goldenSkills, "utf8"),
    );
    expect(fs.readFileSync(path.join(ws, ".rulesync/reference/refs-map.md"), "utf8")).toBe(
      fs.readFileSync(goldenRefs, "utf8"),
    );
    const refs = fs.readFileSync(path.join(ws, ".rulesync/reference/refs-map.md"), "utf8");
    expect(refs).not.toMatch(/INDEX\.md/);
    expect(refs).not.toMatch(/Essay-style INDEX/);
    expect(refs).not.toMatch(/skills-map\.md/);
    expect(refs).not.toMatch(/refs-map\.md/);
    const index = fs.readFileSync(path.join(ws, ".rulesync/reference/INDEX.md"), "utf8");
    const skills = fs.readFileSync(path.join(ws, ".rulesync/reference/skills-map.md"), "utf8");
    expect(index).toMatch(/# Law/);
    expect(index).toMatch(/Protocol stays cascade\/overview; domain fills this\./);
    expect(index).toMatch(/# Skills/);
    expect(index).toMatch(/# Refs/);
    expect(index).toMatch(/\| name \| origin \| description \| task \| commandPath \| refs \|/);
    expect(index).toMatch(/\| path \| title \| tags \| summary \|/);
    expect(index).not.toMatch(/Law: `\.rulesync\/reference\/law\.md`/);
    expect(index).not.toMatch(/Skills: `\.rulesync\/reference\/skills-map\.md`/);
    expect(index).not.toMatch(/Refs: `\.rulesync\/reference\/refs-map\.md`/);
    expect(index).not.toMatch(/Body ignored/);
    expect(index).not.toMatch(/Beta body/);
    expect(index).not.toMatch(/More text ignored for one-line/);
    expect(index).toContain("| alpha | local | Alpha skill one-liner. | alpha-work | scripts/alpha.mjs | cascade.md, alpha.md |");
    expect(skills).toContain("| alpha | local | Alpha skill one-liner. | alpha-work | scripts/alpha.mjs | cascade.md, alpha.md |");
    const indexSkills = index.split("# Refs")[0];
    const skillsRows = skills.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| name |") && !l.startsWith("| ---"));
    for (const row of skillsRows) expect(indexSkills).toContain(row);
    const refsRows = refs.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| path |") && !l.startsWith("| ---"));
    const indexRefs = index.split("# Refs")[1] || "";
    for (const row of refsRows) expect(indexRefs).toContain(row);
  });

  it("--check fails on drift then passes; writes nothing on check", () => {
    const ws = copyFixtureWs();
    expect(emitMaps({ workspaceRoot: ws, check: false }).ok).toBe(true);
    expect(emitMaps({ workspaceRoot: ws, check: true }).ok).toBe(true);

    const skillsPath = path.join(ws, ".rulesync/reference/skills-map.md");
    const indexPath = path.join(ws, ".rulesync/reference/INDEX.md");
    const refsPath = path.join(ws, ".rulesync/reference/refs-map.md");
    const before = fs.readFileSync(skillsPath, "utf8");
    const indexBefore = fs.readFileSync(indexPath, "utf8");
    const refsBefore = fs.readFileSync(refsPath, "utf8");
    fs.writeFileSync(skillsPath, before.replace("local", "nope"));
    const drifted = emitMaps({ workspaceRoot: ws, check: true });
    expect(drifted.ok).toBe(false);
    expect(String(drifted.error)).toMatch(/drift/);
    expect(String(drifted.error)).toMatch(/skills-map\.md/);
    expect(fs.readFileSync(skillsPath, "utf8")).not.toBe(before);

    fs.writeFileSync(skillsPath, before);
    expect(emitMaps({ workspaceRoot: ws, check: true }).ok).toBe(true);

    fs.writeFileSync(indexPath, indexBefore.replace("alpha-work", "nope"));
    const indexDrift = emitMaps({ workspaceRoot: ws, check: true });
    expect(indexDrift.ok).toBe(false);
    expect(String(indexDrift.error)).toMatch(/INDEX\.md/);
    fs.writeFileSync(indexPath, indexBefore);
    expect(emitMaps({ workspaceRoot: ws, check: true }).ok).toBe(true);

    fs.writeFileSync(refsPath, refsBefore.replace("First sentence", "nope"));
    const refsDrift = emitMaps({ workspaceRoot: ws, check: true });
    expect(refsDrift.ok).toBe(false);
    expect(String(refsDrift.error)).toMatch(/refs-map\.md/);
    fs.writeFileSync(refsPath, refsBefore);
    expect(emitMaps({ workspaceRoot: ws, check: true }).ok).toBe(true);

    fs.rmSync(indexPath);
    const missing = emitMaps({ workspaceRoot: ws, check: true });
    expect(missing.ok).toBe(false);
    expect(String(missing.error)).toMatch(/INDEX\.md/);
    expect(fs.existsSync(indexPath)).toBe(false);
  });

  it("skips when .rulesync is missing; does not write", () => {
    const ws = tmpDir("emit-maps-empty-");
    const r = emitMaps({ workspaceRoot: ws, check: false });
    expect(r.ok).toBe(true);
    expect(fs.existsSync(path.join(ws, ".rulesync"))).toBe(false);
  });

  it("generate and --check fail when law.md is missing; writes nothing", () => {
    const ws = tmpDir("emit-maps-nolaw-");
    fs.mkdirSync(path.join(ws, ".rulesync/reference"), { recursive: true });
    fs.mkdirSync(path.join(ws, ".rulesync/skills/x"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".rulesync/skills/x/SKILL.md"), "---\nname: x\n---\n");
    const gen = emitMaps({ workspaceRoot: ws, check: false });
    expect(gen.ok).toBe(false);
    expect(String(gen.error)).toMatch(/\.rulesync\/reference\/law\.md/);
    expect(fs.existsSync(path.join(ws, ".rulesync/reference/INDEX.md"))).toBe(false);
    expect(fs.existsSync(path.join(ws, ".rulesync/reference/skills-map.md"))).toBe(false);
    expect(fs.existsSync(path.join(ws, ".rulesync/reference/refs-map.md"))).toBe(false);

    writeStubLaw(ws);
    expect(emitMaps({ workspaceRoot: ws, check: false }).ok).toBe(true);
    fs.rmSync(path.join(ws, ".rulesync/reference/law.md"));
    const chk = emitMaps({ workspaceRoot: ws, check: true });
    expect(chk.ok).toBe(false);
    expect(String(chk.error)).toMatch(/\.rulesync\/reference\/law\.md/);
    expect(String(chk.error)).not.toMatch(/drift/);
    expect(fs.existsSync(path.join(ws, ".rulesync/reference/INDEX.md"))).toBe(true);
  });

  it("cli missing law.md → stderr + exit 1", () => {
    const ws = tmpDir("emit-maps-cli-nolaw-");
    fs.mkdirSync(path.join(ws, ".rulesync/reference"), { recursive: true });
    const cli = spawnSync(process.execPath, [script], {
      cwd: ws,
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(cli.status).toBe(1);
    expect(cli.stderr).toMatch(/\.rulesync\/reference\/law\.md/);
  });

  it("map.task object/array skipped; string kept", () => {
    const ws = tmpDir("emit-maps-task-");
    fs.mkdirSync(path.join(ws, ".rulesync/skills/obj"), { recursive: true });
    fs.mkdirSync(path.join(ws, ".rulesync/skills/arr"), { recursive: true });
    fs.mkdirSync(path.join(ws, ".rulesync/skills/str"), { recursive: true });
    writeStubLaw(ws);
    fs.writeFileSync(
      path.join(ws, ".rulesync/skills/obj/SKILL.md"),
      "---\nname: obj\nmap:\n  task:\n    nested: yes\n---\n",
    );
    fs.writeFileSync(
      path.join(ws, ".rulesync/skills/arr/SKILL.md"),
      "---\nname: arr\nmap:\n  task:\n    - a\n    - b\n---\n",
    );
    fs.writeFileSync(
      path.join(ws, ".rulesync/skills/str/SKILL.md"),
      "---\nname: str\nmap:\n  task: keep-me\n---\n",
    );
    expect(emitMaps({ workspaceRoot: ws, check: false }).ok).toBe(true);
    const index = fs.readFileSync(path.join(ws, ".rulesync/reference/INDEX.md"), "utf8");
    expect(index).toMatch(/\| str \| local \|  \| keep-me \|/);
    expect(index).not.toMatch(/\[object Object\]/);
    expect(index).not.toMatch(/nested/);
    expect(index).toMatch(/\| obj \|/);
    expect(index).toMatch(/\| arr \|/);
    const objRow = index.split("\n").find((l) => l.startsWith("| obj |"));
    const arrRow = index.split("\n").find((l) => l.startsWith("| arr |"));
    expect(objRow).toMatch(/\| obj \| local \|  \|  \|  \|  \|/);
    expect(arrRow).toMatch(/\| arr \| local \|  \|  \|  \|  \|/);
  });

  it("truncates long descriptions", () => {
    const ws = tmpDir("emit-maps-long-");
    fs.mkdirSync(path.join(ws, ".rulesync/skills/long"), { recursive: true });
    writeStubLaw(ws);
    const long = "word ".repeat(80).trim();
    fs.writeFileSync(
      path.join(ws, ".rulesync/skills/long/SKILL.md"),
      `---\nname: long\ndescription: ${long}\n---\n`,
    );
    expect(emitMaps({ workspaceRoot: ws, check: false }).ok).toBe(true);
    const text = fs.readFileSync(path.join(ws, ".rulesync/reference/skills-map.md"), "utf8");
    expect(text).toMatch(/…/);
    expect(text).not.toContain(long);
  });

  it("INDEX and refs-map include dest extras next to packaged refs", () => {
    const ws = copyFixtureWs();
    fs.writeFileSync(
      path.join(ws, ".rulesync/reference/stripe.md"),
      "---\ntags: [stripe]\n---\n# Stripe\n\nConsumer payments ref.\n",
    );
    expect(emitMaps({ workspaceRoot: ws, check: false }).ok).toBe(true);
    const index = fs.readFileSync(path.join(ws, ".rulesync/reference/INDEX.md"), "utf8");
    const refs = fs.readFileSync(path.join(ws, ".rulesync/reference/refs-map.md"), "utf8");
    expect(index).toMatch(/stripe\.md/);
    expect(index).toMatch(/Consumer payments ref/);
    expect(index).toMatch(/alpha\.md/);
    expect(refs).toMatch(/stripe\.md/);
    expect(refs).toMatch(/alpha\.md/);
  });

  it("keeps a row for huge refs (no silent drop)", () => {
    const ws = tmpDir("emit-maps-huge-");
    writeStubLaw(ws);
    const huge = path.join(ws, ".rulesync/reference/huge.md");
    const fd = fs.openSync(huge, "w");
    fs.writeSync(fd, "# Huge\n\n");
    const chunk = "x".repeat(64 * 1024);
    let left = 512 * 1024 + 1;
    while (left > 0) {
      const n = Math.min(left, chunk.length);
      fs.writeSync(fd, chunk.slice(0, n));
      left -= n;
    }
    fs.closeSync(fd);
    expect(emitMaps({ workspaceRoot: ws, check: false }).ok).toBe(true);
    const refs = fs.readFileSync(path.join(ws, ".rulesync/reference/refs-map.md"), "utf8");
    const index = fs.readFileSync(path.join(ws, ".rulesync/reference/INDEX.md"), "utf8");
    expect(refs).toMatch(/\| \.rulesync\/reference\/huge\.md \| huge \|  \|  \|/);
    expect(index).toMatch(/\| \.rulesync\/reference\/huge\.md \| huge \|  \|  \|/);
    expect(index).not.toMatch(/^x{100,}/m);
  });
});

describe("cli", () => {
  it("unknown flag → stderr + exit 1", () => {
    const cli = spawnSync(process.execPath, [script, "--wat"], {
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(cli.status).toBe(1);
    expect(cli.stderr).toMatch(/unknown flag/);
  });
});
