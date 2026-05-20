import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorError } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, SendTransactionError } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { expect } from "chai";
import { BN } from "bn.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorRegistry } from "../target/types/operator_registry";

async function rpc(fn: () => Promise<string>, label: string): Promise<string> {
  try {
    const sig = await fn();
    console.log(`  ✔  ${label} — sig: ${sig}`);
    return sig;
  } catch (err: any) {
    if (err instanceof SendTransactionError) {
      const logs = await err.getLogs(provider.connection);
      console.error(`  ✖  ${label} — SendTransactionError`);
      console.error("     Message:", err.message);
      console.error("     Logs:\n" + (logs ?? []).map(l => "       " + l).join("\n"));
    } else if (err instanceof AnchorError) {
      console.error(`  ✖  ${label} — AnchorError: ${err.error.errorCode.code} — ${err.error.errorMessage}`);
    } else {
      console.error(`  ✖  ${label} — ${err?.message ?? err}`);
    }
    throw err;
  }
}

// ── Config ───────────────────────────────────────────────────────────────────
const USDC_MINT      = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const EPOCH_DURATION = 60n;
const MIN_STAKE      = 1_000_000; // 1 USDC in base units

function loadKeypair(filename: string): Keypair {
  const raw = fs.readFileSync(path.join(os.homedir(), ".config", "solana", filename));
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw.toString())));
}

// ── Shared state ─────────────────────────────────────────────────────────────
const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

const program  = anchor.workspace.OperatorRegistry as Program<OperatorRegistry>;
const operator = loadKeypair("id.json");
const client   = loadKeypair("devnet.json"); // used as challenger in slash tests

// ── PDA helpers ──────────────────────────────────────────────────────────────
function pda(seeds: (Buffer | Uint8Array)[]) {
  return PublicKey.findProgramAddressSync(seeds, program.programId);
}

function operatorRecordPda(authority: PublicKey) {
  return pda([Buffer.from("operator"), authority.toBuffer()])[0];
}

function vaultPda(authority: PublicKey) {
  return pda([Buffer.from("vault"), authority.toBuffer()])[0];
}

function slashRecordPda(authority: PublicKey, targetEpoch: bigint) {
  const epochBuf = Buffer.alloc(8);
  epochBuf.writeBigInt64LE(targetEpoch);   // i64 LE — matches Rust i64
  return pda([Buffer.from("slash"), authority.toBuffer(), epochBuf])[0];
}

// Settlement program stats PDA — used as Path B proof in slash tests
function statsPda(operatorPk: PublicKey, epoch: bigint) {
  const SETTLEMENT_PROGRAM_ID = new PublicKey("Hzg2MGHMMoVDgA5X5v5r4XwMKyZAwUyZuYfMAtUg6whV");
  const epochBuf = Buffer.alloc(8);
  epochBuf.writeBigInt64LE(epoch);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stats"), operatorPk.toBuffer(), epochBuf],
    SETTLEMENT_PROGRAM_ID
  )[0];
}

// ── Pre-flight ───────────────────────────────────────────────────────────────
describe("Pre-flight checks", () => {
  it("operator has sufficient SOL", async () => {
    const bal = await provider.connection.getBalance(operator.publicKey);
    expect(bal).to.be.greaterThan(
      0.1 * anchor.web3.LAMPORTS_PER_SOL,
      `Operator SOL too low: ${bal / anchor.web3.LAMPORTS_PER_SOL}`
    );
  });

  it("operator has sufficient USDC to stake", async () => {
    const ata = await getAssociatedTokenAddress(USDC_MINT, operator.publicKey);
    const acc = await getAccount(provider.connection, ata);
    expect(Number(acc.amount)).to.be.greaterThanOrEqual(
      MIN_STAKE,
      `Operator USDC too low: ${acc.amount}`
    );
  });

  it("client has sufficient SOL (for challenger fees)", async () => {
    const bal = await provider.connection.getBalance(client.publicKey);
    expect(bal).to.be.greaterThan(
      0.05 * anchor.web3.LAMPORTS_PER_SOL,
      `Client SOL too low: ${bal / anchor.web3.LAMPORTS_PER_SOL}`
    );
  });
});

