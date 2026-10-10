#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  dispatchText,
  getCostReport,
  GuardError,
  summarizeText,
  VendorError,
} from "agentic-core";
import { DEFAULT_BRAND } from "./index.js";
import {
  isVendor,
  listVoices,
  SpeechRouterAdapter,
  synthesizeSpeech,
  type AudioFormat,
  type EnvRecord,
} from "./speech.js";
import { VERSION } from "./version.js";

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export type CliCommand =
  | "speak"
  | "voices"
  | "summary"
  | "dispatch"
  | "costs"
  | "mcp"
  | "help"
  | "version";

export interface CliRequest {
  command: CliCommand;
  text?: string;
  file?: string;
  dryRun: boolean;
  topN?: number;
  vendor?: string;
  voice?: string;
  model?: string;
  format?: AudioFormat;
  out?: string;
  live: boolean;
}

function takeValue(args: string[], flag: string): string {
  const value = args.shift();
  if (value === undefined) {
    throw new UsageError(`${flag} needs a value`);
  }
  return value;
}

export function parseArgs(argv: string[]): CliRequest {
  const request: CliRequest = { command: "help", dryRun: false, live: false };
  const args = [...argv];
  const first = args.shift();
  if (first === undefined || first === "--help" || first === "-h") {
    return request;
  }
  if (first === "--version" || first === "-V") {
    request.command = "version";
    return request;
  }
  if (
    first !== "speak" &&
    first !== "voices" &&
    first !== "summary" &&
    first !== "dispatch" &&
    first !== "costs" &&
    first !== "mcp"
  ) {
    throw new UsageError(`unknown command "${first}"`);
  }
  request.command = first;
  while (args.length > 0) {
    const flag = args.shift() as string;
    if (flag === "--live" && (request.command === "speak" || request.command === "dispatch")) {
      request.live = true;
      continue;
    }
    if (flag === "--text" || flag === "--file") {
      if (request.command !== "speak" && request.command !== "summary" && request.command !== "dispatch") {
        throw new UsageError(`unknown flag "${flag}" for "${request.command}"`);
      }
      const value = takeValue(args, flag);
      if (flag === "--text") request.text = value;
      if (flag === "--file") request.file = value;
      continue;
    }
    if (flag === "--top" && request.command === "summary") {
      const value = takeValue(args, flag);
      const topN = Number.parseInt(value, 10);
      if (!Number.isInteger(topN) || topN < 0) {
        throw new UsageError(`--top needs an integer of 0 or more, got "${value}"`);
      }
      request.topN = topN;
      continue;
    }
    if (
      (flag === "--vendor" || flag === "--voice" || flag === "--model" || flag === "--format" || flag === "--out") &&
      (request.command === "speak" || request.command === "dispatch" || request.command === "voices")
    ) {
      if (request.command === "voices" && flag !== "--vendor") {
        throw new UsageError(`unknown flag "${flag}" for "voices"`);
      }
      if (request.command === "dispatch" && (flag === "--model" || flag === "--format" || flag === "--out")) {
        throw new UsageError(`unknown flag "${flag}" for "dispatch"`);
      }
      const value = takeValue(args, flag);
      if (flag === "--vendor") {
        if (!isVendor(value)) {
          throw new UsageError(`unknown vendor "${value}" (want elevenlabs, openai, or cartesia)`);
        }
        request.vendor = value;
      }
      if (flag === "--voice") request.voice = value;
      if (flag === "--model") request.model = value;
      if (flag === "--format") {
        if (value !== "mp3" && value !== "wav") {
          throw new UsageError(`--format needs mp3 or wav, got "${value}"`);
        }
        request.format = value;
      }
      if (flag === "--out") request.out = value;
      continue;
    }
    throw new UsageError(`unknown flag "${flag}" for "${request.command}"`);
  }
  if (
    (request.command === "speak" || request.command === "summary" || request.command === "dispatch") &&
    request.text === undefined &&
    request.file === undefined
  ) {
    throw new UsageError(`${request.command} needs --text or --file`);
  }
  return request;
}

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
  readFile(path: string): string;
  writeFile(path: string, data: Uint8Array): void;
  fetchFn?: typeof fetch;
  env?: EnvRecord;
}

function defaultIo(): CliIo {
  return {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    readFile: (path) => readFileSync(path, "utf8"),
    writeFile: (path, data) => writeFileSync(path, data),
    env: process.env,
  };
}

