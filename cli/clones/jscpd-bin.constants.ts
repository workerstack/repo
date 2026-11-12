/** The package whose manifest locates jscpd's install. */
export const JSCPD_MANIFEST = "jscpd/package.json";

/** The prefix of jscpd's platform packages, one per OS, architecture and (on Linux) libc. */
export const JSCPD_PREFIX = "jscpd-";
export const LINUX_PLATFORM = "linux";
export const WINDOWS_PLATFORM = "win32";

/** The OS part of a platform package's name, where it is not the platform's own. */
export const JSCPD_OS: Readonly<Record<"win32", string>> = { win32: "windows" };

/** The libc parts of a Linux platform package's name: only the one of the host's libc installs. */
export const LINUX_LIBCS: readonly string[] = ["-gnu", "-musl"];

/** The toolchain part of a Windows platform package's name. */
export const WINDOWS_SUFFIX = "-msvc";

/** The binary inside a platform package. */
export const JSCPD_BINARY = "bin/jscpd";
export const JSCPD_BINARY_WINDOWS = "bin/jscpd.exe";

/** The line for a platform package that is not installed. */
export function platformMissing(name: string): string {
  return (
    `jscpd has no binary for this platform (${name}); run \`bun install\` with optional dependencies on a platform ` +
    "jscpd ships one for"
  );
}