// ── register_operator ────────────────────────────────────────────────────────
describe("register_operator", () => {
  let operatorAta: PublicKey;
  let vault: PublicKey;
  let operatorRecord: PublicKey;
  let vaultBalanceBefore: bigint;
  let operatorBalanceBefore: bigint;

  before(async () => {
    operatorAta    = await getAssociatedTokenAddress(USDC_MINT, operator.publicKey);
    vault          = vaultPda(operator.publicKey);
    operatorRecord = operatorRecordPda(operator.publicKey);

    // If already registered from a previous run, deregister first so init succeeds
    const existing = await provider.connection.getAccountInfo(operatorRecord);
    if (existing) {
      const data = await (program.account as any).operatorRecord.fetch(operatorRecord);
      if (data.active) {
        console.log("  ⚠  operator_record already exists — deregistering first");
        await rpc(
          () => program.methods
            .deregisterOperator()
            .accountsPartial({
              authority:             operator.publicKey,
              operatorRecord,
              vault,
              operatorTokenAccount:  operatorAta,
              tokenProgram:          new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
            })
            .signers([operator])
            .rpc(),
          "before: deregister_operator (cleanup)"
        );
      } else {
        console.log("  ⚠  operator_record exists but already inactive — skipping deregister");
      }
    }

    const vaultInfo = await provider.connection.getAccountInfo(vault);
    vaultBalanceBefore = vaultInfo
      ? (await getAccount(provider.connection, vault)).amount
      : 0n;

    operatorBalanceBefore = (await getAccount(provider.connection, operatorAta)).amount;
  });

  it("creates operator_record PDA", async () => {
    await rpc(
      () => program.methods
        .registerOperator("https://facilitator.example.com", "us-east-1", new BN(MIN_STAKE))
        .accountsPartial({
          authority:            operator.publicKey,
          operatorTokenAccount: operatorAta,
          vault,
          mint:                 USDC_MINT,
          operatorRecord:       operatorRecordPda(operator.publicKey),
          tokenProgram:         new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
          systemProgram:        SystemProgram.programId,
          rent:                 anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([operator])
        .rpc(),
      "register_operator"
    );

    const info = await provider.connection.getAccountInfo(operatorRecordPda(operator.publicKey));
    expect(info).to.not.be.null;
    expect(info!.data.length).to.be.greaterThan(0);
  });

  it("operator_record has correct authority, url, region, and active = true", async () => {
    const data = await program.account.operatorRecord.fetch(
      operatorRecordPda(operator.publicKey)
    );
    expect(data.authority.toBase58()).to.equal(operator.publicKey.toBase58());
    expect(data.endpointUrl).to.equal("https://facilitator.example.com");
    expect(data.region).to.equal("us-east-1");
    expect(data.active).to.be.true;
  });

  it("operator_record stake matches MIN_STAKE", async () => {
    const data = await program.account.operatorRecord.fetch(
      operatorRecordPda(operator.publicKey)
    );
    expect(data.stake.toNumber()).to.equal(MIN_STAKE);
  });

  it("vault received the staked USDC", async () => {
    const vaultAcc = await getAccount(provider.connection, vault);
    expect(Number(vaultAcc.amount)).to.be.greaterThanOrEqual(
      MIN_STAKE,
      "Vault should hold at least MIN_STAKE"
    );
    expect(vaultAcc.amount - vaultBalanceBefore).to.equal(
      BigInt(MIN_STAKE),
      "Vault increase should equal stake amount"
    );
  });

  it("operator token account decreased by MIN_STAKE", async () => {
    const acc = await getAccount(provider.connection, operatorAta);
    expect(operatorBalanceBefore - acc.amount).to.equal(
      BigInt(MIN_STAKE),
      "Operator ATA should decrease by stake amount"
    );
  });

  it("registered_at timestamp is recent", async () => {
    const data = await program.account.operatorRecord.fetch(
      operatorRecordPda(operator.publicKey)
    );
    const ts = data.registeredAt.toNumber();
    expect(ts).to.be.greaterThan(0);
    expect(ts).to.be.closeTo(Math.floor(Date.now() / 1000), 60);
  });
});

// ── slash_operator (Path A — no stats PDA) ───────────────────────────────────
describe("slash_operator – Path A (operator fully inactive)", () => {
  // We need a PAST epoch where the operator had zero payments.
  // We use currentEpoch - 2 to be safely outside the live epoch.
  // The operator_stats account for that epoch must NOT exist on devnet
  // (or we pass SystemProgram.programId as the sentinel — Path A).

  let targetEpoch: bigint;
  let slashRecord: PublicKey;
  let clientAta: PublicKey;
  let vault: PublicKey;
  let vaultBalanceBefore: bigint;
  let clientBalanceBefore: bigint;
  let expectedSlashAmount: bigint;

  before(async () => {
    const slot      = await provider.connection.getSlot();
    const blockTime = await provider.connection.getBlockTime(slot);
    const now       = BigInt(blockTime!);
    targetEpoch     = (now / EPOCH_DURATION) - 2n; // safely completed epoch

    vault        = vaultPda(operator.publicKey);
    slashRecord  = slashRecordPda(operator.publicKey, targetEpoch);
    clientAta    = await getAssociatedTokenAddress(USDC_MINT, client.publicKey);

    // Create client USDC ATA if missing
    const ataInfo = await provider.connection.getAccountInfo(clientAta);
    if (!ataInfo) {
      const ix = createAssociatedTokenAccountInstruction(
        client.publicKey, clientAta, client.publicKey, USDC_MINT
      );
      await provider.sendAndConfirm(
        new anchor.web3.Transaction().add(ix),
        [client]
      );
    }

    // If slash_record already exists from a previous run, skip to a different epoch
    const slashInfo = await provider.connection.getAccountInfo(slashRecord);
    if (slashInfo) {
      console.log("  ⚠  slash_record already exists for epoch-2, trying epoch-3");
      targetEpoch  = (now / EPOCH_DURATION) - 3n;
      slashRecord  = slashRecordPda(operator.publicKey, targetEpoch);
    }

    const vaultAcc         = await getAccount(provider.connection, vault);
    vaultBalanceBefore     = vaultAcc.amount;
    expectedSlashAmount    = (vaultBalanceBefore * 1000n) / 10_000n; // 10% SLASH_BPS

    const clientAcc        = await getAccount(provider.connection, clientAta);
    clientBalanceBefore    = clientAcc.amount;
  });

  it("slash_operator executes with SystemProgram as operator_stats sentinel (Path A)", async () => {
    await rpc(
      () => program.methods
        .slashOperator(new BN(targetEpoch.toString()))
        .accountsPartial({
          challenger:             client.publicKey,
          challengerTokenAccount: clientAta,
          operatorRecord:         operatorRecordPda(operator.publicKey),
          vault,
          mint:                   USDC_MINT,
          operatorStats:          SystemProgram.programId, // Path A sentinel
          slashRecord,
          tokenProgram:           new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
          systemProgram:          SystemProgram.programId,
        })
        .signers([client])
        .rpc(),
      `slash_operator epoch=${targetEpoch}`
    );

    const info = await provider.connection.getAccountInfo(slashRecord);
    expect(info).to.not.be.null;
  });

  it("slash_record has correct operator, epoch, and challenger", async () => {
    const data = await program.account.slashRecord.fetch(slashRecord);
    expect(data.operator.toBase58()).to.equal(operator.publicKey.toBase58());
    expect(data.epoch.toString()).to.equal(targetEpoch.toString());
    expect(data.challenger.toBase58()).to.equal(client.publicKey.toBase58());
  });

  it("slash_record slash_amount equals 10% of vault balance", async () => {
    const data = await program.account.slashRecord.fetch(slashRecord);
    expect(data.slashAmount.toString()).to.equal(expectedSlashAmount.toString());
  });

  it("challenger token account received the slash reward", async () => {
    const acc = await getAccount(provider.connection, clientAta);
    expect(acc.amount - clientBalanceBefore).to.equal(
      expectedSlashAmount,
      "Challenger should receive exactly 10% of vault"
    );
  });

  it("vault balance decreased by slash_amount", async () => {
    const acc = await getAccount(provider.connection, vault);
    expect(vaultBalanceBefore - acc.amount).to.equal(
      expectedSlashAmount,
      "Vault should decrease by slash amount"
    );
  });

  it("operator_record stake decreased by slash_amount", async () => {
    const data = await program.account.operatorRecord.fetch(
      operatorRecordPda(operator.publicKey)
    );
    expect(data.stake.toString()).to.equal(
      (BigInt(MIN_STAKE) - expectedSlashAmount).toString()
    );
  });
});

// ── deregister_operator ───────────────────────────────────────────────────────
describe("deregister_operator", () => {
  let operatorAta: PublicKey;
  let vault: PublicKey;
  let operatorRecord: PublicKey;
  let operatorBalanceBefore: bigint;
  let vaultBalanceBefore: bigint;

  before(async () => {
    operatorAta    = await getAssociatedTokenAddress(USDC_MINT, operator.publicKey);
    vault          = vaultPda(operator.publicKey);
    operatorRecord = operatorRecordPda(operator.publicKey);

    const vaultAcc             = await getAccount(provider.connection, vault);
    vaultBalanceBefore         = vaultAcc.amount;
    const operatorAcc          = await getAccount(provider.connection, operatorAta);
    operatorBalanceBefore      = operatorAcc.amount;
  });

  it("deregisters operator and sets active = false", async () => {
    await rpc(
      () => program.methods
        .deregisterOperator()
        .accountsPartial({
          authority:            operator.publicKey,
          operatorRecord,
          vault,
          operatorTokenAccount: operatorAta,
          tokenProgram:         new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        })
        .signers([operator])
        .rpc(),
      "deregister_operator"
    );

    const data = await program.account.operatorRecord.fetch(operatorRecord);
    expect(data.active).to.be.false;
  });

  it("operator_record stake is zero after deregister", async () => {
    const data = await program.account.operatorRecord.fetch(operatorRecord);
    expect(data.stake.toNumber()).to.equal(0);
  });

  it("vault returned remaining stake to operator ATA", async () => {
    const acc = await getAccount(provider.connection, operatorAta);
    expect(acc.amount - operatorBalanceBefore).to.equal(
      vaultBalanceBefore,
      "Operator ATA should increase by full vault balance"
    );
  });

  it("vault balance is zero after deregister", async () => {
    const acc = await getAccount(provider.connection, vault);
    expect(acc.amount).to.equal(0n);
  });
});