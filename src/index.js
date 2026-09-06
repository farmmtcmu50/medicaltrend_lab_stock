import QRCode from "qrcode";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const COOKIE_MAX_AGE = 60 * 60 * 12;
const CLEAR_PASSWORD = "medicaltrend@2023";
const PASSWORD_ITERATIONS = 100000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      await ensureBootstrap(env);
      if (url.pathname.startsWith("/api/")) {
        return await api(request, env);
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ ok: false, error: error.message || "Server error" }, error.status || 500);
    }
  },
};

async function api(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, "") || "/";
  const method = request.method.toUpperCase();

  if (method === "POST" && path === "/login") return login(request, env);
  if (method === "POST" && path === "/logout") return logout(env, request);

  const user = await requireUser(request, env);
  if (method === "GET" && path === "/me") return json({ ok: true, user: publicUser(user) });
  if (method === "GET" && path === "/dashboard") return dashboard(request, env);
  if (method === "GET" && path === "/items") return listItems(request, env);
  if (method === "POST" && path === "/items") return addItem(request, env, user);
  if (method === "PUT" && path.startsWith("/items/")) return updateItem(request, env, user, path.split("/")[2]);
  if (method === "DELETE" && path.startsWith("/items/")) return deleteItem(env, user, path.split("/")[2]);
  if (method === "GET" && path === "/lots") return listLots(request, env);
  if (method === "GET" && path === "/stock/available") return availableStock(request, env);
  if (method === "POST" && path === "/receive") return receiveStock(request, env, user);
  if (method === "POST" && path === "/consume/preview") return consumePreview(request, env, user);
  if (method === "POST" && path === "/consume") return consumeStock(request, env, user);
  if (method === "POST" && path === "/labels") return labelPdf(request, env);
  if (method === "GET" && path === "/reports") return movementReport(request, env);
  if (method === "GET" && path === "/settings") return getSettings(env);
  if (method === "PUT" && path === "/settings/expiring-days") return setExpiringDays(request, env, user);
  if (method === "GET" && path === "/export/excel") return exportExcel(env, user, false);
  if (method === "GET" && path === "/backup") return backup(env, user);
  if (method === "POST" && path === "/optimize") return optimize(env, user);

  const admin = await requireAdmin(user);
  if (method === "GET" && path === "/users") return listUsers(env, admin);
  if (method === "POST" && path === "/users") return addUser(request, env, admin);
  if (method === "PUT" && path.startsWith("/users/")) return updateUser(request, env, admin, path.split("/")[2]);
  if (method === "DELETE" && path.startsWith("/users/")) return deleteUser(env, admin, path.split("/")[2]);
  if (method === "GET" && path === "/audit") return auditLogs(env, admin);
  if (method === "GET" && path === "/export/audit") return exportExcel(env, admin, true);
  if (method === "POST" && path === "/restore") return restore(request, env, admin);
  if (method === "POST" && path === "/clear") return clearDatabase(request, env, admin);

  return json({ ok: false, error: "Not found" }, 404);
}

async function ensureBootstrap(env) {
  const setting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'expiring_days'").first();
  if (!setting) {
    await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('expiring_days', '90', ?)").bind(now()).run();
  }
  const userCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE is_active = 1").first();
  const admin = await env.DB.prepare("SELECT * FROM users WHERE lower(username) = 'admin'").first();
  if (!userCount?.n || !admin || admin.password_hash === "AUTO_CREATE_ON_FIRST_LOGIN") {
    const hp = await hashPassword("1111");
    await env.DB.prepare(
      `INSERT OR REPLACE INTO users
       (user_id, username, password_hash, salt, role, is_active, created_at, updated_at)
       VALUES (?, 'admin', ?, ?, 'admin', 1, ?, ?)`
    ).bind(admin?.user_id || nextId("USR"), hp.hash, hp.salt, now(), now()).run();
  }
}

