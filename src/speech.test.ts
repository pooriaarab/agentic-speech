import { beforeEach, describe, expect, test } from "vitest";
import {
  createGuards,
  getCostReport,
  GuardError,
  resetCosts,
  VendorError,
} from "agentic-core";
import {
  CartesiaSpeechAdapter,
  DryRunSpeechAdapter,
  ElevenLabsSpeechAdapter,
  listVoices,
  OpenAiSpeechAdapter,
  pcmToWav,
  resolveSpeechAdapter,
  SpeechRouterAdapter,
  synthesizeSpeech,
} from "./speech.js";

function mockFetch(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return (async (url: unknown, init?: RequestInit) =>
    handler(String(url), init)) as typeof fetch;
}

function boomFetch(): typeof fetch {
  return mockFetch(() => {
    throw new Error("network must stay silent");
  });
}

beforeEach(() => {
  resetCosts();
});

describe("elevenlabs adapter", () => {
  test("posts text and returns mp3 bytes", async () => {
    let seenUrl = "";
    let seenInit: RequestInit = {};
    const fetchFn = mockFetch((url, init) => {
      seenUrl = url;
      seenInit = init ?? {};
      return new Response("FAKEAUDIO", { status: 200 });
    });
    const adapter = new ElevenLabsSpeechAdapter({ apiKey: "test-key", fetchFn });
    const result = await adapter.synthesize("hello");
    expect(seenUrl).toContain("https://api.elevenlabs.io/v1/text-to-speech/");
    expect(seenUrl).toContain("21m00Tcm4TlvDq8ikWAM");
    expect(seenUrl).toContain("output_format=mp3_44100_128");
    expect((seenInit.headers as Record<string, string>)["xi-api-key"]).toBe("test-key");
    expect(JSON.parse(String(seenInit.body))).toMatchObject({
      text: "hello",
      model_id: "eleven_multilingual_v2",
    });
    expect(result).toMatchObject({
      dryRun: false,
      vendor: "elevenlabs",
      voice: "21m00Tcm4TlvDq8ikWAM",
      model: "eleven_multilingual_v2",
      chars: 5,
      bytes: 9,
      mimeType: "audio/mpeg",
    });
    expect(Buffer.from(result.audioBase64, "base64").toString()).toBe("FAKEAUDIO");
  });

  test("wraps wav output in a wav header", async () => {
    const fetchFn = mockFetch((url) => {
      expect(url).toContain("output_format=pcm_24000");
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
    });
    const adapter = new ElevenLabsSpeechAdapter({ apiKey: "test-key", fetchFn });
    const result = await adapter.synthesize("hi", "wav");
    expect(result.mimeType).toBe("audio/wav");
    expect(result.bytes).toBe(48);
    const raw = Buffer.from(result.audioBase64, "base64");
    expect(raw.subarray(0, 4).toString()).toBe("RIFF");
  });

  test("honors custom voice and model", async () => {
    const fetchFn = mockFetch((url, init) => {
      expect(url).toContain("/custom-voice?");
      expect(JSON.parse(String(init?.body))).toMatchObject({ model_id: "custom-model" });
      return new Response("x", { status: 200 });
    });
    const adapter = new ElevenLabsSpeechAdapter({
      apiKey: "test-key",
      voice: "custom-voice",
      model: "custom-model",
      fetchFn,
    });
    const result = await adapter.synthesize("hi");
    expect(result.voice).toBe("custom-voice");
    expect(result.model).toBe("custom-model");
  });

  test("throws VendorError with status on non-2xx", async () => {
    const fetchFn = mockFetch(() => new Response("bad key", { status: 401 }));
    const adapter = new ElevenLabsSpeechAdapter({ apiKey: "bad", fetchFn });
    const error = await adapter.synthesize("hi").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(VendorError);
    expect((error as VendorError).status).toBe(401);
    expect((error as Error).message).toContain("401");
  });

  test("throws VendorError on network failure", async () => {
    const fetchFn = mockFetch(() => {
      throw new Error("socket hangup");
    });
    const adapter = new ElevenLabsSpeechAdapter({ apiKey: "test-key", fetchFn });
    await expect(adapter.synthesize("hi")).rejects.toThrow(/elevenlabs request failed/);
  });

  test("throws on missing key and on empty text", async () => {
    const noKey = new ElevenLabsSpeechAdapter({ apiKey: "", fetchFn: boomFetch() });
    await expect(noKey.synthesize("hi")).rejects.toThrow(/ELEVENLABS_API_KEY/);
    const adapter = new ElevenLabsSpeechAdapter({ apiKey: "test-key", fetchFn: boomFetch() });
    await expect(adapter.synthesize("")).rejects.toThrow(/non-empty text/);
  });
});

