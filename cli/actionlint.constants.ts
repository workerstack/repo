/** The pinned actionlint release. */
export const ACTIONLINT_VERSION: string = "1.7.12";
/** The directory under the state home that caches the binary, then the version. */
export const CACHE_DIR: string = "actionlint";
/** Where the pinned release's archives are published. */
export const RELEASE_URL: string = `https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}`;
/** How long the archive download may take. */
export const FETCH_TIMEOUT_MS = 120_000;
/** The most output a spawned tool may print before it is cut off. */
export const MAX_OUTPUT_BYTES: number = 64 * 1024 * 1024;
/** The workflow directory, relative to the repo root. */
export const WORKFLOWS_DIR = ".github/workflows";
/** The extensions of a workflow file. */
export const WORKFLOW_EXTENSIONS: readonly string[] = [".yml", ".yaml"];
/** The flags that print json and turn off the tools runners differ in. */
export const ACTIONLINT_FLAGS: readonly string[] = ["-format", "{{json .}}", "-shellcheck=", "-pyflakes="];
/** The windows system directory when `SystemRoot` is unset. */
export const DEFAULT_SYSTEM_ROOT = "C:\\Windows";
/** What `process.platform` calls windows. */
export const WINDOWS_PLATFORM = "win32";
/** The windows tar, under the system root; Git's GNU tar can come first on PATH and cannot read a zip. */
export const WINDOWS_TAR = "\\System32\\tar.exe";
/** The hash characters a mismatch line shows. */
export const SHOWN_HASH = 8;
/** The exit code actionlint gives when it found problems. */
export const EXIT_PROBLEMS = 1;
/** The octal mode of the cached binary. */
export const BINARY_MODE = 0o755;

/** What `process.platform` calls an os that actionlint publishes, mapped to the name its archives use. */
export const OS_NAMES: Record<string, string> = { darwin: "darwin", linux: "linux", win32: "windows" };
/** What `process.arch` calls an architecture that actionlint publishes, mapped to the name its archives use. */
export const ARCH_NAMES: Record<string, string> = { arm64: "arm64", x64: "amd64" };

/** The sha256 of each archive of the release, from its checksums.txt, by `<os>_<arch>`. */
export const HASHES: Record<string, string> = {
  darwin_amd64: "5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644",
  darwin_arm64: "aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f",
  linux_amd64: "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8",
  linux_arm64: "325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6",
  windows_amd64: "6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9",
  windows_arm64: "cadcf7ea4efe3a68728893813643cebe1185e5b1d4be5b96245f65c9a4d5ea41",
};
