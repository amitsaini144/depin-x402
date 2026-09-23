'use client'

import { OperatorRecord, SlashRecord } from '@/hooks/useDepinData'
import clsx from 'clsx'

interface StatsCardsProps {
  operators:    OperatorRecord[]
  slashRecords: SlashRecord[]
}

export function StatsCards({ operators, slashRecords }: StatsCardsProps) {
  const activeCount  = operators.filter(o => o.active).length
  const totalStake   = operators.reduce((s, o) => s + o.stake, 0) / 1_000_000
  const totalVolume  = operators.reduce((s, o) => s + o.totalVolume, 0) / 1_000_000
  const totalSlashes = slashRecords.length
  const slashTotal   = slashRecords.reduce((s, r) => s + r.slashAmount, 0) / 1_000_000

  const stats = [
    { label: 'Active operators', value: activeCount.toString(),  unit: '',     sub: `of ${operators.length} registered` },
    { label: 'Total staked',     value: totalStake.toFixed(2),   unit: 'USDC', sub: 'locked in vaults' },
    { label: 'Network volume',   value: totalVolume.toFixed(4),  unit: 'USDC', sub: 'settled on-chain' },
    { label: 'Slash events',     value: totalSlashes.toString(), unit: '',     sub: `${slashTotal.toFixed(4)} USDC slashed` },
  ]

  return (
    <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-6 sm:pt-8">
      <div className="rounded-2xl bg-ink px-5 sm:px-8 pt-8 pb-7">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-on-ink text-balance">
          Operator network
        </h1>
        <p className="mt-1.5 text-sm text-on-ink-muted max-w-xl">
          Staked operators settle x402 micropayments on Solana. Idle for a full epoch, and anyone can slash 10% of the vault.
        </p>

        <dl className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-y-6 border-t border-ink-line pt-5">
          {stats.map((s, i) => (
            <div
              key={s.label}
              className={clsx(
                'min-w-0 pr-4',
                i % 2 === 1 && 'pl-4 border-l border-ink-line',
                i === 2 && 'lg:pl-4 lg:border-l lg:border-ink-line',
              )}
            >
              <dt className="text-xs text-on-ink-muted">{s.label}</dt>
              <dd className="mt-2 flex items-baseline gap-1.5">
                <span className="num text-2xl sm:text-[28px] font-medium text-on-ink truncate">{s.value}</span>
                {s.unit && <span className="text-xs text-on-ink-muted">{s.unit}</span>}
              </dd>
              <dd className="mt-1 text-xs text-on-ink-muted">{s.sub}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
