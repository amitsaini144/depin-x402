import express from 'express'
import dotenv from 'dotenv'

dotenv.config()

const PORT = parseInt(process.env.PORT ?? '3000')
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? 'http://localhost:4000'

const RESOURCE_URL = process.env.RESOURCE_URL ?? 
    (process.env.RAILWAY_PUBLIC_DOMAIN 
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/data` 
        : `http://localhost:${PORT}/api/data`)

const PRICE_USDC = parseFloat(process.env.PRICE_USDC ?? '0.001')

const app = express()
app.use(express.json())

app.get('/health', (_req, res) => {
    res.json({ status: 'ok', ts: new Date().toISOString() })
})

app.get('/api/data', async (req, res) => {
    const payment = req.headers['x-payment'] as string

    const requiredAmount = Math.round(PRICE_USDC * 1_000_000)

    const requirements = {
        scheme: 'exact',
        network: 'solana-devnet',           // or use genesis hash if you prefer
        maxAmountRequired: String(requiredAmount),
        resource: RESOURCE_URL,
        description: 'Pay per API call',
        mimeType: 'application/json',
    }

    if (!payment) {
        return res.status(402).json({
            x402Version: 1,
            accepts: [requirements],
            error: 'Payment required'
        })
    }

    try {
        const body = {
            payment,
            requiredAmount,
            resource: requirements.resource,
        }

        // Verify
        const verifyRes = await fetch(`${FACILITATOR_URL}/verify`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
        })

        const verifyBody = await verifyRes.json() as any

        if (!verifyBody.valid) {
            return res.status(402).json({ 
                error: verifyBody.invalidReason || 'Payment verification failed' 
            })
        }

        // Settle
        const settleRes = await fetch(`${FACILITATOR_URL}/settle`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
        })

        const settlement = await settleRes.json() as any

        if (!settlement.success) {
            return res.status(402).json({ error: 'Settlement failed' })
        }

        res.setHeader('x-payment-response', Buffer.from(JSON.stringify(settlement)).toString('base64'))
        res.json({
            data: 'This is protected content',
            txSignature: settlement.transaction,
            receipt: settlement.receipt
        })

    } catch (e: any) {
        console.error('Server error:', e)
        res.status(500).json({ error: e.message })
    }
})

app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`))