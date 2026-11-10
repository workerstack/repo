/** One place a dependency name is declared: a catalog entry or a manifest field, with the spec written there. */
export type Source = {
  name: string;
  spec: string;
  /** The package.json field or catalog the entry sits in. */
  field: string;
  /** Where the table shows it: `catalog`, `catalog:<name>`, `package.json` or the package's dir. */
  where: string;
  /** Where the updated line says it: `the catalog`, `the <name> catalog` or the same as `where`. */
  said: string;
  /** The root-relative POSIX path of the package.json that holds it. */
  file: string;
  /** Every place in that file the entry lives; a catalog bun reads from two places has two. */
  paths: Route[];
};

/** A JSON object in a file, by the keys down to it, and the key of the entry inside it. */
export type Route = { parent: string[]; key: string };

/** A source whose spec is an optional `^` or `~` and a full version. */
export type Plain = Source & { prefix: string; version: string };

/** A plain source and the registry's `latest` for its name. */
export type Checked = Plain & { latest: string };
