-- Merge spelling variants requested by the owner and preserve canonical supplier IDs.

INSERT INTO audit_logs(audit_id,timestamp,username,action,target_type,target_id,result,details)
SELECT 'AUD-'||lower(hex(randomblob(16))),datetime('now'),'system','MERGE_SUPPLIER','supplier',(SELECT supplier_id FROM suppliers WHERE name='Z-Medic' COLLATE NOCASE),'SUCCESS',json_object('source_id',supplier_id,'source_name',name,'target_name','Z-Medic','contact_name',contact_name,'phone',phone,'email',email,'address',address,'note',note)
FROM suppliers WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='Zmedic' COLLATE NOCASE) AND (SELECT supplier_id FROM suppliers WHERE name='Z-Medic' COLLATE NOCASE) IS NOT NULL;
UPDATE items SET supplier_id=(SELECT supplier_id FROM suppliers WHERE name='Z-Medic' COLLATE NOCASE),supplier=(SELECT name FROM suppliers WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='Z-Medic' COLLATE NOCASE)),updated_at=datetime('now'),updated_by='system'
WHERE (SELECT supplier_id FROM suppliers WHERE name='Z-Medic' COLLATE NOCASE) IS NOT NULL AND (supplier_id=(SELECT supplier_id FROM suppliers WHERE name='Zmedic' COLLATE NOCASE) OR supplier='Zmedic' COLLATE NOCASE);
UPDATE stock_units SET supplier_id=(SELECT supplier_id FROM suppliers WHERE name='Z-Medic' COLLATE NOCASE) WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='Zmedic' COLLATE NOCASE) AND (SELECT supplier_id FROM suppliers WHERE name='Z-Medic' COLLATE NOCASE) IS NOT NULL;
UPDATE purchase_requisition_items SET supplier_id=(SELECT supplier_id FROM suppliers WHERE name='Z-Medic' COLLATE NOCASE),supplier=(SELECT name FROM suppliers WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='Z-Medic' COLLATE NOCASE))
WHERE (SELECT supplier_id FROM suppliers WHERE name='Z-Medic' COLLATE NOCASE) IS NOT NULL AND (supplier_id=(SELECT supplier_id FROM suppliers WHERE name='Zmedic' COLLATE NOCASE) OR supplier='Zmedic' COLLATE NOCASE);

UPDATE suppliers SET contact_name=COALESCE(NULLIF(contact_name,''),(SELECT contact_name FROM suppliers WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='Zmedic' COLLATE NOCASE))),updated_at=datetime('now') WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='Z-Medic' COLLATE NOCASE) AND (SELECT supplier_id FROM suppliers WHERE name='Zmedic' COLLATE NOCASE) IS NOT NULL;

UPDATE suppliers SET phone=COALESCE(NULLIF(phone,''),(SELECT phone FROM suppliers WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='Zmedic' COLLATE NOCASE))),updated_at=datetime('now') WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='Z-Medic' COLLATE NOCASE) AND (SELECT supplier_id FROM suppliers WHERE name='Zmedic' COLLATE NOCASE) IS NOT NULL;

UPDATE suppliers SET email=COALESCE(NULLIF(email,''),(SELECT email FROM suppliers WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='Zmedic' COLLATE NOCASE))),updated_at=datetime('now') WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='Z-Medic' COLLATE NOCASE) AND (SELECT supplier_id FROM suppliers WHERE name='Zmedic' COLLATE NOCASE) IS NOT NULL;

UPDATE suppliers SET address=COALESCE(NULLIF(address,''),(SELECT address FROM suppliers WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='Zmedic' COLLATE NOCASE))),updated_at=datetime('now') WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='Z-Medic' COLLATE NOCASE) AND (SELECT supplier_id FROM suppliers WHERE name='Zmedic' COLLATE NOCASE) IS NOT NULL;

UPDATE suppliers SET note=COALESCE(NULLIF(note,''),(SELECT note FROM suppliers WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='Zmedic' COLLATE NOCASE))),updated_at=datetime('now') WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='Z-Medic' COLLATE NOCASE) AND (SELECT supplier_id FROM suppliers WHERE name='Zmedic' COLLATE NOCASE) IS NOT NULL;

DELETE FROM suppliers WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='Zmedic' COLLATE NOCASE) AND (SELECT supplier_id FROM suppliers WHERE name='Z-Medic' COLLATE NOCASE) IS NOT NULL;

