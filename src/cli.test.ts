import { describe, expect, test } from "vitest";
import { parseArgs, runCli, UsageError, type CliIo } from "./cli.js";

function testIo(overrides: Partial<CliIo> = {}): CliIo & {
  outLines: string[];
  errLines: string[];
  files: Map<string, Uint8Array>;
} {
  const outLines: string[] = [];
  const errLines: string[] = [];
  const files = new Map<string, Uint8Array>();
  return {
    outLines,
    errLines,
    files,
    out: (line) => outLines.push(line),
    err: (line) => errLines.push(line),
    readFile: (path) => `file:${path}`,
    writeFile: (path, data) => {
      files.set(path, data);
    },
    env: {},
    ...overrides,
  };
}

function okFetch(body: string): typeof fetch {
  return (async () => new Response(body, { status: 200 })) as typeof fetch;
}

describe("parseArgs", () => {
  test("empty args print help", () => {
    expect(parseArgs([]).command).toBe("help");
  });

  test("--version selects version", () => {
    expect(parseArgs(["--version"]).command).toBe("version");
  });

  test("speak takes text and speech flags", () => {
    expect(
      parseArgs([
        "speak",
        "--text",
        "hi",
        "--vendor",
        "openai",
        "--voice",
        "nova",
        "--model",
        "tts-1-hd",
        "--format",
        "wav",
        "--out",
        "a.mp3",
        "--live",
      ]),
    ).toEqual({
      command: "speak",
      text: "hi",
      vendor: "openai",
      voice: "nova",
      model: "tts-1-hd",
      format: "wav",
      out: "a.mp3",
      live: true,
      dryRun: false,
    });
  });

  test("speak previews by default", () => {
    const request = parseArgs(["speak", "--text", "hi"]);
    expect(request.live).toBe(false);
  });

  test("voices takes an optional vendor", () => {
    expect(parseArgs(["voices", "--vendor", "cartesia"]).vendor).toBe("cartesia");
    expect(parseArgs(["voices"]).vendor).toBeUndefined();
  });

  test("unknown command throws UsageError", () => {
    expect(() => parseArgs(["frobnicate"])).toThrow(UsageError);
  });

  test("speak without input throws", () => {
    expect(() => parseArgs(["speak"])).toThrow(/needs --text or --file/);
  });

  test("unknown vendor throws", () => {
    expect(() => parseArgs(["speak", "--text", "hi", "--vendor", "acme"])).toThrow(/unknown vendor/);
  });

  test("bad format throws", () => {
    expect(() => parseArgs(["speak", "--text", "hi", "--format", "ogg"])).toThrow(/--format/);
  });

  test("voices rejects speech flags", () => {
    expect(() => parseArgs(["voices", "--voice", "x"])).toThrow(/unknown flag/);
  });

  test("summary takes text and top", () => {
    expect(parseArgs(["summary", "--text", "hi", "--top", "2"])).toEqual({
      command: "summary",
      text: "hi",
      topN: 2,
      dryRun: false,
      live: false,
    });
  });

  test("dispatch takes vendor and live", () => {
    const request = parseArgs(["dispatch", "--text", "hi", "--vendor", "openai", "--live"]);
    expect(request.vendor).toBe("openai");
    expect(request.live).toBe(true);
  });

  test("bad top value throws", () => {
    expect(() => parseArgs(["summary", "--text", "hi", "--top", "many"])).toThrow(/--top/);
  });
});

describe("runCli", () => {
  test("speak previews with no key and no cost", async () => {
    const io = testIo();
    const code = await runCli(["speak", "--text", "hello"], io);
    expect(code).toBe(0);
    expect(JSON.parse(io.outLines[0])).toMatchObject({
      dryRun: true,
      vendor: "elevenlabs",
      chars: 5,
      audioBase64: "",
    });
    expect(io.files.size).toBe(0);
  });

  test("speak live writes the audio file", async () => {
    const io = testIo({
      fetchFn: okFetch("AUDIOBYTES"),
      env: { OPENAI_API_KEY: "k" },
    });
    const code = await runCli(
      ["speak", "--text", "hi", "--vendor", "openai", "--out", "out.mp3", "--live"],
      io,
    );
    expect(code).toBe(0);
    const meta = JSON.parse(io.outLines[0]);
    expect(meta).toMatchObject({ dryRun: false, vendor: "openai", bytes: 10, out: "out.mp3" });
    expect(meta.audioBase64).toBeUndefined();
    expect(Buffer.from(io.files.get("out.mp3") as Uint8Array).toString()).toBe("AUDIOBYTES");
  });

  test("speak live without --out fails", async () => {
    const io = testIo({ env: { OPENAI_API_KEY: "k" } });
    const code = await runCli(["speak", "--text", "hi", "--vendor", "openai", "--live"], io);
    expect(code).toBe(1);
    expect(io.errLines.join("\n")).toContain("--out");
  });

  test("speak live without a key reports the vendor error", async () => {
    const io = testIo();
    const code = await runCli(
      ["speak", "--text", "hi", "--vendor", "openai", "--out", "o.mp3", "--live"],
      io,
    );
    expect(code).toBe(1);
    expect(io.errLines.join("\n")).toContain("OPENAI_API_KEY");
  });

  test("voices prints the voice list", async () => {
    const io = testIo();
    const code = await runCli(["voices"], io);
    expect(code).toBe(0);
    expect(JSON.parse(io.outLines[0])).toHaveLength(8);
  });

  test("voices filters by vendor", async () => {
    const io = testIo();
    const code = await runCli(["voices", "--vendor", "openai"], io);
    expect(code).toBe(0);
    expect(JSON.parse(io.outLines[0])).toHaveLength(6);
  });

  test("summary prints JSON stats", async () => {
    const io = testIo();
    const code = await runCli(["summary", "--text", "hello world hello"], io);
    expect(code).toBe(0);
    expect(JSON.parse(io.outLines[0])).toMatchObject({ words: 3 });
  });

  test("dispatch previews by default", async () => {
    const io = testIo();
    const code = await runCli(["dispatch", "--text", "hi"], io);
    expect(code).toBe(0);
    expect(JSON.parse(io.outLines[0])).toMatchObject({ dryRun: true, chars: 2 });
  });

  test("dispatch live routes through the vendor", async () => {
    const io = testIo({ fetchFn: okFetch("x"), env: { OPENAI_API_KEY: "k" } });
    const code = await runCli(["dispatch", "--text", "hi", "--vendor", "openai", "--live"], io);
    expect(code).toBe(0);
    expect(JSON.parse(io.outLines[0])).toMatchObject({ dryRun: false, adapter: "openai" });
  });

  test("costs prints the report", async () => {
    const io = testIo();
    const code = await runCli(["costs"], io);
    expect(code).toBe(0);
    expect(JSON.parse(io.outLines[0])).toHaveProperty("entries");
  });

  test("missing input file reports not found", async () => {
    const io = testIo({
      readFile: () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
    });
    const code = await runCli(["summary", "--file", "gone.txt"], io);
    expect(code).toBe(1);
    expect(io.errLines.join("\n")).toContain("gone.txt");
  });

  test("bad usage exits 2", async () => {
    const io = testIo();
    const code = await runCli(["bogus"], io);
    expect(code).toBe(2);
    expect(io.errLines.length).toBeGreaterThan(0);
  });

  test("version prints a version string", async () => {
    const io = testIo();
    const code = await runCli(["--version"], io);
    expect(code).toBe(0);
    expect(io.outLines[0]).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
