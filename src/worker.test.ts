import { describe, expect, test } from "vitest";
import worker from "./worker.js";

describe("worker", () => {
  test("GET /health reports ok", async () => {
    const response = await worker.fetch(new Request("https://pack.test/health"), {
      PACK_NAME: "probe",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, pack: "probe" });
  });

  test("POST /summarize returns stats", async () => {
    const response = await worker.fetch(
      new Request("https://pack.test/summarize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "one two two" }),
      }),
      {},
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ words: 3 });
  });

  test("POST /summarize rejects a bad body", async () => {
    const response = await worker.fetch(
      new Request("https://pack.test/summarize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: 42 }),
      }),
      {},
    );
    expect(response.status).toBe(400);
  });

  test("POST /speak previews by default", async () => {
    const response = await worker.fetch(
      new Request("https://pack.test/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hello" }),
      }),
      {},
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ dryRun: true, vendor: "elevenlabs" });
  });

  test("POST /speak rejects a bad format", async () => {
    const response = await worker.fetch(
      new Request("https://pack.test/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hi", format: "ogg" }),
      }),
      {},
    );
    expect(response.status).toBe(400);
  });

  test("POST /speak reports a vendor failure as 502", async () => {
    const response = await worker.fetch(
      new Request("https://pack.test/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hi", vendor: "openai", dryRun: false }),
      }),
      {},
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("OPENAI_API_KEY") });
  });

  test("unknown routes return 404", async () => {
    const response = await worker.fetch(new Request("https://pack.test/nowhere"), {});
    expect(response.status).toBe(404);
  });
});
