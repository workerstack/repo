/** `value`, or a throw with `message` when it is null or undefined: a node or token the rule knows the AST holds. */
export function nullThrows<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);

  return value;
}
