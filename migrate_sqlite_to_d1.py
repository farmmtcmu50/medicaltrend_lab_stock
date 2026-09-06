import sqlite3
import hashlib
import uuid
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DB = ROOT / "data" / "lab_stock.db"
OUT = Path(__file__).resolve().parent / "d1_import_from_portable.sql"

TABLES = [
    "items",
    "stock_units",
    "package_barcodes",
    "movements",
    "settings",
    "users",
    "audit_logs",
]

D1_COLUMNS = {
    "items": [
        "item_id", "reagent_name", "machine", "main_unit", "sub_unit", "sub_per_main",
        "supplier", "unit_price", "main_unit_price", "lead_time_days", "reorder_point_sub",
        "created_at", "updated_at", "created_by", "updated_by", "is_deleted",
    ],
    "stock_units": [
        "barcode", "item_id", "reagent_name", "lot", "expiry_date", "machine", "sub_unit",
        "status", "received_at", "used_at", "note", "parent_barcode", "received_by", "used_by",
    ],
    "package_barcodes": [
        "package_barcode", "item_id", "reagent_name", "lot", "expiry_date", "machine",
        "main_unit", "sub_unit", "sub_count", "status", "received_at", "used_at", "note",
        "received_by", "used_by",
    ],
    "movements": [
        "movement_id", "timestamp", "type", "barcode", "item_id", "reagent_name", "lot",
        "quantity_sub", "operator_note", "operator_username",
    ],
    "settings": ["key", "value", "updated_at"],
    "users": ["user_id", "username", "password_hash", "salt", "role", "is_active", "created_at", "updated_at"],
    "audit_logs": ["audit_id", "timestamp", "username", "action", "target_type", "target_id", "result", "details"],
}

DEFAULTS = {
    "items": {
        "machine": "", "main_unit": "", "sub_unit": "", "sub_per_main": 1, "supplier": "",
        "unit_price": 0, "main_unit_price": 0, "lead_time_days": 0, "reorder_point_sub": 0,
        "created_by": "", "updated_by": "", "is_deleted": 0,
    },
    "stock_units": {
        "lot": "", "machine": "", "sub_unit": "", "status": "IN_STOCK", "note": "",
        "parent_barcode": "", "received_by": "", "used_by": "",
    },
    "package_barcodes": {
        "lot": "", "machine": "", "main_unit": "", "sub_unit": "", "sub_count": 1,
        "status": "IN_STOCK", "note": "", "received_by": "", "used_by": "",
    },
    "movements": {
        "type": "", "barcode": "", "item_id": "", "reagent_name": "", "lot": "",
        "quantity_sub": 0, "operator_note": "", "operator_username": "",
    },
    "settings": {},
    "users": {"role": "staff", "is_active": 1},
    "audit_logs": {"username": "", "action": "", "target_type": "", "target_id": "", "result": "SUCCESS", "details": ""},
}

DATE_FIELDS = {
    "items": ["created_at", "updated_at"],
    "stock_units": ["received_at"],
    "package_barcodes": ["received_at"],
    "movements": ["timestamp"],
    "settings": ["updated_at"],
    "users": ["created_at", "updated_at"],
    "audit_logs": ["timestamp"],
}


def q(value):
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def web_hash(password="1111"):
    salt = uuid.uuid4().hex
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000)
    return salt, digest.hex()


def main():
    if not SOURCE_DB.exists():
        raise SystemExit(f"ไม่พบไฟล์ database: {SOURCE_DB}")
    conn = sqlite3.connect(SOURCE_DB)
    conn.row_factory = sqlite3.Row
    lines = ["PRAGMA foreign_keys = OFF;"]
    for table in reversed(TABLES):
        lines.append(f"DELETE FROM {table};")
    for table in TABLES:
        rows = conn.execute(f"SELECT * FROM {table}").fetchall()
        for row in rows:
            data = dict(row)
            if table == "users":
                salt, digest = web_hash("1111")
                data["salt"] = salt
                data["password_hash"] = digest
            data = {key: data.get(key) for key in D1_COLUMNS[table]}
            for key, value in DEFAULTS.get(table, {}).items():
                if data.get(key) is None:
                    data[key] = value
            for key in DATE_FIELDS.get(table, []):
                if data.get(key) is None:
                    data[key] = datetime.now().isoformat(timespec="seconds")
            if table in ("items", "stock_units", "package_barcodes") and not data.get("reagent_name"):
                data["reagent_name"] = "Unknown"
            if table == "users" and not data.get("username"):
                data["username"] = f"user_{uuid.uuid4().hex[:6]}"
            cols = ", ".join(data.keys())
            vals = ", ".join(q(v) for v in data.values())
            lines.append(f"INSERT INTO {table} ({cols}) VALUES ({vals});")
    lines += ["PRAGMA foreign_keys = ON;"]
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"created: {OUT}")


if __name__ == "__main__":
    main()
