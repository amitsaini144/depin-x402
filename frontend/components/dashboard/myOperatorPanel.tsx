'use client'

import { useState } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import { Program, AnchorProvider, BN, Idl } from '@coral-xyz/anchor'
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  OperatorRecord, EpochStats,
  SETTLEMENT_PROGRAM_ID, REWARD_MINT,
  currentEpoch, epochToBuffer, derivePDA,
} from '@/hooks/useDepinData'
import { Wallet, UserX, Check } from 'lucide-react'
import { Panel, PanelHeader, shortAddr } from '@/components/ui/panel'
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
    setClaimMsg('Preparing…')
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
      const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' })
      const idl: Idl = { ...CLAIM_IDL, address: SETTLEMENT_PROGRAM_ID.toBase58(), metadata: { name: CLAIM_IDL.name, version: CLAIM_IDL.version, spec: '0.1.0' } } as unknown as Idl
      const program  = new Program(idl, provider)

      setClaimMsg('Awaiting wallet…')
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

      setClaimMsg(`Claimed · ${tx.slice(0, 8)}…`)
      await fetchRewardBal()
      onRefresh()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      setClaimMsg(
        msg.includes('AlreadyClaimed')    ? 'Already claimed this epoch'   :
        msg.includes('EpochNotComplete')  ? 'Epoch not complete yet'       :
        `Failed: ${msg.slice(0, 50)}`
      )
    } finally {
      setClaiming(false)
    }
  }

  if (!publicKey) {
    return (
      <EmptyState
        icon={<Wallet size={20} />}
        title="Connect your wallet"
        body="See your stake, vault and epoch activity, and claim rewards."
      />
    )
  }

  if (!operator) {
    return (
      <EmptyState
        icon={<UserX size={20} />}
        title="This wallet isn't a registered operator"
        body={<span className="addr">{shortAddr(publicKey.toBase58(), 8, 6)}</span>}
      />
    )
  }

  const epoch        = currentEpoch()
  const prevEpoch    = epoch - 1
  const canClaim     = myStats && myStats.paymentCount > 0 && !myStats.rewardsClaimed
  const rewardAmount = myStats ? myStats.paymentCount * 1 : 0 // 1 reward token per tx

  return (
    <Panel>
      <PanelHeader
        title="My operator"
        meta={
          <span className="inline-flex items-center gap-1.5 text-fg">
            <span className="h-2 w-2 rounded-full bg-pos" /> Active
          </span>
        }
      />

      {/* Endpoint */}
      <div className="px-5 pt-5">
        <p className="text-xs text-muted">Endpoint</p>
        <p className="mt-1 text-[15px] font-medium text-fg truncate">{operator.endpointUrl}</p>
      </div>

      {/* Key figures */}
      <dl className="mx-5 mt-5 grid grid-cols-2 sm:grid-cols-4 gap-y-4 border-y border-line py-4">
        <Figure label="Stake"      value={(operator.stake / 1_000_000).toFixed(2)} unit="USDC" />
        <Figure label="Vault"      value={operator.vaultBalance?.toFixed(2) ?? '—'} unit="USDC" />
        <Figure label="Region"     value={operator.region} plain />
        <Figure label="Registered" value={new Date(operator.registeredAt * 1000).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} plain />
      </dl>

      {/* Epoch stats + claim */}
      <div className="px-5 py-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-fg">
            Epoch <span className="num">{prevEpoch.toLocaleString()}</span>
          </h3>
          {myStats?.rewardsClaimed && (
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <Check size={13} className="text-pos" /> Rewards claimed
            </span>
          )}
        </div>

        {myStats ? (
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted">Payments</p>
              <p className="num mt-1 text-2xl font-medium text-fg">{myStats.paymentCount}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Volume</p>
              <p className="mt-1 text-fg">
                <span className="num text-2xl font-medium">{(myStats.volume / 1_000_000).toFixed(4)}</span>
                <span className="ml-1 text-xs text-dim">USDC</span>
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">No activity recorded for this epoch.</p>
        )}

        <button
          onClick={handleClaim}
          disabled={!canClaim || claiming}
          className={clsx(
            'mt-5 w-full h-11 rounded-lg text-sm font-medium transition-colors',
            canClaim && !claiming
              ? 'bg-accent text-accent-fg hover:bg-accent/90'
              : 'bg-subtle text-muted cursor-not-allowed'
          )}
        >
          {claiming ? claimMsg ?? 'Claiming…'
            : myStats?.rewardsClaimed ? 'Already claimed'
            : !myStats || myStats.paymentCount === 0 ? 'No rewards to claim'
            : `Claim ${rewardAmount} reward ${rewardAmount === 1 ? 'token' : 'tokens'}`}
        </button>

        {!claiming && claimMsg && (
          <p className="mt-2 text-xs text-muted text-center">{claimMsg}</p>
        )}
      </div>

      {/* Reward balance */}
      <div className="flex items-center justify-between px-5 py-4 border-t border-line bg-subtle/40">
        <span className="text-sm text-muted">Reward balance</span>
        {rewardBal !== null ? (
          <span className="text-sm text-fg">
            <span className="num font-medium">{rewardBal}</span>
            <span className="ml-1 text-xs text-dim">tokens</span>
          </span>
        ) : (
          <button onClick={fetchRewardBal} className="text-sm font-medium text-accent-strong hover:underline underline-offset-4">
            Check balance
          </button>
        )}
      </div>
    </Panel>
  )
}

function Figure({ label, value, unit, plain }: { label: string; value: string; unit?: string; plain?: boolean }) {
  return (
    <div className="min-w-0 pr-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-fg truncate">
        <span className={clsx('font-medium', plain ? 'text-sm' : 'num text-base')}>{value}</span>
        {unit && <span className="ml-1 text-xs text-dim">{unit}</span>}
      </dd>
    </div>
  )
}

function EmptyState({ icon, title, body }: { icon: React.ReactNode; title: string; body: React.ReactNode }) {
  return (
    <Panel className="flex flex-col items-center justify-center gap-3 text-center px-6 py-16">
      <div className="h-10 w-10 rounded-full bg-subtle text-muted inline-flex items-center justify-center">
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium text-fg">{title}</p>
        <p className="mt-1 text-xs text-muted">{body}</p>
      </div>
    </Panel>
  )
}
