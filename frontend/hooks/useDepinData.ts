'use client'

import { useEffect, useState, useCallback } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import { AnchorProvider, Program } from '@coral-xyz/anchor'

// ── Program IDs ──────────────────────────────────────────────────────────────
export const SETTLEMENT_PROGRAM_ID = new PublicKey('Hzg2MGHMMoVDgA5X5v5r4XwMKyZAwUyZuYfMAtUg6whV')
export const REGISTRY_PROGRAM_ID   = new PublicKey('38X2K9cy8m4LnvtRmhFWs6TRuxCZV24znbBqCDJaAPXT')
export const USDC_MINT             = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
export const REWARD_MINT           = new PublicKey('8oXkboReapvTEsVmmxgVgnT8hwfBvpn5UPBZRyushuve')
export const EPOCH_DURATION        = 60

// ── Types ────────────────────────────────────────────────────────────────────
export interface OperatorRecord {
  pubkey:      string
  authority:   string
  endpointUrl: string
  region:      string
  stake:       number
  registeredAt: number
  active:      boolean
  totalVolume: number
  score:       number
  vaultBalance?: number
}

export interface SlashRecord {
  pubkey:      string
  operator:    string
  epoch:       number
  challenger:  string
  slashAmount: number
  slashedAt:   number
}

export interface EpochStats {
  epoch:         number
  paymentCount:  number
  volume:        number
  rewardsClaimed: boolean
}

// ── Minimal IDLs (account layout only) ───────────────────────────────────────
import REGISTRY_IDL from '@/idl/operator_registry.json'

// ── Helper: epoch buffer ──────────────────────────────────────────────────────
export function currentEpoch(): number {
  return Math.floor(Date.now() / 1000 / EPOCH_DURATION)
}

export function epochToBuffer(epoch: number): Buffer {
  const buf = Buffer.alloc(8)
  buf.writeBigInt64LE(BigInt(epoch))
  return buf
}

export function derivePDA(seeds: Buffer[], programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(seeds, programId)
  return pda
}

// ── Main hook ─────────────────────────────────────────────────────────────────
export function useDepinData() {
  const { connection }          = useConnection()
  const { publicKey, signTransaction, signAllTransactions } = useWallet()

  const [operators,   setOperators]   = useState<OperatorRecord[]>([])
  const [slashRecords, setSlashRecords] = useState<SlashRecord[]>([])
  const [myStats,     setMyStats]     = useState<EpochStats | null>(null)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  // ── Build Anchor provider (read-only friendly) ────────────────────────────
  const getProvider = useCallback(() => {
    const wallet = publicKey && signTransaction && signAllTransactions
      ? { publicKey, signTransaction, signAllTransactions }
      : {
          publicKey: PublicKey.default,
          signTransaction: async (tx: any) => tx,
          signAllTransactions: async (txs: any) => txs,
        }
    return new AnchorProvider(connection, wallet as any, { commitment: 'confirmed' })
  }, [connection, publicKey, signTransaction, signAllTransactions])

  // ── Fetch all operators ───────────────────────────────────────────────────
  const fetchOperators = useCallback(async () => {
    try {
      const provider = getProvider()
      const program = new Program(REGISTRY_IDL as any, provider)
      const all      = await (program.account as any).operatorRecord.all()

      const ops: OperatorRecord[] = await Promise.all(
        all.map(async (o: any) => {
          const authority = o.account.authority as PublicKey
          const vaultPDA  = derivePDA(
            [Buffer.from('vault'), authority.toBuffer()],
            REGISTRY_PROGRAM_ID
          )
          let vaultBalance = 0
          try {
            const bal = await connection.getTokenAccountBalance(vaultPDA)
            vaultBalance = bal.value.uiAmount ?? 0
          } catch {}

          return {
            pubkey:       o.publicKey.toBase58(),
            authority:    authority.toBase58(),
            endpointUrl:  o.account.endpointUrl,
            region:       o.account.region,
            stake:        o.account.stake.toNumber(),
            registeredAt: o.account.registeredAt.toNumber(),
            active:       o.account.active,
            totalVolume:  o.account.totalVolume.toNumber(),
            score:        o.account.score.toNumber(),
            vaultBalance,
          }
        })
      )

      // Sort: active first, then by stake desc
      ops.sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1
        return b.stake - a.stake
      })

      setOperators(ops)
    } catch (e: any) {
      console.error('fetchOperators error:', e)
    }
  }, [connection, getProvider])

  // ── Fetch slash records ───────────────────────────────────────────────────
  const fetchSlashRecords = useCallback(async () => {
    try {
      const provider = getProvider()
      const program  = new Program(REGISTRY_IDL as any, provider)
      const all      = await (program.account as any).slashRecord.all()

      const records: SlashRecord[] = all.map((r: any) => ({
        pubkey:      r.publicKey.toBase58(),
        operator:    (r.account.operator as PublicKey).toBase58(),
        epoch:       r.account.epoch.toNumber(),
        challenger:  (r.account.challenger as PublicKey).toBase58(),
        slashAmount: r.account.slashAmount.toNumber(),
        slashedAt:   r.account.slashedAt.toNumber(),
      }))

      records.sort((a, b) => b.slashedAt - a.slashedAt)
      setSlashRecords(records)
    } catch (e: any) {
      console.error('fetchSlashRecords error:', e)
    }
  }, [getProvider])

  // ── Fetch my epoch stats (connected wallet) ───────────────────────────────
  const fetchMyStats = useCallback(async () => {
    if (!publicKey) return
    try {
      const epoch      = currentEpoch() - 1 // last completed epoch
      const statsPDA   = derivePDA(
        [Buffer.from('stats'), publicKey.toBuffer(), epochToBuffer(epoch)],
        SETTLEMENT_PROGRAM_ID
      )
      const info = await connection.getAccountInfo(statsPDA)
      if (!info) { setMyStats(null); return }

      const data         = info.data
      const payload      = data.slice(8)
      const paymentCount = Number(payload.readBigUInt64LE(40))
      const volume       = Number(payload.readBigUInt64LE(48))
      const rewardsClaimed = payload[56] !== 0

      setMyStats({ epoch, paymentCount, volume, rewardsClaimed })
    } catch (e) {
      setMyStats(null)
    }
  }, [connection, publicKey])

  // ── Full refresh ──────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await Promise.all([fetchOperators(), fetchSlashRecords(), fetchMyStats()])
      setLastRefresh(new Date())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [fetchOperators, fetchSlashRecords, fetchMyStats])

  // Fetch on mount and when wallet connects/disconnects.
  // No auto-polling — user triggers updates via the Topbar refresh button.
  useEffect(() => { refresh() }, [publicKey])

  return {
    operators,
    slashRecords,
    myStats,
    loading,
    error,
    lastRefresh,
    refresh,
    myOperator: publicKey
      ? operators.find(o => o.authority === publicKey.toBase58()) ?? null
      : null,
  }
}