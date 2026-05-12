/**
 * packages/facilitator/index.ts
 *
 * Express server on :4000
 * Routes:
 *   GET  /supported          — list supported assets + networks
 *   POST /verify             — verify x402 payment header
 *   POST /settle             — settle payment on-chain
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

// ── Constants ──────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? process.env.FACILITATOR_PORT ?? "4000");
const OPERATOR_ADDRESS =
  process.env.OPERATOR_ADDRESS ?? "C9rwmkp5HC4XyhZDwJ7h39tDwVyv8CqRzEJvpzQFPV1L";
const USDC_MINT =
  process.env.USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const SOLANA_NETWORK = process.env.SOLANA_NETWORK ?? "devnet";

// ── App ────────────────────────────────────────────────────────────────────

const app = express();

app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"] }));
app.use(express.json({ limit: "1mb" }));

// ── Health ─────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    operator: OPERATOR_ADDRESS,
    network: SOLANA_NETWORK,
    ts: new Date().toISOString(),
  });
});

// ── Supported assets ───────────────────────────────────────────────────────

app.get("/supported", (_req, res) => {
  res.json({
    supportedAssets: [
      {
        network: `solana-${SOLANA_NETWORK}`,
        asset: USDC_MINT,
        symbol: "USDC",
        decimals: 6,
      },
    ],
    facilitator: OPERATOR_ADDRESS,
  });
});

// ── Verify ─────────────────────────────────────────────────────────────────

app.post("/verify", async (req, res) => {
  try {
    const { payment, requiredAmount = 0, resource = "*" } = req.body;
    if (!payment) return res.status(400).json({ error: "payment required" });

    const { verifyPayment } = await import("./payment");
    const result = await verifyPayment(payment, {
      requiredAmount,
      resource,
      facilitatorAddress: OPERATOR_ADDRESS,
    });

    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── Settle ─────────────────────────────────────────────────────────────────

app.post("/settle", async (req, res) => {
  try {
    const { payment, requiredAmount = 0, resource = "data" } = req.body;
    if (!payment) return res.status(400).json({ error: "payment required" });

    const { verifyPayment, settlePayment } = await import("./payment");

    const verification = await verifyPayment(payment, {
      requiredAmount,
      resource,
      facilitatorAddress: OPERATOR_ADDRESS,
    });

    if (!verification.valid) {
      return res.status(402).json({ error: verification.invalidReason });
    }

    const txSig = await settlePayment(payment, verification);
    res.json({ success: true, transaction: txSig });
  } catch (err: any) {
    console.error("[settle]", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n[facilitator] Listening on :${PORT}`);
  console.log(`  Operator : ${OPERATOR_ADDRESS}`);
  console.log(`  Network  : ${SOLANA_NETWORK}`);
  console.log(`  Routes   : GET /supported, POST /verify, POST /settle\n`);
});