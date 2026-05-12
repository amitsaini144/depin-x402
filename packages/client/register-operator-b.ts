import * as anchor from '@coral-xyz/anchor'
import { Program, AnchorProvider, BN, Wallet } from '@coral-xyz/anchor'
import { PublicKey, Keypair } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import { Connection } from '@solana/web3.js'
import fs from 'fs'
import operatorIdl from './operator_registry.json'

const REGISTRY_PROGRAM_ID = new PublicKey('38X2K9cy8m4LnvtRmhFWs6TRuxCZV24znbBqCDJaAPXT')
const USDC_MINT           = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')

// Load operator B keypair
const secret   = JSON.parse(fs.readFileSync(`${process.env.HOME}/.config/solana/operator-b.json`, 'utf-8'))
const operatorB = Keypair.fromSecretKey(Uint8Array.from(secret))

const connection = new Connection('https://api.devnet.solana.com', 'confirmed')
const wallet     = new Wallet(operatorB)
const provider   = new AnchorProvider(connection, wallet, { commitment: 'confirmed' })
const program    = new Program(operatorIdl as any, provider)

async function main() {
  const authority = operatorB.publicKey

  const [operatorPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('operator'), authority.toBuffer()],
    REGISTRY_PROGRAM_ID
  )

  const [vaultPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), authority.toBuffer()],
    REGISTRY_PROGRAM_ID
  )

  const operatorATA = await getAssociatedTokenAddress(USDC_MINT, authority)

  console.log('Registering operator B...')
  console.log('  pubkey:     ', authority.toBase58())
  console.log('  operatorPDA:', operatorPDA.toBase58())
  console.log('  vaultPDA:   ', vaultPDA.toBase58())

  const tx = await program.methods
    .registerOperator(
      'https://operator-b-facilitator.xyz',  // endpoint URL
      'us-east-1',                            // region
      new BN(5_000_000)                       // 5 tokens — more than operator A's 1
    )
    .accounts({
      authority:            authority,
      operatorTokenAccount: operatorATA,
      vault:                vaultPDA,
      mint:                 USDC_MINT,
      operatorRecord:       operatorPDA,
    })
    .rpc()

  console.log('✅ Operator B registered! tx:', tx)
  console.log('Now run client — it should pick operator B (higher stake)')
}

main().catch(console.error)