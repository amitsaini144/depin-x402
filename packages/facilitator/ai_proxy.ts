/**
 * ai_proxy.ts — Gemini proxy route for the DePIN facilitator
 *
 * Flow:
 *   POST /ai  { model, messages, max_tokens }
 *     1. Check X-PAYMENT header (x402 payment token)
 *     2. Verify + settle on-chain via existing settle logic
 *     3. Forward request to Gemini
 *     4. Return AI response (OpenAI-compatible shape) + X-PAYMENT-RESPONSE header
 *
 * Pricing (configurable):
 *   gemini-2.0-flash         → 500 µUSDC per request  (0.0005 USDC)
 *   gemini-2.5-flash-preview → 800 µUSDC per request
 *   gemini-2.5-pro-preview   → 3000 µUSDC per request
 *   default                  → 800 µUSDC per request
 */

import { Router, Request, Response } from "express";
import { GoogleGenerativeAI, Content } from "@google/generative-ai";
import { verifyPayment, settlePayment, PaymentVerification } from "./payment";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.warn("[ai_proxy] GEMINI_API_KEY not set — /ai route will be disabled");
}

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

/** Price in micro-USDC (6 decimals) per model */
const MODEL_PRICES: Record<string, number> = {
  "gemini-2.0-flash":          500,
  "gemini-2.5-flash-preview":  800,
  "gemini-2.5-pro-preview":   3000,
};
const DEFAULT_PRICE = 800; // µUSDC

/** Allowed models — whitelist to prevent abuse */
const ALLOWED_MODELS = new Set(Object.keys(MODEL_PRICES));

/** Max output tokens forwarded to Gemini */
const MAX_TOKENS_CAP = 2048;

// ---------------------------------------------------------------------------
// Message format conversion
// ---------------------------------------------------------------------------

/**
 * Convert OpenAI-style messages to Gemini's Content[] format.
 * Gemini roles: "user" and "model" (not "assistant").
 * System messages are extracted and passed as systemInstruction.
 */
function toGeminiContents(
  messages: { role: string; content: string }[]
): { systemInstruction?: string; contents: Content[] } {
  let systemInstruction: string | undefined;
  const contents: Content[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemInstruction = msg.content;
      continue;
    }
    contents.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    });
  }

  return { systemInstruction, contents };
}

/**
 * Normalize Gemini response to OpenAI-compatible shape so the frontend
 * and client code need zero changes.
 */
