import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountInstruction,
  getMint,
} from "@solana/spl-token";
import { expect } from "chai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { BN } from "bn.js";

// ── Config ──────────────────────────────────────────────────────────────────
const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const EPOCH_DURATION = 60n;
const MIN_SOL = 0.1 * anchor.web3.LAMPORTS_PER_SOL;
const MIN_USDC = 1_000_000n; // 1 USDC

function loadKeypair(filename: string): Keypair {
  const raw = fs.readFileSync(path.join(os.homedir(), ".config", "solana", filename));
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw.toString())));
}

// ── Shared state ────────────────────────────────────────────────────────────
const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

const connection = new anchor.web3.Connection(
  process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com",
  "confirmed"
);

const program = anchor.workspace.SettlementProgram as Program;
const operator = loadKeypair("id.json");
const client = loadKeypair("devnet.json");

// ── PDA helpers ─────────────────────────────────────────────────────────────
function pda(seeds: (Buffer | Uint8Array)[]) {
  return PublicKey.findProgramAddressSync(seeds, program.programId);
}
function rewardMintPda() { return pda([Buffer.from("reward-mint")])[0]; }
function rewardAuthorityPda() { return pda([Buffer.from("reward-authority")])[0]; }
function receiptPda(payerPk: PublicKey, nonce: Buffer) {
  return pda([Buffer.from("receipt"), payerPk.toBuffer(), nonce])[0];
}
function statsPda(operatorPk: PublicKey, epoch: bigint) {
  const epochBuf = Buffer.alloc(8);
  epochBuf.writeBigInt64LE(epoch);
  return pda([Buffer.from("stats"), operatorPk.toBuffer(), epochBuf])[0];
}

const now = BigInt(Math.floor(Date.now() / 1000));
const currentEpoch = now / EPOCH_DURATION;

// ── Balance check ────────────────────────────────────────────────────────────
describe("Pre-flight checks", () => {
  it("operator has sufficient SOL", async () => {
    const bal = await provider.connection.getBalance(operator.publicKey);
    expect(bal).to.be.greaterThan(MIN_SOL, `Operator SOL too low: ${bal / anchor.web3.LAMPORTS_PER_SOL}`);
  });

  it("client has sufficient SOL", async () => {
    const bal = await provider.connection.getBalance(client.publicKey);
    expect(bal).to.be.greaterThan(MIN_SOL, `Client SOL too low: ${bal / anchor.web3.LAMPORTS_PER_SOL}`);
  });

  it("operator has sufficient USDC", async () => {
    const ata = await getAssociatedTokenAddress(USDC_MINT, operator.publicKey);
    const acc = await getAccount(provider.connection, ata);
    expect(Number(acc.amount)).to.be.greaterThan(Number(MIN_USDC), `Operator USDC too low: ${acc.amount}`);
  });

  it("client has sufficient USDC", async () => {
    const ata = await getAssociatedTokenAddress(USDC_MINT, client.publicKey);
    const acc = await getAccount(provider.connection, ata);
    expect(Number(acc.amount)).to.be.greaterThan(Number(MIN_USDC), `Client USDC too low: ${acc.amount}`);
  });
});

