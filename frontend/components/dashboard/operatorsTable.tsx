'use client'

import { useState } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import { Program, AnchorProvider, BN, Idl } from '@coral-xyz/anchor'
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction } from '@solana/spl-token'
import { OperatorRecord, REGISTRY_PROGRAM_ID, USDC_MINT, currentEpoch, epochToBuffer, derivePDA, SETTLEMENT_PROGRAM_ID } from '@/hooks/useDepinData'
import { ArrowUpRight, ChevronUp, ChevronDown } from 'lucide-react'
import { Panel, PanelHeader, shortAddr } from '@/components/ui/panel'
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
    setSlashMsg(m => ({ ...m, [op.authority]: 'Checking epoch…' }))

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
        setSlashMsg(m => ({ ...m, [op.authority]: 'Already slashed this epoch' }))
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

      setSlashMsg(m => ({ ...m, [op.authority]: 'Sending transaction…' }))

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

      setSlashMsg(m => ({ ...m, [op.authority]: `Slashed · ${tx.slice(0, 8)}…` }))
      setTimeout(onRefresh, 2000)
    } catch (e: unknown) {
      console.error('Slash error', e)
      const msg = e instanceof Error ? e.message : 'Unknown error'
      const clean = msg.includes('HasPayments')       ? 'Had payments this epoch'
                  : msg.includes('AlreadySlashed')    ? 'Already slashed'
                  : msg.includes('EpochNotComplete')  ? 'Epoch not finished yet'
                  : msg.includes('EmptyVault')        ? 'Vault is empty'
                  : `Failed: ${msg.slice(0, 40)}`
      setSlashMsg(m => ({ ...m, [op.authority]: clean }))
    } finally {
      setSlashing(null)
    }
  }


  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k
      ? sortAsc ? <ChevronUp size={13} /> : <ChevronDown size={13} />
      : <ChevronDown size={13} className="opacity-30" />

  const th = 'px-5 py-3 text-xs font-medium text-muted whitespace-nowrap'
  const sortable = 'cursor-pointer select-none hover:text-fg transition-colors'
  const me = publicKey?.toBase58()

  return (
    <Panel>
      <PanelHeader
        title="Operators"
        meta={<><span className="num text-fg">{operators.filter(o => o.active).length}</span> active of <span className="num">{operators.length}</span></>}
      />

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-subtle/50">
            <tr className="border-b border-line">
              <th className={clsx(th, 'text-left')}>Operator</th>
              <th className={clsx(th, 'text-left', sortable)} onClick={() => handleSort('region')}>
                <span className="inline-flex items-center gap-1">Region <SortIcon k="region" /></span>
              </th>
              <th className={clsx(th, 'text-right', sortable)} onClick={() => handleSort('stake')}>
                <span className="inline-flex items-center gap-1">Stake <SortIcon k="stake" /></span>
              </th>
              <th className={clsx(th, 'text-right')}>Vault</th>
              <th className={clsx(th, 'text-right', sortable)} onClick={() => handleSort('registeredAt')}>
                <span className="inline-flex items-center gap-1">Joined <SortIcon k="registeredAt" /></span>
              </th>
              <th className={clsx(th, 'text-right')}><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.map(op => (
              <tr key={op.pubkey} className="hover:bg-subtle/60 transition-colors">
                <td className="px-5 py-4">
                  <div className="flex items-start gap-3">
                    <span
                      className={clsx('mt-1.5 h-2 w-2 rounded-full shrink-0', op.active ? 'bg-pos' : 'bg-line')}
                      title={op.active ? 'Active' : 'Inactive'}
                    />
                    <div className="min-w-0">
                      <a
                        href={op.endpointUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={clsx(
                          'group inline-flex items-center gap-1 max-w-[240px] font-medium hover:text-accent-strong transition-colors',
                          op.active ? 'text-fg' : 'text-muted'
                        )}
                      >
                        <span className="truncate">{op.endpointUrl.replace(/^https?:\/\//, '')}</span>
                        <ArrowUpRight size={13} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </a>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                        <span className="addr">{shortAddr(op.authority)}</span>
                        {!op.active && <span>· Inactive</span>}
                        {op.authority === me && <span className="text-accent-strong font-medium">· You</span>}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-4 text-muted whitespace-nowrap">{op.region}</td>
                <td className="px-5 py-4 text-right whitespace-nowrap">
                  <span className="num text-fg">{(op.stake / 1_000_000).toFixed(2)}</span>
                  <span className="ml-1 text-xs text-dim">USDC</span>
                </td>
                <td className="px-5 py-4 text-right whitespace-nowrap">
                  <span className={clsx('num', (op.vaultBalance ?? 0) > 0 ? 'text-fg' : 'text-dim')}>
                    {op.vaultBalance?.toFixed(2) ?? '—'}
                  </span>
                </td>
                <td className="px-5 py-4 text-right whitespace-nowrap text-muted">
                  {new Date(op.registeredAt * 1000).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                </td>
                <td className="px-5 py-4 text-right">
                  {publicKey && op.active && op.authority !== me ? (
                    <div className="flex flex-col items-end gap-1.5">
                      <button
                        onClick={() => handleSlash(op)}
                        disabled={slashing === op.authority}
                        className={clsx(
                          'h-8 px-3 rounded-lg border border-accent-strong/40 text-xs font-medium text-accent-strong',
                          'hover:bg-accent hover:text-accent-fg hover:border-accent transition-colors',
                          'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-accent-strong'
                        )}
                      >
                        {slashing === op.authority ? 'Slashing…' : 'Slash'}
                      </button>
                      {slashMsg[op.authority] && (
                        <span className="text-[11px] text-muted max-w-[160px] text-right leading-snug">
                          {slashMsg[op.authority]}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-dim">—</span>
                  )}
                </td>
              </tr>
            ))}
            {operators.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center">
                  <p className="text-sm text-fg">No operators registered</p>
                  <p className="mt-1 text-xs text-muted">Registered operators will appear here.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
