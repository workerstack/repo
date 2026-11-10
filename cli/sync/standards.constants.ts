/** The platform whose files git cannot give an executable bit. */
export const WINDOWS_PLATFORM = "win32";

/** The index mode of an executable file; a file written on win32 is added as `100644` since NTFS has no mode bits. */
export const EXECUTABLE_MODE = "100755";

/** The fields of a `git ls-files -s` line: mode, blob, stage and path. */
export const INDEX_FIELDS = 4;
