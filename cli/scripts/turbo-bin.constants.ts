/** The package whose manifest locates turbo's install. */
export const TURBO_MANIFEST = "turbo/package.json";

/** The scope of turbo's platform packages, one per OS and architecture. */
export const TURBO_SCOPE = "@turbo/";

/** The platform package names turbo uses for an OS. */
export const TURBO_OS: Readonly<Record<string, string>> = { win32: "windows" };

/** The platform package names turbo uses for an architecture. */
export const TURBO_ARCH: Readonly<Record<string, string>> = { x64: "64" };
export const WINDOWS_PLATFORM = "win32";

/** The binary inside a platform package. */
export const TURBO_BINARY = "bin/turbo";
export const TURBO_BINARY_WINDOWS = "bin/turbo.exe";

/** The line for a turbo that is not installed at all. */
export const TURBO_MISSING = "turbo is not installed; run `bun install`";

/** The line for a platform package that is not installed. */
export function platformMissing(name: string): string {
  return `turbo has no ${name} binary; run \`bun install\` so its optional dependency installs`;
}

/** The most output of a turbo run held in memory: a gigabyte. */
export const MAX_BUFFER: number = 1024 ** 3;
