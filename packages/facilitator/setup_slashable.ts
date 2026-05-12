/**
 * setup_slashable.ts
 *
 * Step 1 of slash test:
 *   1. Register operator (or confirm already registered)
 *   2. Print the current epoch
 *   3. Wait for epoch to complete (60s)
 *   4. Print the slashable epoch number — pass this to slash.ts
 *
 * Run: npx ts-node setup_slashable.ts
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { AnchorProvider, Program, Wallet, BN } from '@coral-xyz/anchor'
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import fs from 'fs'
import operatorIdl from './idl/operator_registry.json'

// ─── Config ──────────────────────────────────────────────────────────────────

const REGISTRY_PROGRAM_ID  = new PublicKey('38X2K9cy8m4LnvtRmhFWs6TRuxCZV24znbBqCDJaAPXT')
const USDC_MINT            = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
const EPOCH_DURATION       = 60   // seconds — must match on-chain
const MIN_STAKE            = 1_000_000  // 1 USDC (6 decimals)

// ─── Setup ───────────────────────────────────────────────────────────────────

const keypairFile = JSON.parse(fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, 'utf-8'))
const operator    = Keypair.fromSecretKey(Uint8Array.from(keypairFile))

const connection  = new Connection('https://api.devnet.solana.com', 'confirmed')
const provider    = new AnchorProvider(connection, new Wallet(operator), { commitment: 'confirmed' })
const registry    = new Program(operatorIdl as any, provider)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function currentEpoch(): number {
    return Math.floor(Date.now() / 1000 / EPOCH_DURATION)
}

function secondsUntilNextEpoch(): number {
    const nowSeconds = Math.floor(Date.now() / 1000)
    return EPOCH_DURATION - (nowSeconds % EPOCH_DURATION)
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

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

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    console.log('='.repeat(60))
    console.log('SETUP SLASHABLE OPERATOR')
    console.log('='.repeat(60))
    console.log('Operator wallet:', operator.publicKey.toBase58())

    const operatorPDA = deriveOperatorPDA(operator.publicKey)
    const vaultPDA    = deriveVaultPDA(operator.publicKey)
    const operatorAta = await getAssociatedTokenAddress(USDC_MINT, operator.publicKey)

    // ── Step 1: Check if already registered ──────────────────────────────────
    let alreadyRegistered = false
    try {
        const record = await (registry.account as any).operatorRecord.fetch(operatorPDA)
        alreadyRegistered = true
        console.log('\n✅ Operator already registered on-chain')
        console.log('   Active:', record.active)
        console.log('   Stake: ', record.stake.toString())
        console.log('   URL:   ', record.endpointUrl)

        if (!record.active) {
            console.error('❌ Operator is deregistered. Re-register manually first.')
            process.exit(1)
        }
    } catch {
        console.log('\nOperator not registered — registering now...')
    }

    // ── Step 2: Register if needed ────────────────────────────────────────────
    if (!alreadyRegistered) {
        // Check USDC balance
        const ataInfo = await connection.getTokenAccountBalance(operatorAta).catch(() => null)
        if (!ataInfo) {
            console.error('❌ No USDC token account found. Fund your wallet with devnet USDC first.')
            process.exit(1)
        }
        const usdcBalance = Number(ataInfo.value.amount)
        if (usdcBalance < MIN_STAKE) {
            console.error(`❌ Insufficient USDC. Have ${usdcBalance}, need ${MIN_STAKE}`)
            process.exit(1)
        }

        const tx = await registry.methods
            .registerOperator(
                'http://localhost:4000',  // endpoint_url
                'us-east',               // region
                new BN(MIN_STAKE)        // stake_amount
            )
            .accounts({
                authority:             operator.publicKey,
                operatorTokenAccount:  operatorAta,
                vault:                 vaultPDA,
                mint:                  USDC_MINT,
                operatorRecord:        operatorPDA,
                tokenProgram:          TOKEN_PROGRAM_ID,
                systemProgram:         PublicKey.default,
            })
            .rpc()

        console.log('✅ Operator registered:', tx)
        console.log('   Staked:', MIN_STAKE, 'USDC base units')
    }

    // ── Step 3: Show current epoch, wait for it to end ────────────────────────
    const epochAtStart   = currentEpoch()
    const waitSeconds    = secondsUntilNextEpoch() + 2  // +2s buffer for clock drift

    console.log('\n' + '-'.repeat(60))
    console.log(`Current epoch:      ${epochAtStart}`)
    console.log(`Slashable epoch:    ${epochAtStart}  (this one — doing zero payments)`)
    console.log(`Next epoch starts:  in ${secondsUntilNextEpoch()}s`)
    console.log(`Waiting:            ${waitSeconds}s for epoch to complete...`)
    console.log('-'.repeat(60))
    console.log('⏳ Do NOT make any payments during this wait.')
    console.log('   Operator must have payment_count = 0 for this epoch.\n')

    // Countdown
    for (let i = waitSeconds; i > 0; i--) {
        process.stdout.write(`\r   ${i}s remaining...   `)
        await sleep(1000)
    }
    console.log('\n')

    const epochAfterWait = currentEpoch()
    console.log('='.repeat(60))
    console.log('✅ Epoch complete!')
    console.log(`   Slashable epoch: ${epochAtStart}`)
    console.log(`   Current epoch:   ${epochAfterWait}`)
    console.log('='.repeat(60))
    console.log('\nNow run the slash script:')
    console.log(`\n   npx ts-node slash.ts ${epochAtStart}\n`)
}

main().catch(e => {
    console.error('Error:', e.message ?? e)
    process.exit(1)
})