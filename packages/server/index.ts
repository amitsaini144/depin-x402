import express from 'express'
import dotenv from 'dotenv'

dotenv.config()

const PORT = parseInt(process.env.PORT ?? '3000')
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? 'http://localhost:4000'
const RESOURCE_URL =
    process.env.RESOURCE_URL ??
    (process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/data`
        : `http://localhost:${PORT}/api/data`)
const TREASURY = process.env.TREASURY
const OPERATOR_PUBKEY = process.env.OPERATOR_ADDRESS
const SOLANA_NETWORK = process.env.SOLANA_NETWORK
const SOLANA_GENESIS_HASH = process.env.SOLANA_GENESIS_HASH
const USDC_MINT = process.env.USDC_MINT
const PRICE_USDC = parseFloat(process.env.PRICE_USDC ?? '0.001')

const app = express()
app.use(express.json())

app.get('/health', (_req, res) => {
    res.json({ status: 'ok', network: SOLANA_NETWORK, ts: new Date().toISOString() })
})

app.get('/api/data', async (req, res) => {
    const payment = req.headers['x-payment']

    const requirements = {
        scheme: 'exact',
        network: `solana:${SOLANA_GENESIS_HASH}`,
        maxAmountRequired: String(Math.round(PRICE_USDC * 1_000_000)),
        resource: RESOURCE_URL,
        description: 'Pay per API call',
        mimeType: 'application/json',
        payTo: TREASURY,
        maxTimeoutSeconds: 300,
        asset: USDC_MINT,
    }

    if (!payment) {
        return res.status(402).json({
            x402Version: 1,
            accepts: [requirements],
            error: 'Payment required'
        })
    }

    try {
        const facilitatorBody = {
            payment,
            requiredAmount: Number(requirements.maxAmountRequired),
            resource: requirements.resource,
        }

        console.log('→ Calling verify...')
        const verifyRes = await fetch(`${FACILITATOR_URL}/verify`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-operator-pubkey': OPERATOR_PUBKEY,
            },
            body: JSON.stringify(facilitatorBody)
        })
        console.log('Verify status:', verifyRes.status)
        const verifyBody = await verifyRes.json() as any
        console.log('Verify body:', JSON.stringify(verifyBody))
        const { valid, invalidReason } = verifyBody

        if (!valid) {
            return res.status(402).json({ error: invalidReason ?? 'Payment verification failed' })
        }

        console.log('→ Calling settle...')
        const settleRes = await fetch(`${FACILITATOR_URL}/settle`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-operator-pubkey': OPERATOR_PUBKEY,
            },
            body: JSON.stringify(facilitatorBody)
        })
        console.log('Settle status:', settleRes.status)
        const settlement = await settleRes.json() as any
        console.log('Settle result:', JSON.stringify(settlement))

        if (!settlement.success) {
            return res.status(402).json({ error: 'Settlement failed', detail: settlement.error })
        }

        res.setHeader('x-payment-response', Buffer.from(JSON.stringify(settlement)).toString('base64'))
        res.json({
            data: 'protected content',
            txSignature: settlement.transaction,
        })

    } catch (e: any) {
        console.error('Server error:', e.message)
        res.status(500).json({ error: e.message })
    }
})

app.listen(PORT, () => console.log(`Server running on :${PORT}`))
