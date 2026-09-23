import { ReactNode } from 'react'
import clsx from 'clsx'

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={clsx('rounded-xl border border-line bg-card overflow-hidden', className)}>
      {children}
    </section>
  )
}

export function PanelHeader({ title, meta }: { title: string; meta?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-line">
      <h2 className="text-[15px] font-semibold tracking-tight text-fg">{title}</h2>
      {meta && <div className="text-xs text-muted">{meta}</div>}
    </div>
  )
}

export function shortAddr(addr: string, head = 4, tail = 4) {
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`
}
