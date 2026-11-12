/** A parsed JSON value, or a schema's read of one whose optional keys may hold undefined. */
type JsonTree = string | number | boolean | null | undefined | JsonTree[] | JsonBranch;

/** An object of a JSON tree. */
type JsonBranch = { [key: string]: JsonTree };

/** True for an object of a JSON tree, false for an array, a primitive, null and a missing value. */
export function isBranch(node: JsonTree): node is JsonBranch {
  return typeof node === "object" && node !== null && !Array.isArray(node);
}

/** The value at a JSON path, or undefined when any step is missing or is not an object. */
export function atRoute(value: JsonTree, route: readonly string[]): JsonTree {
  let node = value;

  for (const key of route) node = isBranch(node) ? node[key] : undefined;

  return node;
}

/** The object at a JSON path; a detached empty object when the path holds none, so a write there changes nothing. */
export function branchAt(value: JsonTree, route: readonly string[]): JsonBranch {
  const node = atRoute(value, route);

  return isBranch(node) ? node : {};
}
