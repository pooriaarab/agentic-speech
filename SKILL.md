---
name: agentic-speech
description: Route text to speech across ElevenLabs, OpenAI, and Cartesia. Keywords: text-to-speech, elevenlabs, agentic-suite, claude-code, codex, cli, mcp.
---

# agentic-speech

Route text to speech across ElevenLabs, OpenAI, and Cartesia.

## Use the SDK

```js
import { synthesizeSpeech, listVoices } from "agentic-speech";

await synthesizeSpeech("some text");
listVoices("openai");
```

## Use the CLI

```sh
agentic-speech speak --text "some text"
agentic-speech voices --vendor openai
```

## Use the MCP server

Start the server with `agentic-speech mcp`. Call `synthesize_speech`
for speech, `list_voices` for voices, `get_cost_report` for costs.

## Rules

- Preview each render with dry run first.
- Report guard denials and adapter errors as failures.
- Read the cost report at the end.
