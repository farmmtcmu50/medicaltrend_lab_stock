# Stock workflows

Available to the legacy Stock application and each isolated subscription tenant. Migration `0007_stock_workflows.sql` is additive; existing quantities, prices and movement history are not rewritten.

## Daily work

- **รับเข้าคลัง:** select the item, quantity in the actual unit, Lot and expiry. Optionally select an approved PR line. The server converts to the smallest tracked unit and rejects overdelivery. Each partial receipt updates the remaining amount in the PR's ordering unit. Manual PR lines require mapping to an existing active item with a matching unit; the first receipt keeps that mapping for subsequent receipts.
- **ใบ PR ในระบบ → รับของ / ดูยอดค้างรับ:** view ordered, received and outstanding amounts for each line. Approved PRs must be unapproved before edits; PRs with any receipt history are retained and cannot be unapproved, edited or deleted, including after stock reversal.
- **ตัด Stock:** choose use or disposal. Disposal requires a reason and appears in its own report. Automatic scanning can be turned off. A repeated barcode within ten seconds asks for confirmation, including partially used packages. The result shows item, Lot, actual quantity/unit and remaining quantity in that QR, plus the latest ten scans in the current page.
- **ประวัติ / กลับรายการ:** admins may reverse a new receipt, consumption, disposal or count adjustment after specifying a reason. The original record stays visible and the reversal gets a separate audit record. View QR membership before deciding. If any affected QR has a later operation, reversal is rejected; count and adjust instead. Pre-update movements cannot be reversed because they do not have exact QR membership. Historical reports still show them.
- **ตรวจนับสต๊อก:** select item, Lot and expiry, then enter the physical count in the smallest tracked unit and a reason. Staff can submit; admins review system count, physical count and difference before approval. If the inventory snapshot has changed, approval is rejected and a fresh count must be submitted. Positive adjustments create printable QR codes; negative adjustments retain QR history as `ADJUSTED_OUT`. Pending drafts do not change stock.
- **รายงาน:** separate receipt, use, disposal, adjustment and all-movement views. Actual units are shown. Reversed entries stay visible but are excluded from totals. The all-movement totals use signed inventory effects, grouped by unit; filtered use/disposal reports show quantities taken out. Queries retain the existing 2,000-row report limit, so split large date ranges.

## Lost responses

Stock writes save a request ID and command in local browser storage **before** sending. The banner lets the same user check the outcome or resend the exact original command. Do not clear browser storage, change accounts or create a new command while its outcome is uncertain. A successful retry returns the same operation ID and original receipt QR labels, without applying the quantity again. Validation errors clear the pending command. Network/server errors retain it until verified or retried.

The pending banner covers receive, use, disposal, reversal, count submission and count approval. It does not turn ordinary item/PR edits into offline operations. Old open browser tabs must reload after deployment.

## Integrity and limits

`stock_operations` stores request hashes, replay responses and links to source operations/PR lines. `stock_operation_units` stores exact unit membership and previous state. Every stock mutation, replay record, movement, audit and conditional guard executes in one D1 batch. Unique request IDs and stock-state guards make retries and simultaneous requests safe. This remains an online application; it does not queue arbitrary new work offline.

A single receipt or adjustment is capped at 2,000 smallest units. A physical count can be larger, provided the resulting adjustment stays within that cap. Full admin backup/restore includes the operation journal and counts. Staff exports are not full disaster-recovery backups. Runtime guard rows are transient and are not included in backups. Do not manually remove journal rows: they are required for safe retries and reversals.

Validation: `TMPDIR=/private/tmp node --test tests/*.test.mjs`. Tests cover concurrent retries, unchanged movement counts, case-insensitive scans, partial packages, FEFO, write-off reasons/reports, stale counts, receipt reversal, PR outstanding amounts, role/tenant boundaries, workflow backup/restore and lost-response recovery in the client.

Deploy migration before Worker/assets for the legacy database and each tenant (`node scripts/subscription.mjs update <slug>`). Keep database backups private; never commit provisioning files or credentials.

## Dashboard analytics

