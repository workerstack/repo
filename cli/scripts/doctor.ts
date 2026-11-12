#!/usr/bin/env bun
/** Unified prereq doctor. Print-only install hints. Never runs installs. */
import os from "node:os";
import path from "node:path";

import { enabledSkills } from "../config.ts";
import { repoEnv, type Env } from "../repo-env.ts";
import { agentModelsLines } from "./agent-models-lines.ts";
import { bunMinimum, versionAtLeast } from "./doctor-bun.ts";
import { globalsRow, mapsRow, row } from "./doctor-rows.ts";
import { jevDoctorStatus, speakDoctorStatus, workspaceDoctorStatus } from "./doctor-status.ts";
import { installHints, lookupChromium, readVersion, whichBin, withNmBin } from "./doctor-which.ts";
import { workspaceLines, workspaceIssues } from "./doctor-workspace.ts";
import { REQUIRED } from "./doctor.constants.ts";
import type { DoctorOpts, DoctorResult, DoctorStatus } from "./doctor.types.ts";
import { loadOptionalConsumerEnv } from "./load-optional-consumer-env.ts";
import {
  PACKAGED_SKILLS_REL,
  WORKSPACE_SKILLS_REL,
  findSkillContentConflicts,
  formatSkillConflictWarn,
} from "./skill-conflicts.ts";
import { resolveRoots } from "./workspace-root.ts";

/** `DoctorOpts` with every default filled in, and the enabled packs as a set. */
type Resolved = { cwd: string; pathEnv: string | undefined; platform: string; env: Env; home: string } & {
  enabled: Set<string>;
};

/** The required tools after `bun`, each on its own row. */
const TOOL_ROWS = ["git", "rtk", "lightpanda", "chromium"] as const;
const OPTIONAL = "missing (optional)";

function optionalRow(name: string, hit: string): string {
  return hit === "" ? row(name, OPTIONAL) : row(name, "ok", hit);
}

function statusRow(name: string, status: DoctorStatus): string {
  return status.ok ? row(name, "ok", status.extra) : row(name, OPTIONAL);
}

/** The `bun` row, and the bun path when it meets the floor ("" otherwise). */
function bunRow(pathEnv: string | undefined, platform: string) {
  const bunBin = whichBin("bun", pathEnv, platform);
  const bunVer = bunBin === "" ? "" : readVersion(bunBin, "--version");
  const bunMin = bunMinimum();
  const bunOk = bunBin !== "" && versionAtLeast(bunVer, bunMin);
  const shownVer = bunVer === "" ? "unknown" : bunVer;

  if (bunBin !== "" && !bunOk) return { bun: "", line: row("bun", `need ≥${bunMin}`, `${shownVer} (${bunBin})`) };

  return { bun: bunOk ? bunBin : "", line: bunOk ? row("bun", "ok", `${bunVer} (${bunBin})`) : row("bun", "missing") };
}

/** The required tools' rows, and where each was found ("" when missing). */
function toolRows({ cwd, pathEnv, platform }: Resolved) {
  const bun = bunRow(pathEnv, platform);

  const found: Record<(typeof TOOL_ROWS)[number] | "bun", string> = {
    bun: bun.bun,
    chromium: lookupChromium(pathEnv, platform),
    git: whichBin("git", pathEnv, platform),
    lightpanda: whichBin("lightpanda", pathEnv, platform),
    rtk: whichBin("rtk", withNmBin(cwd, pathEnv, platform), platform),
  };

  const lines = TOOL_ROWS.map((k) => (found[k] === "" ? row(k, "missing") : row(k, "ok", found[k])));

  return { found, lines: [bun.line, ...lines] };
}

/** The optional rows: gh, the enabled packs' tools and keys, and jev. */
function setupRows({ enabled, env, home, pathEnv, platform }: Resolved): string[] {
  function which(name: string): string {
    return whichBin(name, pathEnv, platform);
  }

  const lines = [optionalRow("gh", which("gh"))];

  if (enabled.has("clasp")) lines.push(optionalRow("clasp", which("clasp")));

  if (enabled.has("google-workspace")) lines.push(statusRow("google-workspace", workspaceDoctorStatus({ home })));

  if (enabled.has("listen")) {
    lines.push(optionalRow("ffmpeg", which("ffmpeg")));
    const whisperCli = which("whisper-cli");
    lines.push(optionalRow("whisper-cli", whisperCli === "" ? which("whisper-cpp") : whisperCli));
  }

  if (enabled.has("speak")) lines.push(statusRow("speak", speakDoctorStatus({ env, home })));
  lines.push(statusRow("jev", jevDoctorStatus({ env, home })));

  return lines;
}

/** The print-only install block for the missing required tools. No two tools share a hint line, so none repeats. */
function hintLines(missing: string[], platform: string): string[] {
  if (missing.length === 0) return [];

  return ["", "install (print-only; not run):", ...missing.flatMap((k) => installHints(k, platform))];
}

/** The skill conflicts block, and the workspace leftovers. */
function repoRows({ cwd, env }: Resolved): string[] {
  const conflicts = findSkillContentConflicts({
    packagedSkillsDir: path.join(cwd, PACKAGED_SKILLS_REL),
    workspaceSkillsDir: path.join(cwd, WORKSPACE_SKILLS_REL),
  });

  const warn =
    conflicts.length > 0
      ? [
          "",
          "skill conflicts (warn; re-init overwrites repo-owned names):",
          ...conflicts.map((c) => formatSkillConflictWarn(c.name)),
        ]
      : [];

  return [...warn, ...workspaceLines(workspaceIssues(resolveRoots({}, { cwd, env })))];
}

/** `opts` with every default filled in. */
function resolveOpts(opts: DoctorOpts): Resolved {
  return {
    cwd: opts.cwd ?? process.cwd(),
    enabled: new Set<string>(opts.skills ?? []),
    env: opts.env ?? repoEnv.process,
    home: opts.home ?? os.homedir(),
    pathEnv: opts.pathEnv ?? repoEnv.process.PATH,
    platform: opts.platform ?? process.platform,
  };
}

export function runDoctor(opts: DoctorOpts = {}): DoctorResult {
  const o = resolveOpts(opts);
  const { cwd, platform } = o;
  const tools = toolRows(o);
  const setup = setupRows(o);
  const missingRequired = REQUIRED.filter((k) => tools.found[k] === "");
  const maps = mapsRow(cwd);

  const lines = [
    ...tools.lines,
    ...setup,
    ...(opts.globals == null ? [] : [opts.globals]),
    ...hintLines(missingRequired, platform),
    ...(maps === null ? [] : [maps.line]),
    ...repoRows(o),
    ...(opts.extraLines ?? []),
  ];

  return {
    code: missingRequired.length > 0 || maps?.ok === false ? 1 : 0,
    stderr: "",
    stdout: `${lines.join("\n")}\n`,
  };
}

export async function main(): Promise<number> {
  await loadOptionalConsumerEnv();

  const r = runDoctor({
    extraLines: await agentModelsLines(),
    globals: await globalsRow(process.cwd(), os.homedir()),
    skills: await enabledSkills(process.cwd()),
  });

  process.stdout.write(r.stdout); // runDoctor reports on stdout only

  return r.code;
}
