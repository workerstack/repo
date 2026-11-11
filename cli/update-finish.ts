import fs from "node:fs";
import path from "node:path";
import { OXFMT_CONFIG_PATH } from "./sync/standards.ts";
import type { ToolResult, UpdateIo } from "./update-io.types.ts";
import { EXIT_FAIL, INDENT, POSIX, SYNC_PREFIX, formatFailed, installFailed } from "./update.constants.ts";

/** The command whose files were written, where it ran and how it talks. */
export type Run = { io: UpdateIo; command: string; root: string };

/** Prints each line to stderr and returns the exit code. */
export function fail(io: UpdateIo, lines: readonly string[], code: number = EXIT_FAIL): number {
  for (const line of lines) io.err(line);
  return code;
}

/** A message with its command's `repo <command>: ` prefix. */
export const said = (command: string, message: string): string => `repo ${command}: ${message}`;

const indented = (result: ToolResult): string[] =>
  result.output
    .trimEnd()
    .split("\n")
    .filter(Boolean)
    .map((line) => `${INDENT}${line}`);

/** Prints the lines of the install's output that `repo sync` wrote. */
function syncLines(io: UpdateIo, result: ToolResult): void {
  for (const line of result.output.split("\n")) {
    if (line.startsWith(SYNC_PREFIX)) io.out(line.trimEnd());
  }
}

/** Installs, prints the `repo sync:` lines it printed, then formats what `repo fmt` would (only when the root has an oxfmt config); a failed step prints why and returns the exit code. */
export function finish(run: Run, files: string[]): number {
  const { io, command, root } = run;
  const installed = io.install(root);
  if (installed.code !== 0) return fail(io, [said(command, installFailed(installed.code)), ...indented(installed)]);
  syncLines(io, installed);
  if (!fs.existsSync(path.join(root, OXFMT_CONFIG_PATH))) return 0;
  const formatted = io.format(root, files);
  if (formatted.code === 0) return 0;
  const shown = files.map((file) => file.split(path.sep).join(POSIX)).join(", ");
  return fail(io, [said(command, formatFailed(shown)), ...indented(formatted)]);
}
