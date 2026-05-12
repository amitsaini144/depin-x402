'use client'

import { useState } from 'react'
import { useDepinData } from '@/hooks/useDepinData'
import { Topbar } from '@/components/dashboard/topbar'
import { StatsCards } from '@/components/dashboard/statsCards'
import { OperatorsTable } from '@/components/dashboard/operatorsTable'
import { MyOperatorPanel } from '@/components/dashboard/myOperatorPanel'
import { SlashFeed } from '@/components/dashboard/slashFeed'
import { Globe, User, Sword } from 'lucide-react'
import clsx from 'clsx'

type Tab = 'network' | 'mine' | 'slashes'

const TABS = [
  { key: 'network' as Tab, label: 'Network',       icon: <Globe size={13} /> },
  { key: 'mine'    as Tab, label: 'My Operator',   icon: <User  size={13} /> },
  { key: 'slashes' as Tab, label: 'Slashes',       icon: <Sword size={13} /> },
]

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>('network')
  const {
    operators, slashRecords, myStats, myOperator,
    loading, lastRefresh, refresh, error,
  } = useDepinData()

  return (
    <div className="min-h-screen bg-base scanline">
      <Topbar onRefresh={refresh} loading={loading} lastRefresh={lastRefresh} />

      <main className="mx-auto max-w-7xl px-4 py-6 space-y-5">

        {/* Error banner */}
        {error && (
          <div className="rounded-lg border border-[#FF3B5C40] bg-[#FF3B5C10] px-4 py-2.5 font-mono text-xs text-[#FF3B5C]">
            ⚠ {error}
          </div>
        )}

        {/* Stats row */}
        <StatsCards operators={operators} slashRecords={slashRecords} />

        {/* Tab nav */}
        <div className="flex items-center gap-1 border-b border-line pb-0">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={clsx(
                'flex items-center gap-1.5 px-4 py-2.5 font-mono text-xs font-medium transition-all duration-150',
                'border-b-2 -mb-px',
                tab === t.key
                  ? 'border-[#00E5FF] text-[#00E5FF]'
                  : 'border-transparent text-dim hover:text-muted'
              )}
            >
              {t.icon}
              {t.label}
              {t.key === 'slashes' && slashRecords.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-[#FF3B5C20] text-[#FF3B5C] text-[9px]">
                  {slashRecords.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="animate-fade-in">

          {/* ── Network tab ──────────────────────────────────────────── */}
          {tab === 'network' && (
            <OperatorsTable operators={operators} onRefresh={refresh} />
          )}

          {/* ── My Operator tab ──────────────────────────────────────── */}
          {tab === 'mine' && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
              {/* Main panel — wider */}
              <div className="lg:col-span-3">
                <MyOperatorPanel
                  operator={myOperator}
                  myStats={myStats}
                  onRefresh={refresh}
                />
              </div>
              {/* Recent slashes against my operator */}
              <div className="lg:col-span-2">
                <SlashFeed
                  records={myOperator
                    ? slashRecords.filter(r => r.operator === myOperator.authority)
                    : []
                  }
                />
              </div>
            </div>
          )}

          {/* ── Slashes tab ──────────────────────────────────────────── */}
          {tab === 'slashes' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <SlashFeed records={slashRecords} />
              </div>
              {/* Summary card */}
              <div className="rounded-xl border border-line bg-card p-4">
                <h3 className="font-mono text-xs font-semibold text-fg mb-4 uppercase tracking-widest">
                  Slash Summary
                </h3>
                <div className="space-y-3">
                  <SummaryRow
                    label="Total events"
                    value={slashRecords.length.toString()}
                    accent="red"
                  />
                  <SummaryRow
                    label="Total slashed"
                    value={`${(slashRecords.reduce((s, r) => s + r.slashAmount, 0) / 1_000_000).toFixed(4)} USDC`}
                    accent="red"
                  />
                  <SummaryRow
                    label="Unique operators"
                    value={new Set(slashRecords.map(r => r.operator)).size.toString()}
                    accent="amber"
                  />
                  <SummaryRow
                    label="Unique challengers"
                    value={new Set(slashRecords.map(r => r.challenger)).size.toString()}
                    accent="cyan"
                  />
                </div>

                <div className="mt-5 pt-4 border-t border-line">
                  <p className="font-mono text-[10px] text-dim leading-relaxed">
                    Operators are slashable when they are registered and active but process zero payments in a completed epoch.
                    Challengers earn 10% of the operator&apos;s vault balance.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="pt-4 border-t border-line flex items-center justify-between">
          <span className="font-mono text-[10px] text-dim">
            SettLd · DePIN x402 · Solana Devnet
          </span>
          <div className="flex items-center gap-3">
            <a
              href={`https://explorer.solana.com/address/Hzg2MGHMMoVDgA5X5v5r4XwMKyZAwUyZuYfMAtUg6whV?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[10px] text-dim hover:text-[#00E5FF] transition-colors"
            >
              Settlement Program ↗
            </a>
            <a
              href={`https://explorer.solana.com/address/38X2K9cy8m4LnvtRmhFWs6TRuxCZV24znbBqCDJaAPXT?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[10px] text-dim hover:text-[#00E5FF] transition-colors"
            >
              Registry Program ↗
            </a>
          </div>
        </footer>
      </main>
    </div>
  )
}

function SummaryRow({ label, value, accent }: { label: string; value: string; accent: 'red' | 'cyan' | 'amber' }) {
  const colors = {
    red:   'text-[#FF3B5C]',
    cyan:  'text-[#00E5FF]',
    amber: 'text-[#FFB800]',
  }
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[11px] text-dim">{label}</span>
      <span className={clsx('font-mono text-sm font-semibold', colors[accent])}>{value}</span>
    </div>
  )
}