async function login(request, env) {
  const body = await readBody(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const user = await env.DB.prepare("SELECT * FROM users WHERE lower(username) = lower(?) AND is_active = 1").bind(username).first();
  if (!user || !(await verifyPassword(password, user.salt, user.password_hash))) {
    await logAudit(env, username || "unknown", "LOGIN_FAILED", "user", username, "FAIL");
    return json({ ok: false, error: "username หรือ password ไม่ถูกต้อง" }, 401);
  }
  await logAudit(env, user.username, "LOGIN_SUCCESS", "user", user.username);
  const token = await signSession(env, { user_id: user.user_id, username: user.username, role: user.role, exp: unixNow() + COOKIE_MAX_AGE });
  return json({ ok: true, user: publicUser(user) }, 200, { "set-cookie": cookie(env, token, request) });
}

async function logout(env, request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return json({ ok: true }, 200, { "set-cookie": `${env.SESSION_COOKIE || "mt_stock_session"}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}` });
}

async function dashboard(request, env) {
  const url = new URL(request.url);
  const q = `%${(url.searchParams.get("q") || "").trim().toLowerCase()}%`;
  const expiringDays = await expiringDaysSetting(env);
  const rows = await env.DB.prepare(
    `SELECT i.item_id, i.reagent_name AS name, i.machine, i.main_unit, i.sub_unit, i.sub_per_main,
            i.supplier, i.unit_price, i.main_unit_price, i.lead_time_days, i.reorder_point_sub,
            COUNT(s.barcode) AS qty_sub,
            MIN(CASE WHEN s.status = 'IN_STOCK' THEN s.expiry_date END) AS expiry,
            GROUP_CONCAT(DISTINCT CASE WHEN s.status = 'IN_STOCK' THEN s.lot END) AS lots
     FROM items i
     LEFT JOIN stock_units s ON s.item_id = i.item_id AND s.status = 'IN_STOCK'
     WHERE i.is_deleted = 0 AND (? = '%%' OR lower(i.reagent_name) LIKE ? OR lower(i.machine) LIKE ? OR lower(i.supplier) LIKE ?)
     GROUP BY i.item_id
     ORDER BY lower(i.reagent_name)`
  ).bind(q, q, q, q).all();

  const today = dateOnly(new Date());
  const data = (rows.results || []).map((row) => {
    const qtySub = Number(row.qty_sub || 0);
    const subPerMain = Math.max(1, Number(row.sub_per_main || 1));
    const unitPrice = Number(row.unit_price || 0);
    const expiry = row.expiry || "";
    const diff = expiry ? daysBetween(today, expiry) : null;
    let status = "OK";
    if (qtySub <= 0) status = "CRITICAL";
    else if (diff !== null && diff < 0) status = "EXPIRED";
    else if (qtySub <= Number(row.reorder_point_sub || 0)) status = "REORDER";
    else if (diff !== null && diff <= expiringDays) status = "EXPIRING";
    return {
      ...row,
      qty_sub: qtySub,
      qty_main: Math.floor(qtySub / subPerMain),
      qty_main_display: `${Math.floor(qtySub / subPerMain)} ${row.main_unit || ""}${qtySub % subPerMain ? ` + ${qtySub % subPerMain} ${row.sub_unit || ""}` : ""}`.trim(),
      lot: row.lots || "",
      expiry,
      status,
      stock_value: round(qtySub * unitPrice),
    };
  });
  return json({ ok: true, rows: data, expiring_days: expiringDays, total_value: round(data.reduce((sum, row) => sum + row.stock_value, 0)) });
}

async function listItems(request, env) {
  const url = new URL(request.url);
  const q = `%${(url.searchParams.get("q") || "").trim().toLowerCase()}%`;
  const rows = await env.DB.prepare(
    `SELECT * FROM items
     WHERE is_deleted = 0 AND (? = '%%' OR lower(reagent_name) LIKE ? OR lower(machine) LIKE ? OR lower(supplier) LIKE ?)
     ORDER BY lower(reagent_name)`
  ).bind(q, q, q, q).all();
  return json({ ok: true, rows: rows.results || [] });
}

async function addItem(request, env, user) {
  const data = cleanItem(await readBody(request));
  const itemId = nextId("ITM");
  await env.DB.prepare(
    `INSERT INTO items
     (item_id, reagent_name, machine, main_unit, sub_unit, sub_per_main, supplier, unit_price, main_unit_price,
      lead_time_days, reorder_point_sub, created_at, updated_at, created_by, updated_by, is_deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
  ).bind(itemId, data.reagent_name, data.machine, data.main_unit, data.sub_unit, data.sub_per_main, data.supplier,
    data.unit_price, data.main_unit_price, data.lead_time_days, data.reorder_point_sub, now(), now(), user.username, user.username).run();
  await logAudit(env, user.username, "ADD_ITEM", "item", itemId, "SUCCESS", data);
  return json({ ok: true, item_id: itemId });
}

async function updateItem(request, env, user, itemId) {
  const before = await getActiveItem(env, itemId);
  const data = cleanItem(await readBody(request));
  await env.DB.prepare(
    `UPDATE items SET reagent_name = ?, machine = ?, main_unit = ?, sub_unit = ?, sub_per_main = ?, supplier = ?,
      unit_price = ?, main_unit_price = ?, lead_time_days = ?, reorder_point_sub = ?, updated_at = ?, updated_by = ?
     WHERE item_id = ? AND is_deleted = 0`
  ).bind(data.reagent_name, data.machine, data.main_unit, data.sub_unit, data.sub_per_main, data.supplier,
    data.unit_price, data.main_unit_price, data.lead_time_days, data.reorder_point_sub, now(), user.username, itemId).run();
  await env.DB.prepare(
    `UPDATE stock_units SET reagent_name = ?, machine = ?, sub_unit = ? WHERE item_id = ? AND status = 'IN_STOCK'`
  ).bind(data.reagent_name, data.machine, data.sub_unit, itemId).run();
  await env.DB.prepare(
    `UPDATE package_barcodes SET reagent_name = ?, machine = ?, main_unit = ?, sub_unit = ? WHERE item_id = ? AND status = 'IN_STOCK'`
  ).bind(data.reagent_name, data.machine, data.main_unit, data.sub_unit, itemId).run();
  await logAudit(env, user.username, "UPDATE_ITEM", "item", itemId, "SUCCESS", { before, after: data });
  return json({ ok: true });
}

async function deleteItem(env, user, itemId) {
  const item = await getActiveItem(env, itemId);
  await env.DB.prepare("UPDATE items SET is_deleted = 1, updated_at = ?, updated_by = ? WHERE item_id = ?").bind(now(), user.username, itemId).run();
  await logAudit(env, user.username, "DELETE_ITEM", "item", itemId, "SUCCESS", { name: item.reagent_name });
  return json({ ok: true });
}

async function listLots(request, env) {
  const url = new URL(request.url);
  const itemId = String(url.searchParams.get("item_id") || "").trim();
  if (!itemId) return json({ ok: true, rows: [] });
  const rows = await env.DB.prepare(
    `SELECT lot, MIN(expiry_date) AS expiry_date,
            SUM(CASE WHEN status = 'IN_STOCK' THEN 1 ELSE 0 END) AS qty_in_stock,
            MAX(received_at) AS last_received_at
     FROM stock_units
     WHERE item_id = ? AND lot <> '' AND expiry_date >= ?
     GROUP BY lot
     ORDER BY expiry_date ASC, lower(lot) ASC
     LIMIT 100`
  ).bind(itemId, dateOnly(new Date())).all();
  return json({ ok: true, rows: rows.results || [] });
}

async function availableStock(request, env) {
  const url = new URL(request.url);
  const q = `%${(url.searchParams.get("q") || "").trim().toLowerCase()}%`;
  const units = await env.DB.prepare(
    `SELECT barcode, item_id, reagent_name, lot, expiry_date, machine, '' AS main_unit, sub_unit, 1 AS quantity_sub, 0 AS is_package, received_at
     FROM stock_units
     WHERE status = 'IN_STOCK' AND parent_barcode = '' AND (? = '%%' OR lower(barcode) LIKE ? OR lower(reagent_name) LIKE ? OR lower(lot) LIKE ?)
     UNION ALL
     SELECT p.package_barcode AS barcode, p.item_id, p.reagent_name, p.lot, p.expiry_date, p.machine, p.main_unit, p.sub_unit,
            COUNT(s.barcode) AS quantity_sub, 1 AS is_package, p.received_at
     FROM package_barcodes p
     LEFT JOIN stock_units s ON s.parent_barcode = p.package_barcode AND s.status = 'IN_STOCK'
     WHERE p.status = 'IN_STOCK' AND (? = '%%' OR lower(p.package_barcode) LIKE ? OR lower(p.reagent_name) LIKE ? OR lower(p.lot) LIKE ?)
     GROUP BY p.package_barcode
     ORDER BY expiry_date, reagent_name
     LIMIT 500`
  ).bind(q, q, q, q, q, q, q, q).all();
  return json({ ok: true, rows: units.results || [] });
}

async function receiveStock(request, env, user) {
  const body = await readBody(request);
  const item = await getActiveItem(env, body.item_id);
  const quantity = int(body.quantity, 1);
  const lot = String(body.lot || "").trim();
  const expiry = String(body.expiry_date || "").trim();
  if (!lot || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) throw httpError("กรุณาระบุ Lot และวันหมดอายุ");
  const unitMode = body.unit_mode === "main" ? "main" : "sub";
  const stickerMode = body.sticker_mode === "main" ? "main" : "sub";
  const subPerMain = Math.max(1, Number(item.sub_per_main || 1));
  const totalSub = unitMode === "main" ? quantity * subPerMain : quantity;
  const created = [];
  const batch = [];

  if (stickerMode === "main") {
    const packageCount = unitMode === "main" ? quantity : Math.ceil(totalSub / subPerMain);
    let remaining = totalSub;
    for (let i = 0; i < packageCount; i++) {
      const packageCode = nextQr();
      const count = Math.min(subPerMain, remaining);
      remaining -= count;
      created.push({ code: packageCode, type: "main", sub_count: count, item, lot, expiry });
      batch.push(env.DB.prepare(
        `INSERT INTO package_barcodes (package_barcode, item_id, reagent_name, lot, expiry_date, machine, main_unit, sub_unit,
          sub_count, status, received_at, note, received_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'IN_STOCK', ?, ?, ?)`
      ).bind(packageCode, item.item_id, item.reagent_name, lot, expiry, item.machine, item.main_unit, item.sub_unit, count, now(), String(body.note || ""), user.username));
      for (let j = 0; j < count; j++) {
        const code = nextQr();
        batch.push(insertStockUnit(env, code, item, lot, expiry, String(body.note || ""), user.username, packageCode));
      }
    }
  } else {
    for (let i = 0; i < totalSub; i++) {
      const code = nextQr();
      created.push({ code, type: "sub", sub_count: 1, item, lot, expiry });
      batch.push(insertStockUnit(env, code, item, lot, expiry, String(body.note || ""), user.username, ""));
    }
  }

  batch.push(env.DB.prepare(
    `INSERT INTO movements (movement_id, timestamp, type, barcode, item_id, reagent_name, lot, quantity_sub, operator_note, operator_username)
     VALUES (?, ?, 'RECEIVE', ?, ?, ?, ?, ?, ?, ?)`
  ).bind(nextId("MOV"), now(), created.map((x) => x.code).join(","), item.item_id, item.reagent_name, lot, totalSub, String(body.note || ""), user.username));
  await env.DB.batch(batch);
  await logAudit(env, user.username, "RECEIVE_STOCK", "stock", item.item_id, "SUCCESS", { barcodes: created.map((x) => x.code), total_sub: totalSub });
  return json({ ok: true, labels: created, total_sub: totalSub });
}

function insertStockUnit(env, code, item, lot, expiry, note, username, parent) {
  return env.DB.prepare(
    `INSERT INTO stock_units
     (barcode, item_id, reagent_name, lot, expiry_date, machine, sub_unit, status, received_at, note, parent_barcode, received_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'IN_STOCK', ?, ?, ?, ?)`
  ).bind(code, item.item_id, item.reagent_name, lot, expiry, item.machine, item.sub_unit, now(), note, parent, username);
}

async function consumePreview(request, env) {
  const body = await readBody(request);
  const barcode = String(body.barcode || "").trim();
  if (!barcode) throw httpError("กรุณาระบุ QR code");
  const target = await findStockTarget(env, barcode);
  const warnings = await fefoWarnings(env, target, int(body.package_quantity, target.quantity_sub));
  return json({ ok: true, target, warnings });
}

async function consumeStock(request, env, user) {
  const body = await readBody(request);
  const barcode = String(body.barcode || "").trim();
  if (!barcode) throw httpError("กรุณาระบุ QR code");
  const target = await findStockTarget(env, barcode);
  const requestedQty = target.is_package ? int(body.package_quantity, target.quantity_sub) : 1;
  const warnings = await fefoWarnings(env, target, requestedQty);
  if (warnings.length && !body.confirm_fefo) {
    return json({ ok: false, need_fefo_confirm: true, target, warnings }, 409);
  }
  if (warnings.length) {
    await logAudit(env, user.username, "FEFO_OVERRIDE", "stock", barcode, "SUCCESS", warnings);
  }

  const note = String(body.note || "");
  if (target.is_package) {
    const children = await env.DB.prepare(
      `SELECT barcode FROM stock_units WHERE parent_barcode = ? AND status = 'IN_STOCK' ORDER BY expiry_date, received_at, barcode LIMIT ?`
    ).bind(barcode, requestedQty).all();
    if ((children.results || []).length < requestedQty) throw httpError("จำนวนย่อยในหน่วยหลักไม่พอ");
    const codes = children.results.map((row) => row.barcode);
    const marks = codes.map((code) => env.DB.prepare("UPDATE stock_units SET status = 'USED', used_at = ?, note = ?, used_by = ? WHERE barcode = ?").bind(now(), note, user.username, code));
    marks.push(env.DB.prepare(
      `INSERT INTO movements (movement_id, timestamp, type, barcode, item_id, reagent_name, lot, quantity_sub, operator_note, operator_username)
       VALUES (?, ?, 'CONSUME', ?, ?, ?, ?, ?, ?, ?)`
    ).bind(nextId("MOV"), now(), barcode, target.item_id, target.reagent_name, target.lot, requestedQty, note, user.username));
    const left = Number(target.quantity_sub) - requestedQty;
    if (left <= 0) {
      marks.push(env.DB.prepare("UPDATE package_barcodes SET status = 'USED', used_at = ?, note = ?, used_by = ? WHERE package_barcode = ?").bind(now(), note, user.username, barcode));
    } else {
      marks.push(env.DB.prepare("UPDATE package_barcodes SET note = ? WHERE package_barcode = ?").bind(note, barcode));
    }
    await env.DB.batch(marks);
  } else {
    await env.DB.batch([
      env.DB.prepare("UPDATE stock_units SET status = 'USED', used_at = ?, note = ?, used_by = ? WHERE barcode = ? AND status = 'IN_STOCK'").bind(now(), note, user.username, barcode),
      env.DB.prepare(
        `INSERT INTO movements (movement_id, timestamp, type, barcode, item_id, reagent_name, lot, quantity_sub, operator_note, operator_username)
         VALUES (?, ?, 'CONSUME', ?, ?, ?, ?, 1, ?, ?)`
      ).bind(nextId("MOV"), now(), barcode, target.item_id, target.reagent_name, target.lot, note, user.username),
    ]);
  }
  await logAudit(env, user.username, "CONSUME_STOCK", "stock", barcode, "SUCCESS", { quantity_sub: requestedQty, note });
  return json({ ok: true, consumed: requestedQty });
}

async function movementReport(request, env) {
  const url = new URL(request.url);
  const reportType = url.searchParams.get("type") === "consume" ? "consume" : "receive";
  const today = dateOnly(new Date());
  const from = validDate(url.searchParams.get("from")) || today;
  const to = validDate(url.searchParams.get("to")) || from;
  const start = from <= to ? from : to;
  const end = from <= to ? to : from;
  const q = `%${(url.searchParams.get("q") || "").trim().toLowerCase()}%`;
  const typeSql = reportType === "receive" ? "type = 'RECEIVE'" : "type IN ('CONSUME', 'CONSUME_PACKAGE')";
  const rows = await env.DB.prepare(
    `SELECT movement_id, timestamp, type, barcode, item_id, reagent_name, lot,
            ABS(quantity_sub) AS quantity_sub, operator_note, operator_username
     FROM movements
     WHERE ${typeSql}
       AND date(timestamp) BETWEEN ? AND ?
       AND (? = '%%' OR lower(reagent_name) LIKE ? OR lower(lot) LIKE ? OR lower(barcode) LIKE ? OR lower(operator_username) LIKE ?)
     ORDER BY timestamp DESC
     LIMIT 2000`
  ).bind(start, end, q, q, q, q, q).all();
  const data = rows.results || [];
  const totalQty = data.reduce((sum, row) => sum + Number(row.quantity_sub || 0), 0);
  const items = new Set(data.map((row) => row.item_id).filter(Boolean)).size;
  return json({ ok: true, report_type: reportType, from: start, to: end, rows: data, summary: { rows: data.length, quantity_sub: totalQty, items } });
}

async function findStockTarget(env, barcode) {
  const unit = await env.DB.prepare("SELECT *, 0 AS is_package, 1 AS quantity_sub FROM stock_units WHERE lower(barcode) = lower(?) AND status = 'IN_STOCK'").bind(barcode).first();
  if (unit) return unit;
  const pack = await env.DB.prepare(
    `SELECT p.*, p.package_barcode AS barcode, 1 AS is_package, COUNT(s.barcode) AS quantity_sub
     FROM package_barcodes p
     LEFT JOIN stock_units s ON s.parent_barcode = p.package_barcode AND s.status = 'IN_STOCK'
     WHERE lower(p.package_barcode) = lower(?) AND p.status = 'IN_STOCK'
     GROUP BY p.package_barcode`
  ).bind(barcode).first();
  if (pack && Number(pack.quantity_sub || 0) > 0) return pack;
  throw httpError("ไม่พบ QR code ที่ยังอยู่ใน stock", 404);
}

async function fefoWarnings(env, target, qty) {
  const older = await env.DB.prepare(
    `SELECT barcode, lot, expiry_date FROM stock_units
     WHERE item_id = ? AND status = 'IN_STOCK' AND expiry_date < ?
     ORDER BY expiry_date, received_at LIMIT 10`
  ).bind(target.item_id, target.expiry_date).all();
  return (older.results || []).map((row) => `มี Lot ${row.lot} Exp ${row.expiry_date} ควรถูกใช้ก่อน QR นี้`);
}

async function labelPdf(request, env) {
  const body = await readBody(request);
  const labels = Array.isArray(body.labels) ? body.labels : [];
  if (!labels.length) throw httpError("ไม่มีรายการ QR สำหรับพิมพ์");
  const html = await makeLabelHtml(labels);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

async function makeLabelHtml(labels) {
  const cards = [];
  for (const label of labels) {
    const svg = await QRCode.toString(label.code, { type: "svg", margin: 0, width: 130, errorCorrectionLevel: "M" });
    const item = label.item || {};
    cards.push(`
      <section class="label">
        <div class="qr">${svg}<div class="code">${escapeHtml(label.code)}</div></div>
        <div class="text">
          ${label.type === "main" ? `<div class="warn">** หน่วยหลัก ระวังการแปะผิด **</div>` : ""}
          <div class="name">${escapeHtml(item.reagent_name || label.reagent_name || "")}</div>
          <div>Lot: ${escapeHtml(label.lot || "")}</div>
          <div>Exp: ${escapeHtml(label.expiry || label.expiry_date || "")}</div>
          <div>Machine: ${escapeHtml(item.machine || label.machine || "")}</div>
          ${label.type === "main" ? `<div>จำนวนย่อย: ${Number(label.sub_count || 0)} ${escapeHtml(item.sub_unit || label.sub_unit || "")}</div>` : ""}
        </div>
      </section>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>QR Labels</title><style>
    @page { size: 50mm 25mm; margin: 0; }
    html,body { margin:0; padding:0; font-family: Arial, sans-serif; color:#000; }
    .label { box-sizing:border-box; page-break-after:always; width:50mm; height:25mm; padding:1.5mm 1.8mm; display:flex; gap:2mm; align-items:center; overflow:hidden; border:0.2mm solid #000; }
    .qr { width:19mm; flex:0 0 19mm; text-align:center; }
    .qr svg { width:17mm; height:17mm; display:block; margin:0 auto; }
    .code { font-size:5pt; font-weight:700; line-height:1.05; word-break:break-all; }
    .text { flex:1; min-width:0; font-size:8pt; font-weight:700; line-height:1.2; }
    .name { font-size:10pt; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .warn { font-size:6pt; font-weight:900; margin-bottom:0.5mm; }
    @media screen { body { background:#eee; } .label { background:#fff; margin:8px; } }
  </style></head><body>${cards.join("")}<script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`;
}

async function getSettings(env) {
  const expiringDays = await expiringDaysSetting(env);
  const info = await Promise.all([
    count(env, "items", "is_deleted = 0"),
    count(env, "stock_units", "status = 'IN_STOCK'"),
    count(env, "package_barcodes", "status = 'IN_STOCK'"),
    count(env, "users", "is_active = 1"),
    count(env, "audit_logs", "1 = 1"),
  ]);
  return json({ ok: true, expiring_days: expiringDays, info: { items: info[0], stock_units: info[1], packages: info[2], active_users: info[3], audit_logs: info[4] } });
}

async function setExpiringDays(request, env, user) {
  const body = await readBody(request);
  const value = String(int(body.value, 90));
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('expiring_days', ?, ?)").bind(value, now()).run();
  await logAudit(env, user.username, "UPDATE_SETTING", "setting", "expiring_days", "SUCCESS", { value });
  return json({ ok: true });
}

async function listUsers(env) {
  const rows = await env.DB.prepare("SELECT user_id, username, role, is_active, created_at, updated_at FROM users WHERE is_active = 1 ORDER BY lower(username)").all();
  return json({ ok: true, rows: rows.results || [] });
}

async function addUser(request, env, admin) {
  const body = await readBody(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "").trim();
  const role = body.role === "admin" ? "admin" : "staff";
  if (!username || !password) throw httpError("กรุณากรอก username และ password");
  const hp = await hashPassword(password);
  await env.DB.prepare(
    `INSERT INTO users (user_id, username, password_hash, salt, role, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
  ).bind(nextId("USR"), username, hp.hash, hp.salt, role, now(), now()).run();
  await logAudit(env, admin.username, "ADD_USER", "user", username, "SUCCESS", { role });
  return json({ ok: true });
}

async function updateUser(request, env, admin, userId) {
  const body = await readBody(request);
  const target = await env.DB.prepare("SELECT * FROM users WHERE user_id = ? AND is_active = 1").bind(userId).first();
  if (!target) throw httpError("ไม่พบผู้ใช้งาน", 404);
  const username = String(body.username || "").trim();
  const role = body.role === "admin" ? "admin" : "staff";
  if (!username) throw httpError("กรุณากรอก username");
  if (target.role === "admin" && role !== "admin") {
    const admins = await count(env, "users", "role = 'admin' AND is_active = 1");
    if (admins <= 1) throw httpError("ไม่สามารถเปลี่ยน admin คนสุดท้ายเป็น staff");
  }
  const password = String(body.password || "").trim();
  if (password) {
    const hp = await hashPassword(password);
    await env.DB.prepare("UPDATE users SET username = ?, role = ?, password_hash = ?, salt = ?, updated_at = ? WHERE user_id = ?")
      .bind(username, role, hp.hash, hp.salt, now(), userId).run();
  } else {
    await env.DB.prepare("UPDATE users SET username = ?, role = ?, updated_at = ? WHERE user_id = ?").bind(username, role, now(), userId).run();
  }
  await logAudit(env, admin.username, "UPDATE_USER", "user", username, "SUCCESS", { role, password_changed: Boolean(password) });
  return json({ ok: true });
}

async function deleteUser(env, admin, userId) {
  const target = await env.DB.prepare("SELECT * FROM users WHERE user_id = ? AND is_active = 1").bind(userId).first();
  if (!target) throw httpError("ไม่พบผู้ใช้งาน", 404);
  if (target.username.toLowerCase() === "admin") throw httpError("ไม่สามารถลบผู้ใช้งาน admin ได้");
  await env.DB.prepare("UPDATE users SET is_active = 0, updated_at = ? WHERE user_id = ?").bind(now(), userId).run();
  await logAudit(env, admin.username, "DELETE_USER", "user", target.username);
  return json({ ok: true });
}

async function auditLogs(env) {
  const rows = await env.DB.prepare("SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 500").all();
  return json({ ok: true, rows: rows.results || [] });
}

async function exportExcel(env, user, auditOnly) {
  const sheets = auditOnly
    ? { AuditTrail: await tableRows(env, "audit_logs", "ORDER BY timestamp DESC") }
    : {
        Items: await tableRows(env, "items", "ORDER BY reagent_name"),
        StockUnits: await tableRows(env, "stock_units", "ORDER BY received_at DESC"),
        PackageBarcodes: await tableRows(env, "package_barcodes", "ORDER BY received_at DESC"),
        Movements: await tableRows(env, "movements", "ORDER BY timestamp DESC"),
        AuditTrail: await tableRows(env, "audit_logs", "ORDER BY timestamp DESC"),
      };
  await logAudit(env, user.username, auditOnly ? "EXPORT_AUDIT_EXCEL" : "EXPORT_EXCEL", "file", auditOnly ? "audit.xls" : "lab_stock.xls");
  const xml = spreadsheetXml(sheets);
  return new Response(xml, {
    headers: {
      "content-type": "application/vnd.ms-excel; charset=utf-8",
      "content-disposition": `attachment; filename="${auditOnly ? "audit_trail_export" : "lab_stock_export"}.xls"`,
    },
  });
}

async function backup(env, user) {
  const data = {
    exported_at: now(),
    tables: {
      items: await tableRows(env, "items"),
      stock_units: await tableRows(env, "stock_units"),
      package_barcodes: await tableRows(env, "package_barcodes"),
      movements: await tableRows(env, "movements"),
      settings: await tableRows(env, "settings"),
      users: await tableRows(env, "users"),
      audit_logs: await tableRows(env, "audit_logs"),
    },
  };
  await logAudit(env, user.username, "BACKUP_DATABASE", "database", "json");
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="lab_stock_backup_${compactDate()}.json"` },
  });
}

async function restore(request, env, admin) {
  const body = await readBody(request);
  if (!body?.tables) throw httpError("ไฟล์ backup ไม่ถูกต้อง");
  const safety = { exported_at: now(), tables: { items: await tableRows(env, "items"), stock_units: await tableRows(env, "stock_units"), package_barcodes: await tableRows(env, "package_barcodes"), movements: await tableRows(env, "movements"), settings: await tableRows(env, "settings"), users: await tableRows(env, "users"), audit_logs: await tableRows(env, "audit_logs") } };
  await replaceTables(env, body.tables);
  await logAudit(env, admin.username, "RESTORE_DATABASE", "database", "json", "SUCCESS", { safety_backup_created_in_browser: true });
  return json({ ok: true, safety_backup: safety });
}

async function clearDatabase(request, env, admin) {
  const body = await readBody(request);
  if (String(body.password || "") !== CLEAR_PASSWORD) throw httpError("password สำหรับลบข้อมูลไม่ถูกต้อง", 403);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM stock_units"),
    env.DB.prepare("DELETE FROM package_barcodes"),
    env.DB.prepare("DELETE FROM movements"),
    env.DB.prepare("UPDATE items SET is_deleted = 1, updated_at = ?").bind(now()),
  ]);
  await logAudit(env, admin.username, "CLEAR_DATABASE", "database", "d1");
  return json({ ok: true });
}

async function optimize(env, user) {
  const integrity = await env.DB.prepare("PRAGMA quick_check").first();
  await env.DB.prepare("PRAGMA optimize").run();
  await logAudit(env, user.username, "OPTIMIZE_DATABASE", "database", "d1", "SUCCESS", integrity);
  return json({ ok: true, integrity });
}

async function replaceTables(env, tables) {
  const stmts = [
    env.DB.prepare("DELETE FROM audit_logs"),
    env.DB.prepare("DELETE FROM movements"),
    env.DB.prepare("DELETE FROM stock_units"),
    env.DB.prepare("DELETE FROM package_barcodes"),
    env.DB.prepare("DELETE FROM items"),
    env.DB.prepare("DELETE FROM settings"),
    env.DB.prepare("DELETE FROM users"),
  ];
  const order = ["items", "stock_units", "package_barcodes", "movements", "settings", "users", "audit_logs"];
  for (const table of order) {
    for (const row of tables[table] || []) {
      const keys = Object.keys(row);
      stmts.push(env.DB.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).bind(...keys.map((k) => row[k])));
    }
  }
  await env.DB.batch(stmts);
}

async function requireUser(request, env) {
  const token = readCookie(request, env.SESSION_COOKIE || "mt_stock_session");
  const session = token ? await verifySession(env, token) : null;
  if (!session?.user_id || session.exp < unixNow()) throw httpError("กรุณา login ก่อน", 401);
  const user = await env.DB.prepare("SELECT * FROM users WHERE user_id = ? AND is_active = 1").bind(session.user_id).first();
  if (!user) throw httpError("กรุณา login ก่อน", 401);
  return user;
}

async function requireAdmin(user) {
  if (user.role !== "admin") throw httpError("ต้องเป็น admin เท่านั้น", 403);
  return user;
}

async function getActiveItem(env, itemId) {
  const item = await env.DB.prepare("SELECT * FROM items WHERE item_id = ? AND is_deleted = 0").bind(itemId).first();
  if (!item) throw httpError("ไม่พบรายการน้ำยา", 404);
  return item;
}

function cleanItem(body) {
  const subPerMain = int(body.sub_per_main, 1);
  let unitPrice = money(body.unit_price);
  let mainUnitPrice = money(body.main_unit_price);
  if (unitPrice && !mainUnitPrice) mainUnitPrice = round(unitPrice * subPerMain);
  if (mainUnitPrice && !unitPrice) unitPrice = round(mainUnitPrice / subPerMain);
  return {
    reagent_name: String(body.reagent_name || "").trim(),
    machine: String(body.machine || "").trim() || "Manual",
    main_unit: String(body.main_unit || "").trim(),
    sub_unit: String(body.sub_unit || "").trim(),
    sub_per_main: subPerMain,
    supplier: String(body.supplier || "").trim(),
    unit_price: unitPrice,
    main_unit_price: mainUnitPrice,
    lead_time_days: int(body.lead_time_days, 0),
    reorder_point_sub: int(body.reorder_point_sub, 0),
  };
}

async function expiringDaysSetting(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'expiring_days'").first();
  return int(row?.value, 90);
}

async function logAudit(env, username, action, targetType = "", targetId = "", result = "SUCCESS", details = null) {
  await env.DB.prepare(
    `INSERT INTO audit_logs (audit_id, timestamp, username, action, target_type, target_id, result, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(nextId("AUD"), now(), username || "", action, targetType, targetId || "", result, details ? JSON.stringify(details) : "").run();
}

async function tableRows(env, table, suffix = "") {
  const rows = await env.DB.prepare(`SELECT * FROM ${table} ${suffix}`).all();
  return rows.results || [];
}

async function count(env, table, where) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).first();
  return Number(row?.n || 0);
}

function spreadsheetXml(sheets) {
  const worksheets = Object.entries(sheets).map(([name, rows]) => {
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const header = `<Row>${columns.map((c) => cell(c)).join("")}</Row>`;
    const body = rows.map((row) => `<Row>${columns.map((c) => cell(row[c] ?? "")).join("")}</Row>`).join("");
    return `<Worksheet ss:Name="${xml(name.slice(0, 31))}"><Table>${header}${body}</Table></Worksheet>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${worksheets}</Workbook>`;
}

function cell(value) {
  const n = Number(value);
  const type = value !== "" && Number.isFinite(n) && String(value).trim() === String(n) ? "Number" : "String";
  return `<Cell><Data ss:Type="${type}">${xml(String(value))}</Data></Cell>`;
}

async function readBody(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) return request.json();
  if (type.includes("form")) return Object.fromEntries(await request.formData());
  return {};
}

async function hashPassword(password, salt = crypto.randomUUID().replaceAll("-", "")) {
  const key = await crypto.subtle.importKey("raw", enc(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc(salt), iterations: PASSWORD_ITERATIONS, hash: "SHA-256" }, key, 256);
  return { salt, hash: hex(bits) };
}

async function verifyPassword(password, salt, expected) {
  const hp = await hashPassword(password, salt);
  return hp.hash === expected;
}

async function signSession(env, payload) {
  const data = b64url(JSON.stringify(payload));
  const sig = await hmac(env, data);
  return `${data}.${sig}`;
}

async function verifySession(env, token) {
  const [data, sig] = String(token).split(".");
  if (!data || !sig || (await hmac(env, data)) !== sig) return null;
  try {
    return JSON.parse(atob(data.replaceAll("-", "+").replaceAll("_", "/")));
  } catch {
    return null;
  }
}

async function hmac(env, data) {
  const secret = env.SESSION_SECRET || "change-this-session-secret";
  const key = await crypto.subtle.importKey("raw", enc(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc(data)));
}

function cookie(env, token, request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${env.SESSION_COOKIE || "mt_stock_session"}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`;
}

function readCookie(request, name) {
  const cookieHeader = request.headers.get("cookie") || "";
  return cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || "";
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function enc(text) { return new TextEncoder().encode(String(text)); }
function hex(buffer) { return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
function b64url(value) {
  const bytes = typeof value === "string" ? enc(value) : new Uint8Array(value);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function now() { return new Date().toISOString(); }
function unixNow() { return Math.floor(Date.now() / 1000); }
function compactDate() { return new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14); }
function validDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}
function nextId(prefix) { return `${prefix}-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`; }
function nextQr() { return `MT${compactDate().slice(2)}${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`; }
function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
function money(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? round(n) : 0;
}
function round(value) { return Math.round(Number(value || 0) * 100) / 100; }
function dateOnly(d) { return d.toISOString().slice(0, 10); }
function daysBetween(a, b) { return Math.floor((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000); }
function publicUser(user) { return { user_id: user.user_id, username: user.username, role: user.role }; }
function xml(text) { return String(text).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c])); }
function escapeHtml(text) { return xml(text); }
