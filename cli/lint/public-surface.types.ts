/** A form the walk could not follow, in `file` at `line`: what a rule reports instead of passing it. */
export type Unknown = { file: string; form: string; line: number };

/**
 * What a public package exposes. `entries` maps each `exports` key to the source files its code targets name; `names`
 * maps each reached file to its reached declarations, each with the first entry key that reaches it.
 */
export type Surface = {
  entries: Map<string, string[]>;
  names: Map<string, Map<string, string>>;
  unknown: Unknown[];
};

/** A syntax node read from untrusted parser output: every field is checked before it is used. */
export type Node = Record<string, unknown>;

/** `name` as `source` exports it, or as this file declares it when `source` is null. */
export type Link = { name: string; source: string | null };

/** `name` as `source` exports it. */
export type Import = { name: string; source: string };

/** One parsed file: what it exports, imports and declares, and the forms in it the walk cannot follow. */
export type Module = {
  file: string;
  code: string;
  exports: Map<string, Link>;
  imports: Map<string, Import>;
  locals: Map<string, Node[]>;
  stars: { source: string; at: number }[];
  unknown: { form: string; at: number }[];
};

/** What a name is: a declaration, a whole module, outside the walk, or (null) declared nowhere. */
export type Resolved =
  | { kind: "external" }
  | { kind: "module"; module: Module }
  | { kind: "name"; module: Module; name: string; statements: Node[] }
  | null;

/** A name a declaration's type mentions: through an `import()` type, or by a local name and its first member. */
export type Reference = { source: string; name: string } | { source: null; name: string; member: string | null };

/** The files read so far and what has been published from them, for one `publicSurface` call. */
export type Graph = {
  root: string;
  modules: Map<string, Module | null>;
  published: Set<Module>;
  failed: Set<string>;
  names: Surface["names"];
  unknown: Unknown[];
};

/** One resolution: the graph and the `file\0name` pairs already visited, which end a cycle. */
export type Query = { graph: Graph; seen: Set<string> };

export type Build = { rootDir: string; outDir: string };
