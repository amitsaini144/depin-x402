/**
 * payment.ts — Updated for X402 Depin Pay-As-You-Go (Trustless SPL Transfer)
 */

import dotenv from "dotenv";
dotenv.config();

import {
  Connection,
  PublicKey,
  Keypair,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import bs58 from "bs58";
import settlementIdl from "./idl/settlement_program.json";
import registryIdl from "./idl/operator_registry.json";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaymentVerification {
  valid: boolean;
  invalidReason?: string;
  payer: string;
  amount: number;
  nonce: string;
  signature: string;     // SPL transfer tx signature
  resource: string;
}

export interface VerifyOptions {
  requiredAmount: number;
  resource: string;
  facilitatorAddress: string;
}

// ---------------------------------------------------------------------------
// Connection + Provider
// ---------------------------------------------------------------------------

const RPC_URL = process.env.HELIUS_RPC_URL!;
export const connection = new Connection(RPC_URL, "confirmed");

function loadWallet(): Keypair {
  const key = process.env.OPERATOR_PRIVATE_KEY!;
  const secretKey = Uint8Array.from(JSON.parse(key));
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

// ---------------------------------------------------------------------------
// PDAs
// ---------------------------------------------------------------------------

const SETTLEMENT_PROGRAM_ID = new PublicKey(
  process.env.SETTLEMENT_PROGRAM_ID ?? "Hzg2MGHMMoVDgA5X5v5r4XwMKyZAwUyZuYfMAtUg6whV"
);

export function getPaymentReceiptPDA(
  nonce: string,
  payer: PublicKey
): [PublicKey, number] {
  const nonceBytes = Buffer.from(nonce, "hex").slice(0, 8);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), payer.toBuffer(), nonceBytes],
    SETTLEMENT_PROGRAM_ID
  );
}

// ---------------------------------------------------------------------------
// Header Parsing (unchanged)
// ---------------------------------------------------------------------------

export function parsePaymentHeader(header: string) {
  try {
    const decoded = Buffer.from(header, "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch {
    return JSON.parse(header);
  }
}

// ---------------------------------------------------------------------------
// Verify SPL USDC Transfer (Fixed + Detailed Logs)
// ---------------------------------------------------------------------------

async function verifySplTransfer(
  signature: string, 
  payer: PublicKey, 
  expectedAmount: number
): Promise<boolean> {

  const tx = await connection.getParsedTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  if (!tx) {
    return false;
  }
  if (tx.meta?.err) {
    return false;
  }

  const usdcMint = new PublicKey(process.env.USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
  const operatorAta = await getAssociatedTokenAddress(usdcMint, operatorKeypair.publicKey);

  // Fixed parsing with proper type check
  for (const ix of tx.transaction.message.instructions) {
    if ("parsed" in ix && ix.program === "spl-token") {
      const parsed = (ix as any).parsed;

      if (parsed?.type === "transfer") {
        const info = parsed.info;
        if (
          info.destination === operatorAta.toBase58() &&
          Number(info.amount) === expectedAmount
        ) {
          return true;
        }
      }
    }
  }

  console.error(`[verifySpl] No matching transfer to operator ATA`);
  return false;
}

// ---------------------------------------------------------------------------
// Verify Payment (Updated)
// ---------------------------------------------------------------------------

export async function verifyPayment(
  paymentHeader: string,
  opts: VerifyOptions
): Promise<PaymentVerification> {
  try {
    const parsed = parsePaymentHeader(paymentHeader);
    const { payload } = parsed;
    const payerPubkey = new PublicKey(payload.payer);

    console.log(`[verify] Received payment from ${payload.payer}, amount=${payload.amount}, nonce=${payload.nonce}`);

    // Amount check
    if (payload.amount < opts.requiredAmount) {
      return { valid: false, invalidReason: `Insufficient amount`, ...payload };
    }

    // Duplicate check
    const [receiptPDA] = getPaymentReceiptPDA(payload.nonce, payerPubkey);
    if (await connection.getAccountInfo(receiptPDA)) {
      return { valid: false, invalidReason: `Nonce already settled`, ...payload };
    }

    // Critical: Verify SPL Transfer
    const transferValid = await verifySplTransfer(payload.signature, payerPubkey, payload.amount);
    
    if (!transferValid) {
      return { valid: false, invalidReason: `Invalid or missing USDC transfer to operator`, ...payload };
    }

    console.log(`[verify] Payment fully verified!`);
    return { valid: true, ...payload };

  } catch (err: any) {
    return { valid: false, invalidReason: err.message, ...{payer:"", amount:0, nonce:"", signature:"", resource:""} };
  }
}

// ---------------------------------------------------------------------------
// Settle Payment (Updated — uses record_payment)
// ---------------------------------------------------------------------------

export async function settlePayment(
  paymentHeader: string,
  verification: PaymentVerification
): Promise<string> {
  if (!verification.valid) throw new Error("Cannot settle invalid payment");

  const program = getSettlementProgram();
  const payer = new PublicKey(verification.payer);

  const nonceBytes = Buffer.from(verification.nonce, "hex").slice(0, 8);
  const resourceHash = Array.from(crypto.createHash("sha256").update(verification.resource).digest());

  const [receiptPDA] = getPaymentReceiptPDA(verification.nonce, payer);

  const EPOCH_DURATION = parseInt(process.env.EPOCH_DURATION ?? "60");
  const currentEpoch = Math.floor(Date.now() / 1000 / EPOCH_DURATION);
  const epochBN = new BN(currentEpoch);
  const [statsPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("stats"), operatorKeypair.publicKey.toBuffer(), epochBN.toArrayLike(Buffer, "le", 8)],
    SETTLEMENT_PROGRAM_ID
  );

  const txSig = await program.methods
    .recordPayment(
      new BN(verification.amount),
      resourceHash,
      Array.from(nonceBytes),
      Array.from(bs58.decode(verification.signature)) // usdc_tx_sig as [u8; 64]
    )
    .accounts({
      operator: operatorKeypair.publicKey,
      payer: payer,
      paymentReceipt: receiptPDA,
      operatorStats: statsPDA,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([operatorKeypair])
    .rpc({ commitment: "confirmed" });

  console.log(`Payment recorded | Tx: ${txSig} | Amount: ${verification.amount}`);
  return txSig;
}