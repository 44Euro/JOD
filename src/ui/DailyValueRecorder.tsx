import { useEffect, useState } from 'react'
import { db } from '../db/db'
import { recordDailyValue } from '../db/repo'
import { todayLocal } from '../domain/dates'
import { dailySnapshot } from '../domain/investor'
import { useAppData, useInvestor } from './hooks'

// Lives in the layout so the day is recorded whichever page the app was opened on (spec 5.8).
export function DailyValueRecorder() {
  const data = useAppData()
  const { investor, confirmed } = useInvestor(data)
  // An installed app is resumed rather than reloaded, so the day is checked again whenever it comes to the front.
  const [today, setToday] = useState(() => todayLocal())
  const snapshot = investor && confirmed ? dailySnapshot(investor) : null
  const valueBase = snapshot?.valueBase
  const netInvestedBase = snapshot?.netInvestedBase

  useEffect(() => {
    function refreshDay() {
      if (document.visibilityState === 'visible') setToday(todayLocal())
    }
    document.addEventListener('visibilitychange', refreshDay)
    return () => document.removeEventListener('visibilitychange', refreshDay)
  }, [])

  useEffect(() => {
    if (valueBase === undefined || netInvestedBase === undefined) return
    // today is a dependency only so this runs again after the day is re-read; the date itself must be the date of the write,
    // or a change made after midnight would overwrite yesterday's row.
    recordDailyValue(db, { date: todayLocal(), valueBase, netInvestedBase }).catch(() => {
      // The next change of value or day writes it again, and there is nothing the user could do about it.
    })
  }, [today, valueBase, netInvestedBase])

  return null
}
