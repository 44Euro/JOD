# เอา JOD ขึ้นใช้งานจริง

JOD มี 3 ส่วน แต่ละส่วนขึ้นคนละที่

| ส่วน | อยู่ที่ไหน | ทำหน้าที่ |
|---|---|---|
| เซิร์ฟเวอร์ซิงก์ (`server/`) | Fly.io | บัญชีผู้ใช้ ซิงก์ข้อมูลที่เข้ารหัสแล้ว ราคา ข่าว อีเมลตั้งรหัสผ่านใหม่ |
| ฐานข้อมูล | Supabase (Postgres) | เก็บบัญชีและข้อมูลที่เข้ารหัสจากเครื่องผู้ใช้ |
| เว็บแอป (`dist/`) | Cloudflare Pages หรือ Netlify | ไฟล์หน้าเว็บ |

## HTTPS หรือ HTTP

ใช้ **HTTPS เท่านั้น** ทั้งเว็บและเซิร์ฟเวอร์ HTTP ส่งข้อมูลแบบอ่านได้ คนที่อยู่ในเครือข่ายเดียวกัน (เช่น Wi-Fi สาธารณะ) ดัก session และรหัสได้

- Fly.io และ Cloudflare Pages ออกใบรับรอง HTTPS ให้อัตโนมัติ ไม่ต้องซื้อ
- `fly.toml` ตั้ง `force_https = true` ไว้แล้ว คำขอ HTTP จะถูกส่งต่อไป HTTPS
- เซิร์ฟเวอร์ส่ง `Strict-Transport-Security` ทำให้เบราว์เซอร์ไม่ยอมกลับไปใช้ HTTP กับโดเมนนี้อีก

## 1. Supabase (ทำก่อน)

1. **Settings → Database → SSL Configuration:** เปิด *Enforce SSL on incoming connections*
2. ดาวน์โหลด *SSL certificate* แล้วเก็บไว้ ใช้เป็น `DATABASE_CA` ถ้าต้องการให้เซิร์ฟเวอร์ตรวจว่าคุยกับ Supabase ตัวจริง
3. **Database → Backups:** แผนฟรีเก็บ backup รายวันไว้ไม่กี่วัน ถ้ามีผู้ใช้จริงควรอัปเกรดเป็นแผนที่มี Point-in-Time Recovery
4. **Database password:** ใช้รหัสยาว สุ่ม และไม่ใช้ซ้ำกับที่อื่น
5. ทุกตารางเปิด row level security ไว้โดยไม่มี policy คนที่ใช้ anon key ของ Supabase จึงอ่านอะไรไม่ได้ เซิร์ฟเวอร์ JOD ต่อตรงด้วยบัญชีเจ้าของ

## 2. เซิร์ฟเวอร์บน Fly.io

ติดตั้ง `flyctl` แล้วล็อกอิน จากนั้นสร้างแอปจาก `fly.toml` (ชื่อแอปเปลี่ยนได้)

```bash
fly launch --no-deploy --copy-config
```

ตั้งค่าลับ ทีละตัวหรือรวมคำสั่งเดียวก็ได้ ค่าเหล่านี้ห้ามใส่ในไฟล์ที่ commit

```bash
fly secrets set DATABASE_URL="postgresql://..." ALLOW_ORIGIN="https://app.yourdomain.com,capacitor://localhost,https://localhost" APP_URL="https://app.yourdomain.com"
```

```bash
fly secrets set FINNHUB_API_KEY="..." SEC_USER_AGENT="JOD you@yourdomain.com" RESEND_API_KEY="..." MAIL_FROM="JOD <no-reply@yourdomain.com>"
```

- `ALLOW_ORIGIN` ต้องมีโดเมนเว็บ และ `capacitor://localhost` (แอป iOS) กับ `https://localhost` (แอป Android) ถ้าไม่ตั้ง เซิร์ฟเวอร์จะไม่ยอมเริ่มในโหมด production
- `TRUST_PROXY=1` ตั้งไว้ใน `fly.toml` แล้ว ทำให้การจำกัดการล็อกอินนับตาม IP ของผู้ใช้จริง ไม่ใช่ IP ของ proxy
- ถ้าใช้ไฟล์ CA ของ Supabase ให้ใส่ไฟล์ในภาพ Docker แล้วตั้ง `DATABASE_CA` เป็น path ของไฟล์

