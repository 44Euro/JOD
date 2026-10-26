import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { Card } from '../../components/ui/card'
import { PageHeader } from '../components/PageHeader'
import { MORE_PAGES } from '../nav'
import { t } from '../../i18n'

// Phones only reach these pages from here; the sidebar lists them directly on larger screens.
export function MorePage() {
  return (
    <>
      <PageHeader title={t('เพิ่มเติม')} />
      <Card className="py-1.5 md:py-2">
        <nav aria-label={t('หน้าอื่นๆ')}>
          {MORE_PAGES.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} className="flex min-h-12 items-center gap-3 border-t border-muted py-2 first:border-t-0">
              <Icon className="size-5 text-ink-2" aria-hidden />
              <span className="flex-1">{label}</span>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </Link>
          ))}
        </nav>
      </Card>
    </>
  )
}
