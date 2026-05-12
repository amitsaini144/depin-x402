# DePIN x402

**HTTP 402 micropayments on Solana with staked operators that get slashed if idle.**

Any HTTP API can charge per-call USDC, settled on-chain in one transaction, with no accounts, no API keys, no subscriptions. Operators stake USDC to run resources, earn fees on every request they settle, and lose 10% of their vault if they sit idle for a full epoch.

---

## Architecture

```
   Payer Wallet                Facilitator (Express)         Solana Devnet
   ────────────                ─────────────────────         ─────────────
        │                              │                            │
        │   1. POST /resource          │                            │
        ├─────────────────────────────►│                            │
        │   ◄── 402 Payment Required ──┤                            │
        │      { amount, payTo, ...}   │                            │
        │                              │                            │
        │   2. Sign USDC transfer ────────────────────────────────► │
        │   ◄── tx signature ──────────────────────────────────────┤
        │                              │                            │
        │   3. POST /resource          │                            │
        │      X-PAYMENT: <token>      │                            │
        ├─────────────────────────────►│                            │
        │                              │   4. verify + settle      │
        │                              ├──────────────────────────►│
        │                              │   ◄── settlement tx ──────┤
        │   ◄── 200 + resource ────────┤                            │
        │                              │                            │
```

**Components:**
- `frontend/` — Next.js 14 dashboard (operators, slashes, my-operator panel)
- `packages/facilitator/` — Express server that verifies x402 payments and settles them on-chain
- `packages/client/` — Reference CLI client demonstrating the payer side of the flow
- `settlement-program/` — Two Anchor programs deployed on devnet:
  - **Settlement** [`Hzg2MGHMMoVDgA5X5v5r4XwMKyZAwUyZuYfMAtUg6whV`](https://explorer.solana.com/address/Hzg2MGHMMoVDgA5X5v5r4XwMKyZAwUyZuYfMAtUg6whV?cluster=devnet) — records payment receipts + per-epoch operator stats
  - **Operator Registry** [`38X2K9cy8m4LnvtRmhFWs6TRuxCZV24znbBqCDJaAPXT`](https://explorer.solana.com/address/38X2K9cy8m4LnvtRmhFWs6TRuxCZV24znbBqCDJaAPXT?cluster=devnet) — handles registration, staking, deregistration, and slashing

---

## Quick start (local)

Prerequisites: Node 18+, a Solana devnet wallet, devnet USDC (`spl-token mint` against `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`).

**Facilitator:**
```bash
cd packages/facilitator
cp .env.example .env
# fill in OPERATOR_ADDRESS, OPERATOR_PRIVATE_KEY, HELIUS_RPC_URL
npm install
npm start
# → Listening on :4000
```

**Frontend:**
```bash
cd frontend
cp .env.example .env
# fill in NEXT_PUBLIC_HELIUS_RPC_URL, NEXT_PUBLIC_FACILITATOR_URL=http://localhost:4000
npm install
npm run dev
# → http://localhost:3000
```

**End-to-end demo via CLI:**
```bash
cd packages/client
PAYER_PRIVATE_KEY=<base58 devnet key with USDC> npx ts-node ai_client.ts
# → 402 received → USDC transfer signed → settlement TX printed
```

---

## x402 flow

The facilitator exposes three endpoints:

- `GET /supported` — list of accepted assets and networks
- `POST /verify` — verify a payment header without settling
- `POST /settle` — verify and settle on-chain (returns Solana TX signature)

A protected resource returns `402 Payment Required` with a `paymentRequired` array describing what the client must pay. The client signs an SPL USDC transfer, wraps the resulting signature + nonce in a base64 `X-PAYMENT` header, and retries. The facilitator settles the payment via the Anchor settlement program, which writes a receipt PDA (keyed by nonce, replay-protected) and updates the operator's per-epoch stats.

---

## Operator lifecycle + slashing

1. `register_operator(endpoint_url, region, stake_amount)` — deposit ≥ 1,000,000 µUSDC into the operator's vault PDA.
2. Each request the operator settles bumps `payment_count` in their `OperatorStats` PDA for the current epoch (epoch = 60s on devnet for fast demos).
3. If an operator's `payment_count == 0` for a completed epoch, **anyone can call `slash_operator(epoch)`** and earn 10% of the vault as a bounty.
4. The slash record is keyed per (operator, epoch) — can only be slashed once per epoch.

CLI scripts in `packages/facilitator/` cover the operator side:
- `init-protocol.ts` — bootstrap the protocol state
- `setup_slashable.ts` — register an operator and let an epoch pass with zero activity
- `slash.ts <epoch>` — execute a slash against a target epoch
- `claim-rewards.ts` — claim earned reward tokens

---

## Stack

- **Solana** + **Anchor 0.32** — on-chain programs
- **Next.js 14** + **Solana Wallet Adapter** — dashboard
- **Express 5** — facilitator HTTP server
- **TypeScript** end-to-end
- **x402** payment protocol (HTTP 402 micropayments)

---

## Network

All on-chain components are currently deployed on **Solana devnet**. USDC mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (devnet test USDC).
