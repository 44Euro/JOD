# JOD

จดทุกเทรด รู้ทุกบาท — บันทึกการลงทุนและการเทรด หุ้นไทย หุ้นต่างประเทศ คริปโต และกองทุน พร้อมเรทค่าเงินของทุกรายการ ข้อมูลอยู่ในเครื่องของผู้ใช้

## ใช้งาน

ต้องมี Node.js 22 ขึ้นไป

```bash
npm install
npm run dev          # เปิดที่ http://localhost:5173
npm test             # เทสทั้งหมด
npm run build        # สร้างไฟล์เว็บใน dist/ (ติดตั้งเป็น PWA ได้)
```

## ซิงก์หลายเครื่อง (ไม่บังคับ)

เซิร์ฟเวอร์ซิงก์รันเองได้ เก็บเฉพาะข้อมูลที่เข้ารหัสแล้วจากเครื่องผู้ใช้

```bash
npm run sync-server  # http://localhost:8787 · ตั้ง PORT, DATA_DIR, ALLOW_ORIGIN ได้
```

แล้วใส่ที่อยู่เซิร์ฟเวอร์ในหน้าตั้งค่า → ซิงก์หลายเครื่อง

## แอปมือถือ

แอป iOS และ Android ห่อ build เดียวกับเว็บด้วย Capacitor

```bash
npm run mobile:ios      # build + sync แล้วเปิด Xcode
npm run mobile:android  # build + sync แล้วเปิด Android Studio
```

ไอคอนสร้างจาก `assets/icon.svg` ด้วย `npx @capacitor/assets generate --ios --android`
