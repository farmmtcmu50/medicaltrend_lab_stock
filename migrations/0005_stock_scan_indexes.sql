-- Match indexes already installed on the legacy production database.
-- IF NOT EXISTS also provisions the same indexes for new tenant databases.
CREATE INDEX IF NOT EXISTS idx_su_barcode_lower ON stock_units(lower(barcode));
CREATE INDEX IF NOT EXISTS idx_su_status_parent ON stock_units(status, parent_barcode);
CREATE INDEX IF NOT EXISTS idx_su_parent_status ON stock_units(parent_barcode, status);
CREATE INDEX IF NOT EXISTS idx_su_item_status_exp ON stock_units(item_id, status, expiry_date);
CREATE INDEX IF NOT EXISTS idx_pb_barcode_lower ON package_barcodes(lower(package_barcode));
CREATE INDEX IF NOT EXISTS idx_pb_status ON package_barcodes(status);

-- These older indexes are covered by the leading columns of the new indexes.
DROP INDEX IF EXISTS idx_stock_parent;
DROP INDEX IF EXISTS idx_stock_item_status;
