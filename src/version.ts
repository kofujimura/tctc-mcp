import { createRequire } from "node:module";

/**
 * The package version, read from package.json at runtime, so `--version`,
 * the startup line and the MCP serverInfo always match what npm published.
 * (0.3.4 shipped still calling itself 0.3.3.) From src/version.ts and from
 * dist/version.js alike, ../package.json is the package root.
 */
export const VERSION: string = createRequire(import.meta.url)("../package.json").version;
