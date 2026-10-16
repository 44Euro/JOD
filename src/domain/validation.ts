import { isIsoDate, todayLocal } from './dates'
import { D, isDecimalString } from './decimal'
import { TX_TYPES, type Transaction } from './types'

const INSTRUMENT_REQUIRED: readonly string[] = ['buy', 'sell', 'dividend', 'split']

export function validateTransaction(tx: Transaction, today: string = todayLocal()): string[] {
  const errors: string[] = []
  const positive = (value: string | undefined, label: string) => {
    if (!value || !isDecimalString(value) || !D(value).greaterThan(0)) errors.push(`${label}ต้องเป็นตัวเลขมากกว่า 0`)
  }
  const nonNegative = (value: string | undefined, label: string) => {
    if (!value || !isDecimalString(value) || D(value).isNegative()) errors.push(`${label}ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป`)
  }

  if (!TX_TYPES.includes(tx.type)) errors.push('ประเภทรายการไม่ถูกต้อง')
  if (!tx.accountId) errors.push('กรุณาเลือกบัญชี')
  if (!isIsoDate(tx.date)) errors.push('วันที่ไม่ถูกต้อง')
  else if (tx.date > today) errors.push('วันที่ต้องไม่เกินวันนี้')
  if (tx.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(tx.time)) errors.push('เวลาไม่ถูกต้อง')
  if (!/^[A-Z0-9]{2,10}$/.test(tx.currency)) errors.push('สกุลเงินไม่ถูกต้อง')
  positive(tx.fxRate, 'เรทแลกเปลี่ยน')
  nonNegative(tx.fees, 'ค่าธรรมเนียม')
  nonNegative(tx.tax, 'ภาษี')
  if (INSTRUMENT_REQUIRED.includes(tx.type) && !tx.instrumentId) errors.push('กรุณาระบุหุ้น/สินทรัพย์')

  switch (tx.type) {
    case 'buy':
    case 'sell':
      positive(tx.quantity, 'จำนวนหน่วย')
      nonNegative(tx.price, 'ราคา')
      break
    case 'opening':
      if (tx.instrumentId) {
        positive(tx.quantity, 'จำนวนหน่วย')
        nonNegative(tx.price, 'ต้นทุนเฉลี่ย')
      } else {
        positive(tx.amount, 'จำนวนเงิน')
      }
      break
    case 'split':
      positive(tx.splitRatio, 'อัตราแตกพาร์')
      break
    case 'fx_convert':
      positive(tx.amount, 'จำนวนเงินต้นทาง')
      positive(tx.toAmount, 'จำนวนเงินที่ได้รับ')
      if (!tx.toCurrency || tx.toCurrency === tx.currency) errors.push('สกุลเงินปลายทางต้องต่างจากต้นทาง')
      break
    default:
      positive(tx.amount, 'จำนวนเงิน')
  }

  if (tx.type === 'withdraw' && tx.remitToThailand) {
    const year = tx.taxYear
    if (year === undefined || !Number.isInteger(year) || year < 2000 || year > 2200) errors.push('ปีภาษีไม่ถูกต้อง')
  }
  return errors
}
