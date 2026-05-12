import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js'
import { AnchorProvider, Program, Wallet, BN } from '@coral-xyz/anchor'
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction } from '@solana/spl-token'
import fs from 'fs'
import settlementIdl from './idl/settlement_program.json'

const SETTLEMENT_PROGRAM_ID = new PublicKey('Hzg2MGHMMoVDgA5X5v5r4XwMKyZAwUyZuYfMAtUg6whV')
const REWARD_MINT           = new PublicKey('8oXkboReapvTEsVmmxgVgnT8hwfBvpn5UPBZRyushuve')
const EPOCH_DURATION        = 60 // seconds — must match on-chain constant

const keypairFile = JSON.parse(fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, 'utf-8'))
const operator    = Keypair.fromSecretKey(Uint8Array.from(keypairFile))

const connection = new Connection('https://api.devnet.solana.com', 'confirmed')
const provider   = new AnchorProvider(connection, new Wallet(operator), { commitment: 'confirmed' })
const settlement = new Program(settlementIdl as any, provider)

// Derive epoch-keyed OperatorStats PDA
// Seeds: [b"stats", operator_pubkey, epoch_as_i64_le_bytes]
function deriveOperatorStats(operatorKey: PublicKey, epoch: number): PublicKey {
    const epochBuffer = Buffer.alloc(8)
    epochBuffer.writeBigInt64LE(BigInt(epoch))
    const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from('stats'), operatorKey.toBuffer(), epochBuffer],
        SETTLEMENT_PROGRAM_ID
    )
    return pda
}

// Get epoch number for any unix timestamp
function epochOf(unixSeconds: number): number {
    return Math.floor(unixSeconds / EPOCH_DURATION)
}

async function main() {
    const nowSeconds    = Math.floor(Date.now() / 1000)
    const currentEpoch  = epochOf(nowSeconds)
    const previousEpoch = currentEpoch - 1  // last completed epoch — the one we can claim

    console.log('Operator:       ', operator.publicKey.toBase58())
    console.log('Current epoch:  ', currentEpoch)
    console.log('Claiming epoch: ', previousEpoch)

    // Derive all PDAs
    const operatorStats = deriveOperatorStats(operator.publicKey, previousEpoch)

    const [rewardMint] = PublicKey.findProgramAddressSync(
        [Buffer.from('reward-mint')],
        SETTLEMENT_PROGRAM_ID
    )
    const [rewardAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from('reward-authority')],
        SETTLEMENT_PROGRAM_ID
    )
    const operatorRewardAta = await getAssociatedTokenAddress(REWARD_MINT, operator.publicKey)

    console.log('OperatorStats PDA: ', operatorStats.toBase58())
    console.log('RewardMint:        ', rewardMint.toBase58())
    console.log('RewardAuthority:   ', rewardAuthority.toBase58())
    console.log('RewardATA:         ', operatorRewardAta.toBase58())

    // Verify the stats account exists and has unclaimed payments
    const statsInfo = await connection.getAccountInfo(operatorStats)
    if (!statsInfo) {
        console.error(`❌ No OperatorStats found for epoch ${previousEpoch}.`)
        console.error('   This means no payments were processed in that epoch.')
        console.error('   PDA checked:', operatorStats.toBase58())
        process.exit(1)
    }
    console.log('✅ OperatorStats account found')

    // Create reward ATA if it doesn't exist
    const ataInfo = await connection.getAccountInfo(operatorRewardAta)
    if (!ataInfo) {
        console.log('Creating reward ATA...')
        const createAtaIx = createAssociatedTokenAccountInstruction(
            operator.publicKey,
            operatorRewardAta,
            operator.publicKey,
            REWARD_MINT
        )
        const ataTx = await provider.sendAndConfirm(new Transaction().add(createAtaIx))
        console.log('ATA created:', ataTx)
    }

    // Call claim_rewards with the target epoch
    const tx = await settlement.methods
        .claimRewards(new BN(previousEpoch))
        .accounts({
            authority:         operator.publicKey,
            operatorStats:     operatorStats,
            rewardMint:        rewardMint,
            rewardAuthority:   rewardAuthority,
            operatorRewardAta: operatorRewardAta,
            tokenProgram:      TOKEN_PROGRAM_ID,
            systemProgram:     PublicKey.default,
        })
        .rpc()

    console.log('✅ Rewards claimed:', tx)

    const balance = await connection.getTokenAccountBalance(operatorRewardAta)
    console.log('Reward token balance:', balance.value.uiAmount)
}

main().catch(console.error)