describe("openai adapter", () => {
  test("posts input and returns bytes", async () => {
    let seenUrl = "";
    let seenInit: RequestInit = {};
    const fetchFn = mockFetch((url, init) => {
      seenUrl = url;
      seenInit = init ?? {};
      return new Response("OPENAIAUDIO", { status: 200 });
    });
    const adapter = new OpenAiSpeechAdapter({ apiKey: "test-key", fetchFn });
    const result = await adapter.synthesize("hello", "wav");
    expect(seenUrl).toBe("https://api.openai.com/v1/audio/speech");
    expect((seenInit.headers as Record<string, string>).authorization).toBe("Bearer test-key");
    expect(JSON.parse(String(seenInit.body))).toEqual({
      model: "tts-1",
      input: "hello",
      voice: "alloy",
      response_format: "wav",
    });
    expect(result).toMatchObject({
      vendor: "openai",
      voice: "alloy",
      model: "tts-1",
      chars: 5,
      bytes: 11,
      mimeType: "audio/wav",
    });
  });

  test("honors custom voice and model", async () => {
    const fetchFn = mockFetch((_url, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "gpt-4o-mini-tts",
        voice: "coral",
      });
      return new Response("x", { status: 200 });
    });
    const adapter = new OpenAiSpeechAdapter({
      apiKey: "test-key",
      voice: "coral",
      model: "gpt-4o-mini-tts",
      fetchFn,
    });
    const result = await adapter.synthesize("hi");
    expect(result.voice).toBe("coral");
    expect(result.model).toBe("gpt-4o-mini-tts");
  });

  test("throws on failure, missing key, and empty text", async () => {
    const failing = new OpenAiSpeechAdapter({
      apiKey: "bad",
      fetchFn: mockFetch(() => new Response("nope", { status: 429 })),
    });
    const error = await failing.synthesize("hi").catch((cause: unknown) => cause);
    expect((error as VendorError).status).toBe(429);
    const noKey = new OpenAiSpeechAdapter({ apiKey: "", fetchFn: boomFetch() });
    await expect(noKey.synthesize("hi")).rejects.toThrow(/OPENAI_API_KEY/);
    const adapter = new OpenAiSpeechAdapter({ apiKey: "test-key", fetchFn: boomFetch() });
    await expect(adapter.synthesize("")).rejects.toThrow(/non-empty text/);
  });
});