function helpText(): string {
  const command = DEFAULT_BRAND.command;
  return [
    `${DEFAULT_BRAND.name} ${VERSION}`,
    `${DEFAULT_BRAND.description}`,
    "",
    `Usage: ${command} <command> [flags]`,
    "",
    "Commands:",
    "  speak --text <t> [--file <p>] [--vendor <v>] [--voice <id>] [--model <m>] [--format <f>] [--out <p>] [--live]  Preview or render speech.",
    "  voices [--vendor <v>]                 List the voices each vendor ships.",
    "  summary --text <t> [--file <p>] [--top <n>]  Print text stats as JSON.",
    "  dispatch --text <t> [--file <p>] [--vendor <v>] [--voice <id>] [--live]  Route one text, print the receipt.",
    "  costs                                 Print the cost report as JSON.",
    "  mcp                                   Start the MCP server on stdio.",
    "",
    "Speech previews by default. It calls no vendor and spends nothing.",
    "Pass --live to render for real. Live runs need the vendor key:",
    "ELEVENLABS_API_KEY, OPENAI_API_KEY, or CARTESIA_API_KEY.",
    "Cartesia also needs a voice: CARTESIA_VOICE_ID or --voice.",
    "",
    "Flags:",
    "  --help, -h       Print this help.",
    "  --version, -V    Print the version.",
  ].join("\n");
}

function readInput(request: CliRequest, io: CliIo): string {
  if (request.file !== undefined) {
    return io.readFile(request.file);
  }
  return request.text ?? "";
}

export async function runCli(argv: string[], io: CliIo = defaultIo()): Promise<number> {
  let request: CliRequest;
  try {
    request = parseArgs(argv);
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    io.err(`Run "${DEFAULT_BRAND.command} --help" for usage.`);
    return 2;
  }
  try {
    switch (request.command) {
      case "help":
        io.out(helpText());
        return 0;
      case "version":
        io.out(VERSION);
        return 0;
      case "voices":
        io.out(JSON.stringify(listVoices(request.vendor)));
        return 0;
      case "summary": {
        const summary = summarizeText(readInput(request, io), { topN: request.topN });
        io.out(JSON.stringify(summary));
        return 0;
      }
      case "speak": {
        const text = readInput(request, io);
        if (!request.live) {
          const preview = await synthesizeSpeech(text, {
            vendor: request.vendor,
            voice: request.voice,
            model: request.model,
            format: request.format,
            dryRun: true,
            fetchFn: io.fetchFn,
            env: io.env,
          });
          io.out(JSON.stringify(preview));
          return 0;
        }
        if (request.out === undefined) {
          throw new UsageError("speak --live needs --out <path> to save audio");
        }
        const result = await synthesizeSpeech(text, {
          vendor: request.vendor,
          voice: request.voice,
          model: request.model,
          format: request.format,
          dryRun: false,
          fetchFn: io.fetchFn,
          env: io.env,
        });
        io.writeFile(request.out, Buffer.from(result.audioBase64, "base64"));
        const { audioBase64: _dropped, ...meta } = result;
        void _dropped;
        io.out(JSON.stringify({ ...meta, out: request.out }));
        return 0;
      }
      case "dispatch": {
        const result = await dispatchText(readInput(request, io), {
          adapter: new SpeechRouterAdapter({
            vendor: request.vendor,
            voice: request.voice,
            dryRun: !request.live,
            fetchFn: io.fetchFn,
            env: io.env,
          }),
          dryRun: !request.live,
        });
        io.out(JSON.stringify(result));
        return 0;
      }
      case "costs":
        io.out(JSON.stringify(getCostReport()));
        return 0;
      case "mcp": {
        const { startMcp } = await import("./mcp.js");
        await startMcp();
        return 0;
      }
    }
  } catch (error) {
    if (error instanceof GuardError || error instanceof VendorError || error instanceof UsageError) {
      io.err(`${error.name}: ${error.message}`);
      return 1;
    }
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      io.err(`file not found: ${request.file ?? request.out ?? ""}`);
      return 1;
    }
    throw error;
  }
}

function isMainModule(): boolean {
  const invoked = process.argv[1];
  if (typeof invoked !== "string") return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(invoked)).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      // Exit nonzero at once. On zero, fall off the end so a running
      // server (mcp) keeps its stdio handles open. Plain commands
      // hold no handles and exit 0 on their own.
      if (code !== 0) process.exit(code);
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
