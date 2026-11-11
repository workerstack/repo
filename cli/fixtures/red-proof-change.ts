/** The name-status entries of a change made of `[status, path]` pairs. */
export function change(...files: [string, string][]) {
  return files.map(([status, file]) => ({ path: file, status }));
}
