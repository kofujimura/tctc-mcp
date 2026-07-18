import type { GateConfig } from "./config.js";
import { globSpecificity } from "./config.js";

export type Resolution =
  | { kind: "public" }
  | { kind: "unmapped" }
  | { kind: "gated"; roles: string[]; via: string };

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === "*" ? ".*" : `\\${c}`));
  return new RegExp(`^${escaped}$`);
}

/**
 * Tool-name → policy resolution (GATE_SPEC §4.1): public (exact) beats
 * everything; exact tool entries beat globs; among globs the most specific
 * (most literal characters) wins — equal-specificity overlaps were already
 * rejected at config load. Unlisted tools are unmapped (defaultPolicy is
 * fixed to deny in v1).
 */
export class Policy {
  private publicSet: Set<string>;
  private exact = new Map<string, string[]>();
  private globs: { pattern: string; re: RegExp; roles: string[]; specificity: number }[] = [];

  constructor(config: GateConfig) {
    this.publicSet = new Set(config.gate.public);
    for (const [key, roles] of Object.entries(config.gate.tools)) {
      if (key.includes("*")) {
        this.globs.push({ pattern: key, re: globToRegExp(key), roles, specificity: globSpecificity(key) });
      } else {
        this.exact.set(key, roles);
      }
    }
    this.globs.sort((a, b) => b.specificity - a.specificity);
  }

  resolve(toolName: string): Resolution {
    if (this.publicSet.has(toolName)) return { kind: "public" };
    const exact = this.exact.get(toolName);
    if (exact) return { kind: "gated", roles: exact, via: toolName };
    for (const g of this.globs) {
      if (g.re.test(toolName)) return { kind: "gated", roles: g.roles, via: g.pattern };
    }
    return { kind: "unmapped" };
  }

  /** Every role name/hash referenced anywhere in the policy (for gate_status). */
  allRoles(): string[] {
    const set = new Set<string>();
    for (const roles of this.exact.values()) roles.forEach((r) => set.add(r));
    for (const g of this.globs) g.roles.forEach((r) => set.add(r));
    return [...set];
  }
}
