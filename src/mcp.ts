import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createLogger,
  dispatchText,
  getCostReport,
  GuardError,
  summarizeText,
  VendorError,
  type Guards,
  type Logger,
} from "agentic-core";
import { DEFAULT_BRAND } from "./index.js";
import {
  listVoices,
  SpeechRouterAdapter,
  synthesizeSpeech,
  type EnvRecord,
} from "./speech.js";

export interface McpDeps {
  guards?: Guards;
  logger?: Logger;
  fetchFn?: typeof fetch;
  env?: EnvRecord;
}

const textShape = {
  text: z.string().describe("The text to handle."),
};

const vendorShape = {
  vendor: z.string().optional().describe("elevenlabs, openai, or cartesia. Defaults to elevenlabs."),
};

function errorResult(error: unknown): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
}

function okResult(value: unknown): {
  content: { type: "text"; text: string }[];
} {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

export function createMcpServer(deps: McpDeps = {}): McpServer {
  const guards = deps.guards;
  const logger = deps.logger ?? createLogger({ quiet: true });
  const fetchFn = deps.fetchFn;
  const env = deps.env;
  const server = new McpServer({
    name: DEFAULT_BRAND.command,
    version: DEFAULT_BRAND.version,
  });

  server.registerTool(
    "synthesize_speech",
    {
      description: "Render text to speech. Dry runs by default; pass dryRun false to call the vendor.",
      inputSchema: {
        ...textShape,
        ...vendorShape,
        voice: z.string().optional().describe("Voice id or name. Vendor default when empty."),
        model: z.string().optional().describe("Vendor model id. Vendor default when empty."),
        format: z.enum(["mp3", "wav"]).optional().describe("Audio format. Defaults to mp3."),
        dryRun: z.boolean().optional().describe("Preview the route without calling the vendor. Defaults to true."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ text, vendor, voice, model, format, dryRun }) => {
      try {
        return okResult(
          await synthesizeSpeech(text, {
            vendor,
            voice,
            model,
            format,
            dryRun: dryRun ?? true,
            guards,
            logger,
            fetchFn,
            env,
          }),
        );
      } catch (error) {
        if (error instanceof GuardError || error instanceof VendorError) {
          return errorResult(error);
        }
        throw error;
      }
    },
  );

  server.registerTool(
    "list_voices",
    {
      description: "List the built-in voices for one vendor, or for all vendors.",
      inputSchema: { ...vendorShape },
      annotations: { readOnlyHint: true },
    },
    async ({ vendor }) => {
      try {
        return okResult(listVoices(vendor));
      } catch (error) {
        if (error instanceof VendorError) {
          return errorResult(error);
        }
        throw error;
      }
    },
  );

  server.registerTool(
    "summarize_text",
    {
      description: "Count chars, words, and lines in a text, with top words.",
      inputSchema: textShape,
      annotations: { readOnlyHint: true },
    },
    async ({ text }) => okResult(summarizeText(text)),
  );

  server.registerTool(
    "dispatch_text",
    {
      description: "Route one text through the speech router. Pass dryRun false to render for real.",
      inputSchema: {
        ...textShape,
        ...vendorShape,
        voice: z.string().optional().describe("Voice id or name. Vendor default when empty."),
        dryRun: z.boolean().optional().describe("Preview the route without calling the vendor. Defaults to true."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ text, vendor, voice, dryRun }) => {
      try {
        const live = dryRun === false;
        return okResult(
          await dispatchText(text, {
            adapter: new SpeechRouterAdapter({ vendor, voice, dryRun: !live, fetchFn, env }),
            guards,
            logger,
            dryRun: !live,
          }),
        );
      } catch (error) {
        if (error instanceof GuardError || error instanceof VendorError) {
          return errorResult(error);
        }
        throw error;
      }
    },
  );

  server.registerTool(
    "get_cost_report",
    {
      description: "Read the cost report for this session.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => okResult(getCostReport()),
  );

  return server;
}

export async function startMcp(deps: McpDeps = {}): Promise<void> {
  const server = createMcpServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
