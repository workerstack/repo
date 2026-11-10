import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readEnv } from "./env.ts";
import { init, parsePacksFlag, type InitOptions } from "./init.ts";
import { confirm, isInteractive, select, spinner } from "./prompt.ts";
import { runSync } from "./sync.ts";
import { HOOK_NAMES } from "./scripts/hook-command.ts";
import { COMMANDS, isCommandName, runCommand } from "./commands.ts";
import { mapCommand } from "./scripts/folder-map.ts";

const PKG_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const pad = (name: string) => `  ${name.padEnd(18)}`;

const USAGE = `Usage: repo [command]

Default (no command): TTY menu; else init — full setup

Commands:
${pad("init")}Full setup: write workerstack.config.ts and package.json, bun install (whose postinstall runs repo sync), repo yolo
${pad("check")}Tsconfig bases, manifests, disable comments, lint.skip entries, generated files current, lint within .repo/lint-baseline.json, knip, actionlint on workflows, and floors, known failures and the baseline against main
${pad("sync")}Write the committed generated files from workerstack.config.ts (--check: report drift; --postinstall: never fail)
${pad("map [dir]")}Code-only folder map (git-tracked, no files); dir for depth
${Object.entries(COMMANDS)
  .map(([name, entry]) => `${pad(name)}${entry.summary}\n`)
  .join("")}${pad("hook <name>")}Run a hook: ${HOOK_NAMES.join(", ")}
${pad("help")}Show this help
${pad("version")}Print package version

Flags:
  --skip-globals     Skip repo yolo (otherwise init always runs it)
  --yes, -y          Non-interactive
  --non-interactive  Same as --yes
  --packs <list>     init: skill packs written as agents.skills into a new config: google-workspace,listen,speak,clasp or none
`;

const MENU_OPTIONS = [
  { value: "init", label: "init" },
  { value: "check", label: "check" },
  { value: "yolo", label: "yolo" },
  { value: "purge-mcps", label: "purge-mcps" },
  { value: "doctor", label: "doctor" },
  { value: "clean", label: "clean" },
  { value: "setup", label: "setup" },
  { value: "tasks", label: "tasks" },
  { value: "help", label: "help" },
  { value: "quit", label: "quit" },
];

const YES_FLAGS = new Set(["--yes", "-y", "--non-interactive"]);

function pkgVersion(): string {
  const pkg: unknown = JSON.parse(readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"));
  if (typeof pkg !== "object" || pkg === null || !("version" in pkg) || typeof pkg.version !== "string") {
    throw new Error("package.json has no version");
  }
  return pkg.version;
}

/** The command line, split into the command, its arguments and the flags this CLI knows. */
export interface Flags {
  cmd: string | undefined;
  args: string[];
  skipGlobals: boolean;
  packs: string[] | undefined;
  packsError: boolean;
}

export function parseArgv(argv: string[]): Flags {
  let skipGlobals = false;
  let packs: string[] | undefined;
  let packsError = false;
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!; // i < argv.length
    if (a === "--skip-globals") {
      skipGlobals = true;
      continue;
    }
    if (YES_FLAGS.has(a)) continue;
    if (a === "--packs") {
      const v = argv[i + 1];
      if (v == null || String(v).startsWith("--")) {
        packsError = true;
        continue;
      }
      try {
        packs = parsePacksFlag(v);
      } catch {
        packsError = true;
      }
      i += 1;
      continue;
    }
    if (typeof a === "string" && a.startsWith("--packs=")) {
      try {
        packs = parsePacksFlag(a.slice("--packs=".length));
      } catch {
        packsError = true;
      }
      continue;
    }
    positionals.push(a);
  }
  return {
    cmd: positionals[0],
    args: positionals.slice(1),
    skipGlobals,
    packs,
    packsError,
  };
}

function bindSpinner() {
  const spin = spinner();
  return (name: string, action: "start" | "stop") => {
    if (action === "start") spin.start(name);
    else spin.stop(name);
  };
}

export const APPLY_GLOBALS_CONFIRM = "Apply global prompt optimizations? (recommended)";

function initOpts(base: InitOptions, packs: string[] | undefined): InitOptions {
  if (packs === undefined) return base;
  return { ...base, packs };
}

interface RunInitOptions {
  skipGlobals: boolean;
  interactive: boolean;
  packs: string[] | undefined;
}

async function runInit(cwd: string, { skipGlobals, interactive, packs }: RunInitOptions) {
  if (!interactive) {
    init(cwd, initOpts({ skipGlobals }, packs));
    return;
  }
  const applyGlobals = await confirm({
    message: APPLY_GLOBALS_CONFIRM,
    initialValue: !skipGlobals,
  });
  init(
    cwd,
    initOpts(
      {
        skipGlobals: !applyGlobals,
        onPhase: bindSpinner(),
      },
      packs,
    ),
  );
}

const syncIo = () => ({
  cwd: process.cwd(),
  stdout: (s: string) => process.stdout.write(s),
  stderr: (s: string) => process.stderr.write(s),
});

/** Floors, known failures and the lint baseline held against main, per the config's `coverage` paths. */
async function ratchetLines(root: string): Promise<string[]> {
  const { loadConfig } = await import("./config.ts");
  const { DEFAULT_COVERAGE } = await import("./coverage-config.ts");
  const { ratchetProblems } = await import("./check-ratchets.ts");
  const { knownFailures } = await import("./known-failures.ts");
  const { sourceFiles } = await import("./check-comments.ts");
  const loaded = await loadConfig(root);
  const coverage = loaded.ok ? loaded.config.coverage : DEFAULT_COVERAGE;
  const listed = sourceFiles(root);
  // Without a git listing there are no test files to read.
  const files = listed.ok ? listed.files : [];
  return [...ratchetProblems(root, coverage), ...knownFailures(root, files, coverage.knownFailures)];
}

