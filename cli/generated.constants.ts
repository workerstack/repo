/**
 * The one folder name for generated code, committed or not: its generator owns the bytes, so `repo fmt` leaves it as
 * written and `.gitattributes` marks it generated.
 */
const GENERATED_DIR: string = "_gen";

/** Every path under a `_gen` folder, at any depth, as oxfmt and `.gitattributes` patterns read it. */
export const GENERATED: string = `**/${GENERATED_DIR}/**`;
