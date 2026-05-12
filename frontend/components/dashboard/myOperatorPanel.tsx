'use client'

import { useState } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor'
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  OperatorRecord, EpochStats,
  SETTLEMENT_PROGRAM_ID, REGISTRY_PROGRAM_ID, REWARD_MINT,
  currentEpoch, epochToBuffer, derivePDA,
} from '@/hooks/useDepinData'
import { Wallet, Trophy, AlertCircle, CheckCircle, Clock, Zap } from 'lucide-react'
import clsx from 'clsx'

const CLAIM_IDL = {
  version: '0.1.0',
  name: 'settlement_program',
  instructions: [
    {
      name: 'claimRewards',
      accounts: [
        { name: 'authority',        isMut: true,  isSigner: true  },
        { name: 'operatorStats',    isMut: true,  isSigner: false },
        { name: 'rewardMint',       isMut: true,  isSigner: false },
        { name: 'rewardAuthority',  isMut: false, isSigner: false },
        { name: 'operatorRewardAta',isMut: true,  isSigner: false },
        { name: 'tokenProgram',     isMut: false, isSigner: false },
        { name: 'systemProgram',    isMut: false, isSigner: false },
      ],
      args: [{ name: 'epoch', type: 'i64' }],
    },
  ],
  accounts: [],
  errors: [],
}

interface MyOperatorPanelProps {
  operator:  OperatorRecord | null
  myStats:   EpochStats | null
  onRefresh: () => void
}

