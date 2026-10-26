import { isIsoDate, todayLocal } from './dates'
import { D, isDecimalString } from './decimal'
import {
  EMOTIONS,
  FEE_PAID_IN,
  MISTAKES,
  RECEIVE_KINDS,
  TX_TYPES,
  type FeeTemplate,
  type Thesis,
  type TradeJournal,
  type Transaction,
} from './types'
import { t } from '../i18n'

const INSTRUMENT_REQUIRED: readonly string[] = ['buy', 'sell', 'dividend', 'split', 'receive_asset']

export const FEE_ASSET_SAME_ERROR = t('สินทรัพย์ที่จ่ายค่าธรรมเนียมต้องต่างจากสินทรัพย์ของรายการ')

const CURRENCY_PATTERN = /^[A-Z0-9]{2,10}$/

export function validateTransaction(tx: Transaction, today: string = todayLocal()): string[] {
  const errors: string[] = []
  const positive = (value: string | undefined, label: string) => {
    if (!value || !isDecimalString(value) || !D(value).greaterThan(0)) errors.push(t('{0}ต้องเป็นตัวเลขมากกว่า 0', label))
  }
  const nonNegative = (value: string | undefined, label: string) => {
    if (!value || !isDecimalString(value) || D(value).isNegative()) errors.push(t('{0}ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป', label))
  }

  if (!TX_TYPES.includes(tx.type)) errors.push(t('ประเภทรายการไม่ถูกต้อง'))
  if (!tx.accountId) errors.push(t('กรุณาเลือกบัญชี'))
  if (!isIsoDate(tx.date)) errors.push(t('วันที่ไม่ถูกต้อง'))
  else if (tx.date > today) errors.push(t('วันที่ต้องไม่เกินวันนี้'))
  if (tx.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(tx.time)) errors.push(t('เวลาไม่ถูกต้อง'))
  if (!CURRENCY_PATTERN.test(tx.currency)) errors.push(t('สกุลเงินไม่ถูกต้อง'))
  positive(tx.fxRate, t('เรทแลกเปลี่ยน'))
  nonNegative(tx.fees, t('ค่าธรรมเนียม'))
  nonNegative(tx.tax, t('ภาษี'))
  if (INSTRUMENT_REQUIRED.includes(tx.type) && !tx.instrumentId) errors.push(t('กรุณาระบุหุ้น/สินทรัพย์'))

  switch (tx.type) {
    case 'buy':
    case 'sell':
      positive(tx.quantity, t('จำนวนหน่วย'))
      nonNegative(tx.price, t('ราคา'))
      break
    case 'opening':
      if (tx.instrumentId) {
        positive(tx.quantity, t('จำนวนหน่วย'))
        nonNegative(tx.price, t('ต้นทุนเฉลี่ย'))
      } else {
        positive(tx.amount, t('จำนวนเงิน'))
      }
      break
    case 'split':
      positive(tx.splitRatio, t('อัตราแตกพาร์'))
      break
    case 'transfer':
      if (!tx.toAccountId) errors.push(t('กรุณาเลือกบัญชีปลายทาง'))
      else if (tx.toAccountId === tx.accountId) errors.push(t('บัญชีปลายทางต้องต่างจากบัญชีต้นทาง'))
      if (tx.instrumentId) positive(tx.quantity, t('จำนวนหน่วย'))
      else positive(tx.amount, t('จำนวนเงิน'))
      if (tx.toCurrency !== undefined) {
        if (!tx.instrumentId) errors.push(t('เปลี่ยนสกุลได้เฉพาะการโอนสินทรัพย์'))
        if (!CURRENCY_PATTERN.test(tx.toCurrency)) errors.push(t('สกุลเงินปลายทางไม่ถูกต้อง'))
        positive(tx.toFxRate, t('เรทของสกุลปลายทาง'))
      }
      break
    case 'swap':
      if (!tx.instrumentId) errors.push(t('กรุณาระบุสินทรัพย์ที่แลกออก'))
      if (!tx.toInstrumentId) errors.push(t('กรุณาระบุสินทรัพย์ที่ได้รับ'))
      else if (tx.toInstrumentId === tx.instrumentId) errors.push(t('สินทรัพย์ที่ได้รับต้องต่างจากที่แลกออก'))
      positive(tx.quantity, t('จำนวนที่แลกออก'))
      positive(tx.toQuantity, t('จำนวนที่ได้รับ'))
      if (tx.exercise) {
        nonNegative(tx.paid, t('เงินที่จ่ายค่าใช้สิทธิ'))
        if (tx.amount !== undefined) errors.push(t('การใช้สิทธิไม่มีมูลค่าแลก'))
      } else positive(tx.amount, t('มูลค่ารวม'))
      break
    case 'receive_asset':
      if (!tx.receiveKind || !RECEIVE_KINDS.includes(tx.receiveKind)) errors.push(t('ประเภทการรับไม่ถูกต้อง'))
      positive(tx.quantity, t('จำนวนที่ได้รับ'))
      nonNegative(tx.price, t('มูลค่าต่อหน่วย'))
      break
    case 'fx_convert':
      positive(tx.amount, t('จำนวนเงินต้นทาง'))
      positive(tx.toAmount, t('จำนวนเงินที่ได้รับ'))
      if (
        tx.amount &&
        isDecimalString(tx.amount) &&
        isDecimalString(tx.fees) &&
        D(tx.amount).greaterThan(0) &&
        D(tx.fees).greaterThanOrEqualTo(D(tx.amount))
      ) {
        errors.push(t('ค่าธรรมเนียมต้องน้อยกว่าจำนวนเงินต้นทาง'))
      }
      if (!tx.toCurrency || tx.toCurrency === tx.currency) errors.push(t('สกุลเงินปลายทางต้องต่างจากต้นทาง'))
      break
    default:
      positive(tx.amount, t('จำนวนเงิน'))
  }

  if (tx.type === 'withdraw' && tx.remitToThailand) {
    const year = tx.taxYear
    if (year === undefined || !Number.isInteger(year) || year < 2000 || year > 2200) errors.push(t('ปีภาษีไม่ถูกต้อง'))
  }

  if (tx.importBatchId !== undefined && typeof tx.importBatchId !== 'string') errors.push(t('เลขชุดนำเข้าไม่ถูกต้อง'))
  if (tx.rightsOffer !== undefined && (tx.rightsOffer !== true || tx.type !== 'buy')) errors.push(t('ซื้อหุ้นเพิ่มทุนใช้ได้กับการซื้อเท่านั้น'))
  if (tx.exercise !== undefined && (tx.exercise !== true || tx.type !== 'swap')) errors.push(t('การใช้สิทธิใช้ได้กับการแลกเท่านั้น'))
  if (tx.paid !== undefined && !tx.exercise) errors.push(t('เงินค่าใช้สิทธิใช้ได้กับการใช้สิทธิเท่านั้น'))

  if (tx.journal !== undefined) {
    if (tx.type !== 'buy' && tx.type !== 'sell') errors.push(t('บันทึกเทรดใช้ได้กับการซื้อและขาย'))
    else errors.push(...validateJournal(tx.journal))
  }

  const feePaidIn = tx.feePaidIn ?? 'cash'
  if (!FEE_PAID_IN.includes(feePaidIn)) {
    errors.push(t('วิธีจ่ายค่าธรรมเนียมไม่ถูกต้อง'))
  } else if (feePaidIn === 'received') {
    if (tx.type !== 'buy' && tx.type !== 'swap' && !(tx.type === 'transfer' && tx.instrumentId)) {
      errors.push(t('หักจากที่ได้รับใช้ได้กับการซื้อ แลกเหรียญ และโอนสินทรัพย์'))
    } else {
      positive(tx.feeQuantity, t('จำนวนที่ถูกหัก'))
      if (isDecimalString(tx.fees) && !D(tx.fees).isZero()) errors.push(t('ค่าธรรมเนียมที่หักจากที่ได้รับกรอกเป็นจำนวนหน่วย'))
      const received = tx.type === 'swap' ? tx.toQuantity : tx.quantity
      if (
        tx.feeQuantity &&
        received &&
        isDecimalString(tx.feeQuantity) &&
        isDecimalString(received) &&
        D(received).greaterThan(0) &&
        D(tx.feeQuantity).greaterThanOrEqualTo(D(received))
      ) {
        errors.push(t('ค่าธรรมเนียมต้องน้อยกว่าจำนวนที่ได้รับ'))
      }
    }
  } else if (feePaidIn === 'asset') {
    if (tx.type !== 'buy' && tx.type !== 'sell' && tx.type !== 'swap') {
      errors.push(t('จ่ายค่าธรรมเนียมเป็นสินทรัพย์อื่นใช้ได้กับการซื้อ ขาย และแลกเหรียญ'))
    } else {
      if (!tx.feeInstrumentId) errors.push(t('กรุณาระบุสินทรัพย์ที่ใช้จ่ายค่าธรรมเนียม'))
      else if (tx.feeInstrumentId === tx.instrumentId || tx.feeInstrumentId === tx.toInstrumentId) {
        errors.push(FEE_ASSET_SAME_ERROR)
      }
      positive(tx.feeQuantity, t('จำนวนที่จ่ายค่าธรรมเนียม'))
      positive(tx.fees, t('มูลค่าค่าธรรมเนียม'))
    }
  }
  return errors
}

