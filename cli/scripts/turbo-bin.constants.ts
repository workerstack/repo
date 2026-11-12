/** The package whose manifest locates turbo's install. */
export const TURBO_MANIFEST = "turbo/package.json";

/** The scope of turbo's platform packages, one per OS and architecture. */
export const TURBO_SCOPE = "@turbo/";

/** The platform package names turbo uses for an OS that it does not name as node does. */
const TURBO_OS = { win32: "windows" } as const satisfies Readonly<Record<string, string>>;

/** The platform package names turbo uses for an architecture that it does not name as node does. */
const TURBO_ARCH = { x64: "64" } as const satisfies Readonly<Record<string, string>>;

function isTurboOs(platform: string): platform is keyof typeof TURBO_OS {
  return Object.hasOwn(TURBO_OS, platform);
}

function isTurboArch(arch: string): arch is keyof typeof TURBO_ARCH {
  return Object.hasOwn(TURBO_ARCH, arch);
}

/** The name turbo's platform packages give node's `platform`. */
export function turboOs(platform: string): string {
  return isTurboOs(platform) ? TURBO_OS[platform] : platform;
}

/** The name turbo's platform packages give node's `arch`. */
export function turboArch(arch: string): string {
  return isTurboArch(arch) ? TURBO_ARCH[arch] : arch;
}

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
