import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor'
import bs58 from 'bs58'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import operatorIdl from './operator_registry.json'

const REGISTRY_PROGRAM_ID = new PublicKey('38X2K9cy8m4LnvtRmhFWs6TRuxCZV24znbBqCDJaAPXT')

const connection = new Connection('https://api.devnet.solana.com', 'confirmed')
const keyPath    = path.join(os.homedir(), '.config', 'solana', 'id.json')
const secret     = JSON.parse(fs.readFileSync(keyPath, 'utf-8'))
const payer      = Keypair.fromSecretKey(Uint8Array.from(secret))
const wallet     = new Wallet(payer)
const provider   = new AnchorProvider(connection, wallet, { commitment: 'confirmed' })
const registryProg = new Program(operatorIdl as any, provider)

// ─── Step 8: fetch operators from chain and pick best one ────────────────────
async function getBestFacilitator(): Promise<{ url: string, pubkey: string }> {
  const all = await (registryProg.account as any).operatorRecord.all()

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

  // Step B: build payment payload matching facilitator/payment.ts schema
  const nonce = crypto.randomBytes(16).toString('hex').slice(0, 16)
  const amount   = Number(accept.maxAmountRequired)
  const resource = accept.resource

  // Signature over (nonce|payer|amount|resource). Facilitator's verifyPayment
  // currently doesn't crypto-verify this, but keeping it deterministic per
  // request leaves room to add ed25519 verification later without a re-design.
  const sigBytes = crypto
    .createHash('sha256')
    .update(`${nonce}|${payer.publicKey.toBase58()}|${amount}|${resource}`)
    .digest()

  const paymentPayload = {
    scheme:  'exact',
    network: accept.network,
    payload: {
      signature: bs58.encode(sigBytes),
      payer:     payer.publicKey.toBase58(),
      amount,
      nonce,
      resource,
    },
  }
  const encoded = Buffer.from(JSON.stringify(paymentPayload)).toString('base64')

  // Step C: retry with payment
  const paid = await fetch(url, {
    headers: {
      'x-payment':         encoded,
      'x-facilitator-url': FACILITATOR_URL,
      'x-operator-pubkey': OPERATOR_PUBKEY,
    },
  })

  console.log('status:', paid.status)
  const result = await paid.json()
  console.log('Result:', result)
}

payAndFetch('http://localhost:3000/api/data')
