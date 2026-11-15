/** What a plain `toHaveBeenCalled()` check leaves a person to do: name the arguments, since lint cannot know them. */
export const MESSAGE = `Assert the arguments with toHaveBeenCalledWith(...) or toHaveBeenLastCalledWith(...); \
lint cannot know them, so it does not fix this.`;

/** The matchers that assert a call without its arguments. */
export const MATCHERS: readonly string[] = ["toHaveBeenCalled", "toBeCalled"];

/** The name of the global every assertion starts from. */
export const EXPECT = "expect";

/** The modifier that turns an assertion around, so a bare call check under it is not a gap. */
export const NOT = "not";
