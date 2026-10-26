import { D, type Decimal } from '../../domain/decimal'
import { INCOME_KINDS, type IncomeBucket } from '../../domain/income'
import { cn } from '../../lib/cn'
import { fmtHeadline, fmtMonth } from '../format'
import { INCOME_SERIES } from '../labels'
import { t } from '../../i18n'

// Bucket keys are YYYY-MM for months and YYYY for whole years.
function bucketLabel(key: string, withYear = false): string {
  return key.length === 4 ? key : fmtMonth(key, withYear)
}

function share(part: Decimal, whole: Decimal): string {
  return whole.greaterThan(0) ? `${part.div(whole).times(100).toFixed(2)}%` : '0%'
}

export function IncomeBars({ buckets, base }: { buckets: readonly IncomeBucket[]; base: string }) {
  const max = buckets.reduce((top, b) => (b.netBase.greaterThan(top) ? b.netBase : top), D(0))
  return (
    <div>
      <ol aria-label={t('รายได้แต่ละช่วง')} className="flex h-[130px] items-end gap-1 border-b pt-2.5 md:h-[170px] md:gap-2.5">
        {buckets.map((bucket) => (
          <li key={bucket.key} className="flex h-full min-w-0 flex-1 items-end">
            <span
              className="mx-auto flex w-full max-w-24 flex-col-reverse overflow-hidden rounded-t-md md:max-w-32"
              style={{ height: share(bucket.netBase, max) }}
            >
              {INCOME_KINDS.filter((kind) => bucket.byKind[kind].greaterThan(0)).map((kind) => (
                <span
                  key={kind}
                  className={cn('block', INCOME_SERIES[kind].className)}
                  style={{ height: share(bucket.byKind[kind], bucket.netBase) }}
                />
              ))}
            </span>
            <span className="sr-only">
              {bucketLabel(bucket.key, true)} {fmtHeadline(bucket.netBase, base)}
            </span>
          </li>
        ))}
      </ol>
      <div aria-hidden className="mt-1.5 flex gap-1 text-[10px] text-muted-foreground md:gap-2.5 md:text-xs">
        {buckets.map((bucket) => (
          <span key={bucket.key} className="min-w-0 flex-1 text-center">
            {bucketLabel(bucket.key)}
          </span>
        ))}
      </div>
    </div>
  )
}
