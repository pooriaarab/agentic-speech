# agentic-speech

Route text to speech across ElevenLabs, OpenAI, and Cartesia.

## Install

```sh
npm i agentic-speech
```

## Quick start

Preview a route. The preview calls no vendor and needs no key.

```sh
npx agentic-speech speak --text "Hello from the pack"
```

List the voices each vendor ships.

```sh
npx agentic-speech voices
```

Render for real. Set the vendor key first, then pass --live.

```sh
export OPENAI_API_KEY="your-key"
npx agentic-speech speak --text "Hello for real" --vendor openai --out hello.mp3 --live
```

## Use cases

- Narrate an article to an mp3 file.
- Give a script a spoken voice for prompts and alerts.
- Preview voice output in dry run mode before you spend.

## The three faces

Use the SDK in code.

```js
import { synthesizeSpeech } from "agentic-speech";

const preview = await synthesizeSpeech("Hello");
const live = await synthesizeSpeech("Hello", {
  vendor: "openai",
  dryRun: false,
  apiKey: process.env.OPENAI_API_KEY,
});
```

Use the CLI in a terminal.

```sh
agentic-speech speak --text "Hello" --vendor openai --out hello.mp3 --live
```

Use the MCP server from an agent.

```sh
agentic-speech mcp
```

Then call `synthesize_speech`.

## Commands

- `speak` renders text. It previews by default. Add `--live`
  and `--out` to render for real.
- `voices` lists voices. Add `--vendor` to filter.
- `summary` prints text stats as JSON.
- `dispatch` routes one text and prints the receipt.
- `costs` prints the session cost report as JSON.
- `mcp` starts the MCP server on stdio.

Run `agentic-speech --help` for flags.

## Vendors and keys

| Vendor | Key | Default voice |
| --- | --- | --- |
| elevenlabs | ELEVENLABS_API_KEY | Rachel |
| openai | OPENAI_API_KEY | alloy |
| cartesia | CARTESIA_API_KEY | none, set CARTESIA_VOICE_ID |

The router defaults to elevenlabs. Dry run mode is the default
everywhere: previews spend nothing and need no key.

## MCP tools

| Tool | Use it for |
| --- | --- |
| synthesize_speech | Render or preview speech. |
| list_voices | List vendor voices. |
| summarize_text | Count chars, words, and lines. |
| dispatch_text | Route one text through the router. |
| get_cost_report | Read session cost totals. |

## Cost report

Each live render records one entry with the vendor and the
char count. Dry runs record nothing. Read the report with
`agentic-speech costs` or `get_cost_report`.

## License

MIT