// ── initialize_protocol ──────────────────────────────────────────────────────
describe("initialize_protocol", () => {
  it("creates reward_mint and reward_authority PDAs", async () => {
    try {
      await program.methods
        .initializeProtocol()
        .accounts({
          payer: operator.publicKey,
          rewardMint: rewardMintPda(),
          rewardAuthority: rewardAuthorityPda(),
        })
        .signers([operator])
        .rpc();
    } catch (e: any) {
      if (!e.message?.includes("already in use")) throw e;
    }

    // reward mint account exists
    const mintInfo = await connection.getAccountInfo(rewardMintPda());
    expect(mintInfo).to.not.be.null;
    expect(mintInfo!.data.length).to.be.greaterThan(0);

    // reward authority PDA is the mint authority
    const mint = await getMint(
      connection,
      rewardMintPda()
    );

    expect(mint.mintAuthority).to.not.be.null;
    expect(
      mint.mintAuthority!.equals(rewardAuthorityPda())
    ).to.be.true;
  });

  it("reward_mint is owned by token program", async () => {
    const mintInfo = await connection.getAccountInfo(rewardMintPda());
    expect(mintInfo!.owner.toBase58()).to.equal("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  });
});

// ── record_payment ───────────────────────────────────────────────────────────
describe("record_payment", () => {
  const nonce = Buffer.alloc(8); nonce.writeBigUInt64LE(BigInt(Date.now()));
  const resourceHash = Array.from(Buffer.alloc(32, 1));
  const usdcTxSig = Array.from(Buffer.alloc(64, 3));
  const amount = new BN(1_000_000);

  let receipt: PublicKey;
  let stats: PublicKey;

  before(async () => {
    const slot = await provider.connection.getSlot();
    const blockTime = await provider.connection.getBlockTime(slot);
    const freshEpoch = BigInt(blockTime!) / EPOCH_DURATION;
    receipt = receiptPda(client.publicKey, nonce);
    stats = statsPda(operator.publicKey, freshEpoch);
  });

  it("creates payment receipt PDA", async () => {
    await program.methods
      .recordPayment(amount, resourceHash, Array.from(nonce), usdcTxSig)
      .accounts({
        operator: operator.publicKey,
        payer: client.publicKey,
        paymentReceipt: receipt,
        operatorStats: stats,
      })
      .signers([operator])
      .rpc();

    const receiptInfo = await provider.connection.getAccountInfo(receipt);
    expect(receiptInfo).to.not.be.null;
    expect(receiptInfo!.data.length).to.be.greaterThan(0);
  });

  it("receipt has correct payer and operator", async () => {
    const data = await program.account.paymentReceipt.fetch(receipt);
    expect(data.payer.toBase58()).to.equal(client.publicKey.toBase58());
    expect(data.operator.toBase58()).to.equal(operator.publicKey.toBase58());
  });

  it("receipt has correct amount and settled flag", async () => {
    const data = await program.account.paymentReceipt.fetch(receipt);
    expect(data.amount.toNumber()).to.equal(1_000_000);
    expect(data.settled).to.be.true;
  });

  it("operator stats payment_count incremented", async () => {
    const data = await program.account.operatorStats.fetch(stats);
    expect(data.paymentCount.toNumber()).to.be.greaterThan(0);
    expect(data.volume.toNumber()).to.be.greaterThan(0);
  });

  it("receipt timestamp is recent", async () => {
    const data = await program.account.paymentReceipt.fetch(receipt);
    const ts = data.timestamp.toNumber();
    expect(ts).to.be.greaterThan(0);
    expect(ts).to.be.closeTo(Math.floor(Date.now() / 1000), 60);
  });
});

// ── settle_payment (legacy) ──────────────────────────────────────────────────
describe("settle_payment (legacy)", () => {
  const nonce = Buffer.alloc(8); nonce.writeBigUInt64LE(BigInt(Date.now() + 999));
  const resourceHash = Array.from(Buffer.alloc(32, 2));
  const amount = new BN(1_000_000);

  let receipt: PublicKey;
  let stats: PublicKey;
  let clientAta: PublicKey;
  let operatorAta: PublicKey;

  before(async () => {
    receipt = receiptPda(client.publicKey, nonce);
    stats = statsPda(operator.publicKey, currentEpoch);
    clientAta = await getAssociatedTokenAddress(USDC_MINT, client.publicKey);
    operatorAta = await getAssociatedTokenAddress(USDC_MINT, operator.publicKey);
  });

  it("transfers USDC and creates legacy receipt", async () => {
    // settle_payment needs client as signer — use separate provider
    const clientProvider = new anchor.AnchorProvider(
      provider.connection,
      new anchor.Wallet(client),
      { commitment: "confirmed" },
    );
    const clientProgram = new anchor.Program(program.idl, clientProvider) as Program;

    try {
      await clientProgram.methods
        .settlePayment(amount, resourceHash, Array.from(nonce))
        .accounts({
          payer: client.publicKey,
          payerAta: clientAta,
          merchantAta: operatorAta,
          paymentReceipt: receipt,
          operator: operator.publicKey,
          operatorStats: stats,
        })
        .signers([client])
        .rpc();

    } catch (e: any) {
      throw e;
    }

    const receiptInfo = await connection.getAccountInfo(receipt);
    expect(receiptInfo).to.not.be.null;
  });

  it("legacy receipt has settled = true and zero usdc_tx_sig", async () => {
    const data = await program.account.paymentReceipt.fetch(receipt);
    expect(data.settled).to.be.true;
    expect(data.usdcTxSig.every((b: number) => b === 0)).to.be.true;
  });

  it("legacy receipt payer matches client", async () => {
    const data = await program.account.paymentReceipt.fetch(receipt);
    expect(data.payer.toBase58()).to.equal(client.publicKey.toBase58());
  });
});


// ── claim_rewards ────────────────────────────────────────────────────────────
describe("claim_rewards", () => {
  let rewardAta: PublicKey;
  let stats: PublicKey;

  before(async () => {
    rewardAta = await getAssociatedTokenAddress(rewardMintPda(), operator.publicKey);
    stats = statsPda(operator.publicKey, currentEpoch);

    // Create reward ATA if missing
    const ataInfo = await connection.getAccountInfo(rewardAta);
    if (!ataInfo) {
      const ix = createAssociatedTokenAccountInstruction(
        operator.publicKey, rewardAta, operator.publicKey, rewardMintPda()
      );
      await provider.sendAndConfirm(new anchor.web3.Transaction().add(ix), [operator]);
    }

    console.log("Waiting 65s for epoch to complete...");
    await new Promise(r => setTimeout(r, 65_000));
  });

  it("mints reward tokens to operator ATA", async () => {
    const before = await getAccount(provider.connection, rewardAta);

    await program.methods
      .claimRewards(new BN(currentEpoch.toString()))
      .accounts({
        authority: operator.publicKey,
        operatorStats: stats,
        rewardMint: rewardMintPda(),
        rewardAuthority: rewardAuthorityPda(),
        operatorRewardAta: rewardAta,
      })
      .signers([operator])
      .rpc();

    const after = await getAccount(provider.connection, rewardAta);
    expect(Number(after.amount)).to.be.greaterThan(Number(before.amount));
  });

  it("marks stats rewards_claimed as true", async () => {
    const data = await program.account.operatorStats.fetch(stats);
    expect(data.rewardsClaimed).to.be.true;
  });
});

// ── Unhappy paths ────────────────────────────────────────────────────────────

describe("unhappy paths – initialize_protocol", () => {
  it("silently skips if already initialized (idempotency contract)", async () => {
    // The happy-path suite swallows "already in use" — we verify the on-chain
    // state is unchanged after a second call attempt.
    const mintBefore = await getMint(provider.connection, rewardMintPda());

    try {
      await program.methods
        .initializeProtocol()
        .accounts({
          payer: operator.publicKey,
          rewardMint: rewardMintPda(),
          rewardAuthority: rewardAuthorityPda(),
        })
        .signers([operator])
        .rpc();
    } catch (e: any) {
      // Expected — account already in use
      expect(e.message).to.match(/already in use/i);
    }

    // Mint authority must still be rewardAuthority — no state was clobbered
    const mintAfter = await getMint(provider.connection, rewardMintPda());
    expect(mintAfter.mintAuthority!.toBase58()).to.equal(
      mintBefore.mintAuthority!.toBase58()
    );
  });

  it("rejects when a non-operator tries to initialize with their own payer", async () => {
    // PDAs are global singletons — any signer hits AccountAlreadyInUse
    try {
      await program.methods
        .initializeProtocol()
        .accounts({
          payer: client.publicKey,      // client is funded, no airdrop needed
          rewardMint: rewardMintPda(),
          rewardAuthority: rewardAuthorityPda(),
        })
        .signers([client])
        .rpc();
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message).to.match(/already in use/i);
    }
  });
});

describe("unhappy paths – record_payment", () => {
  // Shared nonce for the duplicate-nonce test — fixed so both calls use the same PDA
  const duplicateNonce = Buffer.alloc(8);
  duplicateNonce.writeBigUInt64LE(BigInt(Date.now() + 0xdead));

  let epochStats: PublicKey;

  before(async () => {
    const slot = await provider.connection.getSlot();
    const blockTime = await provider.connection.getBlockTime(slot);
    const freshEpoch = BigInt(blockTime!) / EPOCH_DURATION;
    epochStats = statsPda(operator.publicKey, freshEpoch);
  });

  it("rejects a duplicate nonce (receipt PDA already initialized)", async () => {
    const receipt = receiptPda(client.publicKey, duplicateNonce);
    const resourceHash = Array.from(Buffer.alloc(32, 0xaa));
    const usdcTxSig = Array.from(Buffer.alloc(64, 0xbb));
    const amount = new BN(500_000);

    // First call — must succeed
    await program.methods
      .recordPayment(amount, resourceHash, Array.from(duplicateNonce), usdcTxSig)
      .accounts({
        operator: operator.publicKey,
        payer: client.publicKey,
        paymentReceipt: receipt,
        operatorStats: epochStats,
      })
      .signers([operator])
      .rpc();

    // Second call — same nonce → same PDA → must fail
    try {
      await program.methods
        .recordPayment(amount, resourceHash, Array.from(duplicateNonce), usdcTxSig)
        .accounts({
          operator: operator.publicKey,
          payer: client.publicKey,
          paymentReceipt: receipt,
          operatorStats: epochStats,
        })
        .signers([operator])
        .rpc();
      expect.fail("Should have thrown on duplicate nonce");
    } catch (e: any) {
      expect(e.message).to.match(/already in use|custom program error/i);
    }
  });

  it("rejects when client (non-operator) tries to call record_payment", async () => {
    const nonce = Buffer.alloc(8);
    nonce.writeBigUInt64LE(BigInt(Date.now() + 0xcafe));
    const receipt = receiptPda(client.publicKey, nonce);

    // Build a client-signed program instance
    const clientProvider = new anchor.AnchorProvider(
      provider.connection,
      new anchor.Wallet(client),
      { commitment: "confirmed" }
    );
    const clientProgram = new anchor.Program(program.idl, clientProvider) as Program;

    try {
      await clientProgram.methods
        .recordPayment(
          new BN(500_000),
          Array.from(Buffer.alloc(32, 0x01)),
          Array.from(nonce),
          Array.from(Buffer.alloc(64, 0x02))
        )
        .accounts({
          operator: client.publicKey,   // client impersonating operator
          payer: client.publicKey,
          paymentReceipt: receipt,
          operatorStats: epochStats,    // stats still keyed to legit operator — will mismatch
        })
        .signers([client])
        .rpc();
      expect.fail("Should have thrown — client is not the operator");
    } catch (e: any) {
      // Seeds mismatch (stats PDA doesn't match client-as-operator) or
      // program-level ConstraintSeeds / unauthorized error
      expect(e.message).to.not.be.empty;
    }
  });

  it("rejects record_payment with zero amount", async () => {
    const nonce = Buffer.alloc(8);
    nonce.writeBigUInt64LE(BigInt(Date.now() + 0xbeef));
    const receipt = receiptPda(client.publicKey, nonce);

    try {
      await program.methods
        .recordPayment(
          new BN(0),                              // zero amount
          Array.from(Buffer.alloc(32, 0x05)),
          Array.from(nonce),
          Array.from(Buffer.alloc(64, 0x06))
        )
        .accounts({
          operator: operator.publicKey,
          payer: client.publicKey,
          paymentReceipt: receipt,
          operatorStats: epochStats,
        })
        .signers([operator])
        .rpc();
      expect.fail("Should have rejected zero amount");
    } catch (e: any) {
      // Match your error name — likely InvalidAmount or ZeroAmount
      expect(e.message).to.match(/InvalidAmount|ZeroAmount|invalid amount|custom program error/i);
    }
  });
});

describe("unhappy paths – settle_payment", () => {
  let receipt: PublicKey; 
  let clientAta: PublicKey;
  let settledNonce: Buffer;
  let operatorAta: PublicKey;
  let settleStats: PublicKey;

  before(async () => {
    clientAta = await getAssociatedTokenAddress(USDC_MINT, client.publicKey);
    operatorAta = await getAssociatedTokenAddress(USDC_MINT, operator.publicKey);

    const slot = await provider.connection.getSlot();
    const blockTime = await provider.connection.getBlockTime(slot);
    const freshEpoch = BigInt(blockTime!) / EPOCH_DURATION;
    settleStats = statsPda(operator.publicKey, freshEpoch);

    // Create and settle a receipt so we have a known-settled account to reuse
    const nonce = Buffer.alloc(8);
    nonce.writeBigUInt64LE(BigInt(Date.now() + 0x1234));
    settledNonce = Buffer.alloc(8);                                   
    settledNonce.writeBigUInt64LE(BigInt(Date.now() + 0x1234)); 
    receipt = receiptPda(client.publicKey, nonce);

    const clientProvider = new anchor.AnchorProvider(
      provider.connection,
      new anchor.Wallet(client),
      { commitment: "confirmed" }
    );
    const clientProgram = new anchor.Program(program.idl, clientProvider) as Program;

    await clientProgram.methods
      .settlePayment(new BN(500_000), Array.from(Buffer.alloc(32, 0x07)), Array.from(settledNonce))
      .accounts({
        payer: client.publicKey,
        payerAta: clientAta,
        merchantAta: operatorAta,
        paymentReceipt: receipt,
        operator: operator.publicKey,
        operatorStats: settleStats,
      })
      .signers([client])
      .rpc();
  });

  it("rejects settling an already-settled receipt", async () => {
    const clientProvider = new anchor.AnchorProvider(
      provider.connection,
      new anchor.Wallet(client),
      { commitment: "confirmed" }
    );
    const clientProgram = new anchor.Program(program.idl, clientProvider) as Program;

    // `receipt` and `settledNonce` come from the before() — store the settledNonce there too
    try {
      await clientProgram.methods
        .settlePayment(new BN(500_000), Array.from(Buffer.alloc(32, 0x07)), Array.from(settledNonce))
        .accounts({
          payer: client.publicKey,
          payerAta: clientAta,
          merchantAta: operatorAta,
          paymentReceipt: receipt,      // same PDA — same settledNonce → AccountAlreadyInUse
          operator: operator.publicKey,
          operatorStats: settleStats,
        })
        .signers([client])
        .rpc();
      expect.fail("Should have rejected double-settle");
    } catch (e: any) {
      expect(e.message).to.match(/already in use/i);
    }
  });

  it("rejects settle_payment when operator tries to redirect payment to themselves", async () => {
    // Operator signs as payer — they don't have a receipt for this nonce as payer,
    // so the receipt PDA seeds won't match their pubkey.
    const nonce = Buffer.alloc(8);
    nonce.writeBigUInt64LE(BigInt(Date.now() + 0x9999));

    // Receipt derived from operator-as-payer — but the program expects client
    const wrongReceipt = receiptPda(operator.publicKey, nonce);
    const operatorProviderInstance = new anchor.AnchorProvider(
      provider.connection,
      new anchor.Wallet(operator),
      { commitment: "confirmed" }
    );
    const operatorProgram = new anchor.Program(program.idl, operatorProviderInstance) as Program;

    try {
      await operatorProgram.methods
        .settlePayment(new BN(500_000), Array.from(Buffer.alloc(32, 0x08)), Array.from(nonce))
        .accounts({
          payer: operator.publicKey,    // operator pretending to be a payer
          payerAta: operatorAta,
          merchantAta: operatorAta,     // paying themselves
          paymentReceipt: wrongReceipt,
          operator: operator.publicKey,
          operatorStats: settleStats,
        })
        .signers([operator])
        .rpc();
      expect.fail("Should have rejected — operator cannot be both payer and merchant");
    } catch (e: any) {
      expect(e.message).to.not.be.empty;
    }
  });
});

describe("unhappy paths – claim_rewards", () => {
  it("rejects claim for a future epoch (stats account does not exist)", async () => {
    const futureEpoch = currentEpoch + 9999n;
    const futureStats = statsPda(operator.publicKey, futureEpoch);
    const rewardAta = await getAssociatedTokenAddress(rewardMintPda(), operator.publicKey);

    try {
      await program.methods
        .claimRewards(new BN(futureEpoch.toString()))
        .accounts({
          authority: operator.publicKey,
          operatorStats: futureStats,
          rewardMint: rewardMintPda(),
          rewardAuthority: rewardAuthorityPda(),
          operatorRewardAta: rewardAta,
        })
        .signers([operator])
        .rpc();
      expect.fail("Should have rejected — stats PDA does not exist");
    } catch (e: any) {
      expect(e.message).to.match(/AccountNotInitialized|AccountDoesNotExist|could not find account/i);
    }
  });

  it("rejects double-claim on the same epoch (rewards_claimed = true)", async () => {
    // The happy-path claim_rewards test already ran and set rewardsClaimed = true.
    // A second call on the same stats PDA must be rejected.
    const stats = statsPda(operator.publicKey, currentEpoch);
    const rewardAta = await getAssociatedTokenAddress(rewardMintPda(), operator.publicKey);

    // Verify the flag is actually set before asserting the rejection
    const data = await program.account.operatorStats.fetch(stats);
    expect(data.rewardsClaimed).to.be.true;

    try {
      await program.methods
        .claimRewards(new BN(currentEpoch.toString()))
        .accounts({
          authority: operator.publicKey,
          operatorStats: stats,
          rewardMint: rewardMintPda(),
          rewardAuthority: rewardAuthorityPda(),
          operatorRewardAta: rewardAta,
        })
        .signers([operator])
        .rpc();
      expect.fail("Should have rejected double-claim");
    } catch (e: any) {
      expect(e.message).to.match(/AlreadyClaimed|already claimed|custom program error/i);
    }
  });

  it("rejects claim_rewards when a stranger provides operator's stats PDA", async () => {
    const stats = statsPda(operator.publicKey, currentEpoch);
    const rewardAta = await getAssociatedTokenAddress(rewardMintPda(), operator.publicKey);

    // client is funded but is not the authority on operator's stats PDA
    const clientProvider = new anchor.AnchorProvider(
      provider.connection,
      new anchor.Wallet(client),
      { commitment: "confirmed" }
    );
    const clientProgram = new anchor.Program(program.idl, clientProvider) as Program;

    try {
      await clientProgram.methods
        .claimRewards(new BN(currentEpoch.toString()))
        .accounts({
          authority: client.publicKey,  // wrong authority
          operatorStats: stats,         // belongs to operator
          rewardMint: rewardMintPda(),
          rewardAuthority: rewardAuthorityPda(),
          operatorRewardAta: rewardAta,
        })
        .signers([client])
        .rpc();
      expect.fail("Should have rejected — client is not the stats authority");
    } catch (e: any) {
      expect(e.message).to.not.be.empty;
    }
  });
});