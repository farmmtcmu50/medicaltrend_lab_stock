# Cloudflare Access (One-time PIN) สำหรับ stock และ subscriptions

ทั้งสอง Worker ของ Medical Trend เข้าสู่ระบบผ่าน Cloudflare Access team `medicaltrend.cloudflareaccess.com`
แบบ One-time PIN เท่านั้น ไม่มีหน้า login, รหัสผ่าน หรือ session cookie ของ app แล้ว
อ้างอิงแนวทางกลาง: runbook `docs/sso-access.md` ของ MT-QMS

| Worker | โดเมน | ตารางผู้ใช้ | สิทธิ์ |
| --- | --- | --- | --- |
| `medical-trend-lab-stock` | `stock.medicaltrend.stream` | `users.email` (migration 0015) | `role` admin/staff เดิม |
| `medical-trend-subscriptions` | `subscriptions.medicaltrend.stream` (มี s) | `admins.email` | owner คนเดียวเหมือนเดิม |

## โค้ดทำงานอย่างไร

- `subscription/src/access.js` ตรวจ `Cf-Access-Jwt-Assertion` ทุก request ด้วย `jose`
  (JWKS จาก `${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`, issuer = team domain, audience = `ACCESS_AUD` ของแต่ละ app)
- ไม่มี JWT / JWT ผิด / หมดอายุ / AUD ของ app อื่น → 401 · อีเมลไม่อยู่ในตารางผู้ใช้หรือถูกปิด → 403
- stock: หา `users` ด้วย `lower(email)` แล้วใช้ role เดิม · ไม่สร้าง `admin/1111` อีก · `/api/login`, `/api/logout`, `/api/me/password` = 404
  การ restore จะถูกปฏิเสธถ้าไฟล์ backup ไม่มี admin ที่ใช้อีเมลของผู้กด restore (กันล็อกตัวเองออก)
- subscriptions: การเข้าครั้งแรกด้วยอีเมล `ADMIN_EMAIL` จะสร้างแถว owner (บันทึก `OWNER_CREATED`) · `/api/setup`, `/api/login`, `/api/logout`, `/api/password` ถูกถอด
- ปุ่มออกจากระบบไปที่ `/cdn-cgi/access/logout`
- **Worker ลูกค้า `mt-stock-<slug>` (มี `TENANT_ID`) ยังใช้ username/password เดิม** เพราะลูกค้าภายนอกไม่อยู่ใน `mt-staff`
- dev บนเครื่อง: ใส่ `DEV_ACCESS_EMAIL` ใน `.dev.vars` (ดู `.dev.vars.example`) ใช้ได้เฉพาะ host localhost/127.0.0.1
  เปลี่ยนผู้ใช้ทดสอบได้ด้วย header `x-dev-user-email`

## Path ที่ไม่ใช่คน

| Path | ใครเรียก | ต้องทำ |
| --- | --- | --- |
| `subscriptions…/internal/subscription` | Worker ลูกค้า ผ่าน **Service Binding** `SUBSCRIPTIONS` + Bearer token รายลูกค้า | ไม่ต้อง Bypass — Service Binding ไม่วิ่งผ่านโดเมน/Access โค้ดยกเว้น path นี้จากการตรวจ JWT เอง ส่วนการเรียกจากภายนอกผ่านโดเมนจะถูก Access กันไว้ ซึ่งถูกต้องแล้ว |
| `scripts/subscription.mjs` | ผู้ดูแลจาก Terminal | ใช้ `wrangler d1 execute` (Cloudflare API) ไม่ผ่านโดเมน ไม่กระทบ · health check ยิง URL ของ Worker ลูกค้า ไม่ใช่ stock/subscriptions |
| Cron / webhook | — | ไม่มีในทั้งสอง Worker |

จึง **ไม่ต้องมี Bypass policy หรือ Service Token** สำหรับสองโดเมนนี้

## ขั้นตอนใน Cloudflare dashboard

Zero Trust → Access → Applications → Add → Self-hosted (ทำ 2 ครั้ง แยก application ไม่ใช้ wildcard)

1. **stock**: Domain `stock.medicaltrend.stream` · Login method One-time PIN · Policy Allow → Include: Access Group `mt-staff`
2. **subscriptions**: Domain `subscriptions.medicaltrend.stream` · One-time PIN · Policy Allow → แนะนำจำกัดเฉพาะอีเมล owner
   (หรือ group ที่แคบกว่า `mt-staff`) เพราะในแอปมีสิทธิ์เฉพาะ owner อยู่แล้ว
3. คัดลอก **AUD tag** ของแต่ละ application แล้วตั้ง secret:

   ```sh
   npx wrangler secret put ACCESS_AUD
   npx wrangler secret put ACCESS_AUD --config subscription/wrangler.jsonc
   ```

## ลำดับการเปลี่ยน (rollout)

ทุกคำสั่ง `--remote` และ deploy ต้องขออนุมัติก่อน

1. **เตรียมอีเมล**: รัน migration 0015 บน D1 จริง (เพิ่มคอลัมน์อย่างเดียว โค้ดเดิมยังทำงานได้)
   `npm run db:migrate:remote` แล้วใส่อีเมลให้ผู้ใช้ทุกคนที่ยังใช้งาน เช่น
   `npx wrangler d1 execute medical-trend-lab-stock --remote --command "UPDATE users SET email='name@medicaltrend.co.th' WHERE username='name'"`
   ตรวจว่าไม่เหลือ: `SELECT username FROM users WHERE is_active=1 AND (email IS NULL OR email='')`
   และต้องมี admin อย่างน้อยหนึ่งคนที่มีอีเมล
2. **เปิด Access หน้าประตูก่อน**: สร้าง Access application + policy ตามด้านบน และตั้ง `ACCESS_AUD`
   ช่วงนี้ผู้ใช้ใส่ PIN แล้วยังเจอหน้า password เดิม (โค้ดเก่ายังทำงาน)
3. **Deploy โค้ดตรวจ JWT**: `npm run deploy` และ `npx wrangler deploy --config subscription/wrangler.jsonc`
   (`workers_dev: false` จะปิด URL `*.workers.dev` ของทั้งสอง Worker)
4. **ทดสอบ**: เข้าแต่ละโดเมน → PIN → ชื่อและ role ถูกต้อง · อีเมลที่ไม่มีในตาราง → 403 · logout แล้วต้องขอ PIN ใหม่
5. **ถอดรหัสผ่าน**: เมื่อยืนยันแล้ว ล้างข้อมูลรหัสผ่านและ secret เดิมของ Medical Trend เท่านั้น (ห้ามทำผ่าน migration เพราะ Worker ลูกค้าใช้ migration ชุดเดียวกัน)
   - `UPDATE users SET password_hash='ACCESS_ONLY', salt=''` บน `medical-trend-lab-stock`
   - `UPDATE admins SET password_hash='ACCESS_ONLY', salt=''; DELETE FROM sessions; DELETE FROM auth_attempts` บน `medical-trend-subscriptions`
   - `npx wrangler secret delete SESSION_SECRET` (stock) และ `npx wrangler secret delete SETUP_TOKEN --config subscription/wrangler.jsonc`

ย้อนกลับ: deploy commit ก่อนหน้า (รหัสผ่านยังอยู่จนถึงขั้นที่ 5)

## ทดสอบ

```sh
npm test               # ทั้งหมด
npm run test:access    # 401 / 403 / ผู้ใช้และ role ถูกต้อง ทั้งสอง Worker
```
