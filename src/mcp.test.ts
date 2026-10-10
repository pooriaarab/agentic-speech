import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, test } from "vitest";
import { createGuards } from "agentic-core";
import { createMcpServer } from "./mcp.js";

function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return content[0].text;
}

async function linkedClient(deps: Parameters<typeof createMcpServer>[0] = {}): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ env: {}, ...deps });
  await server.connect(serverTransport);
  const client = new Client({ name: "probe", version: "0.0.0" });
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe("mcp server", () => {
  test("serves five tools over a client link", async () => {
    const { client, close } = await linkedClient();
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name).sort();
      expect(names).toEqual([
        "dispatch_text",
        "get_cost_report",
        "list_voices",
        "summarize_text",
        "synthesize_speech",
      ]);
    } finally {
      await close();
    }
  });

  test("synthesize_speech previews by default", async () => {
    const { client, close } = await linkedClient();
    try {
      const result = await client.callTool({
        name: "synthesize_speech",
        arguments: { text: "hello" },
      });
      expect(JSON.parse(textOf(result))).toMatchObject({
        dryRun: true,
        vendor: "elevenlabs",
        chars: 5,
        audioBase64: "",
      });
    } finally {
      await close();
    }
  });

  test("synthesize_speech renders for real with a mocked vendor", async () => {
    const fetchFn = (async () => new Response("AUDIO", { status: 200 })) as typeof fetch;
    const { client, close } = await linkedClient({
      fetchFn,
      env: { OPENAI_API_KEY: "k" },
    });
    try {
      const result = await client.callTool({
        name: "synthesize_speech",
        arguments: { text: "hi", vendor: "openai", dryRun: false },
      });
      const parsed = JSON.parse(textOf(result));
      expect(parsed).toMatchObject({ dryRun: false, vendor: "openai", bytes: 5 });
      expect(Buffer.from(parsed.audioBase64, "base64").toString()).toBe("AUDIO");
    } finally {
      await close();
    }
  });

  test("live synthesis without a key returns a tool error", async () => {
    const { client, close } = await linkedClient();
    try {
      const result = await client.callTool({
        name: "synthesize_speech",
        arguments: { text: "hi", vendor: "openai", dryRun: false },
      });
      expect((result as { isError?: boolean }).isError).toBe(true);
      expect(textOf(result)).toContain("OPENAI_API_KEY");
    } finally {
      await close();
    }
  });

  test("list_voices returns voices with an optional filter", async () => {
    const { client, close } = await linkedClient();
    try {
      const all = await client.callTool({ name: "list_voices", arguments: {} });
      expect(JSON.parse(textOf(all))).toHaveLength(8);
      const filtered = await client.callTool({
        name: "list_voices",
        arguments: { vendor: "openai" },
      });
      expect(JSON.parse(textOf(filtered))).toHaveLength(6);
    } finally {
      await close();
    }
  });

  test("dispatch_text previews and summarize_text counts", async () => {
    const { client, close } = await linkedClient();
    try {
      const preview = await client.callTool({
        name: "dispatch_text",
        arguments: { text: "hi" },
      });
      expect(JSON.parse(textOf(preview))).toMatchObject({ dryRun: true });
      const summary = await client.callTool({
        name: "summarize_text",
        arguments: { text: "a b a" },
      });
      expect(JSON.parse(textOf(summary))).toMatchObject({ words: 3 });
      const report = await client.callTool({ name: "get_cost_report", arguments: {} });
      expect(JSON.parse(textOf(report))).toHaveProperty("entries");
    } finally {
      await close();
    }
  });

  test("a blocked dispatch returns a tool error, not a crash", async () => {
    const { client, close } = await linkedClient({
      guards: createGuards({ blocklist: ["nope"] }),
    });
    try {
      const result = await client.callTool({
        name: "dispatch_text",
        arguments: { text: "nope" },
      });
      expect((result as { isError?: boolean }).isError).toBe(true);
      expect(textOf(result)).toContain("blocklisted");
    } finally {
      await close();
    }
  });
});