INSERT INTO audit_logs(audit_id,timestamp,username,action,target_type,target_id,result,details)
SELECT 'AUD-'||lower(hex(randomblob(16))),datetime('now'),'system','MERGE_SUPPLIER','supplier',(SELECT supplier_id FROM suppliers WHERE name='SorPharmacy' COLLATE NOCASE),'SUCCESS',json_object('source_id',supplier_id,'source_name',name,'target_name','SorPharmacy','contact_name',contact_name,'phone',phone,'email',email,'address',address,'note',note)
FROM suppliers WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='SorPhamacy' COLLATE NOCASE) AND (SELECT supplier_id FROM suppliers WHERE name='SorPharmacy' COLLATE NOCASE) IS NOT NULL;
UPDATE items SET supplier_id=(SELECT supplier_id FROM suppliers WHERE name='SorPharmacy' COLLATE NOCASE),supplier=(SELECT name FROM suppliers WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='SorPharmacy' COLLATE NOCASE)),updated_at=datetime('now'),updated_by='system'
WHERE (SELECT supplier_id FROM suppliers WHERE name='SorPharmacy' COLLATE NOCASE) IS NOT NULL AND (supplier_id=(SELECT supplier_id FROM suppliers WHERE name='SorPhamacy' COLLATE NOCASE) OR supplier='SorPhamacy' COLLATE NOCASE);
UPDATE stock_units SET supplier_id=(SELECT supplier_id FROM suppliers WHERE name='SorPharmacy' COLLATE NOCASE) WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='SorPhamacy' COLLATE NOCASE) AND (SELECT supplier_id FROM suppliers WHERE name='SorPharmacy' COLLATE NOCASE) IS NOT NULL;
UPDATE purchase_requisition_items SET supplier_id=(SELECT supplier_id FROM suppliers WHERE name='SorPharmacy' COLLATE NOCASE),supplier=(SELECT name FROM suppliers WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='SorPharmacy' COLLATE NOCASE))
WHERE (SELECT supplier_id FROM suppliers WHERE name='SorPharmacy' COLLATE NOCASE) IS NOT NULL AND (supplier_id=(SELECT supplier_id FROM suppliers WHERE name='SorPhamacy' COLLATE NOCASE) OR supplier='SorPhamacy' COLLATE NOCASE);

UPDATE suppliers SET contact_name=COALESCE(NULLIF(contact_name,''),(SELECT contact_name FROM suppliers WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='SorPhamacy' COLLATE NOCASE))),updated_at=datetime('now') WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='SorPharmacy' COLLATE NOCASE) AND (SELECT supplier_id FROM suppliers WHERE name='SorPhamacy' COLLATE NOCASE) IS NOT NULL;

UPDATE suppliers SET phone=COALESCE(NULLIF(phone,''),(SELECT phone FROM suppliers WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='SorPhamacy' COLLATE NOCASE))),updated_at=datetime('now') WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='SorPharmacy' COLLATE NOCASE) AND (SELECT supplier_id FROM suppliers WHERE name='SorPhamacy' COLLATE NOCASE) IS NOT NULL;

UPDATE suppliers SET email=COALESCE(NULLIF(email,''),(SELECT email FROM suppliers WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='SorPhamacy' COLLATE NOCASE))),updated_at=datetime('now') WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='SorPharmacy' COLLATE NOCASE) AND (SELECT supplier_id FROM suppliers WHERE name='SorPhamacy' COLLATE NOCASE) IS NOT NULL;

UPDATE suppliers SET address=COALESCE(NULLIF(address,''),(SELECT address FROM suppliers WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='SorPhamacy' COLLATE NOCASE))),updated_at=datetime('now') WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='SorPharmacy' COLLATE NOCASE) AND (SELECT supplier_id FROM suppliers WHERE name='SorPhamacy' COLLATE NOCASE) IS NOT NULL;

UPDATE suppliers SET note=COALESCE(NULLIF(note,''),(SELECT note FROM suppliers WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='SorPhamacy' COLLATE NOCASE))),updated_at=datetime('now') WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='SorPharmacy' COLLATE NOCASE) AND (SELECT supplier_id FROM suppliers WHERE name='SorPhamacy' COLLATE NOCASE) IS NOT NULL;

DELETE FROM suppliers WHERE supplier_id=(SELECT supplier_id FROM suppliers WHERE name='SorPhamacy' COLLATE NOCASE) AND (SELECT supplier_id FROM suppliers WHERE name='SorPharmacy' COLLATE NOCASE) IS NOT NULL;
