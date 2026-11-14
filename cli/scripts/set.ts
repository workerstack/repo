#!/usr/bin/env bun
/** Set: change this session's approval, effort or strategy in its settings file, like the /set prompt. */
import { agentDefaults } from "../agent-defaults.ts";
import type { AgentDefaults } from "../config-resolved.types.ts";
import { setSessionSettings } from "./session-settings.ts";
import { EXIT_USAGE, NEEDS_SESSION, SESSION_FLAG } from "./set.constants.ts";
import { resolveRoots, type Roots } from "./workspace-root.ts";

/** The session id and the setting words of the command line; a missing id is null. */
type SetArgs = { sid: string | null; words: string[] };

function parse(argv: readonly string[]): SetArgs {
  let sid: string | null = null;
  const words: string[] = [];

  const rest = [...argv];

  for (let arg = rest.shift(); arg !== undefined; arg = rest.shift()) {
    if (arg === SESSION_FLAG) sid = rest.shift() ?? null;
    else if (arg.startsWith(`${SESSION_FLAG}=`)) sid = arg.slice(SESSION_FLAG.length + 1);
    else words.push(arg);
  }

  return { sid: sid === "" ? null : sid, words };
}

function write(msg: string, stream: NodeJS.WriteStream): void {
  stream.write(`${msg}\n`);
}

function run(roots: Roots, { sid, words }: { sid: string; words: string[] }, defaults: AgentDefaults): number {
  const done = setSessionSettings({ cwd: roots.cwd, sessionId: sid, workspaceRoot: roots.root }, words, defaults);

  write(done.ok ? done.value : done.error, done.ok ? process.stdout : process.stderr);

  return done.ok ? 0 : EXIT_USAGE;
}

export async function main(argv: string[], roots: () => Roots = resolveRoots): Promise<number> {
  const { sid, words } = parse(argv);

  if (sid === null) {
    write(NEEDS_SESSION, process.stderr);

    return EXIT_USAGE;
  }

  const at = roots();

  return run(at, { sid, words }, await agentDefaults(at.root));
}
