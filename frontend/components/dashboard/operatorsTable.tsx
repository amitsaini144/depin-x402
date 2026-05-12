'use client'

import { useState } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import { Program, AnchorProvider, BN, Idl } from '@coral-xyz/anchor'
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction } from '@solana/spl-token'
import { OperatorRecord, REGISTRY_PROGRAM_ID, USDC_MINT, currentEpoch, epochToBuffer, derivePDA, SETTLEMENT_PROGRAM_ID } from '@/hooks/useDepinData'
import { Shield, ShieldOff, ExternalLink, Sword, ChevronUp, ChevronDown } from 'lucide-react'
import clsx from 'clsx'
import REGISTRY_IDL from '@/idl/operator_registry.json'

interface OperatorsTableProps {
  operators: OperatorRecord[]
  onRefresh:  () => void
}

type SortKey = 'stake' | 'region' | 'registeredAt'

export function OperatorsTable({ operators, onRefresh }: OperatorsTableProps) {
  const { publicKey, signTransaction, signAllTransactions } = useWallet()
  const { connection } = useConnection()
  const [slashing,  setSlashing]  = useState<string | null>(null)
  const [slashMsg,  setSlashMsg]  = useState<Record<string, string>>({})
  const [sortKey,   setSortKey]   = useState<SortKey>('stake')
  const [sortAsc,   setSortAsc]   = useState(false)

  const sorted = [...operators].sort((a, b) => {
    const v = sortKey === 'stake'        ? a.stake - b.stake
            : sortKey === 'registeredAt' ? a.registeredAt - b.registeredAt
            : a.region.localeCompare(b.region)
    return sortAsc ? v : -v
  })

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(false) }
  }

  const handleSlash = async (op: OperatorRecord) => {
    if (!publicKey || !signTransaction || !signAllTransactions) return
    const opKey = new PublicKey(op.authority)
    const target = currentEpoch() - 1

    setSlashing(op.authority)
    setSlashMsg(m => ({ ...m, [op.authority]: 'Checking epoch...' }))

    try {
      // Check if stats PDA exists
      const statsPDA = derivePDA(
        [Buffer.from('stats'), opKey.toBuffer(), epochToBuffer(target)],
        SETTLEMENT_PROGRAM_ID
      )
      const statsInfo = await connection.getAccountInfo(statsPDA)

      // Check if slash record already exists
      const slashRecordPDA = derivePDA(
        [Buffer.from('slash'), opKey.toBuffer(), epochToBuffer(target)],
        REGISTRY_PROGRAM_ID
      )
      const slashExists = await connection.getAccountInfo(slashRecordPDA)
      if (slashExists) {
        setSlashMsg(m => ({ ...m, [op.authority]: '⚠ Already slashed this epoch' }))
        setSlashing(null)
        return
      }

      const operatorPDA = derivePDA([Buffer.from('operator'), opKey.toBuffer()], REGISTRY_PROGRAM_ID)
      const vaultPDA    = derivePDA([Buffer.from('vault'),    opKey.toBuffer()], REGISTRY_PROGRAM_ID)
      const challengerAta = await getAssociatedTokenAddress(USDC_MINT, publicKey)

      const ataInfo = await connection.getAccountInfo(challengerAta)
      const preIxs = ataInfo
        ? []
        : [createAssociatedTokenAccountInstruction(publicKey, challengerAta, publicKey, USDC_MINT)]

      const wallet   = { publicKey, signTransaction, signAllTransactions }
      const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' })
      const program  = new Program(REGISTRY_IDL as Idl, provider)

      setSlashMsg(m => ({ ...m, [op.authority]: 'Sending tx...' }))

      const tx = await (program.methods as unknown as {
        slashOperator: (epoch: BN) => {
          accounts: (a: Record<string, PublicKey>) => {
            preInstructions: (ixs: unknown[]) => { rpc: () => Promise<string> }
          }
        }
      })
        .slashOperator(new BN(target))
        .accounts({
          challenger:             publicKey,
          challengerTokenAccount: challengerAta,
          operatorRecord:         operatorPDA,
          vault:                  vaultPDA,
          mint:                   USDC_MINT,
          operatorStats:          statsInfo ? statsPDA : PublicKey.default,
          slashRecord:            slashRecordPDA,
          tokenProgram:           TOKEN_PROGRAM_ID,
          systemProgram:          PublicKey.default,
        })
        .preInstructions(preIxs)
        .rpc()

      setSlashMsg(m => ({ ...m, [op.authority]: `✅ Slashed! ${tx.slice(0, 8)}...` }))
      setTimeout(onRefresh, 2000)
    } catch (e: unknown) {
      console.error('Slash error', e)
      const msg = e instanceof Error ? e.message : 'Unknown error'
      const clean = msg.includes('HasPayments')       ? '⚠ Had payments this epoch'
                  : msg.includes('AlreadySlashed')    ? '⚠ Already slashed'
                  : msg.includes('EpochNotComplete')  ? '⚠ Epoch not done yet'
                  : msg.includes('EmptyVault')        ? '⚠ Vault empty'
                  : `❌ ${msg.slice(0, 40)}`
      setSlashMsg(m => ({ ...m, [op.authority]: clean }))
    } finally {
      setSlashing(null)
    }
  }

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k
      ? sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />
      : <ChevronDown size={12} className="opacity-20" />

  return (
    <div className="rounded-xl border border-line bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-line">
        <h2 className="font-mono text-sm font-semibold text-fg">
          Network Operators
        </h2>
        <span className="font-mono text-[10px] text-dim">
          {operators.filter(o => o.active).length} active / {operators.length} total
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="text-left px-4 py-2.5 font-mono text-[10px] text-dim uppercase tracking-widest">
                Status
              </th>
              <th className="text-left px-4 py-2.5 font-mono text-[10px] text-dim uppercase tracking-widest">
                Endpoint
              </th>
              <th
                className="text-left px-4 py-2.5 font-mono text-[10px] text-dim uppercase tracking-widest cursor-pointer hover:text-muted"
                onClick={() => handleSort('region')}
              >
                <span className="flex items-center gap-1">Region <SortIcon k="region" /></span>
              </th>
              <th
                className="text-right px-4 py-2.5 font-mono text-[10px] text-dim uppercase tracking-widest cursor-pointer hover:text-muted"
                onClick={() => handleSort('stake')}
              >
                <span className="flex items-center justify-end gap-1">Stake <SortIcon k="stake" /></span>
              </th>
              <th className="text-right px-4 py-2.5 font-mono text-[10px] text-dim uppercase tracking-widest">
                Vault
              </th>
              <th
                className="text-right px-4 py-2.5 font-mono text-[10px] text-dim uppercase tracking-widest cursor-pointer hover:text-muted"
                onClick={() => handleSort('registeredAt')}
              >
                <span className="flex items-center justify-end gap-1">Joined <SortIcon k="registeredAt" /></span>
              </th>
              <th className="text-right px-4 py-2.5 font-mono text-[10px] text-dim uppercase tracking-widest">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((op, i) => (
              <tr
                key={op.pubkey}
                className={clsx(
                  'border-b border-line last:border-0 transition-colors duration-100',
                  'hover:bg-subtle',
                  !op.active && 'opacity-50'
                )}
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {op.active
                      ? <><div className="w-1.5 h-1.5 rounded-full bg-[#00FF88] animate-pulse-slow" /><Shield size={12} className="text-[#00FF88]" /></>
                      : <><div className="w-1.5 h-1.5 rounded-full bg-dim" /><ShieldOff size={12} className="text-dim" /></>
                    }
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs text-fg truncate max-w-[160px]">
                      {op.endpointUrl}
                    </span>
                    <a
                      href={op.endpointUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-dim hover:text-[#00E5FF] transition-colors"
                    >
                      <ExternalLink size={10} />
                    </a>
                  </div>
                  <div className="font-mono text-[10px] text-dim mt-0.5">
                    {op.authority.slice(0, 8)}...{op.authority.slice(-4)}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-line text-muted">
                    {op.region}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-mono text-xs text-fg">
                    {(op.stake / 1_000_000).toFixed(2)}
                  </span>
                  <span className="font-mono text-[10px] text-dim ml-1">USDC</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={clsx(
                    'font-mono text-xs',
                    (op.vaultBalance ?? 0) > 0 ? 'text-[#00FF88]' : 'text-dim'
                  )}>
                    {op.vaultBalance?.toFixed(2) ?? '—'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-mono text-[10px] text-dim">
                    {new Date(op.registeredAt * 1000).toLocaleDateString()}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {publicKey && op.active && op.authority !== publicKey.toBase58() ? (
                    <div className="flex flex-col items-end gap-1">
                      <button
                        onClick={() => handleSlash(op)}
                        disabled={slashing === op.authority}
                        className={clsx(
                          'flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[10px] font-mono font-semibold transition-all duration-150',
                          'border-[#FF3B5C40] text-[#FF3B5C] hover:bg-[#FF3B5C15] hover:border-[#FF3B5C]',
                          slashing === op.authority && 'opacity-50 cursor-not-allowed'
                        )}
                      >
                        <Sword size={10} />
                        {slashing === op.authority ? 'Slashing...' : 'Slash'}
                      </button>
                      {slashMsg[op.authority] && (
                        <span className="font-mono text-[9px] text-muted max-w-[120px] text-right">
                          {slashMsg[op.authority]}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="font-mono text-[10px] text-dim">
                      {!publicKey ? '—' : op.authority === publicKey.toBase58() ? 'You' : '—'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {operators.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center font-mono text-xs text-dim">
                  No operators registered
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}