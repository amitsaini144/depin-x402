// test-register.ts
import * as anchor from '@coral-xyz/anchor'
import { Program } from '@coral-xyz/anchor'
import { PublicKey, Keypair } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'

const PROGRAM_ID = new PublicKey('38X2K9cy8m4LnvtRmhFWs6TRuxCZV24znbBqCDJaAPXT')
const MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')  // your staking token mint

async function main() {
  const provider = anchor.AnchorProvider.env()
  anchor.setProvider(provider)

  const program = anchor.workspace.OperatorRegistry as Program

  const authority = provider.wallet.publicKey

  const [operatorPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('operator'), authority.toBuffer()],
    PROGRAM_ID
  )
  const [vaultPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), authority.toBuffer()],
    PROGRAM_ID
  )
  const operatorATA = await getAssociatedTokenAddress(MINT, authority)

  const tx = await program.methods
    .registerOperator('https://my-facilitator.xyz', 'ap-south-1', new anchor.BN(1_000_000))
    .accounts({
      authority,
      operatorTokenAccount: operatorATA,
      vault: vaultPDA,
      mint: MINT,
      operatorRecord: operatorPDA,
    })
    .rpc()

  console.log('tx:', tx)
  console.log('Now check: solana account', operatorPDA.toBase58(), '--url devnet')
}

main()