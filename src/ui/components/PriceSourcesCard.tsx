import { useState } from 'react'
import { AUTO_PRICES_STORAGE_KEY, useLocal, writeLocal } from '../../ai/apiKey'
import { Card } from '../../components/ui/card'
import { Field } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { Switch } from '../../components/ui/switch'
import { db } from '../../db/db'
import { saveSettings } from '../../db/repo'
import type { Settings } from '../../domain/types'
import { DEFAULT_BENCHMARK } from '../../prices/run'
import { t } from '../../i18n'

export function PriceSourcesCard({ settings }: { settings: Settings }) {
  const auto = useLocal(AUTO_PRICES_STORAGE_KEY) === 'on'
  const [benchmark, setBenchmark] = useState(settings.benchmarkSymbol ?? DEFAULT_BENCHMARK)
  return (
    <Card className="grid gap-3">
      <div>
        <h2 className="text-lg font-semibold">{t('ราคาอัตโนมัติ')}</h2>
        <p className="text-[13px] text-muted-foreground">
          {t('หุ้น US และหุ้นไทยดึงจาก Yahoo ผ่านเซิร์ฟเวอร์ JOD ช้าราว 15 นาที คริปโตจาก CoinGecko กองทุนยังต้องกรอกเองหรืออัปเดตจากรูป')}
        </p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span id="auto-prices-label" className="block">
            {t('ดึงราคาวันละครั้งเมื่อเปิดแอป')}
          </span>
          <span id="auto-prices-hint" className="block text-[13px] text-muted-foreground">
            {t('ส่งแค่ชื่อสินทรัพย์ที่ถือไปถามราคา ไม่ส่งจำนวนหรือมูลค่า')}
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
