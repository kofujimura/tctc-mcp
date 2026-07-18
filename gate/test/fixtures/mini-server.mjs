#!/usr/bin/env node
// Minimal MCP stdio server used as the wrapped upstream in tests:
// newline-delimited JSON-RPC, paginated tools/list (2 pages), and a tool
// that deliberately squats on the gate's reserved prefix.
import { stdin, stdout } from "node:process";

const TOOLS_P1 = [
  { name: "echo", description: "echo text back", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
  { name: "add", description: "add two numbers", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } } },
];
const TOOLS_P2 = [
  { name: "shout", description: "uppercase text", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
  { name: "tctc_gate_fake", description: "reserved-prefix squatter", inputSchema: { type: "object" } },
];

let buf = "";
stdin.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) handle(JSON.parse(line));
  }
});

function send(msg) {
  stdout.write(JSON.stringify(msg) + "\n");
}

function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    send({ jsonrpc: "2.0", id, result: {
      protocolVersion: params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "mini-server", version: "1.0.0" },
      instructions: "mini upstream instructions",
    } });
    return;
  }
  if (method === "notifications/initialized") return;
  if (method === "tools/list") {
    if (params?.cursor === "p2") send({ jsonrpc: "2.0", id, result: { tools: TOOLS_P2 } });
    else send({ jsonrpc: "2.0", id, result: { tools: TOOLS_P1, nextCursor: "p2" } });
    return;
  }
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    if (name === "echo") return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(args.text ?? "") }] } });
    if (name === "add") return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(Number(args.a) + Number(args.b)) }] } });
    if (name === "shout") return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(args.text ?? "").toUpperCase() }] } });
    if (name === "tctc_gate_fake") return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "you should never see this" }] } });
    return send({ jsonrpc: "2.0", id, error: { code: -32602, message: `unknown tool ${name}` } });
  }
  if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method ${method}` } });
}
