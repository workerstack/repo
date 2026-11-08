import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { emitMaps, parseArgv } from "./emit-maps.ts";
import { VALID_LESSON } from "./fixtures/persist-bodies.ts";
import { BUN } from "../../dev/test-paths";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "emit-maps.ts");
const fixtureWs = path.join(here, "fixtures/emit-maps/ws");
const goldenIndex = path.join(here, "fixtures/emit-maps/golden/INDEX.md");
const INDEX = "references/INDEX.md";

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

function selfWs(prefix: string) {
  const ws = tmpDir(prefix);
  fs.writeFileSync(path.join(ws, "package.json"), '{ "name": "@workerstack/repo" }\n');
  fs.mkdirSync(path.join(ws, "references"), { recursive: true });
  return ws;
}

function copyFixtureWs() {
  const dest = tmpDir("emit-maps-ws-");
  fs.cpSync(fixtureWs, dest, { recursive: true });
  const packaged = path.join(
    dest,
    "node_modules/@workerstack/repo/.agents/skills/beta",
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
  it("fills repo:skills and repo:refs and keeps hand text and repo:stack byte for byte", () => {
    const ws = copyFixtureWs();
    const r = emitMaps({ workspaceRoot: ws, check: false });
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(path.join(ws, INDEX), "utf8")).toBe(fs.readFileSync(goldenIndex, "utf8"));
    expect(fs.existsSync(path.join(ws, ".rulesync"))).toBe(false);
  });

  it("refs rows name the stock package path and skip INDEX.md", () => {
    const ws = copyFixtureWs();
    emitMaps({ workspaceRoot: ws });
    const index = fs.readFileSync(path.join(ws, INDEX), "utf8");
    expect(index).toContain("| node_modules/@workerstack/repo/references/alpha.md | Alpha |");
    expect(index).toContain("| node_modules/@workerstack/repo/references/nested/beta.md |");
    expect(index).not.toMatch(/references\/INDEX\.md \|/);
    expect(index).not.toMatch(/Body ignored|Beta body|More text ignored/);
  });

  it("a second run changes nothing", () => {
    const ws = copyFixtureWs();
    emitMaps({ workspaceRoot: ws });
    const file = path.join(ws, INDEX);
    const first = fs.readFileSync(file);
    const mtime = fs.statSync(file).mtimeMs;
    expect(emitMaps({ workspaceRoot: ws }).ok).toBe(true);
    expect(fs.readFileSync(file).equals(first)).toBe(true);
    expect(fs.statSync(file).mtimeMs).toBe(mtime);
  });

  it("creates the sections when INDEX.md is missing", () => {
    const ws = copyFixtureWs();
    fs.rmSync(path.join(ws, INDEX));
    expect(emitMaps({ workspaceRoot: ws }).ok).toBe(true);
    const index = fs.readFileSync(path.join(ws, INDEX), "utf8");
    expect(index).toContain("<!-- repo:skills -->");
    expect(index).toContain("<!-- repo:refs -->");
  });

  it("--check reports drift in either section only; writes nothing", () => {
    const ws = copyFixtureWs();
    expect(emitMaps({ workspaceRoot: ws, check: false }).ok).toBe(true);
    expect(emitMaps({ workspaceRoot: ws, check: true }).ok).toBe(true);
    const file = path.join(ws, INDEX);
    const good = fs.readFileSync(file, "utf8");

    fs.writeFileSync(file, good.replace("alpha-work", "nope"));
    const skills = emitMaps({ workspaceRoot: ws, check: true });
    expect(skills.ok).toBe(false);
    expect(String(skills.error)).toMatch(/drift: references\/INDEX\.md \(repo:skills\)/);
    expect(fs.readFileSync(file, "utf8")).toContain("nope");

    fs.writeFileSync(file, good.replace("First sentence", "nope"));
    const refs = emitMaps({ workspaceRoot: ws, check: true });
    expect(refs.ok).toBe(false);
    expect(String(refs.error)).toMatch(/\(repo:refs\)/);

    fs.writeFileSync(file, good.replace("Hand text between", "Edited hand text between").replace("hand-written", "changed"));
    expect(emitMaps({ workspaceRoot: ws, check: true }).ok).toBe(true);

    fs.rmSync(file);
    const missing = emitMaps({ workspaceRoot: ws, check: true });
    expect(missing.ok).toBe(false);
    expect(String(missing.error)).toMatch(/INDEX\.md/);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("another package gets no map but still reindexes lessons", () => {
    const ws = copyFixtureWs();
    fs.writeFileSync(path.join(ws, "package.json"), '{ "name": "consumer" }\n');
    fs.writeFileSync(path.join(ws, INDEX), "hand\n");
    fs.mkdirSync(path.join(ws, "src"), { recursive: true });
    fs.writeFileSync(path.join(ws, "src/a.ts"), "x\n");
    fs.mkdirSync(path.join(ws, ".rulesync/lessons"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".rulesync/lessons/plan-forks.md"), VALID_LESSON);
    expect(emitMaps({ workspaceRoot: ws }).ok).toBe(true);
    expect(fs.readFileSync(path.join(ws, INDEX), "utf8")).toBe("hand\n");
    expect(fs.readFileSync(path.join(ws, ".rulesync/lessons/INDEX.md"), "utf8")).toContain("plan-forks.md");
    expect(emitMaps({ workspaceRoot: ws, check: true }).ok).toBe(true);
  });

  it("a workspace without package.json writes nothing", () => {
    const ws = tmpDir("emit-maps-empty-");
    expect(emitMaps({ workspaceRoot: ws, check: false }).ok).toBe(true);
    expect(fs.readdirSync(ws)).toEqual([]);
  });

  it("map.task object/array skipped; string kept", () => {
    const ws = selfWs("emit-maps-task-");
    for (const n of ["obj", "arr", "str"]) fs.mkdirSync(path.join(ws, ".agents/skills", n), { recursive: true });
    fs.writeFileSync(path.join(ws, ".agents/skills/obj/SKILL.md"), "---\nname: obj\nmap:\n  task:\n    nested: yes\n---\n");
    fs.writeFileSync(path.join(ws, ".agents/skills/arr/SKILL.md"), "---\nname: arr\nmap:\n  task:\n    - a\n    - b\n---\n");
    fs.writeFileSync(path.join(ws, ".agents/skills/str/SKILL.md"), "---\nname: str\nmap:\n  task: keep-me\n---\n");
    expect(emitMaps({ workspaceRoot: ws, check: false }).ok).toBe(true);
    const index = fs.readFileSync(path.join(ws, INDEX), "utf8");
    expect(index).toMatch(/\| str \| local \|  \| keep-me \|/);
    expect(index).not.toMatch(/\[object Object\]/);
    expect(index).not.toMatch(/nested/);
    const objRow = index.split("\n").find((l) => l.startsWith("| obj |"));
    const arrRow = index.split("\n").find((l) => l.startsWith("| arr |"));
    expect(objRow).toMatch(/\| obj \| local \|  \|  \|  \|  \|/);
    expect(arrRow).toMatch(/\| arr \| local \|  \|  \|  \|  \|/);
  });

  it("truncates long descriptions", () => {
    const ws = selfWs("emit-maps-long-");
    fs.mkdirSync(path.join(ws, ".agents/skills/long"), { recursive: true });
    const long = "word ".repeat(80).trim();
    fs.writeFileSync(path.join(ws, ".agents/skills/long/SKILL.md"), `---\nname: long\ndescription: ${long}\n---\n`);
    expect(emitMaps({ workspaceRoot: ws, check: false }).ok).toBe(true);
    const text = fs.readFileSync(path.join(ws, INDEX), "utf8");
    expect(text).toMatch(/…/);
    expect(text).not.toContain(long);
  });

  it("includes extra refs next to the fixture refs", () => {
    const ws = copyFixtureWs();
    fs.writeFileSync(path.join(ws, "references/stripe.md"), "---\ntags: [stripe]\n---\n# Stripe\n\nConsumer payments ref.\n");
    expect(emitMaps({ workspaceRoot: ws, check: false }).ok).toBe(true);
    const index = fs.readFileSync(path.join(ws, INDEX), "utf8");
    expect(index).toMatch(/references\/stripe\.md \| Stripe \| stripe \| Consumer payments ref/);
    expect(index).toMatch(/alpha\.md/);
  });

  it("keeps a row for huge refs (no silent drop)", () => {
    const ws = selfWs("emit-maps-huge-");
    const fd = fs.openSync(path.join(ws, "references/huge.md"), "w");
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
    const index = fs.readFileSync(path.join(ws, INDEX), "utf8");
    expect(index).toMatch(/\| node_modules\/@workerstack\/repo\/references\/huge\.md \| huge \|  \|  \|/);
    expect(index).not.toMatch(/^x{100,}/m);
  });
});

describe("lessons index", () => {
  function withLesson() {
    const ws = copyFixtureWs();
    fs.mkdirSync(path.join(ws, "src"), { recursive: true });
    fs.writeFileSync(path.join(ws, "src/a.ts"), "x\n");
    fs.mkdirSync(path.join(ws, ".rulesync/lessons"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".rulesync/lessons/plan-forks.md"), VALID_LESSON);
    return ws;
  }

  it("generate writes the lessons index next to the maps", () => {
    const ws = withLesson();
    expect(emitMaps({ workspaceRoot: ws }).ok).toBe(true);
    expect(fs.readFileSync(path.join(ws, ".rulesync/lessons/INDEX.md"), "utf8")).toContain(".rulesync/lessons/plan-forks.md");
    expect(emitMaps({ workspaceRoot: ws, check: true }).ok).toBe(true);
  });

  it("--check fails on a stale lessons index or a lesson whose paths match nothing", () => {
    const ws = withLesson();
    emitMaps({ workspaceRoot: ws });
    fs.writeFileSync(path.join(ws, ".rulesync/lessons/INDEX.md"), "stale\n");
    const stale = emitMaps({ workspaceRoot: ws, check: true });
    expect(stale.ok).toBe(false);
    expect(stale.error).toMatch(/lessons\/INDEX\.md is out of date/);
    emitMaps({ workspaceRoot: ws });
    fs.rmSync(path.join(ws, "src"), { recursive: true });
    expect(emitMaps({ workspaceRoot: ws, check: true }).error).toMatch(/src\/\*\* matches no file/);
  });

  it("does not create a lessons dir in a repo without lessons", () => {
    const ws = copyFixtureWs();
    expect(emitMaps({ workspaceRoot: ws }).ok).toBe(true);
    expect(fs.existsSync(path.join(ws, ".rulesync/lessons"))).toBe(false);
  });
});

describe("cli", () => {
  it("unknown flag → stderr + exit 1", () => {
    const cli = spawnSync(BUN, [script, "--wat"], {
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(cli.status).toBe(1);
    expect(cli.stderr).toMatch(/unknown flag/);
  });
});