describe("cartesia adapter", () => {
  test("posts transcript and returns bytes", async () => {
    let seenUrl = "";
    let seenInit: RequestInit = {};
    const fetchFn = mockFetch((url, init) => {
      seenUrl = url;
      seenInit = init ?? {};
      return new Response("CARTESIAAUDIO", { status: 200 });
    });
    const adapter = new CartesiaSpeechAdapter({ apiKey: "test-key", voice: "voice-1", fetchFn });
    const result = await adapter.synthesize("hello");
    expect(seenUrl).toBe("https://api.cartesia.ai/tts/bytes");
    const headers = seenInit.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("test-key");
    expect(headers["Cartesia-Version"]).toBe("2025-04-16");
    expect(JSON.parse(String(seenInit.body))).toMatchObject({
      model_id: "sonic-2",
      transcript: "hello",
      voice: { mode: "id", id: "voice-1" },
    });
    expect(result).toMatchObject({ vendor: "cartesia", voice: "voice-1", bytes: 13 });
  });

  test("throws without a voice id and without a key", async () => {
    const noVoice = new CartesiaSpeechAdapter({ apiKey: "test-key", fetchFn: boomFetch() });
    await expect(noVoice.synthesize("hi")).rejects.toThrow(/CARTESIA_VOICE_ID/);
    const noKey = new CartesiaSpeechAdapter({ apiKey: "", voice: "v", fetchFn: boomFetch() });
    await expect(noKey.synthesize("hi")).rejects.toThrow(/CARTESIA_API_KEY/);
  });

  test("throws on non-2xx", async () => {
    const adapter = new CartesiaSpeechAdapter({
      apiKey: "bad",
      voice: "v",
      fetchFn: mockFetch(() => new Response("denied", { status: 403 })),
    });
    const error = await adapter.synthesize("hi").catch((cause: unknown) => cause);
    expect((error as VendorError).status).toBe(403);
  });
});

describe("resolveSpeechAdapter", () => {
  test("defaults to the elevenlabs dry run with no network", async () => {
    const adapter = resolveSpeechAdapter({ fetchFn: boomFetch(), env: {} });
    expect(adapter.vendor).toBe("elevenlabs");
    const result = await adapter.synthesize("hello");
    expect(result).toMatchObject({ dryRun: true, chars: 5, bytes: 0, audioBase64: "" });
  });

  test("dry run resolves the requested vendor", async () => {
    const adapter = resolveSpeechAdapter({ vendor: "openai", fetchFn: boomFetch(), env: {} });
    expect(adapter.vendor).toBe("openai");
    const result = await adapter.synthesize("hi");
    expect(result).toMatchObject({ dryRun: true, voice: "alloy", model: "tts-1" });
  });

  test("live run reads the key from the environment", async () => {
    const fetchFn = mockFetch(() => new Response("x", { status: 200 }));
    const adapter = resolveSpeechAdapter({
      vendor: "openai",
      dryRun: false,
      fetchFn,
      env: { OPENAI_API_KEY: "env-key" },
    });
    expect(adapter).toBeInstanceOf(OpenAiSpeechAdapter);
    await adapter.synthesize("hi");
  });

  test("live run without a key names the missing variable", () => {
    expect(() => resolveSpeechAdapter({ vendor: "cartesia", dryRun: false, env: {} })).toThrow(
      /CARTESIA_API_KEY/,
    );
  });

  test("cartesia reads the voice id from the environment", async () => {
    const fetchFn = mockFetch(() => new Response("x", { status: 200 }));
    const adapter = resolveSpeechAdapter({
      vendor: "cartesia",
      dryRun: false,
      fetchFn,
      env: { CARTESIA_API_KEY: "k", CARTESIA_VOICE_ID: "env-voice" },
    });
    const result = await adapter.synthesize("hi");
    expect(result.voice).toBe("env-voice");
  });

  test("unknown vendor throws", () => {
    expect(() => resolveSpeechAdapter({ vendor: "acme" })).toThrow(/unknown vendor/);
  });
});

