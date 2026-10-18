import { isIsoDate, todayLocal } from './dates'
import { D, isDecimalString } from './decimal'
import { FEE_PAID_IN, RECEIVE_KINDS, TX_TYPES, type Thesis, type Transaction } from './types'

const INSTRUMENT_REQUIRED: readonly string[] = ['buy', 'sell', 'dividend', 'split', 'receive_asset']

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
    case 'transfer':
      if (!tx.toAccountId) errors.push('กรุณาเลือกบัญชีปลายทาง')
      else if (tx.toAccountId === tx.accountId) errors.push('บัญชีปลายทางต้องต่างจากบัญชีต้นทาง')
      if (tx.instrumentId) positive(tx.quantity, 'จำนวนหน่วย')
      else positive(tx.amount, 'จำนวนเงิน')
      break
    case 'swap':
      if (!tx.instrumentId) errors.push('กรุณาระบุสินทรัพย์ที่แลกออก')
      if (!tx.toInstrumentId) errors.push('กรุณาระบุสินทรัพย์ที่ได้รับ')
      else if (tx.toInstrumentId === tx.instrumentId) errors.push('สินทรัพย์ที่ได้รับต้องต่างจากที่แลกออก')
      positive(tx.quantity, 'จำนวนที่แลกออก')
      positive(tx.toQuantity, 'จำนวนที่ได้รับ')
      positive(tx.amount, 'มูลค่ารวม')
      break
    case 'receive_asset':
      if (!tx.receiveKind || !RECEIVE_KINDS.includes(tx.receiveKind)) errors.push('ประเภทการรับไม่ถูกต้อง')
      positive(tx.quantity, 'จำนวนที่ได้รับ')
      nonNegative(tx.price, 'มูลค่าต่อหน่วย')
      break
    case 'fx_convert':
      positive(tx.amount, 'จำนวนเงินต้นทาง')
      positive(tx.toAmount, 'จำนวนเงินที่ได้รับ')
      if (
        tx.amount &&
        isDecimalString(tx.amount) &&
        isDecimalString(tx.fees) &&
        D(tx.amount).greaterThan(0) &&
        D(tx.fees).greaterThanOrEqualTo(D(tx.amount))
      ) {
        errors.push('ค่าธรรมเนียมต้องน้อยกว่าจำนวนเงินต้นทาง')
      }
      if (!tx.toCurrency || tx.toCurrency === tx.currency) errors.push('สกุลเงินปลายทางต้องต่างจากต้นทาง')
      break
    default:
      positive(tx.amount, 'จำนวนเงิน')
  }

  if (tx.type === 'withdraw' && tx.remitToThailand) {
    const year = tx.taxYear
    if (year === undefined || !Number.isInteger(year) || year < 2000 || year > 2200) errors.push('ปีภาษีไม่ถูกต้อง')
  }

  const feePaidIn = tx.feePaidIn ?? 'cash'
  if (!FEE_PAID_IN.includes(feePaidIn)) {
    errors.push('วิธีจ่ายค่าธรรมเนียมไม่ถูกต้อง')
  } else if (feePaidIn === 'received') {
    if (tx.type !== 'buy' && tx.type !== 'swap' && !(tx.type === 'transfer' && tx.instrumentId)) {
      errors.push('หักจากที่ได้รับใช้ได้กับการซื้อ แลกเหรียญ และโอนสินทรัพย์')
    } else {
      positive(tx.feeQuantity, 'จำนวนที่ถูกหัก')
      if (isDecimalString(tx.fees) && !D(tx.fees).isZero()) errors.push('ค่าธรรมเนียมที่หักจากที่ได้รับกรอกเป็นจำนวนหน่วย')
      const received = tx.type === 'swap' ? tx.toQuantity : tx.quantity
      if (
        tx.feeQuantity &&
        received &&
        isDecimalString(tx.feeQuantity) &&
        isDecimalString(received) &&
        D(received).greaterThan(0) &&
        D(tx.feeQuantity).greaterThanOrEqualTo(D(received))
      ) {
        errors.push('ค่าธรรมเนียมต้องน้อยกว่าจำนวนที่ได้รับ')
      }
    }
  } else if (feePaidIn === 'asset') {
    if (tx.type !== 'buy' && tx.type !== 'sell' && tx.type !== 'swap') {
      errors.push('จ่ายค่าธรรมเนียมเป็นสินทรัพย์อื่นใช้ได้กับการซื้อ ขาย และแลกเหรียญ')
    } else {
      if (!tx.feeInstrumentId) errors.push('กรุณาระบุสินทรัพย์ที่ใช้จ่ายค่าธรรมเนียม')
      else if (tx.feeInstrumentId === tx.instrumentId || tx.feeInstrumentId === tx.toInstrumentId) {
        errors.push('สินทรัพย์ที่จ่ายค่าธรรมเนียมต้องต่างจากสินทรัพย์ของรายการ')
      }
      positive(tx.feeQuantity, 'จำนวนที่จ่ายค่าธรรมเนียม')
      positive(tx.fees, 'มูลค่าค่าธรรมเนียม')
    }
  }
  return errors
}

// Every field may be left empty; whatever is filled in has to make sense.
export function validateThesis(thesis: Thesis): string[] {
  const errors: string[] = []
  if (thesis.targetPrice && (!isDecimalString(thesis.targetPrice) || D(thesis.targetPrice).isNegative())) {
    errors.push('ราคาเป้าหมายต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป')
  }
  if (thesis.reviewDate && !isIsoDate(thesis.reviewDate)) errors.push('วันทบทวนไม่ถูกต้อง')
  return errors
}