- เลือกวันนี้, 7 วันล่าสุด, เดือนนี้ หรือช่วงอิสระ (ไม่เกิน 366 วัน) ร่วมกับเครื่องและคำค้น
- ตารางคลังอยู่ใน Popup เปิดจากกราฟหรือการ์ด สถานะ Stockout / ROP และ FEFO เป็นข้อมูลปัจจุบัน ไม่เปลี่ยนย้อนหลังตามวันที่
- ROP นับทุกรายการที่คงเหลือไม่เกินจุดสั่งซื้อ รวมยอดศูนย์ ตัวหารคือรายการที่เปิดใช้งานภายใต้ตัวกรอง
- มูลค่าทั้งหมดประมาณจากราคาต่อหน่วยปัจจุบัน ไม่มีต้นทุนย้อนหลังแยก Lot; ต้นงวดและปลายงวดคำนวณย้อนจาก movements รวมการกลับรายการ การนำเข้าข้อมูลที่ไม่มี movements อาจทำให้ประวัติไม่ครบ
- Turnover = มูลค่าใช้งานสุทธิ / ((มูลค่าต้นงวด + ปลายงวด) / 2) แยกเครื่อง ไม่มีการ annualize
- DOH = มูลค่าปลายงวด / (มูลค่าใช้งานสุทธิ / จำนวนวันในช่วง) ไม่คูณ 365 ซ้ำเมื่อฐานเป็นรายวันแล้ว ถ้าไม่มีการใช้จะแสดงว่าคำนวณไม่ได้
- Wastage ใช้มูลค่าตัดทิ้งสุทธิ / มูลค่าการซื้อในงบประมาณที่ผู้ดูแลระบุสำหรับช่วงวันเดียวกัน ค่าฐานเป็นทั้งคลังทุกเครื่อง; ตัวกรองเครื่อง/คำค้นจำกัดเฉพาะตัวเศษ จึงตีความเป็นสัดส่วนต่อฐานทั้งคลัง ค่าฐานไม่เปลี่ยนสต๊อก มี Audit และรวมใน Backup
- Heatmap สาเหตุจำแนกจากข้อความตัดทิ้ง: หมดอายุ/expire, เสื่อม/เสีย/damage, อื่น ๆ การกลับรายการใช้สาเหตุเดิม
- FEFO แบ่งหมดอายุ, 0–29 วัน, 30–59 วัน, 60–89 วัน ตารางแสดงหน่วยและจำนวนจริง กราฟนับ Lot/รายการ ไม่บวกหน่วยต่างชนิดเข้าด้วยกัน
- คลิกกราฟ OTIF หรือ Lead Time > กำหนดวันที่ เพื่อบันทึกวันออก PO จริงและวันนัดส่งใน PR ที่อนุมัติแล้ว ไม่ถือวันขอซื้อเป็นวันออก PO อัตโนมัติ ข้อมูลรับครบมาจากการรับเข้าที่ผูกบรรทัด PR และยังไม่ถูกกลับรายการ
- OTIF แยก Vendor โดยนับคู่เอกสาร/Vendor (PO เดียวหลาย Vendor แยกตามส่วนของ Vendor นั้น) ต้องรับครบทุกบรรทัดภายในวันนัดส่ง ฐานคือเอกสารที่ออกในช่วงและถึงวันนัดส่งแล้ว ไม่รวมวันที่ไม่ครบหรือยังไม่ถึงกำหนด เอกสารค้างรับที่ถึงกำหนดถือว่าไม่ผ่าน
- Lead Time นับจากออก PO ถึงวันที่รับครบ เฉลี่ยต่อเอกสาร/Vendor ที่รับครบในช่วง พร้อมแนวโน้มรายเดือน ไม่รวมวันที่ขาดหรือเรียงลำดับผิด
- บัญชีพนักงานไม่เห็นมูลค่า, Turnover, DOH, Wastage หรือฐานงบประมาณ และแก้ไขวันที่จัดซื้อไม่ได้

## ทะเบียน Supplier

