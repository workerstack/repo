/** The value at a JSON path, or undefined when any step is missing. */
export function atRoute(value: unknown, route: readonly string[]): unknown {
  let node = value;

  for (const key of route)
    node = (node /* a JSON object, or undefined past a missing key */ as Record<string, unknown> | undefined)?.[key];

  return node;
}