function normalizeGeminiResponse(geminiResult: any, model: string): object {
  const text = geminiResult.response.text();
  return {
    id: `gemini-${Date.now()}`,
    object: "chat.completion",
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens:     geminiResult.response.usageMetadata?.promptTokenCount     ?? null,
      completion_tokens: geminiResult.response.usageMetadata?.candidatesTokenCount ?? null,
      total_tokens:      geminiResult.response.usageMetadata?.totalTokenCount      ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Payment requirement builder
// ---------------------------------------------------------------------------

export function buildAiPaymentRequirement(
  model: string,
  facilitatorAddress: string,
  network: "solana-devnet" | "solana-mainnet" = "solana-devnet"
) {
  const amount = MODEL_PRICES[model] ?? DEFAULT_PRICE;

  return {
    scheme: "exact",
    network,
    maxAmountRequired: amount.toString(),
    resource: `ai:${model}`,
    description: `Pay ${amount} µUSDC for one ${model} request`,
    mimeType: "application/json",
    payTo: facilitatorAddress,
    maxTimeoutSeconds: 60,
    asset: process.env.USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    extra: { model, provider: "gemini", pricePerRequest: amount },
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export function createAiProxyRouter(facilitatorWallet: string): Router {
  const router = Router();

  if (!genAI) {
    router.post("/ai", (_req: Request, res: Response) => {
      res.status(503).json({ error: "AI proxy not configured — missing GEMINI_API_KEY" });
    });
    router.get("/ai/models", (_req: Request, res: Response) => {
      res.status(503).json({ error: "AI proxy not configured — missing GEMINI_API_KEY" });
    });
    return router;
  }

  // ── OPTIONS (/ai) — CORS preflight ───────────────────────────────────────
  router.options("/ai", (_req, res) => {
    res.set({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-PAYMENT, Accept",
    });
    res.sendStatus(204);
  });

  // ── GET /ai/models — list available models + pricing ─────────────────────
  router.get("/ai/models", (_req: Request, res: Response) => {
    const models = Object.entries(MODEL_PRICES).map(([id, price]) => ({
      id,
      provider: "gemini",
      pricePerRequest: price,
      currency: "µUSDC",
      description: `${price} µUSDC (${(price / 1_000_000).toFixed(4)} USDC) per request`,
    }));
    res.json({
      models,
      facilitator: facilitatorWallet,
      network: process.env.SOLANA_NETWORK ?? "devnet",
    });
  });

  // ── POST /ai — main proxy endpoint ───────────────────────────────────────
  router.post("/ai", async (req: Request, res: Response) => {
    try {
      const {
        model = "gemini-2.0-flash",
        messages,
        max_tokens,
        stream = false,
      } = req.body ?? {};

      // ── Validate request ────────────────────────────────────────────────
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "messages array is required" });
      }

      if (!ALLOWED_MODELS.has(model)) {
        return res.status(400).json({
          error: `Model '${model}' not supported`,
          allowedModels: [...ALLOWED_MODELS],
        });
      }

      if (stream) {
        return res.status(400).json({
          error: "Streaming not supported with x402 payment",
        });
      }

      const requiredAmount = MODEL_PRICES[model] ?? DEFAULT_PRICE;

      // ── Check payment header ────────────────────────────────────────────
      const paymentHeader = req.headers["x-payment"] as string | undefined;

      if (!paymentHeader) {
        const paymentRequirement = buildAiPaymentRequirement(model, facilitatorWallet);
        return res
          .status(402)
          .set({
            "X-PAYMENT-REQUIRED": JSON.stringify([paymentRequirement]),
            "Content-Type": "application/json",
          })
          .json({
            error: "Payment required",
            paymentRequired: [paymentRequirement],
          });
      }

      // ── Verify payment ──────────────────────────────────────────────────
      let verification: PaymentVerification;
      try {
        verification = await verifyPayment(paymentHeader, {
          requiredAmount,
          resource: `ai:${model}`,
          facilitatorAddress: facilitatorWallet,
        });
      } catch (err: any) {
        return res.status(402).json({
          error: "Payment verification failed",
          details: err.message,
        });
      }

      if (!verification.valid) {
        return res.status(402).json({
          error: "Invalid payment",
          details: verification.invalidReason,
        });
      }

      // ── Settle on-chain ─────────────────────────────────────────────────
      let settlementSig: string;
      try {
        settlementSig = await settlePayment(paymentHeader, verification);
      } catch (err: any) {
        return res.status(402).json({
          error: "Settlement failed",
          details: err.message,
        });
      }

      console.log(
        `[ai_proxy] Settled ${requiredAmount} µUSDC for ${model} | tx: ${settlementSig}`
      );

      // ── Forward to Gemini ────────────────────────────────────────────────
      const { systemInstruction, contents } = toGeminiContents(messages);
      const cappedMaxTokens = Math.min(max_tokens ?? 1024, MAX_TOKENS_CAP);

      const geminiModel = genAI.getGenerativeModel({
        model,
        ...(systemInstruction ? { systemInstruction } : {}),
        generationConfig: { maxOutputTokens: cappedMaxTokens },
      });

      const result = await geminiModel.generateContent({ contents });

      // ── Normalize + return response ──────────────────────────────────────
      const normalized = normalizeGeminiResponse(result, model);

      const responsePayment = {
        settled: true,
        transaction: settlementSig,
        amount: requiredAmount,
        model,
        provider: "gemini",
        network: process.env.SOLANA_NETWORK ?? "devnet",
      };

      return res
        .status(200)
        .set({
          "X-PAYMENT-RESPONSE": JSON.stringify(responsePayment),
          "X-SETTLEMENT-TX": settlementSig,
        })
        .json({
          ...normalized,
          _payment: responsePayment,
        });

    } catch (err: any) {
      console.error("[ai_proxy] Unhandled error:", err);
      return res.status(500).json({
        error: "Internal server error",
        details: err.message,
      });
    }
  });

  return router;
}