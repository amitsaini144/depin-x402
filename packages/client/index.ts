import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  getOrCreateAssociatedTokenAccount
} from '@solana/spl-token'
import bs58 from 'bs58'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config()

const connection = new Connection(process.env.HELIUS_RPC_URL!, 'confirmed')

const keyPath = path.join(os.homedir(), '.config', 'solana', 'devnet.json')
const secret = JSON.parse(fs.readFileSync(keyPath, 'utf-8'))
const payer = Keypair.fromSecretKey(Uint8Array.from(secret))

const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU")

// ─── Main Payment Flow ───────────────────────────────────────────────────────
async function payAndFetch(url: string) {
  const FACILITATOR_URL = 'http://localhost:4000'
  const OPERATOR_PUBKEY = new PublicKey('C9rwmkp5HC4XyhZDwJ7h39tDwVyv8CqRzEJvpzQFPV1L')

  // Step A: Get 402
  const res = await fetch(url)
  if (res.status !== 402) {
    console.log('No payment needed')
    return
  }

  const requirements = await res.json() as any
  const accept = requirements.accepts[0]

  const amount = Number(accept.maxAmountRequired)
  const resource = accept.resource
  const nonce = crypto.randomBytes(8).toString("hex")

  console.log(`Paying ${amount} µUSDC to operator...`)

  // Ensure payer ATA + get operator ATA
  const payerAtaInfo = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    USDC_MINT,
    payer.publicKey
  )

  const operatorAta = await getAssociatedTokenAddress(USDC_MINT, OPERATOR_PUBKEY)

  console.log("Payer ATA:", payerAtaInfo.address.toBase58())
  console.log("Operator ATA:", operatorAta.toBase58())

  // Build transaction
  const transferIx = createTransferInstruction(
    payerAtaInfo.address,
    operatorAta,
    payer.publicKey,
    amount
  )

  const latestBlockhash = await connection.getLatestBlockhash()

  const tx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: latestBlockhash.blockhash
  }).add(transferIx)

  // Sign
  tx.sign(payer)

  // Send (don't use sendRawTransaction)
  const signature = await connection.sendTransaction(
    tx,
    [payer],
    {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 5
    }
  )

  console.log("Transfer sent:", signature)

  // Confirm
  const confirmation = await connection.confirmTransaction(
    {
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
    },
    "confirmed"
  )

  if (confirmation.value.err) {
    throw new Error(
      `Transaction failed: ${JSON.stringify(confirmation.value.err)}`
    )
  }

  console.log("USDC Transfer CONFIRMED")

  // Send X-PAYMENT
  const paymentPayload = {
    scheme: 'exact',
    network: accept.network || 'solana-devnet',
    payload: {
      signature,
      payer: payer.publicKey.toBase58(),
      amount,
      nonce,
      resource,
    },
  }

  const encoded = Buffer.from(JSON.stringify(paymentPayload)).toString('base64')

  const paidRes = await fetch(url, {
    headers: {
      'x-payment': encoded,
      'x-facilitator-url': FACILITATOR_URL,
      'x-operator-pubkey': OPERATOR_PUBKEY.toBase58(),
    },
  })

  console.log('Server Status:', paidRes.status)
  console.log('Final Response:', await paidRes.json())
}

payAndFetch('http://localhost:3000/api/data')