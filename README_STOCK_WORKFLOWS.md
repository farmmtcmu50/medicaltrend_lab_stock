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
