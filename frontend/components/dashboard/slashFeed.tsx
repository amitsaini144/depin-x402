'use client'

import { SlashRecord } from '@/hooks/useDepinData'
import { Panel, PanelHeader, shortAddr } from '@/components/ui/panel'
import { ArrowUpRight } from 'lucide-react'

interface SlashFeedProps {
  records: SlashRecord[]
  title?:  string
}

export function SlashFeed({ records, title = 'Slash history' }: SlashFeedProps) {
  const fmt = (ts: number) => {
    const d = new Date(ts * 1000)
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' +
           d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <Panel>
      <PanelHeader title={title} meta={`${records.length} ${records.length === 1 ? 'event' : 'events'}`} />

      {records.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="text-sm text-fg">No slash events</p>
          <p className="mt-1 text-xs text-muted">Every active operator has settled payments so far.</p>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {records.map(r => (
            <li key={r.pubkey} className="px-5 py-4 hover:bg-subtle/60 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <dl className="min-w-0 grid grid-cols-[88px_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted">Operator</dt>
                  <dd className="min-w-0">
                    <a
                      href={`https://explorer.solana.com/address/${r.operator}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="addr text-fg hover:text-accent-strong transition-colors"
                    >
                      {shortAddr(r.operator, 6, 6)}
                    </a>
                  </dd>
                  <dt className="text-muted">Challenger</dt>
                  <dd className="addr text-muted truncate">{shortAddr(r.challenger, 6, 6)}</dd>
                  <dt className="text-muted">Epoch</dt>
                  <dd className="num text-muted">{r.epoch.toLocaleString()}</dd>
                </dl>

                <div className="text-right shrink-0">
                  <div className="text-sm text-fg">
                    <span className="num font-medium">−{(r.slashAmount / 1_000_000).toFixed(4)}</span>
                    <span className="ml-1 text-xs text-dim">USDC</span>
                  </div>
                  <div className="mt-1 text-xs text-muted">{fmt(r.slashedAt)}</div>
                  <a
                    href={`https://explorer.solana.com/address/${r.pubkey}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-0.5 text-xs text-muted hover:text-accent-strong transition-colors"
                  >
                    Record <ArrowUpRight size={12} />
                  </a>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
