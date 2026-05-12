/**
 * payment.ts — Shared payment verification + settlement logic
 *
 * Extracted from index.ts so ai_proxy.ts and the original /settle route
 * both use the same battle-tested code path.
 *
 * The actual on-chain settlement calls your existing Anchor program via
 * the same wallet/provider setup already in index.ts — we just export
 * the pieces here so they can be imported by ai_proxy.ts.
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import bs58 from "bs58";
import settlementIdl from "./idl/settlement_program.json";
import registryIdl from "./idl/operator_registry.json";
import dotenv from "dotenv";

dotenv.config();


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaymentVerification {
  valid: boolean;
  invalidReason?: string;
  payer: string;
  amount: number;
  nonce: string;
  signature: string;
  resource: string;
}

export interface VerifyOptions {
  requiredAmount: number;
  resource: string;
  facilitatorAddress: string;
}

// ---------------------------------------------------------------------------
// Singleton connection + provider (mirrors index.ts setup)
// ---------------------------------------------------------------------------

const RPC_URL =
  process.env.HELIUS_RPC_URL ??
  process.env.SOLANA_RPC_URL ??
  "https://api.devnet.solana.com";

export const connection = new Connection(RPC_URL, "confirmed");

function loadWallet(): Keypair {
  const key = process.env.OPERATOR_PRIVATE_KEY;

  if (!key) {
    throw new Error("OPERATOR_PRIVATE_KEY env var not set");
  }

  const secretKey = Uint8Array.from(JSON.parse(key));

  console.log("secretKey", secretKey);

  return Keypair.fromSecretKey(secretKey);
}

export const operatorKeypair = loadWallet();

export function getProvider(): AnchorProvider {
  const wallet = new anchor.Wallet(operatorKeypair);
  return new AnchorProvider(connection, wallet, { commitment: "confirmed" });
}

export function getSettlementProgram(): Program {
  return new Program(settlementIdl as any, getProvider());
}

export function getRegistryProgram(): Program {
  return new Program(registryIdl as any, getProvider());
}

// ---------------------------------------------------------------------------
// PDAs
// ---------------------------------------------------------------------------

const SETTLEMENT_PROGRAM_ID = new PublicKey(
  process.env.SETTLEMENT_PROGRAM_ID ?? "Hzg2MGHMMoVDgA5X5v5r4XwMKyZAwUyZuYfMAtUg6whV"
);

export function getPaymentReceiptPDA(nonce: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), Buffer.from(nonce)],
    SETTLEMENT_PROGRAM_ID
  );
}

export function getOperatorStatsPDA(
  operator: PublicKey,
  epoch: BN
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stats"), operator.toBuffer(), epoch.toArrayLike(Buffer, "le", 8)],
    SETTLEMENT_PROGRAM_ID
  );
}

// ---------------------------------------------------------------------------
// Payment header parsing
// ---------------------------------------------------------------------------

/**
 * The X-PAYMENT header is a base64-encoded JSON payload signed by the payer.
 *
 * Schema (matches x402 spec):
 * {
 *   scheme: "exact",
 *   network: "solana-devnet" | "solana-mainnet",
 *   payload: {
 *     signature: string,   // base58 Solana tx signature OR EIP-712 sig
 *     payer:     string,   // payer pubkey
 *     amount:    number,   // µUSDC
 *     nonce:     string,   // unique per payment
 *     resource:  string,   // what was bought
 *   }
 * }
 */
export function parsePaymentHeader(header: string): {
  scheme: string;
  network: string;
  payload: {
    signature: string;
    payer: string;
    amount: number;
    nonce: string;
    resource: string;
  };
} {
  try {
    const decoded = Buffer.from(header, "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch {
    // Try raw JSON (some clients don't base64-encode)
    try {
      return JSON.parse(header);
    } catch {
      throw new Error("Malformed X-PAYMENT header — expected base64 or JSON");
    }
  }
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

export async function verifyPayment(
  paymentHeader: string,
  opts: VerifyOptions
): Promise<PaymentVerification> {
  const parsed = parsePaymentHeader(paymentHeader);

  const { payload } = parsed;

  // Amount check
  if (payload.amount < opts.requiredAmount) {
    return {
      valid: false,
      invalidReason: `Insufficient amount: got ${payload.amount}, need ${opts.requiredAmount}`,
      payer: payload.payer,
      amount: payload.amount,
      nonce: payload.nonce,
      signature: payload.signature,
      resource: payload.resource,
    };
  }

  // Resource check (optional — resource field in payload must match what we expect)
  if (payload.resource && payload.resource !== opts.resource) {
    return {
      valid: false,
      invalidReason: `Resource mismatch: got '${payload.resource}', expected '${opts.resource}'`,
      payer: payload.payer,
      amount: payload.amount,
      nonce: payload.nonce,
      signature: payload.signature,
      resource: payload.resource,
    };
  }

  // Check for duplicate nonce (receipt PDA already exists)
  const [receiptPDA] = getPaymentReceiptPDA(payload.nonce);
  const receiptAccount = await connection.getAccountInfo(receiptPDA);
  if (receiptAccount !== null) {
    return {
      valid: false,
      invalidReason: `Nonce '${payload.nonce}' already settled (replay detected)`,
      payer: payload.payer,
      amount: payload.amount,
      nonce: payload.nonce,
      signature: payload.signature,
      resource: payload.resource,
    };
  }

  return {
    valid: true,
    payer: payload.payer,
    amount: payload.amount,
    nonce: payload.nonce,
    signature: payload.signature,
    resource: payload.resource,
  };
}

// ---------------------------------------------------------------------------
// Settle
// ---------------------------------------------------------------------------

export async function settlePayment(
  paymentHeader: string,
  verification: PaymentVerification
): Promise<string> {
  if (!verification.valid) {
    throw new Error("Cannot settle invalid payment");
  }

  const program = getSettlementProgram();
  const provider = getProvider();

  const USDC_MINT = new PublicKey(
    process.env.USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
  );

  const payer = new PublicKey(verification.payer);
  const [receiptPDA] = getPaymentReceiptPDA(verification.nonce);

  // Derive epoch (unix timestamp / epoch_duration)
  const EPOCH_DURATION = parseInt(process.env.EPOCH_DURATION ?? "3600");
  const currentEpoch = Math.floor(Date.now() / 1000 / EPOCH_DURATION);
  const epochBN = new BN(currentEpoch);

  const [statsPDA] = getOperatorStatsPDA(operatorKeypair.publicKey, epochBN);

  const tx = await (program.methods as any)
    .settle(
      verification.nonce,
      new BN(verification.amount),
      epochBN
    )
    .accounts({
      operator: operatorKeypair.publicKey,
      payer,
      receipt: receiptPDA,
      operatorStats: statsPDA,
      usdcMint: USDC_MINT,
      systemProgram: anchor.web3.SystemProgram.programId,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
    })
    .signers([operatorKeypair])
    .rpc();

  return tx;
}