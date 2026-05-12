import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js'
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token'
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor'
import bs58 from 'bs58'
import fs from 'fs'
import operatorIdl from './operator_registry.json'

const REGISTRY_PROGRAM_ID = new PublicKey('38X2K9cy8m4LnvtRmhFWs6TRuxCZV24znbBqCDJaAPXT')
const USDC_MINT_DEVNET    = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')

const connection = new Connection('https://api.devnet.solana.com', 'confirmed')
const secret     = JSON.parse(fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, 'utf-8'))
const payer      = Keypair.fromSecretKey(Uint8Array.from(secret))
const wallet     = new Wallet(payer)
const provider   = new AnchorProvider(connection, wallet, { commitment: 'confirmed' })
const registryProg = new Program(operatorIdl as any, provider)

// ─── Step 8: fetch operators from chain and pick best one ────────────────────
async function getBestFacilitator(): Promise<{ url: string, pubkey: string }> {
  // Fetch all OperatorRecord accounts from the registry program
  const all = await (registryProg.account as any).operatorRecord.all()

  // Filter active only, sort by stake descending
  const active = all
    .filter((o: any) => o.account.active)
    .sort((a: any, b: any) => b.account.stake.toNumber() - a.account.stake.toNumber())

  if (active.length === 0) {
    throw new Error('No active operators found on-chain')
  }

  const best = active[0]
  console.log(`Selected operator: ${best.account.endpointUrl}`)
  console.log(`  pubkey: ${best.account.authority.toBase58()}`)
  console.log(`  stake:  ${best.account.stake.toString()}`)
  console.log(`  region: ${best.account.region}`)

  return {
    url:    best.account.endpointUrl,
    pubkey: best.account.authority.toBase58(),
  }
}

// ─── Main payment flow ───────────────────────────────────────────────────────
async function payAndFetch(url: string) {
  // Step 8: pick facilitator from registry instead of hardcoding
  // const facilitator = await getBestFacilitator()
  const FACILITATOR_URL = 'http://localhost:4000'
  const OPERATOR_PUBKEY = 'C9rwmkp5HC4XyhZDwJ7h39tDwVyv8CqRzEJvpzQFPV1L'

  // Step A: hit the endpoint, expect 402
  const res = await fetch(url)
  if (res.status !== 402) {
    console.log('No payment needed:', await res.json())
    return
  }

  const requirements = await res.json() as any
  const accept = requirements.accepts[0]

  // Step B: build USDC transfer transaction
  const payTo  = new PublicKey(accept.payTo)
  const amount = BigInt(accept.maxAmountRequired)

  const fromATA = await getAssociatedTokenAddress(USDC_MINT_DEVNET, payer.publicKey)
  const toATA   = await getAssociatedTokenAddress(USDC_MINT_DEVNET, payTo)

  const tx = new Transaction()
  tx.add(createTransferInstruction(fromATA, toATA, payer.publicKey, amount))
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
  tx.feePayer = payer.publicKey
  tx.sign(payer)

  // Step C: encode signed tx
  const paymentPayload = {
    x402Version: 1,
    scheme:      'exact',
    network:     accept.network,
    payload: {
      from:        payer.publicKey.toBase58(),
      signature:   bs58.encode(tx.signatures[0].signature!),
      transaction: tx.serialize({ requireAllSignatures: false }).toString('base64'),
    }
  }
  const encoded = Buffer.from(JSON.stringify(paymentPayload)).toString('base64')

  // Step D: retry with payment — using the dynamically selected facilitator
  const paid = await fetch(url, {
    headers: {
      'x-payment':          encoded,
      'x-facilitator-url':  FACILITATOR_URL,
      'x-operator-pubkey':  OPERATOR_PUBKEY,
    }
  })

  const result = await paid.json()
  console.log('Result:', result)
}

payAndFetch('http://localhost:3000/api/data')