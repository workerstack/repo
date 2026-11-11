import { dispatch, usage } from "./dispatch.ts";
import { init, type InitOptions } from "./init.ts";
import { ARGV_START, INIT_COMMAND } from "./main.constants.ts";
import { parseArgv } from "./parse-argv.ts";
import { confirm, isInteractive, spinner } from "./prompt.ts";
import { selectCommand } from "./select-command.ts";

export const APPLY_GLOBALS_CONFIRM: string = "Apply global prompt optimizations? (recommended)";

function bindSpinner(): NonNullable<InitOptions["onPhase"]> {
  const spin = spinner();
  return (name, action) => {
    if (action === "start") spin.start(name);
    else spin.stop(name);
  };
}

function initOpts(base: InitOptions, packs: string[] | undefined): InitOptions {
  return packs === undefined ? base : { ...base, packs };
}

/** What `repo init` runs with: the flags it read, and whether a TTY can ask. */
type InitRun = { skipGlobals: boolean; interactive: boolean; packs: string[] | undefined };

/** `repo init` on cwd; in a TTY it first asks whether to apply the global settings and shows each phase. */
async function runInit({ skipGlobals, interactive, packs }: InitRun): Promise<void> {
  if (!interactive) {
    init(process.cwd(), initOpts({ skipGlobals }, packs));
    return;
  }
  const applyGlobals = await confirm({ initialValue: !skipGlobals, message: APPLY_GLOBALS_CONFIRM });
  init(process.cwd(), initOpts({ onPhase: bindSpinner(), skipGlobals: !applyGlobals }, packs));
}

/** No command, or an empty one, as `!cmd` read it. */
function isNone(cmd: string | undefined): cmd is undefined | "" {
  return cmd === undefined || cmd === "";
}

/** Every command but `hook <name>` and the registry commands, which the bin runs through `dispatch` first. */
export async function start(): Promise<void> {
  const flags = parseArgv(process.argv.slice(ARGV_START));
  if (flags.packsError) {
    process.stdout.write(usage());
    process.exitCode = 1;
    return;
  }
  const interactive = isInteractive();
  const cmd = isNone(flags.cmd) && interactive ? await selectCommand() : flags.cmd;
  if (cmd === null) return;
  if (isNone(cmd) || cmd === INIT_COMMAND)
    await runInit({ interactive, packs: flags.packs, skipGlobals: flags.skipGlobals });
  else await dispatch(cmd, flags);
}
