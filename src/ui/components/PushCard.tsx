import { Capacitor } from '@capacitor/core'
import { useEffect, useId, useState } from 'react'
import { useLocal } from '../../ai/apiKey'
import { Card } from '../../components/ui/card'
import { Switch } from '../../components/ui/switch'
import type { PriceAlert } from '../../domain/types'
import { PUSH_TOKEN_KEY, disablePush, enablePush, syncPushAlerts, type PushResult } from '../../push/push'
import { useAppData } from '../hooks'
import { t } from '../../i18n'

const RESULTS: Record<Exclude<PushResult, 'on'>, string> = {
  denied: t('เครื่องนี้ไม่อนุญาตการแจ้งเตือน เปิดได้ในการตั้งค่าของเครื่อง'),
  'server-off': t('เซิร์ฟเวอร์ยังไม่เปิด push จะเปิดเมื่อแอปขึ้น store ระหว่างนี้แจ้งเตือนจะขึ้นในหน้าเช้านี้'),
  failed: t('เปิดการแจ้งเตือนไม่สำเร็จ ลองใหม่อีกครั้ง'),
}

// Opt-in, per phone: alerts still show on เช้านี้ without it.
export function PushCard({
  alerts,
  native = Capacitor.isNativePlatform(),
  enable = enablePush,
  disable = disablePush,
}: {
  alerts: readonly PriceAlert[]
  native?: boolean
  enable?: (alerts: readonly PriceAlert[]) => Promise<PushResult>
  disable?: () => Promise<void>
}) {
  const id = useId()
  const on = Boolean(useLocal(PUSH_TOKEN_KEY))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function toggle(next: boolean) {
    setBusy(true)
    setMessage('')
    if (next) {
      const result = await enable(alerts)
      if (result !== 'on') setMessage(RESULTS[result])
    } else await disable()
    setBusy(false)
  }

  return (
    <Card role="region" aria-labelledby={id} className="grid gap-3">
      <h2 id={id} className="text-lg font-semibold">
        {t('แจ้งเตือนราคาแบบ push')}
      </h2>
      {native ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <span id={`${id}-label`}>{t('ส่งแจ้งเตือนราคามาที่เครื่องนี้')}</span>
            <Switch checked={on} disabled={busy} aria-labelledby={`${id}-label`} onCheckedChange={(next) => void toggle(next)} />
          </div>
          <p className="text-[12.5px] text-muted-foreground">
            {t('เซิร์ฟเวอร์ JOD จะรู้สัญลักษณ์และราคาของแจ้งเตือนแต่ละรายการ กับรหัสสำหรับส่งแจ้งเตือนของเครื่องนี้ ไม่รู้ข้อมูลพอร์ต ปิดเมื่อไรเซิร์ฟเวอร์ก็ลบทิ้ง')}
          </p>
          {message && <p className="text-[13.5px] text-ink-2">{message}</p>}
        </>
      ) : (
        <p className="text-[13.5px] text-muted-foreground">{t('ใช้ได้ในแอปมือถือ ในเบราว์เซอร์แจ้งเตือนจะขึ้นในหน้าเช้านี้')}</p>
      )}
    </Card>
  )
}

// While this phone has opted in, the server is told whenever the alerts change.
export function PushAlertSync() {
  const data = useAppData()
  const on = Boolean(useLocal(PUSH_TOKEN_KEY))
  const active = JSON.stringify((data?.settings.alerts ?? []).filter((a) => !a.firedAt))
  useEffect(() => {
    if (on && data) void syncPushAlerts(JSON.parse(active) as PriceAlert[])
    // Only a change in the alerts or the opt-in sends them again, not every new copy of the app data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, active])
  return null
}
