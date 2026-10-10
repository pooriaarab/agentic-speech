# Speech setup

This pack routes text to speech across three vendors. Each vendor
needs its own key. Set the key as an env var before a live render.

## Keys

- ElevenLabs: set `ELEVENLABS_API_KEY`.
- OpenAI: set `OPENAI_API_KEY`.
- Cartesia: set `CARTESIA_API_KEY`.

## Voices

- ElevenLabs defaults to Rachel (`21m00Tcm4TlvDq8ikWAM`).
  Any voice id from your account also works.
- OpenAI defaults to alloy. It also ships echo, fable, onyx,
  nova, and shimmer.
- Cartesia has no fixed list. Set `CARTESIA_VOICE_ID` to the
  voice id from your account, or pass `--voice` per call.

Run `agentic-speech voices` to print the full list.

## Models

- ElevenLabs defaults to `eleven_multilingual_v2`.
- OpenAI defaults to `tts-1`. It also serves `tts-1-hd` and
  `gpt-4o-mini-tts`.
- Cartesia defaults to `sonic-2`.

Pass `--model` to use another model.

## Formats

The pack renders mp3 by default and wav on request. ElevenLabs
wav output arrives as raw PCM, so the adapter wraps it in a
WAV header before it returns the bytes.

## Dry run

Dry run is the default in the SDK, the CLI, the MCP tools,
and the worker. A preview resolves the vendor, the voice, and
the model, then returns empty audio. It calls no vendor and
records no cost. Pass `--live` in the CLI or `dryRun: false`
in code to render for real.
