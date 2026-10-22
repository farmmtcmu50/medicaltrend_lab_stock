CREATE INDEX IF NOT EXISTS idx_stock_item_lot_expiry_barcode ON stock_units(item_id,lot,expiry_date,barcode);
