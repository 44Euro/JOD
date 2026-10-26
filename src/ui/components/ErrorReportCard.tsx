import { useState } from 'react'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { clearErrors, errorReport, useErrors } from '../../errors/log'
import { todayLocal } from '../../domain/dates'
import { downloadText } from '../download'
import { fmtDate } from '../format'
import { t } from '../../i18n'

export function ErrorReportCard() {
  const errors = useErrors()
  const [copied, setCopied] = useState(false)
  return (
    <Card className="grid gap-3">
      <div>
        <h2 className="text-lg font-semibold">{t('รายงานปัญหา')}</h2>
        <p className="text-[12.5px] text-muted-foreground">
          {t('แอปจดปัญหาที่เกิดไว้ในเครื่องนี้ ไม่ส่งไปไหนเอง · รายงานไม่มีตัวเลขหรือรายการของคุณ ส่งให้ผู้พัฒนาได้อย่างสบายใจ')}
        </p>
      </div>
      {errors.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('ยังไม่มีปัญหาที่บันทึกไว้')}</p>
      ) : (
        <>
          <p className="text-sm">
            {t('มี ')}{errors.length} {t(' ปัญหา · ล่าสุด ')}{fmtDate(errors[0].at.slice(0, 10))}
          </p>
          <ul aria-label={t('ปัญหาล่าสุด')} className="grid gap-1 text-[12.5px] text-muted-foreground">
            {errors.slice(0, 3).map((e) => (
              <li key={e.at + e.message} className="truncate">
                {e.page} · {e.message}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(errorReport(errors))
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false))
              }
            >
              {copied ? t('คัดลอกแล้ว') : t('คัดลอกรายงาน')}
            </Button>
            <Button type="button" variant="outline" onClick={() => downloadText(`jod-errors-${todayLocal()}.txt`, errorReport(errors), 'text/plain')}>
              {t('ดาวน์โหลดรายงาน')}
            </Button>
            <Button type="button" variant="ghost" onClick={clearErrors}>
              {t('ล้าง')}
            </Button>
          </div>
        </>
      )}
    </Card>
  )
}
