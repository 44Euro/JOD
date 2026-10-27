import { NavLink } from 'react-router'
import { cn } from '../../lib/cn'
import { PORTFOLIO, TRADES } from '../nav'
import { t } from '../../i18n'

const ITEM =
  'grid h-11 min-w-11 grow place-items-center rounded-[9px] px-3.5 text-[13.5px] text-ink-2 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 md:h-8 md:grow-0'
const ACTIVE = 'bg-card font-semibold text-foreground shadow-sm shadow-foreground/10'

// Holdings and trades are two views of the same พอร์ต tab, styled like the segmented control but each its own page.
export function PortfolioSwitch() {
  return (
    <nav aria-label={t('มุมมองพอร์ต')} className="flex gap-0.5 rounded-xl bg-muted p-[3px] max-md:w-full md:inline-flex md:justify-self-start">
      {[
        { to: PORTFOLIO.to, label: t('ถืออยู่') },
        { to: TRADES.to, label: TRADES.label },
      ].map(({ to, label }) => (
        <NavLink key={to} to={to} end className={({ isActive }) => cn(ITEM, isActive && ACTIVE)}>
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
