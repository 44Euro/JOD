import { Chip, chipSelectClass } from '../../../components/ui/chip'
import { NativeSelect } from '../../../components/ui/input'
import type { TxType } from '../../../domain/types'
import { cn } from '../../../lib/cn'
import { MORE_TX_TYPES, PRIMARY_TX_TYPES, TX_TYPE_LABELS } from '../../labels'
import { t } from '../../../i18n'

export function TypePicker({ type, onChange }: { type: TxType; onChange(type: TxType): void }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('ประเภทรายการ')}>
      {PRIMARY_TX_TYPES.map((t) => (
        <Chip key={t} active={type === t} onClick={() => onChange(t)}>
          {TX_TYPE_LABELS[t]}
        </Chip>
      ))}
      <NativeSelect
        aria-label={t('ประเภทอื่นๆ')}
        className={cn(chipSelectClass, MORE_TX_TYPES.includes(type) && 'border-foreground bg-foreground text-background')}
        value={MORE_TX_TYPES.includes(type) ? type : ''}
        onChange={(e) => {
          const picked = e.target.value as TxType
          if (picked) onChange(picked)
        }}
      >
        <option value="">{t('เพิ่มเติม…')}</option>
        {MORE_TX_TYPES.map((t) => (
          <option key={t} value={t}>
            {TX_TYPE_LABELS[t]}
          </option>
        ))}
      </NativeSelect>
    </div>
  )
}
