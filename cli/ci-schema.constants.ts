/** The gate labels `repo ci` prints itself; a check cannot take one, or two lines would read the same. */
export const BUILT_IN_LABELS: readonly string[] = ["check", "fmt", "typecheck", "tests", "packages"];
/** A check name: lowercase words and digits joined by single hyphens. */
export const KEBAB_NAME: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** The refusal for a check whose argv is not a non-empty list of non-empty strings. */
export const CI_ARGV_ERROR = 'must be a non-empty list of strings like ["bun", "scripts/check.ts"]';
/** The refusal for `ci.checks` that is not a map of names to argv lists. */
export const CI_CHECKS_ERROR = 'must be an object like { "container-images": ["bun", "scripts/check.ts"] }';
/** The refusal for a `ci` that is not an object of the known keys. */
export const CI_OBJECT_ERROR = 'must be an object like { checks: { "container-images": ["bun", "scripts/check.ts"] } }';
/** The refusal for a check name that is not kebab-case. */
export function notKebab(name: string): string {
  return `${JSON.stringify(name)} is not a kebab-case name like "container-images"`;
}
/** The refusal for a check name that a built-in gate prints. */
export function builtIn(name: string): string {
  return `${JSON.stringify(name)} is a built-in gate label; pick another name`;
}
