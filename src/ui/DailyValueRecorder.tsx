import { useEffect } from 'react'
import { db } from '../db/db'
import { recordDailyValue } from '../db/repo'
import { todayLocal } from '../domain/dates'
import { dailySnapshot } from '../domain/investor'
import { useAppData, useInvestor } from './hooks'

// Lives in the layout so the day is recorded whichever page the app was opened on (spec 5.8).
export function DailyValueRecorder() {
  const data = useAppData()
  const { investor } = useInvestor(data)
  const snapshot = investor ? dailySnapshot(investor) : null
  const valueBase = snapshot?.valueBase
  const netInvestedBase = snapshot?.netInvestedBase

  useEffect(() => {
    if (valueBase === undefined || netInvestedBase === undefined) return
    void recordDailyValue(db, { date: todayLocal(), valueBase, netInvestedBase })
  }, [valueBase, netInvestedBase])

  return null
}
