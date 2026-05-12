'use client'

import { SlashRecord } from '@/hooks/useDepinData'
import { Sword, ExternalLink } from 'lucide-react'

interface SlashFeedProps {
  records: SlashRecord[]
}

export function SlashFeed({ records }: SlashFeedProps) {
  const fmt = (ts: number) => {
    const d = new Date(ts * 1000)
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="rounded-xl border border-line bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-line">
        <div className="flex items-center gap-2">
          <Sword size={14} className="text-[#FF3B5C]" />
          <h2 className="font-mono text-sm font-semibold text-fg">Slash History</h2>
        </div>
        <span className="font-mono text-[10px] text-dim">{records.length} events</span>
      </div>

      {records.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="font-mono text-xs text-dim">No slash events yet</p>
        </div>
      ) : (
        <div className="divide-y divide-line">
          {records.map((r) => (
            <div key={r.pubkey} className="px-4 py-3 hover:bg-subtle transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {/* Operator */}
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="font-mono text-[10px] text-dim uppercase tracking-widest w-16 shrink-0">
                      Operator
                    </span>
                    <span className="font-mono text-xs text-[#FF3B5C] truncate">
                      {r.operator.slice(0, 8)}...{r.operator.slice(-6)}
                    </span>
                    <a
                      href={`https://explorer.solana.com/address/${r.operator}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-dim hover:text-[#FF3B5C] transition-colors shrink-0"
                    >
                      <ExternalLink size={9} />
                    </a>
                  </div>
                  {/* Challenger */}
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="font-mono text-[10px] text-dim uppercase tracking-widest w-16 shrink-0">
                      Challenger
                    </span>
                    <span className="font-mono text-xs text-muted truncate">
                      {r.challenger.slice(0, 8)}...{r.challenger.slice(-6)}
                    </span>
                  </div>
                  {/* Epoch */}
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] text-dim uppercase tracking-widest w-16 shrink-0">
                      Epoch
                    </span>
                    <span className="font-mono text-xs text-dim">#{r.epoch}</span>
                  </div>
                </div>

                {/* Right side */}
                <div className="text-right shrink-0">
                  <div className="font-mono text-sm font-bold text-[#FF3B5C]">
                    -{(r.slashAmount / 1_000_000).toFixed(4)}
                    <span className="text-[10px] text-dim ml-1">USDC</span>
                  </div>
                  <div className="font-mono text-[10px] text-dim mt-1">
                    {fmt(r.slashedAt)}
                  </div>
                  <a
                    href={`https://explorer.solana.com/address/${r.pubkey}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-[9px] text-dim hover:text-[#FF3B5C] transition-colors mt-1"
                  >
                    Record <ExternalLink size={8} />
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}