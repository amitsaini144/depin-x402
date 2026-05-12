import express from 'express'

const app = express()
app.use(express.json())

const PRICE_USDC = 0.001
const TREASURY = 'C9rwmkp5HC4XyhZDwJ7h39tDwVyv8CqRzEJvpzQFPV1L'
const OPERATOR_PUBKEY = 'C9rwmkp5HC4XyhZDwJ7h39tDwVyv8CqRzEJvpzQFPV1L'

app.get('/api/data', async (req, res) => {
    const payment = req.headers['x-payment']

    const requirements = {
        scheme: 'exact',
        network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
        maxAmountRequired: String(PRICE_USDC * 1_000_000),
        resource: 'http://localhost:3000/api/data',
        description: 'Pay per API call',
        mimeType: 'application/json',
        payTo: TREASURY,
        maxTimeoutSeconds: 300,
        asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    }

    if (!payment) {
        return res.status(402).json({
            x402Version: 1,
            accepts: [requirements],
            error: 'Payment required'
        })
    }

    try {
        // Verify
        console.log('→ Calling verify...')
        const verifyRes = await fetch('http://localhost:4000/verify', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-operator-pubkey': OPERATOR_PUBKEY,
            },
            body: JSON.stringify({ paymentPayload: payment, paymentRequirements: requirements })
        })
        console.log('Verify status:', verifyRes.status)
        const verifyBody = await verifyRes.json() as any
        console.log('Verify body:', JSON.stringify(verifyBody))
        const { isValid, invalidReason } = verifyBody

        if (!isValid) {
            return res.status(402).json({ error: invalidReason })
        }

        // Settle
        console.log('→ Calling settle...')
        const settleRes = await fetch('http://localhost:4000/settle', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-operator-pubkey': OPERATOR_PUBKEY,
            },
            body: JSON.stringify({ paymentPayload: payment, paymentRequirements: requirements })
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
            txSignature: settlement.txSignature,
            receiptPda: settlement.receiptPda,
            settledBy: settlement.settledBy,
        })

    } catch (e: any) {
        console.error('❌ Server error:', e.message)
        res.status(500).json({ error: e.message })
    }
})

app.listen(3000, () => console.log('Server running on :3000'))