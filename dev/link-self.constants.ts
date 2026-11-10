/** Launchers `bun install` gives a bin with no shebang, by extension (BinLinkingShim.rs `bun_extensions_get`). */
export const RUN_WITH_BUN: string[] = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".cts", ".mts", ".tsx", ".sh"];
export const RUN_WITH_CMD: string[] = [".cmd", ".bat"];
export const BUN_LAUNCHER = "bun run";
export const CMD_LAUNCHER = "cmd /c";
export const POWERSHELL_LAUNCHER = "powershell -ExecutionPolicy Bypass -File";
export const POWERSHELL_EXTENSION = ".ps1";

/** BinLinkingShim.rs `VersionFlag::V5`, kept above the four flag bits. */
export const SHIM_VERSION = 2739;
export const VERSION_SHIFT = 4;
export const FLAG_NODE_OR_BUN = 1;
export const FLAG_NODE = 2;
export const FLAG_SHEBANG = 4;
export const FLAG_ABSOLUTE = 8;

/** The shebang is read from this many characters at most (`MAX_SHEBANG_INPUT_LENGTH`: 32766 plus `#!`). */
export const MAX_SHEBANG_INPUT = 32768;
export const SHEBANG_MARK = "#!";
export const ENV_PROGRAMS: string[] = ["/usr/bin/env", "/bin/env"];
export const SPLIT_STRING_FLAG = "-S";
export const BUN_PROGRAMS: string[] = ["bun", "node"];
export const NODE = "node";

/** Byte widths in a `.bunx` file: a UTF-16 unit, a u32 length, the two lengths together, the u16 flags. */
export const UTF16_BYTES = 2;
export const U32_BYTES = 4;
export const LENGTH_FIELDS_BYTES = 8;
export const FLAGS_BYTES = 2;

export const SHIM_EXE = ".exe";
export const BUNX = ".bunx";
