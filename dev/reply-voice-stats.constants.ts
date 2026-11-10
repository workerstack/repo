export const ARROW_RE: RegExp = /→|->|=>/g;
export const KEY_VALUE_RE: RegExp = /(?<![\w./-])[A-Za-z_][\w.-]*=[^\s=]+/g;
export const FENCED_CODE_RE: RegExp = /```[\s\S]*?(```|$)/g;
export const INLINE_CODE_RE: RegExp = /`[^`\n]*`/g;
export const TRANSCRIPT_SUFFIX = ".jsonl";
export const ASSISTANT = "assistant";
export const TEXT_PART = "text";
export const ROOT_FLAG = "--root";
export const SINCE_FLAG = "--since";
export const DEFAULT_SINCE = "1970-01-01";
export const DEFAULT_ROOT_PARTS: readonly string[] = [".claude", "projects"];
export const ROOT_NEEDS_VALUE: string = `${ROOT_FLAG} needs a value`;
/** The arguments after the runtime and the script path. */
export const ARGV_START = 2;
