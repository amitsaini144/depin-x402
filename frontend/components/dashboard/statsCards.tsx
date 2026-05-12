'use client'

import { OperatorRecord, SlashRecord } from '@/hooks/useDepinData'
import { Users, Zap, Sword, TrendingUp } from 'lucide-react'

interface StatsCardsProps {
  operators:   OperatorRecord[]
  slashRecords: SlashRecord[]
}

export function StatsCards({ operators, slashRecords }: StatsCardsProps) {
  const activeCount   = operators.filter(o => o.active).length
  const totalStake    = operators.reduce((s, o) => s + o.stake, 0) / 1_000_000
  const totalVolume   = operators.reduce((s, o) => s + o.totalVolume, 0) / 1_000_000
  const totalSlashes  = slashRecords.length
  const slashTotal    = slashRecords.reduce((s, r) => s + r.slashAmount, 0) / 1_000_000

  const cards = [
    {
      label:   'Active Operators',
      value:   activeCount.toString(),
      sub:     `${operators.length} total registered`,
      icon:    <Users size={16} />,
      color:   'cyan',
      glow:    'border-glow-cyan',
    },
    {
      label:   'Total Staked',
      value:   `${totalStake.toFixed(2)} USDC`,
      sub:     'locked in vaults',
      icon:    <TrendingUp size={16} />,
      color:   'green',
      glow:    'border-glow-green',
    },
    {
      label:   'Network Volume',
      value:   `${totalVolume.toFixed(4)} USDC`,
      sub:     'total settled',
      icon:    <Zap size={16} />,
      color:   'cyan',
      glow:    'border-glow-cyan',
    },
    {
      label:   'Slash Events',
      value:   totalSlashes.toString(),
      sub:     `${slashTotal.toFixed(4)} USDC slashed`,
      icon:    <Sword size={16} />,
      color:   'red',
      glow:    'border-glow-red',
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((card, i) => (
        <div
          key={i}
          className={`relative rounded-xl border bg-card p-4 overflow-hidden animate-slide-up ${card.glow}`}
          style={{ animationDelay: `${i * 60}ms` }}
        >
          {/* Background glow */}
          <div className={`absolute -top-6 -right-6 w-20 h-20 rounded-full blur-2xl opacity-20 ${
            card.color === 'cyan' ? 'bg-[#00E5FF]' :
            card.color === 'green' ? 'bg-[#00FF88]' : 'bg-[#FF3B5C]'
          }`} />

          <div className="relative">
            <div className={`inline-flex p-1.5 rounded-lg mb-3 ${
              card.color === 'cyan'  ? 'bg-[#00E5FF15] text-[#00E5FF]' :
              card.color === 'green' ? 'bg-[#00FF8815] text-[#00FF88]' :
                                       'bg-[#FF3B5C15] text-[#FF3B5C]'
            }`}>
              {card.icon}
            </div>
            <div className="font-mono text-xl font-bold text-fg mb-0.5 truncate">
              {card.value}
            </div>
            <div className="font-mono text-[10px] text-muted uppercase tracking-widest">
              {card.label}
            </div>
            <div className="font-mono text-[10px] text-dim mt-1">
              {card.sub}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}