function isScale(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5
}

function isTextList(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

// Every field may be left out; whatever is filled in has to make sense. A backup file can hold anything, so the shape
// is checked as well as the values.
export function validateJournal(journal: TradeJournal): string[] {
  if (typeof journal !== 'object' || journal === null || Array.isArray(journal)) return [t('บันทึกเทรดไม่ถูกต้อง')]
  const errors: string[] = []
  const price = (value: string | undefined, label: string) => {
    if (value !== undefined && (typeof value !== 'string' || !isDecimalString(value) || D(value).isNegative())) {
      errors.push(t('{0}ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป', label))
    }
  }
  const text = [journal.strategy, journal.reason, journal.review].every((value) => value === undefined || typeof value === 'string')
  if (!text || (journal.tags !== undefined && !isTextList(journal.tags))) errors.push(t('บันทึกเทรดไม่ถูกต้อง'))
  if (journal.emotion !== undefined && !EMOTIONS.includes(journal.emotion)) errors.push(t('อารมณ์ไม่ถูกต้อง'))
  if (journal.confidence !== undefined && !isScale(journal.confidence)) errors.push(t('ความมั่นใจต้องเป็น 1–5'))
  price(journal.stopLoss, 'Stop loss ')
  price(journal.target, 'Target ')
  if (journal.mistakes !== undefined && !(Array.isArray(journal.mistakes) && journal.mistakes.every((m) => MISTAKES.includes(m)))) {
    errors.push(t('ข้อผิดพลาดไม่ถูกต้อง'))
  }
  if (journal.score !== undefined && !isScale(journal.score)) errors.push(t('คะแนนการลงมือต้องเป็น 1–5'))
  if (journal.checked !== undefined && !isTextList(journal.checked)) errors.push(t('เช็คลิสต์ไม่ถูกต้อง'))
  return errors
}

// A colon would break the id MARKET:SYMBOL, which is split on ":"; spaces are refused to keep symbols tidy.
export function validateSymbol(symbol: string): string[] {
  const trimmed = symbol.trim()
  if (!trimmed) return [t('กรุณาระบุสัญลักษณ์')]
  const errors: string[] = []
  if (/[\s:]/.test(trimmed)) errors.push(t('สัญลักษณ์ห้ามมีช่องว่างหรือเครื่องหมาย :'))
  if (trimmed.length > 20) errors.push(t('สัญลักษณ์ยาวเกิน 20 ตัวอักษร'))
  return errors
}

// Every field may be left empty; whatever is filled in has to make sense.
export function validateThesis(thesis: Thesis): string[] {
  const errors: string[] = []
  if (thesis.targetPrice && (!isDecimalString(thesis.targetPrice) || D(thesis.targetPrice).isNegative())) {
    errors.push(t('ราคาเป้าหมายต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป'))
  }
  if (thesis.reviewDate && !isIsoDate(thesis.reviewDate)) errors.push(t('วันทบทวนไม่ถูกต้อง'))
  return errors
}

// A number field may be left empty, which reads as 0.
export function validateFeeTemplate(template: FeeTemplate): string[] {
  const errors: string[] = []
  if (!CURRENCY_PATTERN.test(template.currency)) errors.push(t('สกุลเงินของสูตรไม่ถูกต้อง'))
  const number = (value: string, label: string, overLimit?: string) => {
    if (value === '') return
    if (!isDecimalString(value) || D(value).isNegative()) errors.push(t('{0}ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป', label))
    else if (overLimit && D(value).greaterThan(100)) errors.push(overLimit)
  }
  number(template.commissionPct, t('ค่าคอม'), t('ค่าคอมต้องไม่เกิน 100%'))
  number(template.minimum, t('ขั้นต่ำต่อคำสั่ง'))
  number(template.vatPct, 'VAT ', t('VAT ต้องไม่เกิน 100%'))
  number(template.perOrder, t('ค่าธรรมเนียมต่อคำสั่ง'))
  return errors
}
