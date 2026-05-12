'use client'

import { useEffect, useState } from 'react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useTheme } from '@/components/ui/themeProvider'
import { EPOCH_DURATION, currentEpoch } from '@/hooks/useDepinData'
import { Sun, Moon, RefreshCw, Zap } from 'lucide-react'
import clsx from 'clsx'

interface TopbarProps {
  onRefresh: () => void
  loading: boolean
  lastRefresh: Date | null
}

export function Topbar({ onRefresh, loading, lastRefresh }: TopbarProps) {
  const { theme, toggle } = useTheme()
  const [epoch,     setEpoch]     = useState(currentEpoch())
  const [countdown, setCountdown] = useState(0)
  const [mounted,   setMounted]   = useState(false)

  useEffect(() => {
    setMounted(true)
    const tick = () => {
      const now  = Math.floor(Date.now() / 1000)
      const ep   = Math.floor(now / EPOCH_DURATION)
      const secs = EPOCH_DURATION - (now % EPOCH_DURATION)
      setEpoch(ep)
      setCountdown(secs)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const pct = ((EPOCH_DURATION - countdown) / EPOCH_DURATION) * 100

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-surface/90 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 h-14 flex items-center justify-between gap-4">

        {/* Logo */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-DEFAULT to-green-DEFAULT flex items-center justify-center">
            <Zap size={14} className="text-[#080B10]" />
          </div>
          <span className="font-mono text-sm font-semibold text-gradient-cyan hidden sm:flex items-baseline gap-1.5">
            <span>Settld</span>
            <span className="text-[10px] font-normal text-dim tracking-wider">DePIN x402</span>
          </span>
        </div>

        {/* Epoch counter */}
        <div className="flex items-center gap-3 flex-1 max-w-xs">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-[10px] text-muted uppercase tracking-widest">Epoch</span>
              <span className="font-mono text-[10px] text-muted">{countdown}s</span>
            </div>
            <div className="h-1 bg-line rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#00E5FF] to-[#00FF88] rounded-full transition-all duration-1000"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="font-mono text-[10px] text-dim mt-0.5 block">#{epoch}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {lastRefresh && (
            <span className="hidden md:block font-mono text-[10px] text-dim">
              {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={onRefresh}
            disabled={loading}
            className={clsx(
              'p-2 rounded-lg border border-line text-muted',
              'hover:border-[#00E5FF] hover:text-[#00E5FF] hover:bg-[#00E5FF10]',
              'transition-all duration-150',
              loading && 'opacity-60 cursor-not-allowed'
            )}
          >
            <RefreshCw size={14} className={clsx(loading && 'animate-spin')} />
          </button>
          <button
            onClick={toggle}
            className="p-2 rounded-lg border border-line text-muted hover:border-[#00E5FF] hover:text-[#00E5FF] hover:bg-[#00E5FF10] transition-all duration-150"
          >
            {mounted ? (theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />) : <Sun size={14} />}
          </button>
          {mounted && <WalletMultiButton />}
        </div>
      </div>
    </header>
  )
}