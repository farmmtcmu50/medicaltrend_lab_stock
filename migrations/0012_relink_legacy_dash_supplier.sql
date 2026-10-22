-- Relink stock attributed to '-' only when the item's current supplier is known.
-- Preserve quantities, QR identity, status, and provenance verification flags.
INSERT INTO audit_logs(audit_id,timestamp,username,action,target_type,target_id,result,details)
SELECT 'AUD-'||lower(hex(randomblob(16))),datetime('now'),'system','RELINK_LEGACY_SUPPLIER','item',u.item_id,'SUCCESS',
 json_object('source_supplier_id',old.supplier_id,'source_supplier','-','target_supplier_id',v.supplier_id,'target_supplier',v.name,'units',COUNT(*),'in_stock',SUM(u.status='IN_STOCK'),'basis','current item supplier assigned by owner')
FROM stock_units u JOIN suppliers old ON old.supplier_id=u.supplier_id
JOIN items i ON i.item_id=u.item_id JOIN suppliers v ON v.supplier_id=i.supplier_id
WHERE trim(old.name)='-' AND v.is_placeholder=0 AND trim(v.name) NOT IN ('','-')
GROUP BY u.item_id,old.supplier_id,v.supplier_id,v.name;
UPDATE stock_units SET supplier_id=(SELECT i.supplier_id FROM items i WHERE i.item_id=stock_units.item_id)
WHERE supplier_id IN (SELECT supplier_id FROM suppliers WHERE trim(name)='-')
AND EXISTS(SELECT 1 FROM items i JOIN suppliers v ON v.supplier_id=i.supplier_id WHERE i.item_id=stock_units.item_id AND v.is_placeholder=0 AND trim(v.name) NOT IN ('','-'));