describe("synthesizeSpeech", () => {
  test("dry run default calls no network and records no cost", async () => {
    const result = await synthesizeSpeech("hello", { fetchFn: boomFetch(), env: {} });
    expect(result).toMatchObject({ dryRun: true, vendor: "elevenlabs", chars: 5 });
    expect(getCostReport()).toMatchObject({ dispatches: 0, units: 0, entries: [] });
  });

  test("live run records one synthesis cost entry", async () => {
    const fetchFn = mockFetch(() => new Response("AUDIO", { status: 200 }));
    const result = await synthesizeSpeech("hello", {
      vendor: "openai",
      dryRun: false,
      fetchFn,
      env: { OPENAI_API_KEY: "k" },
    });
    expect(result.dryRun).toBe(false);
    expect(getCostReport()).toMatchObject({ dispatches: 0, units: 5 });
    expect(getCostReport().entries).toMatchObject([
      { kind: "synthesis", adapter: "openai", units: 5 },
    ]);
  });

  test("a denied guard throws and records no cost", async () => {
    const guards = createGuards({ blocklist: ["nope"] });
    await expect(
      synthesizeSpeech("nope", {
        vendor: "openai",
        dryRun: false,
        fetchFn: boomFetch(),
        env: { OPENAI_API_KEY: "k" },
        guards,
      }),
    ).rejects.toBeInstanceOf(GuardError);
    expect(getCostReport().entries).toEqual([]);
  });

  test("a failed vendor throws and records no cost", async () => {
    const fetchFn = mockFetch(() => new Response("err", { status: 500 }));
    await expect(
      synthesizeSpeech("hi", {
        vendor: "openai",
        dryRun: false,
        fetchFn,
        env: { OPENAI_API_KEY: "k" },
      }),
    ).rejects.toBeInstanceOf(VendorError);
    expect(getCostReport().entries).toEqual([]);
  });
});

describe("SpeechRouterAdapter", () => {
  test("dispatch previews with a dryrun receipt id", async () => {
    const router = new SpeechRouterAdapter({ fetchFn: boomFetch(), env: {} });
    expect(router.name).toBe("elevenlabs");
    const receipt = await router.dispatch("hello");
    expect(receipt.adapter).toBe("elevenlabs");
    expect(receipt.chars).toBe(5);
    expect(receipt.id.startsWith("dryrun-")).toBe(true);
  });

  test("live dispatch returns a real receipt", async () => {
    const fetchFn = mockFetch(() => new Response("x", { status: 200 }));
    const router = new SpeechRouterAdapter({
      vendor: "openai",
      dryRun: false,
      fetchFn,
      env: { OPENAI_API_KEY: "k" },
    });
    const receipt = await router.dispatch("hi");
    expect(receipt.adapter).toBe("openai");
    expect(receipt.id.startsWith("dryrun-")).toBe(false);
  });
});

describe("DryRunSpeechAdapter", () => {
  test("resolves defaults per vendor", async () => {
    const openai = new DryRunSpeechAdapter("openai");
    expect(await openai.synthesize("hi")).toMatchObject({
      dryRun: true,
      voice: "alloy",
      model: "tts-1",
      mimeType: "audio/mpeg",
    });
    const cartesia = new DryRunSpeechAdapter("cartesia", { voice: "v", model: "m" });
    expect(await cartesia.synthesize("hi", "wav")).toMatchObject({
      dryRun: true,
      voice: "v",
      model: "m",
      mimeType: "audio/wav",
    });
  });
});

describe("listVoices", () => {
  test("lists every vendor by default", () => {
    const voices = listVoices();
    expect(voices).toHaveLength(8);
    expect(voices.filter((voice) => voice.vendor === "openai")).toHaveLength(6);
  });

  test("filters by vendor", () => {
    expect(listVoices("elevenlabs")).toHaveLength(1);
    expect(listVoices("cartesia")[0]).toMatchObject({ vendor: "cartesia" });
  });

  test("unknown vendor throws", () => {
    expect(() => listVoices("acme")).toThrow(/unknown vendor/);
  });
});

describe("pcmToWav", () => {
  test("writes a valid 44-byte header", () => {
    const out = pcmToWav(new Uint8Array([9, 9]), 24000);
    expect(out.length).toBe(46);
    const ascii = (at: number, length: number): string =>
      String.fromCharCode(...out.subarray(at, at + length));
    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    expect(ascii(36, 4)).toBe("data");
    const view = new DataView(out.buffer);
    expect(view.getUint32(4, true)).toBe(38);
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint32(40, true)).toBe(2);
  });
});
