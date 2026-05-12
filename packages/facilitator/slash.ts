/**
 * slash.ts
 *
 * Step 2 of slash test:
 *   Reads the target epoch from argv, derives all PDAs,
 *   verifies the slashable condition, then calls slash_operator.
 *
 * Run: npx ts-node slash.ts <epoch_number>
 * Example: npx ts-node slash.ts 28940123
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { AnchorProvider, Program, Wallet, BN } from '@coral-xyz/anchor'
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import fs from 'fs'
import registryIdl  from './idl/operator_registry.json'

// ─── Config ──────────────────────────────────────────────────────────────────

const SETTLEMENT_PROGRAM_ID = new PublicKey('Hzg2MGHMMoVDgA5X5v5r4XwMKyZAwUyZuYfMAtUg6whV')
const REGISTRY_PROGRAM_ID  = new PublicKey('38X2K9cy8m4LnvtRmhFWs6TRuxCZV24znbBqCDJaAPXT')
const USDC_MINT             = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
const EPOCH_DURATION        = 60  // seconds — must match on-chain

// ─── Setup ───────────────────────────────────────────────────────────────────

const keypairFile = JSON.parse(fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, 'utf-8'))
const challenger  = Keypair.fromSecretKey(Uint8Array.from(keypairFile))

const connection = new Connection('https://api.devnet.solana.com', 'confirmed')
const provider   = new AnchorProvider(connection, new Wallet(challenger), { commitment: 'confirmed' })
const registry   = new Program(registryIdl as any, provider)

// ─── PDA helpers ─────────────────────────────────────────────────────────────

function deriveOperatorPDA(operatorKey: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from('operator'), operatorKey.toBuffer()],
        REGISTRY_PROGRAM_ID
    )
    return pda
}

function deriveVaultPDA(operatorKey: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), operatorKey.toBuffer()],
        REGISTRY_PROGRAM_ID
    )
    return pda
}

function deriveOperatorStatsPDA(operatorKey: PublicKey, epoch: number): PublicKey {
    const epochBuffer = Buffer.alloc(8)
    epochBuffer.writeBigInt64LE(BigInt(epoch))
    const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from('stats'), operatorKey.toBuffer(), epochBuffer],
        SETTLEMENT_PROGRAM_ID
    )
    return pda
}

function deriveSlashRecordPDA(operatorKey: PublicKey, epoch: number): PublicKey {
    const epochBuffer = Buffer.alloc(8)
    epochBuffer.writeBigInt64LE(BigInt(epoch))
    const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from('slash'), operatorKey.toBuffer(), epochBuffer],
        REGISTRY_PROGRAM_ID
    )
    return pda
}

// ─── OperatorStats manual deserializer ───────────────────────────────────────
// Matches on-chain layout: [8 discriminator][32 operator][8 epoch][8 payment_count][8 volume][1 rewards_claimed]

interface OperatorStats {
    operator:       string
    epoch:          bigint
    paymentCount:   bigint
    volume:         bigint
    rewardsClaimed: boolean
}

function deserializeOperatorStats(data: Buffer): OperatorStats {
    const payload = data.slice(8)  // skip 8-byte Anchor discriminator
    return {
        operator:       new PublicKey(payload.slice(0, 32)).toBase58(),
        epoch:          payload.readBigInt64LE(32),
        paymentCount:   payload.readBigUInt64LE(40),
        volume:         payload.readBigUInt64LE(48),
        rewardsClaimed: payload[56] !== 0,
    }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    // Parse target epoch from CLI arg
    const epochArg = process.argv[2]
    if (!epochArg) {
        console.error('Usage: npx ts-node slash.ts <epoch_number>')
        console.error('Example: npx ts-node slash.ts 28940123')
        process.exit(1)
    }
    const targetEpoch    = parseInt(epochArg, 10)
    const currentEpoch   = Math.floor(Date.now() / 1000 / EPOCH_DURATION)

    console.log('='.repeat(60))
    console.log('SLASH OPERATOR')
    console.log('='.repeat(60))
    console.log('Challenger:    ', challenger.publicKey.toBase58())
    console.log('Target epoch:  ', targetEpoch)
    console.log('Current epoch: ', currentEpoch)

    // ── Preflight: epoch must be complete ────────────────────────────────────
    if (targetEpoch >= currentEpoch) {
        console.error(`\n❌ Epoch ${targetEpoch} is not complete yet.`)
        console.error(`   Current epoch is ${currentEpoch}. Wait for it to advance.`)
        process.exit(1)
    }

    // ── In this test, challenger = operator (same keypair, testing on devnet)
    //    In production, operator is a different wallet.
    //    To slash a different operator, change this line:
    const operatorKey = challenger.publicKey

    // ── Derive all PDAs ──────────────────────────────────────────────────────
    const operatorPDA    = deriveOperatorPDA(operatorKey)
    const vaultPDA       = deriveVaultPDA(operatorKey)
    const operatorStats  = deriveOperatorStatsPDA(operatorKey, targetEpoch)
    const slashRecord    = deriveSlashRecordPDA(operatorKey, targetEpoch)
    const challengerAta  = await getAssociatedTokenAddress(USDC_MINT, challenger.publicKey)

    console.log('\nDerived PDAs:')
    console.log('  operatorRecord: ', operatorPDA.toBase58())
    console.log('  vault:          ', vaultPDA.toBase58())
    console.log('  operatorStats:  ', operatorStats.toBase58())
    console.log('  slashRecord:    ', slashRecord.toBase58())
    console.log('  challengerAta:  ', challengerAta.toBase58())

    // ── Preflight: verify OperatorRecord exists and is active ────────────────
    console.log('\n--- Preflights ---')
    let operatorRecord: any
    try {
        operatorRecord = await (registry.account as any).operatorRecord.fetch(operatorPDA)
        console.log('✅ OperatorRecord found')
        console.log('   Active:', operatorRecord.active)
        console.log('   Stake: ', operatorRecord.stake.toString())
    } catch {
        console.error('❌ OperatorRecord not found. Operator not registered.')
        process.exit(1)
    }

    if (!operatorRecord.active) {
        console.error('❌ Operator is not active — cannot slash a deregistered operator.')
        process.exit(1)
    }

    // ── Preflight: verify vault has funds ────────────────────────────────────
    const vaultBalance = await connection.getTokenAccountBalance(vaultPDA).catch(() => null)
    if (!vaultBalance || vaultBalance.value.uiAmount === 0) {
        console.error('❌ Vault is empty — nothing to slash.')
        process.exit(1)
    }
    const vaultAmount = Number(vaultBalance.value.amount)
    const slashAmount = Math.floor(vaultAmount * 0.10)
    console.log(`✅ Vault balance: ${vaultBalance.value.uiAmount} USDC`)
    console.log(`   Slash amount (10%): ${slashAmount} base units`)

    // ── Preflight: check OperatorStats for target epoch (optional) ───────────
    const statsInfo = await connection.getAccountInfo(operatorStats)

    if (!statsInfo) {
        // Path A — no stats PDA at all. Operator was completely invisible this epoch.
        // Absence is the proof. Slashable.
        console.log(`✅ Path A: No OperatorStats for epoch ${targetEpoch} — operator was fully inactive`)
    } else {
        // Path B — stats exist. Verify payment_count == 0.
        const stats = deserializeOperatorStats(statsInfo.data)
        console.log('\n✅ Path B: OperatorStats found:')
        console.log('   Epoch:          ', stats.epoch.toString())
        console.log('   payment_count:  ', stats.paymentCount.toString())
        console.log('   volume:         ', stats.volume.toString())
        console.log('   rewards_claimed:', stats.rewardsClaimed)

        if (stats.epoch !== BigInt(targetEpoch)) {
            console.error(`\n❌ EpochMismatch: stats.epoch=${stats.epoch}, target=${targetEpoch}`)
            console.error('   The stats account epoch does not match — wrong account passed.')
            process.exit(1)
        }
        if (stats.paymentCount > 0n) {
            console.error(`\n❌ Operator had ${stats.paymentCount} payments — not slashable.`)
            process.exit(1)
        }
        if (stats.rewardsClaimed) {
            console.error('\n❌ Rewards already claimed — not slashable.')
            process.exit(1)
        }
    }

    // ── Preflight: check slash record doesn't already exist ──────────────────
    const slashRecordInfo = await connection.getAccountInfo(slashRecord)
    if (slashRecordInfo) {
        console.error(`\n❌ SlashRecord already exists for epoch ${targetEpoch} — already slashed.`)
        process.exit(1)
    }

    console.log('\n✅ All preflights passed — executing slash...\n')

    // ── Execute slash_operator ────────────────────────────────────────────────
    const tx = await registry.methods
        .slashOperator(new BN(targetEpoch))
        .accounts({
            challenger:             challenger.publicKey,
            challengerTokenAccount: challengerAta,
            operatorRecord:         operatorPDA,
            vault:                  vaultPDA,
            mint:                   USDC_MINT,
            // Path A: pass SystemProgram as sentinel (means "no stats")
            // Path B: pass actual operatorStats PDA
            operatorStats:          statsInfo ? operatorStats : PublicKey.default,
            slashRecord:            slashRecord,
            tokenProgram:           TOKEN_PROGRAM_ID,
            systemProgram:          PublicKey.default,
        })
        .rpc()

    console.log('✅ Slash successful!')
    console.log('   Tx:', tx)
    console.log('   Explorer: https://explorer.solana.com/tx/' + tx + '?cluster=devnet')

    // ── Post-slash: print updated balances ───────────────────────────────────
    const newVaultBalance      = await connection.getTokenAccountBalance(vaultPDA)
    const challengerBalance    = await connection.getTokenAccountBalance(challengerAta)
    const updatedRecord        = await (registry.account as any).operatorRecord.fetch(operatorPDA)

    console.log('\n--- Post-slash state ---')
    console.log(`Vault balance:       ${newVaultBalance.value.uiAmount} USDC  (was ${vaultBalance.value.uiAmount})`)
    console.log(`Challenger balance:  ${challengerBalance.value.uiAmount} USDC  (received ${slashAmount} base units)`)
    console.log(`Operator stake:      ${updatedRecord.stake.toString()}  (updated on-chain record)`)
    console.log(`SlashRecord PDA:     ${slashRecord.toBase58()}`)
    console.log('\n✅ Done. SlashRecord created — this epoch cannot be slashed again.')
}

main().catch(e => {
    console.error('\nFatal error:', e.message ?? e)
    if (e.logs) {
        console.error('\nProgram logs:')
        e.logs.forEach((l: string) => console.error(' ', l))
    }
    process.exit(1)
})