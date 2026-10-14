# agentic-speech

[![npm version](https://img.shields.io/npm/v/agentic-speech)](https://www.npmjs.com/package/agentic-speech) [![Downloads/month](https://img.shields.io/npm/dm/agentic-speech)](https://www.npmjs.com/package/agentic-speech) [![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://opensource.org/license/mit)

agentic-speech is an open-source TypeScript text-to-speech wrapper that routes speech requests to ElevenLabs, OpenAI, or Cartesia.

## Install

```sh
npm install agentic-speech
```

Requires Node.js 18 or later. Includes TypeScript declarations and three runtime dependencies.

## Preview your first speech request

```sh
npx agentic-speech speak --text "Hello"
```

Expect JSON with `"dryRun":true`, `"vendor":"elevenlabs"`, `"chars":5`, and `"bytes":0`.
Previews need no key, make no vendor call, and return empty audio.

To render, export the vendor key and pass `--live`:

```sh
export ELEVENLABS_API_KEY="your-key"
npx agentic-speech speak --text "Hello" --out hello.mp3 --live
```

A successful render writes `hello.mp3` and prints metadata with `dryRun: false` and the byte count.
The package reads exported variables; it does not load `.env` files.

## Features and coverage

- Return MP3 or WAV audio as base64; the CLI writes decoded bytes with `--out`.
- Select vendor, voice, and model; ElevenLabs is the default vendor.
- Inject guards, logging, and fetch into library synthesis calls.
- Record successful live synthesis usage by vendor and character count.

| Integration | Adapter | Key | Default model / voice |
| --- | --- | --- | --- |
| ElevenLabs | Implemented | `ELEVENLABS_API_KEY` | `eleven_multilingual_v2` / Rachel |
| OpenAI | Implemented | `OPENAI_API_KEY` | `tts-1` / `alloy` |
| Cartesia | Implemented | `CARTESIA_API_KEY` | `sonic-2` / caller supplies voice |

Three HTTP adapters exist. Tests use fixtures; this rewrite does not verify live credentials or current vendor model availability.
Cartesia requires `CARTESIA_VOICE_ID` or `--voice`. `voices` returns a static list, including an account-voice placeholder for Cartesia.

## Runtime surfaces

```js
import { synthesizeSpeech, getCostReport } from "agentic-speech";
const preview = await synthesizeSpeech("Hello", { vendor: "openai" });
console.log(preview.bytes); // 0
console.log(getCostReport()); // Session usage; previews add no entries.
```

CLI commands: `speak`, `voices`, `summary`, `dispatch`, `costs`, and `mcp`; flags include `--help` and `--version`.
`speak`, `summary`, and `dispatch` accept `--text` or `--file`; `speak --live` requires `--out`.
`speak` accepts `--vendor`, `--voice`, `--model`, and `--format mp3|wav`; `voices` accepts `--vendor`.
`summary` accepts `--top`; `dispatch` accepts `--vendor`, `--voice`, and `--live`, and returns a receipt rather than audio.
Start the Model Context Protocol (MCP) server with `npx agentic-speech mcp` or `npx agentic-speech-mcp`.
Its five tools are `synthesize_speech`, `list_voices`, `summarize_text`, `dispatch_text`, and `get_cost_report`.
The self-hosted Worker source handles `GET /health`, `POST /summarize`, and `POST /speak`; deployment requires runtime compatibility validation.

## Behavior limits

Synthesis defaults to dry run; use `dryRun: false` in library calls, MCP tools, or Worker JSON for live synthesis.
HTTP requests default to a 30-second timeout and have no automatic retry or vendor failover.
Audio is buffered in memory. There is no streaming speech interface or managed speech service.
Cost reports are process-local usage records, not vendor invoices; a separate CLI `costs` process cannot recover earlier runs.
Guards apply when supplied; the default CLI and Worker do not configure caps or quiet hours.
Version 0.1.x interfaces can change. No public case studies are published in this repository.

## Links and license

[Package](https://www.npmjs.com/package/agentic-speech) · [ElevenLabs](https://elevenlabs.io/) · [OpenAI](https://openai.com/) · [Cartesia](https://cartesia.ai/)

MIT license.