- เมนูทะเบียน Supplier รวมชื่อจากข้อมูลน้ำยาและ PR เดิม ตัดช่องว่างหัวท้ายและรวมตัวพิมพ์อังกฤษที่ต่างกัน ผู้ดูแลเพิ่ม/แก้ไขข้อมูลติดต่อหรือปิดใช้งานได้ ลบได้โดยผู้ดูแล ระบบย้ายข้อมูลไปหมวดยังไม่ระบุ Supplier และเก็บ Audit
- เปิด “น้ำยา / Stock” เพื่อดูรายการน้ำยาที่ผูกอยู่ และคงเหลือแยกน้ำยา / Lot / หมดอายุ / หน่วย ไม่รวมจำนวนคนละหน่วยเป็นยอดเดียว
- เพิ่ม/แก้ไขน้ำยาต้องเลือก Supplier ที่มีในทะเบียน API ตรวจรหัสจริงและไม่ยอมรับค่าว่างหรือกลุ่มรอระบุ Supplier รายที่ปิดใช้งานยังคงอยู่กับน้ำยาเดิมได้ แต่เลือกผูกกับรายการใหม่ไม่ได้
- รายการเดิมที่ไม่มีชื่อผู้ขายจัดกลุ่ม “ยังไม่ระบุ Supplier (ข้อมูลเดิม)” ไม่สร้างชื่อผู้ขายแทน เมื่อระบุผู้ขายจริงครั้งแรกจะผูกสต๊อกเดิมที่ยังไม่ทราบผู้ขายตามไปด้วย โดยยังระบุว่าเป็นการอ้างอิงข้อมูลเดิม
- สต๊อกเดิมอนุมานจาก Supplier ประจำ item ณ วัน migration ไม่ยืนยันว่าเป็นผู้ขายจริงของทุกล็อต จะแสดง “อ้างอิงข้อมูลเดิม / ตรวจนับ” เพื่อไม่ใช้เป็นหลักฐานจัดซื้อย้อนหลัง
- รับเข้าใหม่เก็บ `stock_units.supplier_id` เป็นประวัติ ณ วันรับเข้า ถ้ารับจาก PR ใช้ Supplier ของบรรทัด PR; รับทั่วไปใช้ Supplier ประจำ item การเปลี่ยน Supplier ประจำจะไม่ย้ายสต๊อกที่ระบุผู้ขายแล้วไปยังรายใหม่
- PR เก็บรหัส Supplier ควบคู่ชื่อเดิม เพื่อรับของและวิเคราะห์ต่อได้แม้เปลี่ยนชื่อผู้ขาย ภายหลังเปลี่ยนชื่อ Supplier ชื่อใน item จะตรงทะเบียน แต่ไม่เขียนทับชื่อในเอกสาร PR ย้อนหลัง
- Migration เพิ่มดัชนีสำหรับค้นตาม Supplier รวมทะเบียนใน Backup/Restore และ Export Excel รองรับ Restore ไฟล์เก่าที่ยังไม่มีทะเบียน โดยสร้างความสัมพันธ์จากชื่อในไฟล์

## จัดการ Lot จากรายการน้ำยา

- กด “จัดการ Lot” ข้างรายการน้ำยา เพื่อดูคงเหลือ / ใช้แล้ว / ตัดทิ้ง / ปรับออก / ยกเลิก แยกเลข Lot และวันหมดอายุ หน่วยเป็นหน่วยที่ใช้ตัดสต๊อกจริง
- “ดู QR / พิมพ์” แสดง QR ทั้งหมดใน Lot โหลดครั้งละ 200 รายการ พิมพ์ฉลากเดิมซ้ำได้เฉพาะ QR ที่ยังอยู่ในคลัง
- “ตรวจนับ” เปิดหน้าตรวจนับโดยเลือกน้ำยา Lot และวันหมดอายุให้แล้ว ผู้ใช้กรอกยอดนับจริงและเหตุผลตามขั้นตอนเดิม
- ผู้ดูแลแก้เลข Lot / วันหมดอายุได้เมื่อทุกหน่วยของกลุ่มยัง IN_STOCK และไม่เกิน 2000 หน่วย ต้องระบุเหตุผล ไม่ยอมให้รวมเข้ากลุ่ม Lot/วันหมดอายุที่มีอยู่แล้ว
- การแก้ไขรักษารหัส QR, ผู้ขาย, จำนวน และประวัติรับเข้าเดิม อัปเดตข้อมูล QR หน่วยหลักที่เกี่ยวข้องพร้อมกัน ตรวจไม่ให้แพ็กเกจคร่อมกลุ่มหรือมีหน่วยใช้แล้ว
- บันทึกเป็น LOT_EDIT ในประวัติและ Audit รวม QR ที่ได้รับผลกระทบ การแก้ไขไม่สร้าง movement ของจำนวน ใช้ request_id เพื่อป้องกันบันทึกซ้ำเมื่อเครือข่ายขัดข้อง
- ต้องพิมพ์ฉลากที่แสดง Lot/หมดอายุใหม่ ใบตรวจนับที่เก็บ snapshot เดิมจะใช้ยืนยันไม่ได้ และรายการรับเข้าก่อนแก้ไขไม่สามารถกลับย้อนหลังผ่านการแก้ไขนี้ได้
- ดัชนี item_id/lot/expiry_date/barcode ช่วยให้ค้นเฉพาะกลุ่ม Lot โดยไม่อ่านทั้งคลัง

