import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Alert } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { db } from '../../db/db'
import { todayLocal } from '../../domain/dates'
import type { Ledger } from '../../domain/ledger'
import { DEFAULT_BENCHMARK, describeUpdate, heldInstruments, runPriceUpdate, usePriceSources } from '../../prices/run'
import type { AppData } from '../hooks'
import { t } from '../../i18n'

export function PriceUpdateButton({ data, ledger }: { data: AppData; ledger: Ledger }) {
  const sources = usePriceSources()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function run() {
    setBusy(true)
    setMessage('')
    try {
      const held = heldInstruments(ledger, data.instruments)
      const result = await runPriceUpdate(db, held, sources, data.settings.benchmarkSymbol ?? DEFAULT_BENCHMARK, todayLocal())
      setMessage(describeUpdate(result))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void run()}>
        <RefreshCw aria-hidden className={busy ? 'animate-spin' : undefined} />
        {busy ? t('กำลังดึงราคา…') : t('ดึงราคาล่าสุด')}
      </Button>
      {message && (
        <Alert role="status" tone="ok" className="basis-full">
          {message}
        </Alert>
      )}
    </>
  )
}
