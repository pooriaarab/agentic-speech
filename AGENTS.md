# agentic-speech agent guide

Route text to speech across ElevenLabs, OpenAI, and Cartesia.

## Mental model

Text goes in. Audio or a route preview comes out. One router serves
all three faces, so each face returns the same shape.

## The three faces

- SDK: `import { synthesizeSpeech } from "agentic-speech"`.
- CLI: `npx agentic-speech speak --text "..."`.
- MCP: `npx agentic-speech mcp`, then call a tool below.

Keywords: text-to-speech, elevenlabs, agentic-suite, claude-code, codex, cli, mcp.

## MCP tools

| Tool | Use it for |
| --- | --- |
| synthesize_speech | Render or preview speech. Dry runs by default. |
| list_voices | List vendor voices. |
| summarize_text | Count chars, words, lines, top words. |
| dispatch_text | Route one text. Pass dryRun false to render. |
| get_cost_report | Read session cost totals. |

## The loop

1. Discover the tools with `tools/list`.
2. Preview speech with `synthesize_speech` and dryRun true.
3. Check the vendor, voice, and char count in the preview.
4. Render for real with dryRun false when the preview looks right.
5. Read `get_cost_report` and state the cost.

## Rules

- Preview with dry run before each live render.
- Stop when a guard denies the call. State the reason.
- Never retry a denied call with changed text to dodge a guard.
- Report adapter errors as errors. Never present them as success.
- State the cost report before you claim the task is done.
