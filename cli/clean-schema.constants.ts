/** The refusal for a `clean.build` entry that is not a bare dir name. */
export const CLEAN_NAME_ERROR: string = 'must be a dir name like ".flare", not a path';

/** The refusal for a `clean.build` that is not a list. */
export const CLEAN_LIST_ERROR: string = 'must be a list of dir names like [".flare"]';

/** The refusal for a `clean` that is not an object of the known keys. */
export const CLEAN_OBJECT_ERROR: string = 'must be an object like { build: [".flare"] }';

/** A dir name holds no path separator. */
export const PATH_SEPARATOR: RegExp = /[\\/]/;
