import { summarizeText, VendorError } from "agentic-core";
import { synthesizeSpeech } from "./speech.js";
import { VERSION } from "./version.js";

export interface WorkerEnv {
  PACK_NAME?: string;
  ELEVENLABS_API_KEY?: string;
  OPENAI_API_KEY?: string;
  CARTESIA_API_KEY?: string;
  CARTESIA_VOICE_ID?: string;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, pack: env.PACK_NAME ?? "agentic-speech", version: VERSION });
    }
    if (request.method === "POST" && url.pathname === "/summarize") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "body must be JSON" }, 400);
      }
      if (typeof body !== "object" || body === null || !("text" in body)) {
        return json({ error: "body needs a text string" }, 400);
      }
      const { text } = body as { text: unknown };
      if (typeof text !== "string") {
        return json({ error: "body needs a text string" }, 400);
      }
      return json(summarizeText(text));
    }
    if (request.method === "POST" && url.pathname === "/speak") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "body must be JSON" }, 400);
      }
      if (typeof body !== "object" || body === null) {
        return json({ error: "body needs a text string" }, 400);
      }
      const { text, vendor, voice, model, format, dryRun } = body as {
        text?: unknown;
        vendor?: unknown;
        voice?: unknown;
        model?: unknown;
        format?: unknown;
        dryRun?: unknown;
      };
      if (typeof text !== "string") {
        return json({ error: "body needs a text string" }, 400);
      }
      if (format !== undefined && format !== "mp3" && format !== "wav") {
        return json({ error: "format needs mp3 or wav" }, 400);
      }
      if (dryRun !== undefined && typeof dryRun !== "boolean") {
        return json({ error: "dryRun needs a boolean" }, 400);
      }
      for (const [label, value] of [
        ["vendor", vendor],
        ["voice", voice],
        ["model", model],
      ] as const) {
        if (value !== undefined && typeof value !== "string") {
          return json({ error: `${label} needs a string` }, 400);
        }
      }
      try {
        return json(
          await synthesizeSpeech(text, {
            vendor: vendor as string | undefined,
            voice: voice as string | undefined,
            model: model as string | undefined,
            format: format as "mp3" | "wav" | undefined,
            dryRun: (dryRun as boolean | undefined) ?? true,
            env: { ...env },
          }),
        );
      } catch (error) {
        if (error instanceof VendorError) {
          return json({ error: error.message }, 502);
        }
        throw error;
      }
    }
    return json({ error: "not found" }, 404);
  },
};