export function MyOperatorPanel({ operator, myStats, onRefresh }: MyOperatorPanelProps) {
  const { publicKey, signTransaction, signAllTransactions } = useWallet()
  const { connection } = useConnection()
  const [claiming,  setClaiming]  = useState(false)
  const [claimMsg,  setClaimMsg]  = useState<string | null>(null)
  const [rewardBal, setRewardBal] = useState<number | null>(null)

  // Fetch reward token balance
  const fetchRewardBal = async () => {
    if (!publicKey) return
    try {
      const ata = await getAssociatedTokenAddress(REWARD_MINT, publicKey)
      const bal = await connection.getTokenAccountBalance(ata)
      setRewardBal(bal.value.uiAmount)
    } catch { setRewardBal(0) }
  }

  const handleClaim = async () => {
    if (!publicKey || !signTransaction || !signAllTransactions || !myStats) return
    setClaiming(true)
    setClaimMsg('Preparing...')
    try {
      const epoch = myStats.epoch
      const statsPDA = derivePDA(
        [Buffer.from('stats'), publicKey.toBuffer(), epochToBuffer(epoch)],
        SETTLEMENT_PROGRAM_ID
      )
      const [rewardMint]      = PublicKey.findProgramAddressSync([Buffer.from('reward-mint')],      SETTLEMENT_PROGRAM_ID)
      const [rewardAuthority] = PublicKey.findProgramAddressSync([Buffer.from('reward-authority')], SETTLEMENT_PROGRAM_ID)
      const operatorRewardAta = await getAssociatedTokenAddress(REWARD_MINT, publicKey)

      const wallet   = { publicKey, signTransaction, signAllTransactions }
      const provider = new AnchorProvider(connection, wallet as any, { commitment: 'confirmed' })
      const program  = new Program(CLAIM_IDL as any, SETTLEMENT_PROGRAM_ID, provider)

      setClaimMsg('Awaiting wallet...')
      const tx = await program.methods
        .claimRewards(new BN(epoch))
        .accounts({
          authority:         publicKey,
          operatorStats:     statsPDA,
          rewardMint,
          rewardAuthority,
          operatorRewardAta,
          tokenProgram:      TOKEN_PROGRAM_ID,
          systemProgram:     PublicKey.default,
        })
        .rpc()

      setClaimMsg(`✅ Claimed! ${tx.slice(0, 8)}...`)
      await fetchRewardBal()
      onRefresh()
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      setClaimMsg(
        msg.includes('AlreadyClaimed')    ? '⚠ Already claimed this epoch'   :
        msg.includes('EpochNotComplete')  ? '⚠ Epoch not complete yet'       :
        `❌ ${msg.slice(0, 50)}`
      )
    } finally {
      setClaiming(false)
    }
  }

  // Prompt wallet connect
  if (!publicKey) {
    return (
      <div className="rounded-xl border border-line bg-card p-6 flex flex-col items-center justify-center gap-3 text-center min-h-[180px]">
        <Wallet size={28} className="text-dim" />
        <div>
          <p className="font-mono text-sm text-muted">Connect your wallet</p>
          <p className="font-mono text-[11px] text-dim mt-1">to view your operator data and claim rewards</p>
        </div>
      </div>
    )
  }

  // Wallet connected but not an operator
  if (!operator) {
    return (
      <div className="rounded-xl border border-line bg-card p-6 flex flex-col items-center justify-center gap-3 text-center min-h-[180px]">
        <AlertCircle size={28} className="text-[#FFB800]" />
        <div>
          <p className="font-mono text-sm text-muted">Not registered as operator</p>
          <p className="font-mono text-[11px] text-dim mt-1">
            {publicKey.toBase58().slice(0, 12)}...{publicKey.toBase58().slice(-6)}
          </p>
        </div>
      </div>
    )
  }

  const epoch        = currentEpoch()
  const prevEpoch    = epoch - 1
  const canClaim     = myStats && myStats.paymentCount > 0 && !myStats.rewardsClaimed
  const rewardAmount = myStats ? myStats.paymentCount * 1 : 0 // 1 reward token per tx

  return (
    <div className="rounded-xl border border-line bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-line">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#00FF88] animate-pulse-slow" />
          <h2 className="font-mono text-sm font-semibold text-fg">My Operator</h2>
        </div>
        <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-[#00FF8815] text-[#00FF88]">
          Active
        </span>
      </div>

      <div className="p-4 space-y-4">
        {/* Operator info row */}
        <div className="grid grid-cols-2 gap-3">
          <StatBox label="Stake" value={`${(operator.stake / 1_000_000).toFixed(2)} USDC`} accent="green" />
          <StatBox label="Vault" value={`${operator.vaultBalance?.toFixed(2) ?? '—'} USDC`} accent="cyan" />
          <StatBox label="Region" value={operator.region} accent="cyan" />
          <StatBox label="Registered" value={new Date(operator.registeredAt * 1000).toLocaleDateString()} accent="cyan" />
        </div>

        {/* Endpoint */}
        <div className="rounded-lg bg-surface border border-line px-3 py-2">
          <p className="font-mono text-[10px] text-dim mb-1 uppercase tracking-widest">Endpoint</p>
          <p className="font-mono text-xs text-[#00E5FF] truncate">{operator.endpointUrl}</p>
        </div>

        {/* Epoch stats + claim */}
        <div className="rounded-lg bg-surface border border-line p-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <Clock size={12} className="text-muted" />
              <span className="font-mono text-[10px] text-muted uppercase tracking-widest">
                Epoch {prevEpoch} stats
              </span>
            </div>
            {myStats?.rewardsClaimed && (
              <span className="flex items-center gap-1 font-mono text-[10px] text-[#00FF88]">
                <CheckCircle size={10} /> Claimed
              </span>
            )}
          </div>

          {myStats ? (
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <p className="font-mono text-[10px] text-dim">Payments</p>
                <p className="font-mono text-lg font-bold text-fg">{myStats.paymentCount}</p>
              </div>
              <div>
                <p className="font-mono text-[10px] text-dim">Volume</p>
                <p className="font-mono text-lg font-bold text-fg">
                  {(myStats.volume / 1_000_000).toFixed(4)}
                  <span className="text-[10px] text-dim ml-1">USDC</span>
                </p>
              </div>
            </div>
          ) : (
            <p className="font-mono text-xs text-dim mb-3">No activity recorded for epoch {prevEpoch}</p>
          )}

          {/* Claim button */}
          <button
            onClick={handleClaim}
            disabled={!canClaim || claiming}
            className={clsx(
              'w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg',
              'font-mono text-xs font-semibold transition-all duration-150',
              canClaim && !claiming
                ? 'bg-gradient-to-r from-[#00E5FF20] to-[#00FF8820] border border-[#00FF8840] text-[#00FF88] hover:from-[#00E5FF30] hover:to-[#00FF8830] hover:border-[#00FF88]'
                : 'bg-line border border-line text-dim cursor-not-allowed'
            )}
          >
            <Zap size={12} />
            {claiming ? claimMsg ?? 'Claiming...'
              : myStats?.rewardsClaimed ? `Already claimed (epoch ${prevEpoch})`
              : !myStats || myStats.paymentCount === 0 ? 'No rewards to claim'
              : `Claim ~${rewardAmount} reward tokens`}
          </button>

          {!claiming && claimMsg && (
            <p className="font-mono text-[11px] text-muted text-center mt-2">{claimMsg}</p>
          )}
        </div>

        {/* Reward balance */}
        <div
          className="rounded-lg bg-surface border border-line px-3 py-2 cursor-pointer hover:border-line transition-colors"
          onClick={fetchRewardBal}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Trophy size={12} className="text-[#FFB800]" />
              <span className="font-mono text-[10px] text-muted uppercase tracking-widest">Reward Balance</span>
            </div>
            <span className="font-mono text-xs text-fg">
              {rewardBal !== null ? `${rewardBal} tokens` : 'Click to fetch'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatBox({ label, value, accent }: { label: string; value: string; accent: 'cyan' | 'green' }) {
  return (
    <div className="rounded-lg bg-surface border border-line px-3 py-2">
      <p className="font-mono text-[10px] text-dim uppercase tracking-widest">{label}</p>
      <p className={clsx(
        'font-mono text-sm font-semibold mt-0.5 truncate',
        accent === 'cyan' ? 'text-[#00E5FF]' : 'text-[#00FF88]'
      )}>{value}</p>
    </div>
  )
}