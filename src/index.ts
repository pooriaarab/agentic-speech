export { VERSION } from "./version.js";
export {
  defineBrand,
  createLogger,
  GuardError,
  VendorError,
  createGuards,
  LocalRouterAdapter,
  HttpRouterAdapter,
  recordCost,
  getCostReport,
  resetCosts,
  createDryRunResult,
  dispatchText,
  summarizeText,
} from "agentic-core";
export type {
  BrandConfig,
  LogLevel,
  Logger,
  LoggerOptions,
  CapsConfig,
  QuietHoursConfig,
  GuardsConfig,
  Guards,
  DispatchReceipt,
  RouterAdapter,
  HttpRouterOptions,
  CostEntry,
  CostReport,
  DispatchOptions,
  DispatchResult,
  TopWord,
  TextSummary,
  SummarizeOptions,
} from "agentic-core";
export {
  CARTESIA_VERSION,
  CartesiaSpeechAdapter,
  DEFAULT_MODEL,
  DEFAULT_VOICE,
  DryRunSpeechAdapter,
  ElevenLabsSpeechAdapter,
  MIME_TYPE,
  OpenAiSpeechAdapter,
  SpeechRouterAdapter,
  isVendor,
  listVoices,
  pcmToWav,
  resolveSpeechAdapter,
  synthesizeSpeech,
} from "./speech.js";
export type {
  AudioFormat,
  EnvRecord,
  ResolveOptions,
  SpeechAdapter,
  SpeechResult,
  SpeechRouterOptions,
  SpeechVendor,
  SynthesizeOptions,
  VendorAdapterOptions,
  VoiceInfo,
} from "./speech.js";

import { defineBrand, type BrandConfig } from "agentic-core";
import { VERSION } from "./version.js";

export const DEFAULT_BRAND: BrandConfig = defineBrand({
  name: "Agentic speech",
  command: "agentic-speech",
  description: "Route text to speech across ElevenLabs, OpenAI, and Cartesia.",
  keywords: ["text-to-speech", "elevenlabs", "agentic-suite", "claude-code", "codex", "cli", "mcp"],
  version: VERSION,
});
