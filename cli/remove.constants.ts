export const REMOVE_SUMMARY: string = "Remove a dependency from every manifest, the catalog and the root's overrides";
export const REMOVE_COMMAND: string = "remove";
export const REMOVE_USAGE: string = "usage: repo remove <name>…";
export const PATCHED: string = "patchedDependencies";
export const VERSION_AT: string = "@";
const PLACE_JOIN: string = " and ";
const NAME_JOIN: string = "; ";
const FIELD_JOIN: string = ", ";
/** The root's fields that name a dependency outside its dependency fields, with every place bun reads each from. */
export const EXTRAS: readonly { field: string; homes: readonly string[][] }[] = [
  {
    field: "overrides",
    homes: [["overrides"], ["workspaces", "overrides"]],
  },
  { field: "resolutions", homes: [["resolutions"]] },
  { field: "trustedDependencies", homes: [["trustedDependencies"]] },
  { field: PATCHED, homes: [[PATCHED]] },
];
export const removedLine = (parts: string[]): string => `removed ${parts.join(NAME_JOIN)}`;
export const namePart = (name: string, places: string[]): string => `${name} from ${places.join(PLACE_JOIN)}`;
export const placeNote = (said: string, fields: string[]): string =>
  fields.length === 0 ? said : `${said} (${fields.join(FIELD_JOIN)})`;
