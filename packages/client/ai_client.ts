/**
 * packages/client/ai_client.ts
 *
 * Demonstrates the full "pay USDC → get AI response" flow.
 *
 * Usage:
 *   PAYER_PRIVATE_KEY=<base58> npx ts-node packages/client/ai_client.ts
 *
 * What happens:
 *   1. POST /ai without payment  → 402 + payment requirements
 *   2. Build + sign x402 payment token
 *   3. POST /ai with X-PAYMENT  → AI response + settlement tx
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";
import fetch from "node-fetch";
import * as crypto from "node:crypto";
import dotenv from "dotenv";

dotenv.config();

// ── Config ─────────────────────────────────────────────────────────────────

const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://localhost:4000";
const RPC_URL =
  process.env.HELIUS_RPC_URL ??
  process.env.SOLANA_RPC_URL ??
  "https://api.devnet.solana.com";

const USDC_MINT = new PublicKey(
  process.env.USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

// ── Load payer wallet ──────────────────────────────────────────────────────

function loadPayer(): Keypair {
  const key = process.env.PAYER_PRIVATE_KEY;
  if (!key) {
    throw new Error(
      "Set PAYER_PRIVATE_KEY env var to a base58 devnet wallet with some USDC"
    );
  }
  return Keypair.fromSecretKey(bs58.decode(key));
}

// ── Build x402 payment token ───────────────────────────────────────────────

/**
 * The x402 payment header is a base64-encoded JSON object.
 * We construct a "proof of intent" signed with the payer's keypair.
 *
 * NOTE: In production, the payer would send a real USDC SPL transfer.
 * For the devnet demo, we encode the transaction signature of the transfer.
 */
async function buildPaymentHeader(
  payer: Keypair,
  facilitatorAddress: string,
  amount: number,
  model: string,
  connection: Connection
): Promise<string> {
  // Generate unique nonce
  const nonce = crypto.randomBytes(16).toString("hex");

  // Build the SPL token transfer (USDC from payer → facilitator)
  const payerUSDC = await getAssociatedTokenAddress(USDC_MINT, payer.publicKey);
  const facilitatorPubkey = new PublicKey(facilitatorAddress);
  const facilitatorUSDC = await getAssociatedTokenAddress(
    USDC_MINT,
    facilitatorPubkey
  );

  const tx = new Transaction().add(
    createTransferInstruction(
      payerUSDC,
      facilitatorUSDC,
      payer.publicKey,
      amount,
      [],
      TOKEN_PROGRAM_ID
    )
  );

  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer.publicKey;

  console.log(
    `[client] Sending ${amount} µUSDC (${amount / 1_000_000} USDC) to facilitator...`
  );
  const txSig = await sendAndConfirmTransaction(connection, tx, [payer]);
  console.log(`[client] USDC transfer confirmed: ${txSig}`);

  // Build the x402 payload
  const payload = {
    scheme: "exact",
    network: "solana-devnet",
    payload: {
      signature: txSig,
      payer: payer.publicKey.toBase58(),
      amount,
      nonce,
      resource: `ai:${model}`,
    },
  };

  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const payer = loadPayer();

  const model = process.argv[2] ?? "gemini-2.0-flash";
  const prompt = process.argv.slice(3).join(" ") || "Explain DePIN in one sentence.";

  console.log(`\n[ai_client] DePIN x402 AI Client`);
  console.log(`  Payer     : ${payer.publicKey.toBase58()}`);
  console.log(`  Model     : ${model}`);
  console.log(`  Prompt    : "${prompt}"`);
  console.log(`  Endpoint  : ${FACILITATOR_URL}/ai\n`);

  // ── Step 1: Hit /ai without payment (expect 402) ────────────────────────
  console.log("[client] Step 1: Requesting AI (no payment)...");
  const firstRes = await fetch(`${FACILITATOR_URL}/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
  });

  if (firstRes.status !== 402) {
    console.error(`[client] Expected 402, got ${firstRes.status}`);
    process.exit(1);
  }

  const paymentReqs = await firstRes.json();
  const req = paymentReqs.paymentRequired?.[0];
  if (!req) {
    console.error("[client] No payment requirements in 402 response", paymentReqs);
    process.exit(1);
  }

  const amount = parseInt(req.maxAmountRequired);
  const facilitatorAddress = req.payTo;

  console.log(`[client] 402 received — need ${amount} µUSDC → ${facilitatorAddress}`);

  // ── Step 2: Build payment token ─────────────────────────────────────────
  console.log("\n[client] Step 2: Building x402 payment...");
  const paymentHeader = await buildPaymentHeader(
    payer,
    facilitatorAddress,
    amount,
    model,
    connection
  );

  // ── Step 3: Retry with payment ───────────────────────────────────────────
  console.log("\n[client] Step 3: Sending request with X-PAYMENT header...");
  const paidRes = await fetch(`${FACILITATOR_URL}/ai`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-PAYMENT": paymentHeader,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 512,
    }),
  });

  if (!paidRes.ok) {
    const err = await paidRes.json();
    console.error(`[client] Request failed (${paidRes.status}):`, err);
    process.exit(1);
  }

  const response = await paidRes.json();

  // ── Print result ─────────────────────────────────────────────────────────
  const settlementTx = paidRes.headers.get("X-SETTLEMENT-TX") ?? response._payment?.transaction;
  const aiContent = response.choices?.[0]?.message?.content ?? "(no content)";

  console.log("\n" + "═".repeat(60));
  console.log("AI Response:");
  console.log("═".repeat(60));
  console.log(aiContent);
  console.log("═".repeat(60));
  console.log(`\n✓ Paid       : ${amount} µUSDC (${amount / 1_000_000} USDC)`);
  console.log(`✓ Model      : ${model}`);
  console.log(`✓ Settlement : ${settlementTx}`);
  console.log(
    `✓ Explorer   : https://explorer.solana.com/tx/${settlementTx}?cluster=devnet\n`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});