import { useState } from 'react'
import { AUTO_PRICES_STORAGE_KEY, COINGECKO_KEY_STORAGE_KEY, FINNHUB_KEY_STORAGE_KEY, maskApiKey, useLocal, writeLocal } from '../../ai/apiKey'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Field } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { Switch } from '../../components/ui/switch'
import { db } from '../../db/db'
import { saveSettings } from '../../db/repo'
import type { Settings } from '../../domain/types'
import { DEFAULT_BENCHMARK } from '../../prices/run'
import { t } from '../../i18n'

function KeyField({ id, label, storageKey, hint }: { id: string; label: string; storageKey: string; hint: string }) {
  const stored = useLocal(storageKey)
  const [draft, setDraft] = useState('')
  if (stored) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="block text-[13.5px] font-semibold text-ink-2">{label}</span>
          <span className="font-mono text-sm">{maskApiKey(stored)}</span>
        </span>
        <Button type="button" variant="ghost" onClick={() => writeLocal(storageKey, '')}>
          {t('ลบ key')}
        </Button>
      </div>
    )
  }
  return (
    <form
      className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault()
        if (draft.trim()) writeLocal(storageKey, draft.trim())
        setDraft('')
      }}
    >
      <Field id={id} label={label} hint={hint}>
        <Input id={id} type="password" autoComplete="off" spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)} />
      </Field>
      <Button type="submit" variant="outline" className="h-[46px]" disabled={!draft.trim()}>
        {t('บันทึก')}
      </Button>
    </form>
  )
}

export function PriceSourcesCard({ settings }: { settings: Settings }) {
  const auto = useLocal(AUTO_PRICES_STORAGE_KEY) === 'on'
  const [benchmark, setBenchmark] = useState(settings.benchmarkSymbol ?? DEFAULT_BENCHMARK)
  return (
    <Card className="grid gap-3">
      <div>
        <h2 className="text-lg font-semibold">{t('ราคาอัตโนมัติ')}</h2>
        <p className="text-[12.5px] text-muted-foreground">
          {t('หุ้น US และหุ้นไทยดึงผ่านเซิร์ฟเวอร์ JOD จาก Yahoo (ช้าราว 15 นาที) · คริปโตจาก CoinGecko · key Finnhub ใช้สำรองเมื่อเซิร์ฟเวอร์ต่อไม่ได้ · กองทุนยังต้องกรอกเองหรืออัปเดตจากรูป · key เก็บในเครื่องนี้เท่านั้น')}
        </p>
      </div>
      <KeyField id="finnhub-key" label="Finnhub API key" storageKey={FINNHUB_KEY_STORAGE_KEY} hint={t('สำรองสำหรับหุ้นสหรัฐและดัชนีที่ใช้เทียบ')} />
      <KeyField id="coingecko-key" label={t('CoinGecko demo key (ไม่บังคับ)')} storageKey={COINGECKO_KEY_STORAGE_KEY} hint={t('ใส่เมื่อดึงราคาคริปโตแล้วโดนจำกัดจำนวนครั้ง')} />
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span id="auto-prices-label" className="block">
            {t('ดึงราคาวันละครั้งเมื่อเปิดแอป')}
          </span>
          <span id="auto-prices-hint" className="block text-[12.5px] text-muted-foreground">
            {t('แอปจะส่งชื่อสินทรัพย์ที่ถือไปถามราคา ไม่ส่งจำนวนหรือมูลค่า')}
          </span>
        </span>
        <Switch
          checked={auto}
          aria-labelledby="auto-prices-label"
          aria-describedby="auto-prices-hint"
          onCheckedChange={(on) => writeLocal(AUTO_PRICES_STORAGE_KEY, on ? 'on' : '')}
        />
      </div>
      <Field id="benchmark-symbol" label={t('ดัชนีที่ใช้เทียบผลตอบแทน')} hint={t('สัญลักษณ์หุ้นหรือ ETF สหรัฐ เช่น SPY (S&P 500) หรือ QQQ')}>
        <Input
          id="benchmark-symbol"
          className="max-w-[160px] uppercase"
          value={benchmark}
          onChange={(e) => setBenchmark(e.target.value.toUpperCase())}
          onBlur={() => {
            const symbol = benchmark.trim() || DEFAULT_BENCHMARK
            if (/^[A-Z0-9.^-]{1,12}$/.test(symbol) && symbol !== settings.benchmarkSymbol) void saveSettings(db, { ...settings, benchmarkSymbol: symbol })
          }}
        />
      </Field>
    </Card>
  )
}
