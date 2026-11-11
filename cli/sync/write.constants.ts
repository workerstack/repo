/**
 * The mode of a whole file sync owns: read-only for everyone, so a hand edit fails in the editor instead of being
 * lost.
 */
export const OWNED_MODE: number = 0o444;
/** An owned file git runs, a hook: read-only and executable. */
export const OWNED_EXECUTABLE_MODE: number = 0o555;
/** The mode a read-only file is put back to before a rename onto it or its removal, which win32 refuses otherwise. */
export const WRITABLE_MODE: number = 0o644;
/** The permission bits of a `stat` mode, without the file type. */
export const PERMISSION_BITS: number = 0o777;
/** The owner's write bit. */
export const OWNER_WRITE: number = 0o200;
/** The bytes of randomness in a temp file's name. */
export const TEMP_NAME_BYTES: number = 6;
/** The platform whose links are junctions with absolute targets. */
export const WINDOWS_PLATFORM = "win32";
/** A skill link path, `.agents/skills/<name>` or `.claude/skills/<name>`, its name in the `name` group. */
export const SKILL_LINK: Readonly<RegExp> = /^\.(?:agents|claude)\/skills\/(?<name>[^/]+)$/;
