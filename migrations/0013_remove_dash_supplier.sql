-- Owner requested removal of '-' after known stock was reassigned.
INSERT INTO audit_logs(audit_id,timestamp,username,action,target_type,target_id,result,details)
SELECT 'AUD-'||lower(hex(randomblob(16))),datetime('now'),'system','DELETE_SUPPLIER','supplier',supplier_id,'SUCCESS',json_object('source_name',name,'target','SUP-UNASSIGNED','moved_items',(SELECT COUNT(*) FROM items i WHERE i.supplier_id=s.supplier_id),'moved_units',(SELECT COUNT(*) FROM stock_units u WHERE u.supplier_id=s.supplier_id),'moved_pr_lines',(SELECT COUNT(*) FROM purchase_requisition_items p WHERE p.supplier_id=s.supplier_id))
FROM suppliers s WHERE trim(name)='-' AND is_placeholder=0;
UPDATE items SET supplier_id='SUP-UNASSIGNED',supplier=(SELECT name FROM suppliers WHERE supplier_id='SUP-UNASSIGNED'),updated_at=datetime('now'),updated_by='system' WHERE supplier_id IN (SELECT supplier_id FROM suppliers WHERE trim(name)='-' AND is_placeholder=0);
UPDATE stock_units SET supplier_id='SUP-UNASSIGNED',supplier_verified=0 WHERE supplier_id IN (SELECT supplier_id FROM suppliers WHERE trim(name)='-' AND is_placeholder=0);
UPDATE purchase_requisition_items SET supplier_id='SUP-UNASSIGNED' WHERE supplier_id IN (SELECT supplier_id FROM suppliers WHERE trim(name)='-' AND is_placeholder=0);
DELETE FROM suppliers WHERE trim(name)='-' AND is_placeholder=0;
