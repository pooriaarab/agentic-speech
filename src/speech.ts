import { randomUUID } from "node:crypto";
import {
  recordCost,
  VendorError,
  type DispatchReceipt,
  type Guards,
  type Logger,
  type RouterAdapter,
} from "agentic-core";

// Vendors. One adapter per vendor, one router over all three.
// Dry run is the default: previews cost nothing and need no key.

export type SpeechVendor = "elevenlabs" | "openai" | "cartesia";

export type AudioFormat = "mp3" | "wav";

export type EnvRecord = Record<string, string | undefined>;

const VENDORS: SpeechVendor[] = ["elevenlabs", "openai", "cartesia"];

const KEY_ENV: Record<SpeechVendor, string> = {
  elevenlabs: "ELEVENLABS_API_KEY",
  openai: "OPENAI_API_KEY",
  cartesia: "CARTESIA_API_KEY",
};

export const DEFAULT_MODEL: Record<SpeechVendor, string> = {
  elevenlabs: "eleven_multilingual_v2",
  openai: "tts-1",
  cartesia: "sonic-2",
};

// Rachel is the documented ElevenLabs sample voice. OpenAI ships named
// voices. Cartesia voices live in the user account, so cartesia has no
// default voice id: set CARTESIA_VOICE_ID or pass voice.
export const DEFAULT_VOICE: Record<SpeechVendor, string> = {
  elevenlabs: "21m00Tcm4TlvDq8ikWAM",
  openai: "alloy",
  cartesia: "",
};

export const MIME_TYPE: Record<AudioFormat, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

