# ระบบ Subscription ของ Medical Trend Stock

รุ่นแรก: Login ผู้ดูแลส่วนกลาง, ลูกค้าแยกราย, ทดลองใช้, แพ็กเกจ, รับโอนและบันทึกต่ออายุ,
ระงับ/เปิดบริการ และ audit trail ใช้งานจริงกับ Cloudflare Workers และ D1

## โครงสร้าง

- `subscription/`: Worker ส่วนกลาง `medical-trend-subscriptions` และ D1 ส่วนกลาง
- `src/index.js`: โปรแกรม Stock ชุดเดิม ใช้ร่วมกันโดย deploy Worker แยกลูกค้า
- ลูกค้าแต่ละราย: Worker `mt-stock-<slug>`, D1 `mt-stock-<slug>`, secrets ของตัวเอง
- Worker ลูกค้าตรวจสิทธิ์กับส่วนกลางผ่าน Service Binding และ token เฉพาะราย
- ส่วนกลางเก็บทะเบียนลูกค้าและการชำระเงิน ไม่ผูกฐานข้อมูล Stock ของลูกค้า
- Worker เดิม `medical-trend-lab-stock` ไม่ได้เพิ่ม `TENANT_ID` จึงยังทำงานแบบเดิม
  ไม่ย้ายหรือคัดลอกฐานข้อมูลจริงเข้า SaaS อัตโนมัติ

## ติดตั้ง

ต้องมี Node.js และ dependencies ตาม `pnpm-lock.yaml`

```sh
pnpm install --frozen-lockfile
npx wrangler login
npm run subscription:setup
```

คำสั่ง setup สร้างฐานข้อมูลส่วนกลางใหม่, บันทึก database_id ใน
`subscription/wrangler.jsonc`, รัน migrations, deploy ระบบส่วนกลาง และตั้ง SETUP_TOKEN
URL หลักคือ https://subscriptions.medicaltrend.stream โดยใช้ Custom Domain ของ Worker
workers.dev URL เดิมยังใช้ได้ และเว็บ stock.medicaltrend.stream แยกตามเดิม

เปิดลิงก์จาก `.provisioning/control-setup.txt` แล้วตั้งรหัสผ่านอย่างน้อย 12 ตัวอักษร
สำหรับ `chanat@medicaltrend.co.th` ลิงก์นี้มี token จึงไม่ควรใส่ใน Git หรือส่งในที่สาธารณะ
ตั้งค่าผู้ดูแลได้ครั้งเดียว ไม่มีบัญชีหรือรหัสผ่านค่าเริ่มต้น

การรัน setup ซ้ำกับฐานที่ระบุ ID แล้วจะอัปเดตตารางและ Worker โดยรักษาข้อมูลเดิม
ถ้าพบฐานชื่อเดียวกันแต่ config ยังไม่มี ID คำสั่งจะหยุดให้ผู้ดูแลตรวจฐานก่อน
เมื่อเปลี่ยนเครื่อง config กลางใน Git ต้องมี database_id ที่ถูกต้อง และต้องล็อกอิน Cloudflare ใหม่

## ใช้บนเครื่อง

```sh
npm run subscription:setup -- --local
npm run subscription:dev
```

เปิด `http://127.0.0.1:8790` โดยใช้ลิงก์ตั้งรหัสผ่านใน
`.provisioning/control-local-setup.txt` ฐาน local และ remote แยกจากกัน
หาก remote setup เปลี่ยน database_id ระหว่าง dev ให้รัน setup --local และเปิด dev ใหม่
เพื่อสร้างตาราง local ให้ตรง binding

## เปิดลูกค้าใหม่

1. Login ส่วนกลาง แล้วเพิ่มลูกค้า: ชื่อบริษัท อีเมล รหัสลูกค้า แพ็กเกจ และวันทดลอง
2. ลูกค้าจะอยู่สถานะ “รอจัดเตรียม” ยังไม่สามารถเข้าระบบหรือรับชำระได้
3. ผู้ดูแล Cloudflare รันจากโฟลเดอร์โปรเจกต์:

   ```sh
   npm run subscription:provision -- chiangmai-lab
   ```

4. คำสั่งสร้าง D1 ใหม่, สร้างตารางจาก migrations, deploy Worker ใหม่, ตั้ง secrets,
   เปิดใช้ Service Binding และตรวจว่า Worker ตอบกลับตามสิทธิ์
5. เปิดลิงก์ใน `.provisioning/chiangmai-lab-setup.txt` ให้ลูกค้าตั้งรหัสผ่านของ
   `admin` เอง การส่งลิงก์ให้ลูกค้าเป็นหน้าที่ของผู้ดูแล ระบบยังไม่ส่งอีเมล
6. กลับหน้าส่วนกลางและรีเฟรช จะเห็น URL, Database ID และสถานะพร้อมใช้งาน

การจัดเตรียมเป็นขั้นตอนจาก Terminal โดยผู้ดูแล **ยังไม่ได้เป็นปุ่มสร้างพื้นที่อัตโนมัติบนเว็บ**
จึงไม่ต้องเก็บ Cloudflare API token ที่มีสิทธิ์สร้าง/ลบทรัพยากรไว้ใน Worker ส่วนกลาง
หากขั้นตอนล้มเหลวจะบันทึกสถานะ failed และ audit ให้รัน provision ซ้ำเพื่อดำเนินต่อ
หากโปรเซสถูกปิดระหว่างทำงาน ให้รอ lease 15 นาทีแล้วรันซ้ำ
หาก D1 สร้างสำเร็จแต่โปรเซสหยุดก่อนลงทะเบียน ID คำสั่งจะหยุดแทนการนำฐานชื่อเดิมมาใช้เอง
ผู้ดูแลต้องตรวจชื่อ/ID และแก้ทะเบียนผ่าน Cloudflare ก่อนดำเนินต่อ

