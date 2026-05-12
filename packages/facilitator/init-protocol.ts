import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import fs from 'fs'
import settlementIdl from './idl/settlement_program.json'

const SETTLEMENT_PROGRAM_ID = new PublicKey('Hzg2MGHMMoVDgA5X5v5r4XwMKyZAwUyZuYfMAtUg6whV')

const keypairFile = JSON.parse(fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, 'utf-8'))
const payer = Keypair.fromSecretKey(Uint8Array.from(keypairFile))

const connection = new Connection('https://api.devnet.solana.com', 'confirmed')
const provider   = new AnchorProvider(connection, new Wallet(payer), { commitment: 'confirmed' })
const program    = new Program(settlementIdl as any, provider)

async function main() {
    const [rewardMint]      = PublicKey.findProgramAddressSync([Buffer.from('reward-mint')],      SETTLEMENT_PROGRAM_ID)
    const [rewardAuthority] = PublicKey.findProgramAddressSync([Buffer.from('reward-authority')], SETTLEMENT_PROGRAM_ID)

    console.log('Reward mint PDA:      ', rewardMint.toBase58())
    console.log('Reward authority PDA: ', rewardAuthority.toBase58())

    const tx = await program.methods
        .initializeProtocol()
        .accounts({
            payer:           payer.publicKey,
            rewardMint:      rewardMint,
            rewardAuthority: rewardAuthority,
            tokenProgram:    TOKEN_PROGRAM_ID,
            systemProgram:   PublicKey.default,
        })
        .rpc()

    console.log('✅ Protocol initialized:', tx)
    console.log('Save this reward mint address — you will need it for claim_rewards calls:')
    console.log('   REWARD_MINT =', rewardMint.toBase58())
}

main().catch(console.error)