Deploy:

```bash
fly deploy
```

`release_command` ใน `fly.toml` จะรัน `prisma migrate deploy` ก่อนเวอร์ชันใหม่รับคำขอ ครั้งแรกจะสร้างตาราง `push_devices` บน Supabase

เช็กว่าเซิร์ฟเวอร์ทำงานและต่อ DB ได้:

```bash
curl https://jod-sync.fly.dev/api/health
```

ต้องได้ `{"ok":true}`

## 3. อีเมลตั้งรหัสผ่านใหม่ (Resend)

1. สมัคร resend.com แล้วเพิ่มโดเมนของคุณ ใส่ DNS record ที่ Resend ให้ (SPF, DKIM) จนสถานะเป็น Verified
2. สร้าง API key แบบ *Sending access* แล้วตั้งเป็น `RESEND_API_KEY`
3. `MAIL_FROM` ต้องใช้โดเมนที่ verify แล้ว

ถ้าไม่ตั้ง เซิร์ฟเวอร์ยังทำงาน แต่รหัสตั้งรหัสผ่านใหม่จะไปอยู่แค่ใน log และ log จะเตือนตอนเริ่ม

## 4. เว็บแอปบน Cloudflare Pages

Build ด้วยที่อยู่เซิร์ฟเวอร์จริง ไม่อย่างนั้นแอปจะไปถาม `localhost`

- Build command: `npm run build`
- Output directory: `dist`
- Environment variable: `VITE_SYNC_SERVER=https://jod-sync.fly.dev`

ไฟล์ `public/_headers` จะถูกคัดลอกไปกับ build ใส่ header กันการฝังหน้าเว็บใน iframe, HSTS และอื่นๆ ส่วน Content Security Policy อยู่ใน `index.html` ที่ build ออกมา

## 5. แอปมือถือ

Build ด้วย `VITE_SYNC_SERVER` เดียวกัน แล้ว sync เข้า iOS/Android

```bash
VITE_SYNC_SERVER=https://jod-sync.fly.dev npm run mobile:sync
```

## 6. เฝ้าระวังหลังเปิด

- **Uptime monitor:** สมัคร UptimeRobot หรือ Better Stack (มีแผนฟรี) ให้เช็ก `https://jod-sync.fly.dev/api/health` ทุก 1–5 นาที แล้วแจ้งเตือนทางอีเมลหรือ LINE เมื่อไม่ได้ `200` ตัวเช็กนี้ตรวจ DB ด้วย
- **Log:** ดูด้วย `fly logs` ทุกคำขอมีบรรทัด method, path, status, เวลา โดยไม่มี query string หรือข้อมูลผู้ใช้
- **Fly health check:** ตั้งใน `fly.toml` แล้ว ถ้าเซิร์ฟเวอร์ไม่ตอบ Fly จะรีสตาร์ตให้

## เช็กก่อนเปิดให้คนใช้จริง

- [ ] Supabase เปิด Enforce SSL และมี backup
- [ ] `fly secrets list` มีครบ: `DATABASE_URL`, `ALLOW_ORIGIN`, `APP_URL`, `FINNHUB_API_KEY`, `SEC_USER_AGENT`, `RESEND_API_KEY`, `MAIL_FROM`
- [ ] `/api/health` ตอบ `{"ok":true}`
- [ ] เว็บเปิดผ่าน `https://` ได้ และ `http://` ถูกส่งต่อไป `https://`
- [ ] สมัครบัญชีใหม่ ซิงก์ แล้วลองลืมรหัสผ่าน ต้องได้อีเมลจริง
- [ ] Uptime monitor แจ้งเตือนได้ (ลองหยุดเซิร์ฟเวอร์ดูครั้งหนึ่ง)
- [ ] ไม่มีไฟล์ `.env` หรือ key อยู่ใน git (`git ls-files | grep -i env` ต้องเจอแค่ `.env.example`)
