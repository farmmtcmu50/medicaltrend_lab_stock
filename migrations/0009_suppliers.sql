CREATE TABLE IF NOT EXISTS suppliers (
 supplier_id TEXT PRIMARY KEY,
 name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name))>0),
 contact_name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
 address TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
 is_placeholder INTEGER NOT NULL DEFAULT 0 CHECK(is_placeholder IN(0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO suppliers(supplier_id,name,is_placeholder,created_at,updated_at)
VALUES('SUP-UNASSIGNED','ยังไม่ระบุ Supplier (ข้อมูลเดิม)',1,datetime('now'),datetime('now'));
INSERT OR IGNORE INTO suppliers(supplier_id,name,created_at,updated_at)
SELECT 'SUP-'||lower(hex(randomblob(16))),name,datetime('now'),datetime('now') FROM (
 SELECT trim(supplier) name FROM items WHERE trim(supplier)<>''
 UNION SELECT trim(supplier) name FROM purchase_requisition_items WHERE trim(supplier)<>''
) GROUP BY name COLLATE NOCASE;
ALTER TABLE items ADD COLUMN supplier_id TEXT REFERENCES suppliers(supplier_id);
UPDATE items SET supplier_id=COALESCE((SELECT supplier_id FROM suppliers WHERE name=trim(items.supplier) COLLATE NOCASE),'SUP-UNASSIGNED');
UPDATE items SET supplier=(SELECT name FROM suppliers WHERE supplier_id=items.supplier_id);
ALTER TABLE stock_units ADD COLUMN supplier_id TEXT REFERENCES suppliers(supplier_id);
ALTER TABLE stock_units ADD COLUMN supplier_verified INTEGER NOT NULL DEFAULT 0 CHECK(supplier_verified IN(0,1));
UPDATE stock_units SET supplier_id=COALESCE((SELECT supplier_id FROM items WHERE item_id=stock_units.item_id),'SUP-UNASSIGNED');
CREATE INDEX IF NOT EXISTS idx_items_supplier ON items(supplier_id,is_deleted);
CREATE INDEX IF NOT EXISTS idx_stock_supplier_status ON stock_units(supplier_id,status,item_id);
ALTER TABLE purchase_requisition_items ADD COLUMN supplier_id TEXT REFERENCES suppliers(supplier_id);
UPDATE purchase_requisition_items SET supplier_id=COALESCE((SELECT supplier_id FROM suppliers WHERE name=trim(purchase_requisition_items.supplier) COLLATE NOCASE),(SELECT supplier_id FROM items WHERE item_id=purchase_requisition_items.item_id AND trim(purchase_requisition_items.supplier)=''));
CREATE INDEX IF NOT EXISTS idx_pr_items_supplier ON purchase_requisition_items(supplier_id);
