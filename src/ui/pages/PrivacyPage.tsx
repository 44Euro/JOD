import type { ReactNode } from 'react'
import { Card } from '../../components/ui/card'
import { PageHeader } from '../components/PageHeader'

// The policy describes what the code does. When a service is added or changed, this page changes in the same commit.
export const PRIVACY_UPDATED = '26 ต.ค. 2026'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="grid gap-2 [&_li]:ml-5 [&_li]:list-disc [&_p]:leading-relaxed">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </Card>
  )
}

export function PrivacyPage() {
  return (
    <>
      <PageHeader title="นโยบายความเป็นส่วนตัว" note={`ปรับปรุง ${PRIVACY_UPDATED}`} />
      <Section title="สรุปสั้นๆ">
        <p>JOD เก็บข้อมูลการลงทุนของคุณไว้ในเครื่องที่ใช้อยู่เท่านั้น ไม่มีบัญชีผู้ใช้ ไม่มีโฆษณา ไม่มีตัวติดตามการใช้งาน และไม่ขายข้อมูลให้ใคร</p>
      </Section>
      <Section title="ข้อมูลที่เก็บในเครื่อง">
        <ul>
          <li>บัญชี สินทรัพย์ รายการ บันทึกเทรด รูปประกอบ แผน และมูลค่าพอร์ตรายวัน เก็บในฐานข้อมูลของเบราว์เซอร์ (IndexedDB)</li>
          <li>API key ของบริการที่คุณใส่เอง, PIN ล็อกแอป (เก็บเป็นค่าแฮช ไม่ใช่ตัว PIN) และบันทึกปัญหา เก็บใน localStorage ของเครื่องนี้ และไม่อยู่ในไฟล์สำรอง</li>
          <li>ลบได้ทั้งหมดโดยล้างข้อมูลเว็บไซต์ในเบราว์เซอร์ หรือถอนการติดตั้งแอป ควรสำรองไฟล์ก่อน</li>
        </ul>
      </Section>
      <Section title="สิ่งที่ถูกส่งออกจากเครื่อง และเมื่อไหร่">
        <ul>
          <li>
            <b>เรทค่าเงิน</b> — ถามเรทจาก api.frankfurter.dev (ECB) โดยส่งเฉพาะคู่สกุลเงินและวันที่ ไม่ส่งจำนวนเงิน
          </li>
          <li>
            <b>ราคาอัตโนมัติ</b> — เมื่อคุณกดดึงราคาหรือเปิดการดึงอัตโนมัติ แอปส่งชื่อสินทรัพย์ที่ถือไปถาม CoinGecko และ Finnhub (เมื่อใส่ key) ไม่ส่งจำนวนหรือมูลค่า
          </li>
          <li>
            <b>อ่านรูปและไฟล์แบบในเครื่อง (ค่าเริ่มต้น)</b> — รูปและไฟล์ไม่ออกจากเครื่อง ครั้งแรกแอปโหลดชุดอ่านตัวอักษร (tesseract) จาก CDN สาธารณะ
          </li>
          <li>
            <b>อ่านด้วย Claude (เลือกเอง)</b> — รูปหรือไฟล์ที่คุณกด "ให้ AI อ่าน" จะถูกส่งไปที่ Anthropic ด้วย API key ของคุณ ตามนโยบายของ Anthropic · ครอปหรือปิดเลขบัญชีก่อนส่งได้
          </li>
          <li>
            <b>ซิงก์หลายเครื่อง (เมื่อเปิดใช้)</b> — ข้อมูลถูกเข้ารหัสในเครื่องด้วยรหัสผ่านซิงก์ก่อนส่ง เซิร์ฟเวอร์เห็นแค่ข้อมูลที่อ่านไม่ออก
          </li>
        </ul>
      </Section>
      <Section title="ไฟล์สำรองและรายงานปัญหา">
        <ul>
          <li>ไฟล์สำรองเป็นของคุณ แอปไม่ส่งไปไหน เลือกเข้ารหัสด้วยรหัสผ่านได้</li>
          <li>รายงานปัญหาเก็บในเครื่อง ตัวเลขทุกตัวถูกลบออก และส่งต่อเมื่อคุณคัดลอกหรือดาวน์โหลดเองเท่านั้น</li>
        </ul>
      </Section>
      <Section title="ข้อจำกัด">
        <p>
          ตัวเลขในแอป รวมถึงรายงานช่วยเตรียมภาษี เป็นเครื่องมือช่วยจดบันทึก ไม่ใช่คำแนะนำการลงทุนหรือภาษี · ล็อกแอปกันคนที่หยิบเครื่องไปเปิด แต่ข้อมูลในเครื่องไม่ได้ถูกเข้ารหัส
        </p>
      </Section>
    </>
  )
}
