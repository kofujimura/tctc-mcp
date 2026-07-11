import { readFileSync } from "node:fs";
import { z } from "zod";
import { ConfigError } from "./errors.js";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const PRIVATE_KEY_RE = /0x[0-9a-fA-F]{64}/;

const addressSchema = z
  .string()
  .regex(ADDRESS_RE, "must be a 0x-prefixed 20-byte address");

const chainSchema = z.object({
  chainId: z.number().int().positive(),
  rpcUrl: z.string().min(1),
});

const controlTokenSchema = z.object({
  chain: z.string().min(1),
  standard: z.enum(["erc721", "erc1155"]),
  address: addressSchema,
  typeId: z
    .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/), z.null()])
    .optional()
    .default(null)
    .transform((v) => (v === null ? null : BigInt(v))),
});

const adminActionSchema = z.object({
  function: z
    .string()
    .regex(
      /^[A-Za-z_][A-Za-z0-9_]*\([A-Za-z0-9,\[\] ]*\)$/,
      "must be a Solidity function signature like mint(address,uint256,uint256)",
    ),
  args: z.array(z.union([z.string(), z.number(), z.boolean()])).optional()
    .default(["$subject"]),
});

const targetSchema = z.object({
  chain: z.string().min(1).optional(),
  address: addressSchema,
  role: z.string().min(1).optional(),
});

const roleSchema = z
  .object({
    description: z.string().optional(),
    controlTokens: z.array(controlTokenSchema).min(1).optional(),
    target: targetSchema.optional(),
    admin: z
      .object({
        grant: adminActionSchema.optional(),
        revoke: adminActionSchema.optional(),
      })
      .optional(),
  })
  .refine((r) => Boolean(r.controlTokens) !== Boolean(r.target), {
    message:
      "exactly one of controlTokens (static bindings) or target (IERC7303 discovery) is required",
  });

const identitySchema = z.object({
  chain: z.string().min(1),
  identityRegistry: addressSchema,
  erc6551: z.object({
    registry: addressSchema,
    accountImplementation: addressSchema,
    salt: z.string().regex(/^0x[0-9a-fA-F]*$/).default("0x0"),
  }),
});

const selfSchema = z.union([
  z.object({ agentId: z.number().int().nonnegative() }),
  z.object({ address: addressSchema }),
]);

const configSchema = z.object({
  chains: z.record(chainSchema).refine((c) => Object.keys(c).length > 0, {
    message: "at least one chain must be configured",
  }),
  defaultChain: z.string().min(1),
  roles: z.record(roleSchema).default({}),
  identity: identitySchema.optional(),
  self: selfSchema.optional(),
});

export type Config = z.infer<typeof configSchema>;
export type ControlToken = z.infer<typeof controlTokenSchema>;
export type RoleConfig = Config["roles"][string];
export type TargetConfig = z.infer<typeof targetSchema>;
export type AdminAction = z.infer<typeof adminActionSchema>;
export type IdentityConfig = NonNullable<Config["identity"]>;

/** Substitute ${ENV_VAR} in every string value; error on unset variables. */
export function substituteEnv(value: unknown, env: NodeJS.ProcessEnv = process.env): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
      const v = env[name];
      if (v === undefined) {
        throw new ConfigError(
          `config references environment variable ${name}, which is not set`,
        );
      }
      return v;
    });
  }
  if (Array.isArray(value)) return value.map((v) => substituteEnv(v, env));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        substituteEnv(v, env),
      ]),
    );
  }
  return value;
}

/**
 * Reject anything that looks like a private key (32-byte hex string).
 * The only legitimate 32-byte hex value in a config is the ERC-6551 salt.
 */
export function rejectPrivateKeys(value: unknown, allowed: Set<string>, path = "$"): void {
  if (typeof value === "string") {
    const m = value.match(PRIVATE_KEY_RE);
    if (m && !allowed.has(value.toLowerCase())) {
      throw new ConfigError(
        `config value at ${path} looks like a private key (32-byte hex). ` +
          `Private keys must never appear in the config file; ` +
          `use the TCTC_ADMIN_PRIVATE_KEY environment variable instead.`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => rejectPrivateKeys(v, allowed, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      rejectPrivateKeys(v, allowed, `${path}.${k}`);
    }
  }
}

export function parseConfig(rawJson: string, env: NodeJS.ProcessEnv = process.env): Config {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (e) {
    throw new ConfigError(`config is not valid JSON: ${(e as Error).message}`);
  }

  const substituted = substituteEnv(parsed, env);

  const salt = (substituted as any)?.identity?.erc6551?.salt;
  const allowed = new Set<string>(
    typeof salt === "string" ? [salt.toLowerCase()] : [],
  );
  rejectPrivateKeys(substituted, allowed);

  const result = configSchema.safeParse(substituted);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "$"}: ${i.message}`)
      .join("; ");
    throw new ConfigError(`invalid config: ${issues}`);
  }
  const config = result.data;

  // Cross-reference validation.
  if (!config.chains[config.defaultChain]) {
    throw new ConfigError(`defaultChain "${config.defaultChain}" is not in chains`);
  }
  for (const [roleName, role] of Object.entries(config.roles)) {
    if (role.target) {
      const chain = role.target.chain ?? config.defaultChain;
      if (!config.chains[chain]) {
        throw new ConfigError(
          `roles.${roleName}.target.chain "${chain}" is not in chains`,
        );
      }
    }
    role.controlTokens?.forEach((t, i) => {
      if (!config.chains[t.chain]) {
        throw new ConfigError(
          `roles.${roleName}.controlTokens[${i}].chain "${t.chain}" is not in chains`,
        );
      }
      if (t.standard === "erc1155" && t.typeId === null) {
        throw new ConfigError(
          `roles.${roleName}.controlTokens[${i}]: erc1155 control token requires typeId`,
        );
      }
      if (t.standard === "erc721" && t.typeId !== null) {
        throw new ConfigError(
          `roles.${roleName}.controlTokens[${i}]: erc721 control token must not have typeId`,
        );
      }
    });
  }
  if (config.identity && !config.chains[config.identity.chain]) {
    throw new ConfigError(`identity.chain "${config.identity.chain}" is not in chains`);
  }
  if (config.self && "agentId" in config.self && !config.identity) {
    throw new ConfigError(`self.agentId requires the identity section`);
  }
  return config;
}

export function loadConfig(path: string): Config {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    throw new ConfigError(`cannot read config file ${path}: ${(e as Error).message}`);
  }
  return parseConfig(raw);
}
