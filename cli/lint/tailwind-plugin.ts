/**
 * oxlint-tailwindcss as this package's `./tailwind` export: a consumer's oxlint loads it through its one direct
 * dependency, since an isolated install does not hoist ours to the consumer's root.
 */
import tailwindPlugin from "oxlint-tailwindcss";

export { tailwindPlugin };

export default tailwindPlugin;
