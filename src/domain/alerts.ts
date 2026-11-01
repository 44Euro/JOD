import { D, isDecimalString } from './decimal'
import type { PriceAlert } from './types'
import { t } from '../i18n'

export interface AlertHit {
  alert: PriceAlert
  price: string
}

// Alerts not yet fired whose asset's price is at or past the target; an asset with no price yet is skipped.
export function crossedAlerts(alerts: readonly PriceAlert[], priceOf: (instrumentId: string) => string | null): AlertHit[] {
  return alerts.flatMap((alert) => {
    const price = alert.firedAt ? null : priceOf(alert.instrumentId)
    if (!price) return []
    const crossed = alert.direction === 'above' ? D(price).gte(alert.price) : D(price).lte(alert.price)
    return crossed ? [{ alert, price }] : []
  })
}

export function validateAlert(price: string): string[] {
  return isDecimalString(price) && D(price).gt(0) ? [] : [t('ใส่ราคาที่มากกว่า 0')]
}
