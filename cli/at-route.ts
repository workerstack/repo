/** The value at a JSON path, or undefined when any step is missing. */
export function atRoute(value: unknown, route: readonly string[]): unknown {
  return route.reduce<unknown>(
    (node, key) =>
      (node /* a JSON object, or undefined past a missing key */ as Record<string, unknown> | undefined)?.[key],
    value,
  );
}
