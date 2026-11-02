/**
 * Signed agent links: how an AI agent binds itself to this dashboard.
 *
 * tctc-mcp, started in the agent's folder, derives the agent's EOA from
 * TCTC_AGENT_PRIVATE_KEY (.env.local) and prints / returns (whoami) a link
 *
 *   ?chainId=…&agent=0x…&name=…&ts=<ISO time>&sig=<EIP-191 signature>
 *
 * Opening it adds the agent to the dashboard's agent list. The signature
 * proves the link came from the holder of the agent's key — the key itself
 * never leaves the agent. The message format MUST stay identical to
 * agentLinkMessage() in tctc-mcp's src/agent.ts (cross-checked by
 * test/agent-link.test.ts in the repo root).
 *
 * Pure module (no DOM, no storage) so the root test suite can import it.
 */
import { getAddress, isAddress, verifyMessage, type Address, type Hex } from "viem";

export interface AgentLinkFields {
  agent: Address;
  name: string;
  chainId: number;
  issuedAt: string;
}

export function agentLinkMessage(f: AgentLinkFields): string {
  return [
    "TCTC agent link v1",
    "This agent controls the account below and asks to be shown on a TCTC dashboard.",
    `agent: ${getAddress(f.agent)}`,
    `name: ${f.name}`,
    `chainId: ${f.chainId}`,
    `issuedAt: ${f.issuedAt}`,
  ].join("\n");
}

export interface ParsedAgentLink {
  address: Address;
  name?: string;
  chainId?: number;
  issuedAt?: string;
  signature?: Hex;
}

/** Read an agent link from URL params; undefined when there is no valid `agent`. */
export function parseAgentLink(params: URLSearchParams): ParsedAgentLink | undefined {
  const agent = params.get("agent")?.trim();
  if (!agent || !isAddress(agent, { strict: false })) return undefined;
  const chainIdRaw = params.get("chainId");
  const chainId = chainIdRaw && /^\d+$/.test(chainIdRaw) ? Number(chainIdRaw) : undefined;
  const sig = params.get("sig") ?? undefined;
  return {
    address: getAddress(agent),
    name: params.get("name") ?? undefined,
    chainId,
    issuedAt: params.get("ts") ?? undefined,
    signature: sig && /^0x[0-9a-fA-F]+$/.test(sig) ? (sig as Hex) : undefined,
  };
}

/**
 * true only when the link carries a signature over exactly these fields
 * by the agent's own key. Unsigned links are allowed (manual registration)
 * but are shown as unverified.
 */
export async function verifyAgentLink(link: ParsedAgentLink): Promise<boolean> {
  if (!link.signature || link.chainId === undefined || !link.issuedAt) return false;
  try {
    return await verifyMessage({
      address: link.address,
      message: agentLinkMessage({
        agent: link.address,
        name: link.name ?? "",
        chainId: link.chainId,
        issuedAt: link.issuedAt,
      }),
      signature: link.signature,
    });
  } catch {
    return false;
  }
}
