CREATE TABLE IF NOT EXISTS machines (
 machine_id TEXT PRIMARY KEY,
 name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name))>0),
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO machines(machine_id,name,created_at,updated_at)
VALUES('MCH-MANUAL','Manual',datetime('now'),datetime('now'));
INSERT OR IGNORE INTO machines(machine_id,name,created_at,updated_at)
SELECT 'MCH-'||lower(hex(randomblob(16))),trim(machine),datetime('now'),datetime('now')
FROM items WHERE trim(COALESCE(machine,''))<>'' GROUP BY trim(machine) COLLATE NOCASE;
UPDATE items SET machine=COALESCE((SELECT name FROM machines WHERE name=trim(items.machine) COLLATE NOCASE),'Manual');
UPDATE stock_units SET machine=(SELECT machine FROM items WHERE items.item_id=stock_units.item_id) WHERE status='IN_STOCK' AND item_id IN (SELECT item_id FROM items);
UPDATE package_barcodes SET machine=(SELECT machine FROM items WHERE items.item_id=package_barcodes.item_id) WHERE status='IN_STOCK' AND item_id IN (SELECT item_id FROM items);
CREATE INDEX IF NOT EXISTS idx_items_machine ON items(machine);