export function isVendor(value: string): value is SpeechVendor {
  return (VENDORS as string[]).includes(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertText(text: string, vendor: string): void {
  if (typeof text !== "string" || text.length === 0) {
    throw new VendorError(`${vendor} needs non-empty text`);
  }
}

// Speech result. audioBase64 carries the audio so the result stays
// JSON-safe for the CLI, the MCP tools, and the worker. Dry runs
// return empty audio with the resolved vendor, voice, and model.

export interface SpeechResult {
  dryRun: boolean;
  vendor: SpeechVendor;
  voice: string;
  model: string;
  chars: number;
  bytes: number;
  mimeType: string;
  audioBase64: string;
}

function speechResult(input: {
  vendor: SpeechVendor;
  voice: string;
  model: string;
  chars: number;
  format: AudioFormat;
  raw: Uint8Array;
}): SpeechResult {
  return {
    dryRun: false,
    vendor: input.vendor,
    voice: input.voice,
    model: input.model,
    chars: input.chars,
    bytes: input.raw.length,
    mimeType: MIME_TYPE[input.format],
    audioBase64: Buffer.from(input.raw).toString("base64"),
  };
}

export interface SpeechAdapter {
  readonly vendor: SpeechVendor;
  synthesize(text: string, format?: AudioFormat): Promise<SpeechResult>;
}

export interface VendorAdapterOptions {
  apiKey: string;
  voice?: string;
  model?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  vendor: SpeechVendor,
  timeoutMs: number,
  fetchFn: typeof fetch | undefined,
): Promise<Response> {
  const fetchImpl = fetchFn ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new VendorError(`${vendor} request failed: ${messageOf(error)}`, {
      cause: error,
    });
  }
  if (!response.ok) {
    const snippet = await response
      .text()
      .then((text) => text.slice(0, 300))
      .catch(() => "");
    throw new VendorError(
      `${vendor} request failed with status ${response.status}${snippet === "" ? "" : `: ${snippet}`}`,
      { status: response.status },
    );
  }
  return response;
}

// ElevenLabs. POST /v1/text-to-speech/{voice_id} with xi-api-key.
// Wav comes back as raw PCM, so the adapter wraps it in a WAV header.

export class ElevenLabsSpeechAdapter implements SpeechAdapter {
  readonly vendor: SpeechVendor = "elevenlabs";
  private readonly apiKey: string;
  private readonly voice: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch | undefined;

  constructor(options: VendorAdapterOptions) {
    this.apiKey = options.apiKey;
    this.voice = options.voice ?? "";
    this.model = options.model ?? "";
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchFn = options.fetchFn;
  }

  async synthesize(text: string, format: AudioFormat = "mp3"): Promise<SpeechResult> {
    assertText(text, this.vendor);
    if (this.apiKey === "") {
      throw new VendorError("elevenlabs needs an API key (set ELEVENLABS_API_KEY)");
    }
    const voice = this.voice === "" ? DEFAULT_VOICE.elevenlabs : this.voice;
    const model = this.model === "" ? DEFAULT_MODEL.elevenlabs : this.model;
    const outputFormat = format === "wav" ? "pcm_24000" : "mp3_44100_128";
    const url =
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}` +
      `?output_format=${outputFormat}`;
    const response = await postJson(
      url,
      { "xi-api-key": this.apiKey },
      { text, model_id: model },
      this.vendor,
      this.timeoutMs,
      this.fetchFn,
    );
    let raw: Uint8Array = new Uint8Array(await response.arrayBuffer());
    if (format === "wav") {
      raw = pcmToWav(raw, 24000);
    }
    return speechResult({ vendor: this.vendor, voice, model, chars: text.length, format, raw });
  }
}

// OpenAI. POST /v1/audio/speech with a bearer key. The API returns
// mp3 or wav bytes straight back.

export class OpenAiSpeechAdapter implements SpeechAdapter {
  readonly vendor: SpeechVendor = "openai";
  private readonly apiKey: string;
  private readonly voice: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch | undefined;

  constructor(options: VendorAdapterOptions) {
    this.apiKey = options.apiKey;
    this.voice = options.voice ?? "";
    this.model = options.model ?? "";
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchFn = options.fetchFn;
  }

  async synthesize(text: string, format: AudioFormat = "mp3"): Promise<SpeechResult> {
    assertText(text, this.vendor);
    if (this.apiKey === "") {
      throw new VendorError("openai needs an API key (set OPENAI_API_KEY)");
    }
    const voice = this.voice === "" ? DEFAULT_VOICE.openai : this.voice;
    const model = this.model === "" ? DEFAULT_MODEL.openai : this.model;
    const response = await postJson(
      "https://api.openai.com/v1/audio/speech",
      { authorization: `Bearer ${this.apiKey}` },
      { model, input: text, voice, response_format: format },
      this.vendor,
      this.timeoutMs,
      this.fetchFn,
    );
    const raw = new Uint8Array(await response.arrayBuffer());
    return speechResult({ vendor: this.vendor, voice, model, chars: text.length, format, raw });
  }
}

// Cartesia. POST /tts/bytes with X-API-Key and a version header.
// The voice id always comes from the caller or the environment.

export const CARTESIA_VERSION = "2025-04-16";

export class CartesiaSpeechAdapter implements SpeechAdapter {
  readonly vendor: SpeechVendor = "cartesia";
  private readonly apiKey: string;
  private readonly voice: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch | undefined;

  constructor(options: VendorAdapterOptions) {
    this.apiKey = options.apiKey;
    this.voice = options.voice ?? "";
    this.model = options.model ?? "";
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchFn = options.fetchFn;
  }

  async synthesize(text: string, format: AudioFormat = "mp3"): Promise<SpeechResult> {
    assertText(text, this.vendor);
    if (this.apiKey === "") {
      throw new VendorError("cartesia needs an API key (set CARTESIA_API_KEY)");
    }
    if (this.voice === "") {
      throw new VendorError("cartesia needs a voice id (set CARTESIA_VOICE_ID or pass voice)");
    }
    const model = this.model === "" ? DEFAULT_MODEL.cartesia : this.model;
    const response = await postJson(
      "https://api.cartesia.ai/tts/bytes",
      { "X-API-Key": this.apiKey, "Cartesia-Version": CARTESIA_VERSION },
      {
        model_id: model,
        transcript: text,
        voice: { mode: "id", id: this.voice },
        output_format:
          format === "wav"
            ? { container: "wav", encoding: "pcm_s16le", sample_rate: 24000 }
            : { container: "mp3", bit_rate: 128000, sample_rate: 44100 },
      },
      this.vendor,
      this.timeoutMs,
      this.fetchFn,
    );
    const raw = new Uint8Array(await response.arrayBuffer());
    return speechResult({
      vendor: this.vendor,
      voice: this.voice,
      model,
      chars: text.length,
      format,
      raw,
    });
  }
}

// Dry run. Returns the resolved route with empty audio. Calls no
// network and needs no key. This is the default everywhere.

export class DryRunSpeechAdapter implements SpeechAdapter {
  readonly vendor: SpeechVendor;
  private readonly voice: string;
  private readonly model: string;

  constructor(vendor: SpeechVendor, options: { voice?: string; model?: string } = {}) {
    this.vendor = vendor;
    this.voice = options.voice ?? "";
    this.model = options.model ?? "";
  }

  async synthesize(text: string, format: AudioFormat = "mp3"): Promise<SpeechResult> {
    assertText(text, this.vendor);
    const voice = this.voice === "" ? DEFAULT_VOICE[this.vendor] : this.voice;
    const model = this.model === "" ? DEFAULT_MODEL[this.vendor] : this.model;
    return {
      dryRun: true,
      vendor: this.vendor,
      voice,
      model,
      chars: text.length,
      bytes: 0,
      mimeType: MIME_TYPE[format],
      audioBase64: "",
    };
  }
}

// Resolve. Picks the dry run adapter by default. Picks a real vendor
// adapter when dryRun is false and the vendor key is present. Throws
// when the vendor is unknown or the key is missing.

export interface ResolveOptions {
  vendor?: string;
  voice?: string;
  model?: string;
  apiKey?: string;
  dryRun?: boolean;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  env?: EnvRecord;
}

export function resolveSpeechAdapter(options: ResolveOptions = {}): SpeechAdapter {
  const name = options.vendor ?? "elevenlabs";
  if (!isVendor(name)) {
    throw new VendorError(`unknown vendor "${name}" (want elevenlabs, openai, or cartesia)`);
  }
  const env = options.env ?? process.env;
  let voice = options.voice;
  if (voice === undefined && name === "cartesia") {
    voice = env.CARTESIA_VOICE_ID;
  }
  if (options.dryRun ?? true) {
    return new DryRunSpeechAdapter(name, { voice, model: options.model });
  }
  const key = options.apiKey ?? env[KEY_ENV[name]];
  if (key === undefined || key === "") {
    throw new VendorError(`${name} needs an API key (set ${KEY_ENV[name]} or pass dryRun)`);
  }
  const base = {
    apiKey: key,
    voice,
    model: options.model,
    timeoutMs: options.timeoutMs,
    fetchFn: options.fetchFn,
  };
  switch (name) {
    case "elevenlabs":
      return new ElevenLabsSpeechAdapter(base);
    case "openai":
      return new OpenAiSpeechAdapter(base);
    case "cartesia":
      return new CartesiaSpeechAdapter(base);
  }
}

// Synthesize. Runs guards, then routes, then records cost. Dry run
// walks the same path but calls no vendor and records no cost.

export interface SynthesizeOptions extends ResolveOptions {
  format?: AudioFormat;
  guards?: Guards;
  logger?: Logger;
}

export async function synthesizeSpeech(
  text: string,
  options: SynthesizeOptions = {},
): Promise<SpeechResult> {
  const adapter = resolveSpeechAdapter(options);
  options.guards?.checkDispatch(text);
  const format = options.format ?? "mp3";
  if (options.dryRun ?? true) {
    options.logger?.info(`dry run: would synthesize ${text.length} chars via ${adapter.vendor}`);
    return adapter.synthesize(text, format);
  }
  const result = await adapter.synthesize(text, format);
  options.guards?.recordDispatch();
  recordCost({ kind: "synthesis", adapter: adapter.vendor, units: text.length });
  options.logger?.info(`synthesized ${text.length} chars via ${adapter.vendor}`);
  return result;
}

// Router adapter. Wraps speech synthesis in the core RouterAdapter
// shape so dispatchText routes speech like any other pack content.
// The receipt id carries a dryrun prefix on previews.

export interface SpeechRouterOptions extends ResolveOptions {
  format?: AudioFormat;
}

export class SpeechRouterAdapter implements RouterAdapter {
  readonly name: string;
  private readonly options: SpeechRouterOptions;

  constructor(options: SpeechRouterOptions = {}) {
    this.options = options;
    this.name = options.vendor ?? "elevenlabs";
  }

  async dispatch(text: string): Promise<DispatchReceipt> {
    const result = await synthesizeSpeech(text, this.options);
    return {
      adapter: result.vendor,
      id: result.dryRun ? `dryrun-${randomUUID()}` : randomUUID(),
      chars: result.chars,
      at: new Date().toISOString(),
    };
  }
}

// Voices. The built-in voices each vendor documents. Cartesia has no
// fixed list: its entry points at the account voice id.

export interface VoiceInfo {
  vendor: SpeechVendor;
  id: string;
  name: string;
  note?: string;
}

const OPENAI_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;

export function listVoices(vendor?: string): VoiceInfo[] {
  if (vendor !== undefined && !isVendor(vendor)) {
    throw new VendorError(`unknown vendor "${vendor}" (want elevenlabs, openai, or cartesia)`);
  }
  const all: VoiceInfo[] = [
    {
      vendor: "elevenlabs",
      id: DEFAULT_VOICE.elevenlabs,
      name: "Rachel",
      note: "Default voice. Any voice id from your ElevenLabs account also works.",
    },
    ...OPENAI_VOICES.map((id) => ({
      vendor: "openai" as SpeechVendor,
      id,
      name: id.slice(0, 1).toUpperCase() + id.slice(1),
    })),
    {
      vendor: "cartesia",
      id: "",
      name: "account voice",
      note: "Cartesia voices come from your account. Set CARTESIA_VOICE_ID.",
    },
  ];
  return vendor === undefined ? all : all.filter((voice) => voice.vendor === vendor);
}

// PCM to WAV. Wraps mono 16-bit PCM bytes in a 44-byte WAV header so
// ElevenLabs wav output plays as a normal wav file.

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

export function pcmToWav(pcm: Uint8Array, sampleRate = 24000): Uint8Array {
  const view = new DataView(new ArrayBuffer(44));
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(view.buffer), 0);
  out.set(pcm, 44);
  return out;
}
