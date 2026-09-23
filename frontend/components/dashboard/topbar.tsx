'use client'

import { useEffect, useState } from 'react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useTheme } from '@/components/ui/themeProvider'
import { EPOCH_DURATION, currentEpoch } from '@/hooks/useDepinData'
import { Sun, Moon, RefreshCw } from 'lucide-react'
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

  const iconBtn =
    'h-9 w-9 inline-flex items-center justify-center rounded-lg text-muted ' +
    'hover:text-fg hover:bg-subtle transition-colors'

  return (
    <header className="sticky top-0 z-50 bg-base/85 backdrop-blur-md border-b border-line">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between gap-6">

        {/* Wordmark */}
        <div className="flex items-baseline gap-2 shrink-0">
          <span className="text-[17px] font-semibold tracking-tight text-fg">
            Settld<span className="text-accent-strong">.</span>
          </span>
          <span className="hidden sm:inline text-xs text-muted">x402 · Devnet</span>
        </div>

        {/* Epoch meter */}
        <div className="hidden md:block flex-1 max-w-sm">
          <div className="flex items-baseline justify-between text-xs mb-1.5">
            <span className="text-muted">
              Epoch <span className="num text-fg">{mounted ? epoch.toLocaleString() : '—'}</span>
            </span>
            <span className="num text-muted">{mounted ? `${countdown}s left` : ''}</span>
          </div>
          <div className="h-[3px] bg-line rounded-full overflow-hidden">
            <div
              className="h-full bg-accent-strong transition-[width] duration-1000 ease-linear"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {lastRefresh && (
            <span className="hidden lg:block num text-[11px] text-muted mr-2">
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh data"
            className={clsx(iconBtn, loading && 'opacity-60 cursor-not-allowed')}
          >
            <RefreshCw size={15} className={clsx(loading && 'animate-spin')} />
          </button>
          <button onClick={toggle} aria-label="Toggle theme" className={iconBtn}>
            {mounted && theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
          </button>
          <div className="ml-2">{mounted && <WalletMultiButton />}</div>
        </div>
      </div>
    </header>
  )
}
