#!/usr/bin/env ts-node
/**
 * packages/client/test_ai_proxy.ts
 *
 * Integration smoke test for the /ai route.
 * Tests:
 *   1. GET /health               — facilitator is up + AI enabled
 *   2. GET /ai/models            — returns model list with pricing
 *   3. POST /ai (no payment)     — returns 402 with requirements
 *   4. POST /ai (bad payment)    — returns 402 with error
 *   5. (Manual) Full flow        — skipped without real wallet; see ai_client.ts
 *
 * Usage: npx ts-node packages/client/test_ai_proxy.ts
 */

import fetch from "node-fetch";

const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://localhost:4000";

// ── Helpers ────────────────────────────────────────────────────────────────

const pass = (label: string) => console.log(`  ✓ ${label}`);
const fail = (label: string, detail?: any) => {
  console.error(`  ✗ ${label}`, detail ?? "");
  process.exitCode = 1;
};

async function test(
  name: string,
  fn: () => Promise<void>
): Promise<void> {
  try {
    await fn();
  } catch (err: any) {
    fail(name, err.message);
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nDePIN x402 AI Proxy Smoke Tests`);
  console.log(`Facilitator: ${FACILITATOR_URL}\n`);

  // 1. Health
  await test("GET /health — facilitator is running", async () => {
    const res = await fetch(`${FACILITATOR_URL}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json() as any;
    if (body.status !== "ok") throw new Error("status not ok");
    pass(`/health OK — AI proxy ${body.aiProxy ? "enabled ✓" : "disabled (set GEMINI_API_KEY)"}`);
  });

  // 2. Model list
  await test("GET /ai/models — returns model list", async () => {
    const res = await fetch(`${FACILITATOR_URL}/ai/models`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json() as any;
    if (!Array.isArray(body.models)) throw new Error("no models array");
    pass(`/ai/models — ${body.models.length} models available`);
    for (const m of body.models) {
      console.log(`    ${m.id.padEnd(20)} ${m.pricePerRequest} µUSDC`);
    }
  });

  // 3. 402 on missing payment
  await test("POST /ai (no X-PAYMENT) — returns 402", async () => {
    const res = await fetch(`${FACILITATOR_URL}/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    if (res.status !== 402) throw new Error(`Expected 402, got ${res.status}`);
    const body = await res.json() as any;
    if (!body.paymentRequired) throw new Error("no paymentRequired in 402 body");
    const req = body.paymentRequired[0];
    pass(`/ai → 402 — need ${req.maxAmountRequired} µUSDC → ${req.payTo?.slice(0, 8)}…`);
  });

  // 4. 400 on bad model
  await test("POST /ai (invalid model) — returns 400", async () => {
    const res = await fetch(`${FACILITATOR_URL}/ai`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PAYMENT": "fake",
      },
      body: JSON.stringify({
        model: "claude-3-opus", // not in whitelist
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    pass("/ai with invalid model → 400 ✓");
  });

  // 5. 402 on malformed payment header
  await test("POST /ai (malformed X-PAYMENT) — returns 402", async () => {
    const res = await fetch(`${FACILITATOR_URL}/ai`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PAYMENT": "this_is_not_valid_base64_payment",
      },
      body: JSON.stringify({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    if (res.status !== 402) throw new Error(`Expected 402, got ${res.status}`);
    pass("/ai with bad X-PAYMENT → 402 ✓");
  });

  // 6. Streaming rejection
  await test("POST /ai (stream=true) — returns 400", async () => {
    const res = await fetch(`${FACILITATOR_URL}/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "hello" }],
        stream: true,
      }),
    });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    pass("/ai with stream=true → 400 (streaming not supported) ✓");
  });

  console.log("\n─────────────────────────────────────────────────");
  if (process.exitCode === 1) {
    console.log("Some tests FAILED — check output above");
  } else {
    console.log("All smoke tests passed ✓");
    console.log("\nFor the full paid flow:");
    console.log("  PAYER_PRIVATE_KEY=<key> npx ts-node packages/client/ai_client.ts gemini-2.0-flash 'What is DePIN?'");
  }
  console.log("─────────────────────────────────────────────────\n");
}

main();