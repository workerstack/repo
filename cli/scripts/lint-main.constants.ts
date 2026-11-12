/** The format value oxlint prints as text, which keeps the script hits; any other is a machine format. */
export const DEFAULT_FORMAT = "default";

/** The oxlint flags that choose the output format, short and long. */
export const SHORT_FORMAT_FLAG = "-f";
export const LONG_FORMAT_FLAG = "--format";

/** The long flag with its value joined, as `--format=json`. */
export const LONG_FORMAT_PREFIX = "--format=";

/** oxlint's flag that fixes what it can; Stylelint fixes the stylesheets under it too. */
export const FIX_FLAG = "--fix";
