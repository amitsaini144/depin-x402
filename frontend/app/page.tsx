'use client'

import { useState } from 'react'
import { useDepinData } from '@/hooks/useDepinData'
import { Topbar } from '@/components/dashboard/topbar'
import { StatsCards } from '@/components/dashboard/statsCards'
import { OperatorsTable } from '@/components/dashboard/operatorsTable'
import { MyOperatorPanel } from '@/components/dashboard/myOperatorPanel'
import { SlashFeed } from '@/components/dashboard/slashFeed'
import { Panel, PanelHeader } from '@/components/ui/panel'
import { AlertTriangle } from 'lucide-react'
import clsx from 'clsx'

type Tab = 'network' | 'mine' | 'slashes'

const TABS: { key: Tab; label: string }[] = [
  { key: 'network', label: 'Network' },
  { key: 'mine',    label: 'My operator' },
  { key: 'slashes', label: 'Slashes' },
]

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>('network')
  const {
    operators, slashRecords, myStats, myOperator,
    loading, lastRefresh, refresh, error,
  } = useDepinData()

  return (
    <div className="min-h-screen bg-base">
      <Topbar onRefresh={refresh} loading={loading} lastRefresh={lastRefresh} />
      <StatsCards operators={operators} slashRecords={slashRecords} />

      <main className="mx-auto max-w-6xl px-4 sm:px-6 pt-4 pb-12">

        {/* Tab nav */}
        <nav className="flex items-center gap-6 border-b border-line" role="tablist">
          {TABS.map(t => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={clsx(
                'relative -mb-px py-4 text-sm font-medium transition-colors border-b-2',
                tab === t.key
                  ? 'border-accent-strong text-fg'
                  : 'border-transparent text-muted hover:text-fg'
              )}
            >
              {t.label}
              {t.key === 'slashes' && slashRecords.length > 0 && (
                <span className="num ml-2 text-xs text-dim">{slashRecords.length}</span>
              )}
            </button>
          ))}
        </nav>

        {error && (
          <div className="mt-6 flex items-start gap-3 rounded-lg border border-line border-l-[3px] border-l-accent-strong bg-card px-4 py-3 text-sm text-fg">
            <AlertTriangle size={16} className="text-accent-strong mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-6">
          {tab === 'network' && (
            <OperatorsTable operators={operators} onRefresh={refresh} />
          )}

          {tab === 'mine' && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <div className="lg:col-span-3">
                <MyOperatorPanel operator={myOperator} myStats={myStats} onRefresh={refresh} />
              </div>
              <div className="lg:col-span-2">
                <SlashFeed
                  title="Slashes against you"
                  records={myOperator
                    ? slashRecords.filter(r => r.operator === myOperator.authority)
                    : []
                  }
                />
              </div>
            </div>
          )}

          {tab === 'slashes' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <SlashFeed records={slashRecords} />
              </div>
              <Panel className="self-start">
                <PanelHeader title="Summary" />
                <dl className="px-5 py-2 divide-y divide-line">
                  <SummaryRow label="Total events" value={slashRecords.length.toString()} />
                  <SummaryRow
                    label="Total slashed"
                    value={(slashRecords.reduce((s, r) => s + r.slashAmount, 0) / 1_000_000).toFixed(4)}
                    unit="USDC"
                  />
                  <SummaryRow label="Unique operators"   value={new Set(slashRecords.map(r => r.operator)).size.toString()} />
                  <SummaryRow label="Unique challengers" value={new Set(slashRecords.map(r => r.challenger)).size.toString()} />
                </dl>
                <p className="px-5 py-4 border-t border-line text-xs leading-relaxed text-muted">
                  An operator is slashable when it is registered and active but processes zero payments in a
                  completed epoch. The challenger receives 10% of the operator&apos;s vault.
                </p>
              </Panel>
            </div>
          )}
        </div>

        <footer className="mt-16 pt-6 border-t border-line flex flex-col sm:flex-row gap-3 sm:items-center justify-between text-xs text-muted">
          <span>Settld · DePIN x402 on Solana Devnet</span>
          <div className="flex items-center gap-5">
            <a
              href="https://explorer.solana.com/address/Hzg2MGHMMoVDgA5X5v5r4XwMKyZAwUyZuYfMAtUg6whV?cluster=devnet"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-accent-strong transition-colors"
            >
              Settlement program ↗
            </a>
            <a
              href="https://explorer.solana.com/address/38X2K9cy8m4LnvtRmhFWs6TRuxCZV24znbBqCDJaAPXT?cluster=devnet"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-accent-strong transition-colors"
            >
              Registry program ↗
            </a>
          </div>
        </footer>
      </main>
    </div>
  )
}

function SummaryRow({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex items-baseline justify-between py-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm text-fg">
        <span className="num font-medium">{value}</span>
        {unit && <span className="ml-1 text-xs text-dim">{unit}</span>}
      </dd>
    </div>
  )
}