async function dispatch(cmd: string | undefined, flags: Flags, interactive: boolean) {
  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    process.stdout.write(USAGE);
    return;
  }
  if (cmd === "version" || cmd === "--version" || cmd === "-v") {
    process.stdout.write(`${pkgVersion()}\n`);
    return;
  }
  if (!cmd || cmd === "init") {
    await runInit(process.cwd(), {
      skipGlobals: flags.skipGlobals,
      interactive: interactive && (!cmd || cmd === "init"),
      packs: flags.packs,
    });
    return;
  }
  if (cmd === "check") {
    // Loaded here so other commands never load typescript.
    const { checkTsconfigs } = await import("./check-tsconfig.ts");
    const { checkEnvModules } = await import("./check-env-modules.ts");
    const problems = [...checkTsconfigs(process.cwd(), PKG_ROOT), ...checkEnvModules(process.cwd())];
    for (const line of problems) process.stderr.write(`repo check: ${line}\n`);
    const synced = await runSync(["--check"], syncIo());
    const { loadConfig } = await import("./config.ts");
    const { readWorkspace } = await import("./sync/workspace.ts");
    const { checkManifests } = await import("./check-manifests.ts");
    const { checkComments } = await import("./check-comments.ts");
    const loaded = await loadConfig(process.cwd());
    const on = loaded.ok && loaded.config.packs.includes("standards");
    const read = on ? readWorkspace(process.cwd()) : undefined;
    // An unreadable manifest is already reported by sync --check.
    const standardsLines = [
      ...(read?.ok ? checkManifests(read.workspace) : []),
      ...(on ? checkComments(process.cwd()) : []),
    ];
    for (const line of standardsLines) process.stderr.write(`repo check: ${line}\n`);
    // Computed once: the skip report counts every hit, the baseline only those no skip turns off.
    const { checkRejectionsAt, checkScriptsAt } = await import("./script-diagnostics.ts");
    const rejectionLines = (await checkRejectionsAt(process.cwd())).map((line) => `rejections: ${line}`);
    for (const line of rejectionLines) process.stderr.write(`repo check: ${line}\n`);
    const scripts = await checkScriptsAt(process.cwd());
    const { checkLintSkipsAt } = await import("./scripts/lint-skips.ts");
    const skips = await checkLintSkipsAt(process.cwd(), scripts.all);
    for (const line of skips.report) process.stdout.write(`repo check: ${line}\n`);
    const { checkLintBaseline } = await import("./scripts/lint-baseline.ts");
    const baseline = await checkLintBaseline(process.cwd(), scripts.kept);
    const lintLines = [...scripts.problems, ...skips.problems, ...baseline];
    for (const line of lintLines) process.stderr.write(`repo check: ${line}\n`);
    const { checkNightlyAt } = await import("./check-nightly.ts");
    const nightlyLines = await checkNightlyAt(process.cwd());
    for (const line of nightlyLines) process.stderr.write(`repo check: ${line}\n`);
    const { checkChangelog } = await import("./check-changelog.ts");
    const changelogLines = checkChangelog(process.cwd());
    for (const line of changelogLines) process.stderr.write(`repo check: ${line}\n`);
    const { checkLatestAt, latestRegistry } = await import("./check-latest.ts");
    const latest = await checkLatestAt(process.cwd(), fetch, latestRegistry(readEnv()));
    for (const line of latest.report) process.stdout.write(`repo check: ${line}\n`);
    for (const line of latest.problems) process.stderr.write(`repo check: ${line}\n`);
    const ratchets = await ratchetLines(process.cwd());
    for (const line of ratchets) process.stderr.write(`repo check: ${line}\n`);
    const { checkKnipAt } = await import("./knip-check.ts");
    const knip = await checkKnipAt(process.cwd());
    for (const line of knip.report) process.stdout.write(`repo check: ${line}\n`);
    for (const line of knip.problems) process.stderr.write(`repo check: ${line}\n`);
    const { checkActionlintAt } = await import("./actionlint.ts");
    const actionlint = await checkActionlintAt(process.cwd());
    for (const line of actionlint.problems) process.stderr.write(`repo check: ${line}\n`);
    const found = [
      ...problems,
      ...standardsLines,
      ...rejectionLines,
      ...lintLines,
      ...nightlyLines,
      ...changelogLines,
      ...latest.problems,
      ...ratchets,
    ];
    const failing = [...found, ...knip.problems, ...actionlint.problems];
    const code = failing.length > 0 ? 1 : synced;
    if (code !== 0) process.exitCode = code;
    return;
  }
  if (cmd === "sync") {
    process.exitCode = await runSync(flags.args, syncIo());
    return;
  }
  if (isCommandName(cmd)) {
    process.exitCode = await runCommand(cmd, flags.args);
    return;
  }
  if (cmd === "map") {
    process.stdout.write(mapCommand(process.cwd(), flags.args[0] || ""));
    return;
  }
  process.stderr.write(`repo: unknown command "${cmd}"; run \`repo --help\`\n`);
  process.exitCode = 1;
}

/** Every command but `hook <name>` and the registry commands, which the bin runs through `dispatch` first. */
export async function start(): Promise<void> {
  const raw = process.argv.slice(2);
  const flags = parseArgv(raw);
  if (flags.packsError) {
    process.stdout.write(USAGE);
    process.exitCode = 1;
    return;
  }
  const interactive = isInteractive();
  let cmd = flags.cmd;
  if (!cmd && interactive) {
    const choice = await select({
      message: "Command",
      options: MENU_OPTIONS,
      initialValue: "init",
    });
    if (choice === "quit") return;
    cmd = choice;
  }
  await dispatch(cmd, flags, interactive);
}
