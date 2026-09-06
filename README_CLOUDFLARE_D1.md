# Medical Trend Lab Stock on Cloudflare D1

คู่มือนี้สำหรับนำโปรแกรม Stock น้ำยาเวอร์ชันเว็บขึ้น Cloudflare โดยใช้โดเมน `stock.medicaltrend.stream` และฐานข้อมูล Cloudflare D1

## สิ่งที่ต้องมี

1. บัญชี Cloudflare ที่มีโดเมน `medicaltrend.stream` อยู่ใน account เดียวกัน
2. ติดตั้ง Node.js LTS จาก `https://nodejs.org`
3. เปิด Command Prompt หรือ PowerShell ในโฟลเดอร์นี้
4. Login Cloudflare ด้วยคำสั่ง `npx wrangler login`

## ตั้งค่าครั้งแรก

1. เข้าโฟลเดอร์โปรแกรม

```powershell
cd "C:\Users\Chanat Somboon\OneDrive\Desktop\Codex\Lab request\cloudflare_app"
```

2. ติดตั้งเครื่องมือ

```powershell
npm install
```

3. สร้าง D1 database

```powershell
npm run db:create
```

หลังรันเสร็จ Cloudflare จะแสดง `database_id` ให้ copy ค่า `database_id` ไปใส่แทน `REPLACE_WITH_D1_DATABASE_ID` ในไฟล์ `wrangler.jsonc`

4. สร้างตารางใน database

```powershell
npm run db:migrate:remote
```

5. ตั้งค่า session secret

```powershell
npx wrangler secret put SESSION_SECRET
```

ใส่ข้อความยาว ๆ ที่เดายาก เช่น `medicaltrend-stock-สุ่มตัวเลขยาวๆ`

6. Deploy ขึ้น Cloudflare

```powershell
npm run deploy
```

เมื่อ deploy สำเร็จ ให้เปิด `https://stock.medicaltrend.stream`

## Login เริ่มต้น

- Username: `admin`
- Password: `1111`

ระบบจะสร้าง admin เริ่มต้นให้อัตโนมัติเมื่อเปิดใช้งานครั้งแรก หลังจากนั้นควรเปลี่ยน password admin ทันทีในแท็บตั้งค่า

## ย้ายข้อมูลจากโปรแกรม Portable เดิม

1. ตรวจว่าไฟล์ portable เดิมอยู่ที่ `data\lab_stock.db`
2. รันคำสั่งนี้จากโฟลเดอร์ `cloudflare_app`

```powershell
python migrate_sqlite_to_d1.py
```

3. จะได้ไฟล์ `d1_import_from_portable.sql`
4. Import เข้า D1

```powershell
npx wrangler d1 execute medical-trend-lab-stock --remote --file=./d1_import_from_portable.sql
```

หมายเหตุ: ตอนย้ายข้อมูล ผู้ใช้งานเดิมจาก portable จะถูก reset password เป็น `1111` เพราะระบบเข้ารหัสรหัสผ่านของ portable ใช้ค่า PBKDF2 สูงกว่า runtime ของ Cloudflare Workers รองรับ หลัง import เสร็จให้ admin เปลี่ยน password ผู้ใช้งานในแท็บตั้งค่าทันที

## ตั้งค่าโดเมน

ไฟล์ `wrangler.jsonc` กำหนด custom domain ไว้แล้ว:

```json
"routes": [
  {
    "pattern": "stock.medicaltrend.stream",
    "custom_domain": true
  }
]
```

ถ้า deploy แล้วโดเมนยังไม่เปิด ให้เข้า Cloudflare Dashboard:

1. เลือกโดเมน `medicaltrend.stream`
2. ไปที่ DNS และตรวจว่ามี record สำหรับ `stock`
3. ไปที่ Workers & Pages > Worker `medical-trend-lab-stock`
4. ตรวจที่ Settings > Domains & Routes ว่ามี `stock.medicaltrend.stream`

## ข้อควรรู้เรื่องการพิมพ์ QR

เว็บไม่สามารถสั่งพิมพ์ไปยังเครื่องพิมพ์ Windows โดยตรงแบบไม่ถามผู้ใช้ได้เหมือนโปรแกรม exe เพราะ browser จะบังคับให้ผ่านหน้าต่าง Print เพื่อความปลอดภัย วิธีใช้งานคือกดพิมพ์ QR แล้วเลือกเครื่องพิมพ์หรือเลือก Save as PDF จากหน้าต่าง print ของ browser

## Features ที่มีในเวอร์ชันนี้

- Login user และ role admin/staff
- เพิ่ม/แก้ไข/ลบรายการน้ำยา
- ราคาต่อหน่วยย่อยและราคาต่อหน่วยหลักคำนวณกลับกันอัตโนมัติ
- รับเข้าคลังพร้อม Lot และ Expire
- สร้าง QR หน่วยย่อยหลายดวง หรือ QR หน่วยหลัก 1 ดวงที่ผูกหน่วยย่อย
- ตัด stock ด้วย QR หรือ Manual จากรายการ QR ที่มีอยู่
- กรณี QR หน่วยหลัก เลือกจำนวนหน่วยย่อยที่จะตัดได้
- แจ้งเตือน FEFO ถ้าตัดไม่ตรง Lot ที่ควรออกก่อน
- Dashboard รวม item เดียวกัน, คำนวณมูลค่า stock, ค้นหา, sort และเลือกซ่อน/แสดง column
- ตั้งค่าจำนวนวันใกล้หมดอายุ
- Backup/Restore JSON พร้อม safety backup ก่อน restore
- Export Excel
- Audit trail เฉพาะ admin
- จัดการผู้ใช้งานเฉพาะ admin และห้ามลบ user `admin`