### ลบ Supplier

ผู้ดูแลกด “ลบ” ในทะเบียน Supplier และยืนยันได้ ระบบย้าย item, stock_units และรหัสอ้างอิง PR ไป `SUP-UNASSIGNED` แล้วลบทะเบียนต้นทางในธุรกรรมเดียว พร้อม Audit ข้อมูลผู้ขายเดิมและจำนวนที่ย้าย จำนวน/QR/สถานะสต๊อกไม่เปลี่ยน ข้อความชื่อผู้ขายเดิมใน PR ยังคงอยู่เพื่ออ้างอิงย้อนหลัง ข้อมูลผู้ขายของสต๊อกที่ย้ายจะแสดงว่าไม่ทราบแหล่งที่มาแน่ชัด ต้องผูก Supplier จริงใหม่ก่อนเพิ่ม/แก้ไขน้ำยาหรือรับของ หมวด “ยังไม่ระบุ Supplier” ลบไม่ได้ การเรียกลบซ้ำไม่สร้างประวัติซ้ำ

## ตัดน้ำยาหมดอายุจาก Dashboard

เปิดการ์ด “รายการหมดอายุแล้ว” แล้วกด “ตัดน้ำยาทิ้ง” ข้างรายการ หรือเปิดรายละเอียด Near-Expiry แล้วกดปุ่มใน Lot หมดอายุ เลือก Lot/วันหมดอายุ จำนวนในหน่วยตัดจริง และเหตุผล ก่อนยืนยัน “บันทึกตัดทิ้ง” ได้ครั้งละไม่เกิน 2000 หน่วย

ระบบตรวจวันหมดอายุและยอดคงเหลืออีกครั้ง ตัดเฉพาะ QR ของ Lot/วันหมดอายุที่เลือก เปลี่ยนสถานะเป็น DISPOSED อัปเดตแพ็กเกจ บันทึก movement ประเภท DISPOSE พร้อมเหตุผลหมดอายุและ Audit ในธุรกรรมเดียว ป้องกันคำขอซ้ำผ่าน request_id และรองรับกลับรายการโดยผู้ดูแลตามเงื่อนไขเดิม ยอด Dashboard และรายงานตัดทิ้งอัปเดตตามจริง Lot อื่นที่ยังไม่หมดอายุไม่ถูกตัด จำนวนในตาราง Dashboard อาจรวมหลาย Lot จึงใช้ยอดในหน้าตัดทิ้งเป็นจำนวนเฉพาะ Lot ที่ยืนยัน

## รายการแนะนำจาก Stock ในใบ PR

ตารางแสดงเฉพาะสถานะ ชื่อ Stock ปัจจุบัน และจำนวนสั่ง พร้อมช่องเลือกและปุ่มเพิ่ม คลิกชื่อน้ำยาเพื่อดู Popup ข้อมูล Lot/หมดอายุ ผู้ขาย จุดสั่งซื้อ หน่วย อัตราแปลง และรายละเอียดอื่น โดยแสดงราคาเฉพาะผู้ดูแล รายการที่มีอยู่ในใบ PR ฉบับที่กำลังจัดทำจะไม่แสดงซ้ำในตารางแนะนำ รวมทั้งรายการที่เพิ่มเอง เมื่อเอาออกหรือล้างใบ PR จะกลับมาแนะนำตามตัวกรองปัจจุบัน ระบบเก็บจำนวนที่กรอกไว้ระหว่างย้ายรายการและรีเฟรชตารางในหน้านั้น
