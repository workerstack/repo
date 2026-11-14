/** Program names and option sets the shared bash walk reads commands by. */

/** The builtin that prints by a format, and can write its output into a variable. */
export const PRINTF = "printf";

/** The `printf` option that writes its output into a variable. */
export const PRINTF_VAR_OPTION = "-v";

/** The builtin that drops the variables, or with `-f` the functions, its words name. */
export const UNSET = "unset";

/**
 * A word bash reads as an assignment before the program: `NAME=`, `NAME+=`, or with a subscript (`NAME[k]=`), which
 * bash refuses as a prefix but still runs the program after. Group 1 is the name, 2 the subscript, 3 the `+`.
 */
export const ASSIGNMENT_RE: RegExp = /^([A-Za-z_]\w*)(\[[^\]]*\])?(\+?)=/;

/** Programs that run a shell, by the name `programName` gives. */
export const SHELLS: ReadonlySet<string> = /* @__PURE__ */ new Set(["sh", "bash", "zsh", "dash", "ksh", "mksh", "ash"]);

/**
 * A program that runs the command after it: the options of its own that take the next word as a value, how many
 * operands of its own come before the command, and whether the command still reads the caller's stdin.
 */
export type Runner = { values: readonly string[]; operands: number; isStdinKept: boolean };

/** A runner with no operands of its own that hands the caller's stdin on, the common case. */
const PLAIN = { isStdinKept: true, operands: 0 } as const;

/** Programs that run the command after them, each read by its `Runner`. */
export const RUNNER_SPECS: ReadonlyMap<string, Runner> = /* @__PURE__ */ new Map<string, Runner>([
  ["sudo", { ...PLAIN, values: ["-u", "-g", "-C", "-h", "-p", "-r", "-t", "-U", "-D", "-R", "--user", "--group"] }],
  ["doas", { ...PLAIN, values: ["-u", "-C"] }],
  ["env", { ...PLAIN, values: ["-u", "-C", "--unset", "--chdir"] }],
  ["exec", { ...PLAIN, values: ["-a"] }],
  ["command", { ...PLAIN, values: [] }],
  ["nohup", { ...PLAIN, values: [] }],
  ["nice", { ...PLAIN, values: ["-n", "--adjustment"] }],
  ["ionice", { ...PLAIN, values: ["-c", "-n", "-p", "--class", "--classdata"] }],
  ["chrt", { ...PLAIN, operands: 1, values: [] }],
  ["setsid", { ...PLAIN, values: [] }],
  ["stdbuf", { ...PLAIN, values: ["-i", "-o", "-e"] }],
  ["timeout", { ...PLAIN, operands: 1, values: ["-s", "-k", "--signal", "--kill-after"] }],
  ["rtk", { ...PLAIN, values: [] }],
  ["xargs", { ...PLAIN, isStdinKept: false, values: ["-I", "-n", "-P", "-L", "-d", "-E", "-s", "-a"] }],
]);

function stdinRunners(): ReadonlySet<string> {
  return new Set([...RUNNER_SPECS].flatMap(([name, spec]) => (spec.isStdinKept ? [name] : [])));
}

/** Programs that run the command after them with the caller's stdin, so a shell after one still reads it. */
export const RUNNERS: ReadonlySet<string> = /* @__PURE__ */ stdinRunners();

/** Programs that run the value of their `-c` or `--command` option as a script. */
export const COMMAND_OPTION_PROGRAMS: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "su",
  "runuser",
  "flock",
  "script",
]);

/** Programs whose line, piped on, is the text they print. */
export const PRINTERS: ReadonlySet<string> = /* @__PURE__ */ new Set(["echo", "printf"]);

/** Shell options that take the next word as their value. */
export const SHELL_VALUE_OPTS: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "-o",
  "+o",
  "-O",
  "+O",
  "--rcfile",
  "--init-file",
]);

/** `watch` options that take the next word as their value. */
export const WATCH_VALUE_OPTS: ReadonlySet<string> = /* @__PURE__ */ new Set(["-n", "--interval"]);

/** The option pairs that hold a script: a short and a long spelling. */
export const COMMAND_OPTION: readonly string[] = ["-c", "--command"];
export const SPLIT_STRING_OPTION: readonly string[] = ["-S", "--split-string"];
export const EXEC_OPTION: readonly string[] = ["-x", "--exec"];

/** The git subcommand whose `--exec` runs a script. */
export const REBASE_SUB = "rebase";

/** The words that end a list of options. */
export const END_OF_OPTIONS = "--";
export const STDIN_OPERAND = "-";

/** `cd` and the other commands that change the dir. */
export const CD = "cd";
export const PUSHD = "pushd";
export const POPD = "popd";
export const DIR_CHANGERS: ReadonlySet<string> = /* @__PURE__ */ new Set([CD, PUSHD, POPD]);

/** The options `cd` and `pushd` take before the dir. */
export const CD_OPTIONS: ReadonlySet<string> = /* @__PURE__ */ new Set(["-L", "-P", "-e", "-@"]);
