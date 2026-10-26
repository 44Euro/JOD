import type { FeeTemplate } from '../domain/types'
import { t } from '../i18n'

export interface BrokerPreset {
  key: string
  label: string
  accountName: string
  template: FeeTemplate
  note: string
}

const fee = (currency: string, commissionPct: string, minimum: string, vatPct: string): FeeTemplate => ({
  currency,
  commissionPct,
  minimum,
  vatPct,
  perOrder: '0',
})

// Starting points only: brokers change their rates and promotions, so the page always asks the user to check them.
export const BROKER_PRESETS: readonly BrokerPreset[] = [
  { key: 'dime', label: 'Dime', accountName: 'Dime US', template: fee('USD', '0', '0', '0'), note: t('ค่าคอม 0 ตามโปรโมชันปัจจุบัน') },
  { key: 'webull', label: 'Webull', accountName: 'Webull', template: fee('USD', '0', '0', '0'), note: t('ไม่มีค่าคอมหุ้นสหรัฐ แต่อาจมีค่าธรรมเนียมอื่น') },
  { key: 'innovestx', label: 'InnovestX', accountName: 'InnovestX', template: fee('THB', '0.157', '50', '7'), note: t('อัตราทั่วไปของหุ้นไทย') },
  { key: 'ibkr', label: 'IBKR', accountName: 'IBKR', template: fee('USD', '0', '1', '0'), note: t('ขั้นต่ำต่อคำสั่งของแผน Fixed') },
  { key: 'streaming', label: 'Streaming', accountName: 'Streaming SET', template: fee('THB', '0.157', '50', '7'), note: t('อัตราทั่วไปของหุ้นไทย') },
  { key: 'bitkub', label: 'Bitkub', accountName: 'Bitkub', template: fee('THB', '0.25', '0', '0'), note: t('ค่าธรรมเนียมซื้อขายทั่วไป') },
  { key: 'binance', label: 'Binance', accountName: 'Binance', template: fee('USDT', '0.1', '0', '0'), note: t('ค่าธรรมเนียม Spot ทั่วไป') },
  { key: 'custom', label: t('อื่นๆ'), accountName: '', template: fee('THB', '0', '0', '0'), note: '' },
]

export const CHECK_WITH_BROKER = t('ตรวจกับโบรกอีกครั้ง')
