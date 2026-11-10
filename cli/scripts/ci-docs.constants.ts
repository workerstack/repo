/** The pack whose presence adds the docs gate to `repo ci`. */
export const DOCS_PACK = "docs";
/** The gate's name in its line: `ci: docs ok`. */
export const DOCS_GATE = "docs";
/** The `repo` arguments the gate runs. */
export const DOCS_ARGS: readonly string[] = ["docs", "--check"];
