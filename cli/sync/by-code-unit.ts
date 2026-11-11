/** Orders strings by UTF-16 code unit, the same on every machine; `toSorted(byCodeUnit)` is the sync sort. */
export function byCodeUnit(a: string, b: string): number {
  return Number(a > b) - Number(a < b);
}