## ต่ออายุและระงับ

- ตั้งราคาอ้างอิงแพ็กเกจก่อนขาย ราคาเริ่มต้น 0 หมายถึงยังไม่ได้กำหนดราคา
- รับเงินโอนแล้วเข้า ลูกค้า → Subscription ระบุแพ็กเกจ เดือน ยอดเงินจริง และเลขอ้างอิง
- ยอดเงินเก็บเป็นสตางค์ จำนวนเดือน 1–36 เดือน
- ลูกค้าที่ยังไม่หมดอายุจะต่อจากวันหมดอายุเดิม ลูกค้าหมดอายุเริ่มจากเวลาบันทึก
- ใช้เดือนปฏิทิน เช่น 31 มกราคม + 1 เดือน เป็นวันสุดท้ายของกุมภาพันธ์
- หน้าจอแสดงวันในเขตเวลา Asia/Bangkok ฐานข้อมูลเก็บ UTC ISO timestamps
- ป้องกันส่งซ้ำด้วย request_key และป้องกันการบันทึกพร้อมกันด้วย version
- ข้อมูลการรับชำระและประวัติไม่มีปุ่มลบหรือแก้ย้อนหลังในรุ่นนี้
- สถานะ expired คำนวณฝั่ง API ตามเวลาจริง ไม่ต้องรอ cron
- เมื่อหมดอายุ: Login, อ่าน, รายงาน, backup, ส่งออก และเปลี่ยนรหัสผ่านตนเองได้;
  เพิ่ม/แก้ไข/ลบ/restore/รับเข้า/ตัดสต็อกไม่ได้
- เมื่อ suspended: ปิดการเข้าใช้งาน Worker ลูกค้า จนผู้ดูแลเปิดบริการอีกครั้ง
- หากส่วนกลางขัดข้องหรือ token ไม่ถูกต้อง Worker ลูกค้าปฏิเสธการใช้งาน (503)
  ไม่ใช้สถานะเก่าที่อาจให้ลูกค้าระงับเข้าใช้งานต่อได้

## อัปเดตและสำรองลูกค้า

```sh
npm run subscription:backup -- chiangmai-lab
npm run subscription:update -- chiangmai-lab
```

backup ส่งออก D1 เป็น SQL ลง `.provisioning/` (สิทธิ์ไฟล์ 0600) และบันทึก audit
ยังไม่มี scheduled backup อัตโนมัติ ต้องเก็บสำเนาในที่ปลอดภัยนอกเครื่องด้วย
update อ่าน ID จากทะเบียน, สร้าง config, รัน migrations และ deploy โค้ดปัจจุบันของลูกค้ารายเดียว
ไม่เปลี่ยน secrets เดิม ไม่ deploy Worker Medical Trend เดิม
การเปลี่ยน schema ที่ลบหรือแปลงข้อมูลควรสำรองและทดลองกู้ก่อนอัปเดต

การกู้ SQL ใช้ Cloudflare D1 execute หลังตรวจฐานและสร้างสำเนาสำรองก่อน
หรือใช้ Backup/Restore JSON ภายในโปรแกรม Stock ของลูกค้ารายนั้น
ระบบส่วนกลางยังไม่มีปุ่ม Restore หรืออ่านสต็อกข้ามลูกค้า

## Secrets และการกู้บัญชี

- `.provisioning/` เก็บ secrets, config และลิงก์ตั้งรหัสผ่าน ไม่เข้า Git
- อย่าส่งไฟล์ secrets หรือ SQL backup ในแชตสาธารณะ
- ส่วนกลางใช้ session แบบ token สุ่ม เก็บเฉพาะ hash ใน D1, HttpOnly, Secure บน HTTPS,
  SameSite=Strict และตรวจ Origin ของคำขอแก้ไขข้อมูล
- เปลี่ยนรหัสผ่านส่วนกลางจะยกเลิก sessions ทุกอุปกรณ์
- Worker ลูกค้าใช้ secret และ cookie แยกราย พร้อม tenant_id ใน session
- จำกัดการลอง login/setup ทั้งส่วนกลางและลูกค้า
- รุ่นนี้ยังไม่มี forgot-password ทางอีเมล, MFA หรือผู้ดูแลส่วนกลางหลายคน
  หากลืมรหัสผ่าน ให้ผู้มีสิทธิ์ Cloudflare ใช้กระบวนการกู้บัญชีที่ตรวจเจ้าของแล้ว
  สำรอง CONTROL_DB ก่อน แก้ hash/salt ของ owner และล้าง sessions ผ่านการดูแลโดยตรง
  ห้ามลบ admins เพื่อเปิด setup ใหม่โดยไม่ตรวจสอบ audit/ผลกระทบ

## Validation

```sh
npm run test:subscription
npm run subscription:check
npm run check
```

Tests ใช้ workerd/Miniflare จริงพร้อมฐาน D1 ของ control และลูกค้า A/B แยกกัน
ทดสอบ owner setup, CSRF, tenant isolation, สินค้า/ราคา/หน่วย/backup, expiry,
suspension, payment idempotency/concurrency, calendar month และ session revocation

ยังไม่รวม payment gateway, ออกใบกำกับภาษี, quota ตามแพ็กเกจ, self-service signup,
custom domain อัตโนมัติ หรือ automatic provisioning จากหน้าจอ
