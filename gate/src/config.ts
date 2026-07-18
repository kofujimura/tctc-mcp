import { readFileSync } from "node:fs";
import { z } from "zod";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ENV_REF_RE = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;
const HEX32_RE = /^(0x)?[0-9a-fA-F]{64}$/;

const addressSchema = z.string().regex(ADDRESS_RE, "must be a 0x-prefixed 20-byte address");

const gateConfigSchema = z.object({
  chain: z.object({
    key: z.string().min(1),
    chainId: z.number().int().positive(),
    rpcUrl: z.string().url(),
  }),
  target: addressSchema,
  subject: z.object({
    mode: z.literal("configured"),
    address: addressSchema,
  }),
  gate: z.object({
    public: z.array(z.string().min(1)).default([]),
    // Role lists MUST be non-empty: an empty AND would read as
    // unconditional allow (GATE_SPEC §4.1).
    tools: z.record(z.array(z.string().min(1)).min(1)).default({}),
  }),
  cache: z
    .object({
      allowSeconds: z.number().min(0).default(0),
      denySeconds: z.number().min(0).default(10),
    })
    .default({}),
  listMode: z.enum(["annotate", "plain"]).default("annotate"),
  audit: z.string().optional(),
  grantUrlBase: z.string().url().default("https://tctc-mcp.vercel.app/"),
  server: z.object({
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    env: z.record(z.string()).default({}),
    inherit: z.array(z.string()).default(["PATH", "HOME"]),
  }),
});

export type GateConfig = z.infer<typeof gateConfigSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Do two glob patterns (with `*` wildcards) match any common string? */
export function globsIntersect(a: string, b: string): boolean {
  const memo = new Map<string, boolean>();
  const go = (i: number, j: number): boolean => {
    const key = `${i},${j}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let r: boolean;
    if (i === a.length && j === b.length) r = true;
    else if (i < a.length && a[i] === "*") r = go(i + 1, j) || (j < b.length && go(i, j + 1));
    else if (j < b.length && b[j] === "*") r = go(i, j + 1) || (i < a.length && go(i + 1, j));
    else if (i < a.length && j < b.length && a[i] === b[j]) r = go(i + 1, j + 1);
    else r = false;
    memo.set(key, r);
    return r;
  };
  return go(0, 0);
}

/** Literal (non-*) character count — the specificity metric (GATE_SPEC §4.1). */
export function globSpecificity(pattern: string): number {
  return pattern.replace(/\*/g, "").length;
}

function walkStrings(value: unknown, path: string[], visit: (s: string, path: string[]) => void): void {
  if (typeof value === "string") visit(value, path);
  else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, [...path, String(i)], visit));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) walkStrings(v, [...path, k], visit);
  }
}

/** Parse + field-aware validation (GATE_SPEC §4.2) + policy sanity (§4.1). */
export function parseGateConfig(raw: unknown): GateConfig {
  const parsed = gateConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(`invalid gate config: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const config = parsed.data;

  // server.env values: MUST exactly match ${ENV_NAME} — no literals, ever.
  for (const [name, value] of Object.entries(config.server.env)) {
    if (!ENV_REF_RE.test(value)) {
      throw new ConfigError(
        `server.env.${name} must be a \${ENV_NAME} reference (got a literal value; secrets never belong in config files)`,
      );
    }
  }

  // 32-byte hex is allowed ONLY in role positions (gate.tools values).
  walkStrings(config, [], (s, path) => {
    const inRolePosition = path[0] === "gate" && path[1] === "tools" && path.length === 4;
    if (!inRolePosition && HEX32_RE.test(s)) {
      throw new ConfigError(
        `32-byte hex value at ${path.join(".")} — only role positions (gate.tools values) may hold 32-byte hashes`,
      );
    }
  });

  // A tool cannot be both public and gated.
  const publicSet = new Set(config.gate.public);
  for (const key of Object.keys(config.gate.tools)) {
    if (publicSet.has(key)) {
      throw new ConfigError(`"${key}" is listed in both gate.public and gate.tools — pick one`);
    }
  }

  // Reserved prefix is the gate's own namespace.
  for (const name of [...config.gate.public, ...Object.keys(config.gate.tools)]) {
    if (name.startsWith("tctc_gate_")) {
      throw new ConfigError(`"${name}" uses the reserved tctc_gate_ prefix`);
    }
  }

  // Equal-specificity overlapping globs are a startup error, not a runtime tiebreak.
  const patterns = Object.keys(config.gate.tools).filter((k) => k.includes("*"));
  for (let i = 0; i < patterns.length; i++) {
    for (let j = i + 1; j < patterns.length; j++) {
      if (
        globSpecificity(patterns[i]) === globSpecificity(patterns[j]) &&
        globsIntersect(patterns[i], patterns[j])
      ) {
        throw new ConfigError(
          `glob patterns "${patterns[i]}" and "${patterns[j]}" overlap with equal specificity — make one more specific`,
        );
      }
    }
  }

  return config;
}

export function loadGateConfig(path: string): GateConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new ConfigError(`cannot read config ${path}: ${(e as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new ConfigError(`config ${path} is not valid JSON: ${(e as Error).message}`);
  }
  return parseGateConfig(json);
}

/**
 * Child environment (GATE_SPEC §2.2): inheritEnv is always false — the child
 * receives only the allowlisted variables plus resolved ${ENV} references.
 */
export function buildChildEnv(config: GateConfig, processEnv: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of config.server.inherit) {
    const v = processEnv[name];
    if (v !== undefined) env[name] = v;
  }
  for (const [name, ref] of Object.entries(config.server.env)) {
    const envName = ref.slice(2, -1);
    const v = processEnv[envName];
    if (v === undefined) {
      throw new ConfigError(`server.env.${name} references \${${envName}}, which is not set in the gate's environment`);
    }
    env[name] = v;
  }
  return env;
}
