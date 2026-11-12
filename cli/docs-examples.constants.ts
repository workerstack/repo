export const EXAMPLE_LANGS: readonly string[] = ["ts", "typescript", "tsx"];
export const RUN_WORD = "run";
export const TERMINATOR = "export {};\n";
export const BUILD_SCRIPT = "build";
export const STOCK_TSCONFIG = "bun.json";
export const TSC_ARGS: readonly string[] = ["--pretty", "false", "-p"];
export const BUN_BUILD_ARGS: readonly string[] = ["run", "build"];
export const NO_OUTPUT = "no output";

/** `path(line,col): error TS1234: message`, as `tsc --pretty false` prints it. */
export const TSC_LINE: RegExp = /^(.+?)\((\d+),\d+\): error TS\d+: (.*)$/;
export const THROWN_LINE: RegExp = /^(?:\w*Error|error)\b/;
export const TSX_LANG = "tsx";

/** The spaces a written JSON file indents by. */
export const JSON_INDENT = 2;
