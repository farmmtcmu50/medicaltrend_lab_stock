const state = {
  user: null,
  items: [],
  dashboard: [],
  stock: [],
  reprintStock: [],
  lotOptions: [],
  reportRows: [],
  reportMeta: null,
  prRows: [],
  users: [],
  audits: [],
  lastLabels: [],
};

const dashboardColumns = [
  ["status", "สถานะ"], ["name", "ชื่อ"], ["lot", "Lot"], ["expiry", "Expire"], ["machine", "เครื่อง"],
  ["qty_sub", "จำนวนย่อย"], ["qty_main_display", "จำนวนหลัก"], ["sub_unit", "หน่วย"], ["unit_price", "ราคาย่อย"],
  ["main_unit_price", "ราคาหลัก"], ["stock_value", "มูลค่า Stock"], ["reorder_point_sub", "Safety Stock"],
  ["lead_time_days", "Lead"], ["supplier", "Supplier"],
];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

boot();

async function boot() {
  bindUi();
  try {
    const me = await api("/api/me");
    state.user = me.user;
    showApp();
    await refreshAll();
  } catch {
    $("#loginView").classList.remove("hidden");
  }
}

function bindUi() {
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = formData(e.target);
    const res = await api("/api/login", { method: "POST", body: data });
    state.user = res.user;
    showApp();
    await refreshAll();
  });
  $("#logoutBtn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    location.reload();
  });
  $$(".nav").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

  $("#dashboardSearchBtn").addEventListener("click", refreshDashboard);
  $("#dashboardSearch").addEventListener("keydown", enter(refreshDashboard));
  $("#refreshDashboardBtn").addEventListener("click", refreshDashboard);
  $("#itemSearchBtn").addEventListener("click", refreshItems);
  $("#itemSearch").addEventListener("keydown", enter(refreshItems));
  $("#stockSearchBtn").addEventListener("click", refreshStock);
  $("#stockSearch").addEventListener("keydown", enter(refreshStock));
  $("#reprintSearchBtn").addEventListener("click", refreshReprintStock);
  $("#reprintSearch").addEventListener("keydown", enter(refreshReprintStock));
  $("#printSelectedReprintBtn").addEventListener("click", printSelectedReprint);
  $("#reportForm").addEventListener("submit", refreshReport);
  $("#reportForm").period.addEventListener("change", updateReportDates);
  $("#reportForm").anchor.addEventListener("change", updateReportDates);
  $("#reportForm").from.addEventListener("change", () => { $("#reportForm").period.value = "custom"; });
  $("#reportForm").to.addEventListener("change", () => { $("#reportForm").period.value = "custom"; });
  $("#reportForm").q.addEventListener("keydown", enter(refreshReport));
  $("#printReportBtn").addEventListener("click", printReport);
  $$("[data-report-type]").forEach((btn) => btn.addEventListener("click", () => setReportType(btn.dataset.reportType)));
  $("#prSource").addEventListener("change", renderPrSuggestions);
  $("#refreshPrSuggestionsBtn").addEventListener("click", refreshPrSuggestions);
  $("#addSelectedPrBtn").addEventListener("click", addSelectedPrSuggestions);
  $("#openManualPrDialogBtn").addEventListener("click", openManualPrDialog);
  $("#closeManualPrDialogBtn").addEventListener("click", () => $("#manualPrDialog").close());
  $("#manualPrSearchBtn").addEventListener("click", renderManualPrItems);
  $("#manualPrSearch").addEventListener("keydown", enter(renderManualPrItems));
  $("#printPrBtn").addEventListener("click", printPurchaseRequisition);
  $("#clearPrBtn").addEventListener("click", clearPurchaseRequisition);

  const itemForm = $("#itemForm");
  itemForm.addEventListener("submit", saveItem);
  itemForm.unit_price.addEventListener("input", () => calcPrice("unit"));
  itemForm.main_unit_price.addEventListener("input", () => calcPrice("main"));
  itemForm.sub_per_main.addEventListener("input", () => calcPrice(itemForm.dataset.lastPrice || "unit"));
  $("#openItemFormBtn").addEventListener("click", openNewItemDialog);
  $("#cancelEditItemBtn").addEventListener("click", closeItemDialog);

  $("#receiveForm").addEventListener("submit", receiveStock);
  $("#receiveForm").item_id.addEventListener("change", refreshLotOptions);
  $("#receiveForm").lot.addEventListener("change", applySelectedLotExpiry);
  $("#printLastLabelsBtn").addEventListener("click", () => printLabels(state.lastLabels));
  $("#consumeForm").addEventListener("submit", consumeFromForm);

  $("#expiringForm").addEventListener("submit", saveExpiring);
  $("#restoreForm").addEventListener("submit", restoreBackup);
  $("#clearForm").addEventListener("submit", clearDatabase);
  $("#optimizeBtn").addEventListener("click", optimizeDb);
  $("#userForm").addEventListener("submit", saveUser);
  $("#newUserBtn").addEventListener("click", resetUserForm);
  setDefaultReportDates();
  setDefaultPrMeta();
}

function showApp() {
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  $("#userLabel").textContent = `${state.user.username} (${state.user.role})`;
  if ($("#prMetaForm") && !$("#prMetaForm").requester.value) $("#prMetaForm").requester.value = state.user.username;
  $$(".admin-only").forEach((el) => el.classList.toggle("hidden", state.user.role !== "admin"));
}

function switchTab(tab) {
  $$(".nav").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $$(".tab").forEach((el) => el.classList.toggle("active", el.id === tab));
  location.hash = tab;
  if (tab === "consume") setTimeout(() => $("#consumeForm").barcode.focus(), 0);
}

async function refreshAll() {
  await Promise.all([refreshSettings(), refreshItems(), refreshDashboard(), refreshStock(), refreshReprintStock()]);
  await refreshReport();
  if (state.user.role === "admin") await Promise.all([refreshUsers(), refreshAudit()]);
  if (location.hash) switchTab(location.hash.slice(1));
}

async function refreshSettings() {
  const res = await api("/api/settings");
  $("#expiringForm").value.value = res.expiring_days;
  $("#systemInfo").innerHTML = Object.entries({
    Platform: "Cloudflare Workers + D1",
    Domain: location.hostname,
    Items: res.info.items,
    "Stock Units": res.info.stock_units,
    "Main QR": res.info.packages,
    "Active Users": res.info.active_users,
    "Audit Logs": res.info.audit_logs,
  }).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
}

async function refreshDashboard() {
  const q = encodeURIComponent($("#dashboardSearch").value.trim());
  const res = await api(`/api/dashboard?q=${q}`);
  state.dashboard = res.rows;
  $("#sumItems").textContent = res.rows.length;
  $("#sumExpiringItems").textContent = res.rows.filter((row) => row.status === "EXPIRING").length;
  $("#sumExpiredItems").textContent = res.rows.filter((row) => row.status === "EXPIRED").length;
  $("#sumValue").textContent = money(res.total_value);
  renderDashboardColumns();
  renderTable($("#dashboardTable"), dashboardColumns, res.rows, {
    status: (v) => `<span class="badge ${v}">${v}</span>`,
    unit_price: money, main_unit_price: money, stock_value: money,
  }, (row) => row.status);
  renderPrSuggestions();
}

function renderDashboardColumns() {
  const host = $("#dashboardColumns");
  if (host.children.length) return;
  host.innerHTML = dashboardColumns.map(([key, label]) => `<label><input type="checkbox" data-col="${key}" checked> ${label}</label>`).join("");
  $$("input", host).forEach((box) => box.addEventListener("change", () => {
    const visible = new Set($$("input:checked", host).map((b) => b.dataset.col));
    if (!visible.size) box.checked = true;
    $$("[data-key]", $("#dashboardTable")).forEach((cell) => cell.classList.toggle("hidden", !visible.has(cell.dataset.key)));
  }));
}

async function refreshItems() {
  const q = encodeURIComponent($("#itemSearch").value.trim());
  const res = await api(`/api/items?q=${q}`);
  state.items = res.rows;
  $("#receiveForm").item_id.innerHTML = state.items.map((i) => `<option value="${i.item_id}">${esc(i.reagent_name)} | ${esc(i.machine)}</option>`).join("");
  renderManualPrItems();
  await refreshLotOptions();
  renderTable($("#itemsTable"), [
    ["reagent_name", "ชื่อ"], ["machine", "เครื่อง"], ["main_unit", "หน่วยหลัก"], ["sub_unit", "หน่วยย่อย"],
    ["sub_per_main", "ย่อย/หลัก"], ["supplier", "Supplier"], ["unit_price", "ราคาย่อย"], ["main_unit_price", "ราคาหลัก"],
    ["lead_time_days", "Lead"], ["reorder_point_sub", "Safety Stock"], ["actions", "จัดการ"],
  ], state.items.map((item) => ({ ...item, actions: item.item_id })), {
    unit_price: money,
    main_unit_price: money,
    actions: (_, item) => `<div class="row-actions"><button data-edit-item="${item.item_id}">แก้ไข</button><button class="danger" data-delete-item="${item.item_id}">ลบ</button></div>`,
  });
  $$("[data-edit-item]").forEach((btn) => btn.addEventListener("click", () => editItem(btn.dataset.editItem)));
  $$("[data-delete-item]").forEach((btn) => btn.addEventListener("click", () => deleteItem(btn.dataset.deleteItem)));
}

async function refreshStock() {
  const q = encodeURIComponent($("#stockSearch").value.trim());
  const res = await api(`/api/stock/available?q=${q}`);
  state.stock = res.rows;
  renderTable($("#stockTable"), [
    ["barcode", "QR code"], ["reagent_name", "ชื่อ"], ["lot", "Lot"], ["expiry_date", "Expire"],
    ["quantity_sub", "จำนวนย่อย"], ["sub_unit", "หน่วย"], ["received_at", "รับเมื่อ"], ["actions", "ตัดออก"],
  ], res.rows.map((row) => ({ ...row, actions: row.barcode })), {
    actions: (_, row) => `<button data-manual-consume="${row.barcode}">ตัด Manual</button>`,
  });
  $$("[data-manual-consume]").forEach((btn) => btn.addEventListener("click", () => manualConsume(btn.dataset.manualConsume)));
}

async function refreshReprintStock() {
  const q = encodeURIComponent($("#reprintSearch").value.trim());
  const res = await api(`/api/stock/available?q=${q}`);
  state.reprintStock = res.rows;
  renderTable($("#reprintTable"), [
    ["select", ""], ["barcode", "QR code"], ["reagent_name", "ชื่อ"], ["lot", "Lot"], ["expiry_date", "Expire"],
    ["quantity_sub", "จำนวนย่อย"], ["sub_unit", "หน่วย"], ["type", "ประเภท"], ["actions", "พิมพ์"],
  ], res.rows.map((row) => ({
    ...row,
    select: row.barcode,
    type: Number(row.is_package) ? "หน่วยหลัก" : "หน่วยย่อย",
    actions: row.barcode,
  })), {
    select: (_, row) => `<input class="row-check reprint-check" type="checkbox" value="${esc(row.barcode)}" aria-label="เลือก ${esc(row.barcode)}">`,
    actions: (_, row) => `<button data-reprint-one="${esc(row.barcode)}">พิมพ์</button>`,
  });
  $$("[data-reprint-one]").forEach((btn) => btn.addEventListener("click", () => printReprintRows([btn.dataset.reprintOne])));
}

async function refreshReport(e) {
  if (e) e.preventDefault();
  const form = $("#reportForm");
  if (form.period.value !== "custom") updateReportDates();
  const params = new URLSearchParams(formData(form));
  const res = await api(`/api/reports?${params.toString()}`);
  state.reportRows = res.rows;
  state.reportMeta = res;
  renderTable($("#reportTable"), [
    ["timestamp", "เวลา"], ["type_label", "ประเภท"], ["reagent_name", "ชื่อ"], ["lot", "Lot"],
    ["barcode", "QR code"], ["quantity_sub", "จำนวนย่อย"], ["operator_username", "ผู้ทำรายการ"], ["operator_note", "Note"],
  ], res.rows.map((row) => ({
    ...row,
    type_label: row.type === "RECEIVE" ? "รับเข้า" : "ตัด Stock",
  })));
}

async function setReportType(type) {
  const form = $("#reportForm");
  form.type.value = type === "consume" ? "consume" : "receive";
  $$("[data-report-type]").forEach((btn) => btn.classList.toggle("active", btn.dataset.reportType === form.type.value));
  await refreshReport();
}

function setDefaultReportDates() {
  const form = $("#reportForm");
  form.anchor.value = todayText();
  updateReportDates();
}

function updateReportDates() {
  const form = $("#reportForm");
  const anchor = parseLocalDate(form.anchor.value || todayText());
  const period = form.period.value;
  if (period === "custom") return;
  const [from, to] = reportRange(anchor, period);
  form.from.value = dateInput(from);
  form.to.value = dateInput(to);
}

function reportRange(anchor, period) {
  const d = new Date(anchor);
  if (period === "week") {
    const day = d.getDay() || 7;
    const start = addDays(d, 1 - day);
    return [start, addDays(start, 6)];
  }
  if (period === "month") return [new Date(d.getFullYear(), d.getMonth(), 1), new Date(d.getFullYear(), d.getMonth() + 1, 0)];
  if (period === "quarter") {
    const startMonth = Math.floor(d.getMonth() / 3) * 3;
    return [new Date(d.getFullYear(), startMonth, 1), new Date(d.getFullYear(), startMonth + 3, 0)];
  }
  if (period === "year") return [new Date(d.getFullYear(), 0, 1), new Date(d.getFullYear(), 11, 31)];
  return [d, d];
}

function printReport() {
  if (!state.reportRows.length) return toast("ไม่มีข้อมูลรายงานสำหรับพิมพ์", true);
  const meta = state.reportMeta || {};
  const title = meta.report_type === "consume" ? "รายงานการตัด Stock" : "รายงานการรับน้ำยา";
  const rows = state.reportRows.map((row) => `
    <tr>
      <td>${esc(row.timestamp)}</td>
      <td>${row.type === "RECEIVE" ? "รับเข้า" : "ตัด Stock"}</td>
      <td>${esc(row.reagent_name)}</td>
      <td>${esc(row.lot)}</td>
      <td>${esc(row.barcode)}</td>
      <td>${esc(row.quantity_sub)}</td>
      <td>${esc(row.operator_username)}</td>
      <td>${esc(row.operator_note)}</td>
    </tr>`).join("");
  const win = window.open("", "_blank");
  win.document.open();
  win.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${title}</title>
    <style>
      body{font-family:-apple-system,BlinkMacSystemFont,"Sukhumvit Set","Segoe UI",Arial,sans-serif;margin:24px;color:#182334}
      header{display:flex;align-items:center;gap:14px;margin-bottom:18px;border-bottom:2px solid #dde5ef;padding-bottom:12px}
      img{width:64px;height:64px;object-fit:contain} h1{font-size:22px;margin:0} p{margin:4px 0 0;color:#64748b}
      table{width:100%;border-collapse:collapse;font-size:12px} th,td{border:1px solid #dbe4ef;padding:7px;text-align:left;vertical-align:top} th{background:#f3f6fa}
      .summary{display:flex;gap:16px;margin:10px 0 18px;font-weight:700}
      @media print{button{display:none} body{margin:12mm}}
    </style></head><body>
    <button onclick="window.print()">พิมพ์รายงาน</button>
    <header><img src="/logo-medical-trend.png" alt=""><div><h1>${title}</h1><p>ช่วงวันที่ ${esc(meta.from || "")} ถึง ${esc(meta.to || "")}</p></div></header>
    <div class="summary"><span>จำนวนรายการ: ${esc(meta.summary?.rows || 0)}</span><span>จำนวนหน่วยย่อยรวม: ${esc(meta.summary?.quantity_sub || 0)}</span><span>จำนวนชนิดน้ำยา: ${esc(meta.summary?.items || 0)}</span></div>
    <table><thead><tr><th>เวลา</th><th>ประเภท</th><th>ชื่อ</th><th>Lot</th><th>QR code</th><th>จำนวนย่อย</th><th>ผู้ทำรายการ</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>
    </body></html>`);
  win.document.close();
}

async function refreshPrSuggestions() {
  await refreshDashboard();
  renderPrSuggestions();
  toast("รีเฟรชรายการแนะนำแล้ว");
}

function renderPrSuggestions() {
  const table = $("#prSuggestedTable");
  if (!table) return;
  const rows = suggestedPrRows();
  renderTable(table, [
    ["select", ""], ["status", "สถานะ"], ["name", "ชื่อ"], ["lot", "Lot"], ["expiry", "Expire"],
    ["qty_main_display", "Stock ปัจจุบัน"], ["reorder_point_sub", "Safety Stock"], ["supplier", "Supplier"],
    ["order_qty", "จำนวนสั่ง"], ["unit", "หน่วย"], ["reason", "เหตุผล"], ["actions", "เพิ่ม"],
  ], rows.map((row) => ({
    ...row,
    select: row.item_id,
    order_qty: defaultPrQty(row),
    unit: row.main_unit || row.sub_unit || "",
    reason: prReason(row),
    actions: row.item_id,
  })), {
    select: (_, row) => `<input class="row-check pr-suggest-check" type="checkbox" value="${esc(row.item_id)}">`,
    status: (v) => `<span class="badge ${v}">${v}</span>`,
    order_qty: (v, row) => `<input class="table-input pr-suggest-qty" data-pr-qty="${esc(row.item_id)}" type="number" min="1" value="${esc(v)}">`,
    actions: (_, row) => `<button data-add-pr-suggest="${esc(row.item_id)}" type="button">เพิ่ม</button>`,
  }, (row) => row.status);
  $$("[data-add-pr-suggest]").forEach((btn) => btn.addEventListener("click", () => addPrSuggestion(btn.dataset.addPrSuggest)));
}

function suggestedPrRows() {
  const source = $("#prSource")?.value || "expiring";
  return state.dashboard.filter((row) => {
    const expiring = ["EXPIRING", "EXPIRED"].includes(row.status);
    const reorder = ["REORDER", "CRITICAL"].includes(row.status);
    if (source === "reorder") return reorder;
    if (source === "all") return expiring || reorder;
    return expiring;
  });
}

function addSelectedPrSuggestions() {
  const ids = $$(".pr-suggest-check:checked").map((box) => box.value);
  if (!ids.length) return toast("กรุณาเลือกรายการที่ต้องการเพิ่มเข้าใบ PR", true);
  ids.forEach(addPrSuggestion);
  renderPurchaseRequisition();
  toast("เพิ่มรายการที่เลือกเข้าใบ PR แล้ว");
}

function addPrSuggestion(itemId) {
  const row = suggestedPrRows().find((item) => item.item_id === itemId);
  if (!row) return;
  const qtyInput = $(`[data-pr-qty="${CSS.escape(itemId)}"]`);
  const orderQty = Math.max(1, Number(qtyInput?.value || defaultPrQty(row)));
  const existing = state.prRows.find((item) => item.item_id === itemId && item.source !== "manual");
  if (existing) {
    existing.order_qty = orderQty;
    existing.reason = prReason(row);
  } else {
    state.prRows.push({
      id: nextClientId("PR"),
      item_id: itemId,
      name: row.name,
      supplier: row.supplier || "",
      order_qty: orderQty,
      unit: row.main_unit || row.sub_unit || "",
      unit_price: Number(row.main_unit_price || row.unit_price || 0),
      current_stock: row.qty_main_display || `${row.qty_sub || 0} ${row.sub_unit || ""}`.trim(),
      lot: row.lot || "",
      expiry: row.expiry || "",
      reason: prReason(row),
      source: "stock",
    });
  }
  renderPurchaseRequisition();
}

function openManualPrDialog() {
  $("#manualPrSearch").value = "";
  renderManualPrItems();
  $("#manualPrDialog").showModal();
  $("#manualPrSearch").focus();
}

function renderManualPrItems() {
  const q = ($("#manualPrSearch")?.value || "").trim().toLowerCase();
  const rows = state.items.filter((item) => !q
    || String(item.reagent_name || "").toLowerCase().includes(q)
    || String(item.machine || "").toLowerCase().includes(q)
    || String(item.supplier || "").toLowerCase().includes(q));
  renderTable($("#manualPrTable"), [
    ["reagent_name", "ชื่อสินค้า"], ["machine", "เครื่อง"], ["supplier", "Supplier"], ["order_qty", "จำนวน"],
    ["unit", "หน่วย"], ["unit_price", "ราคา"], ["reason", "เหตุผล"], ["actions", "เลือก"],
  ], rows.map((item) => ({
    ...item,
    order_qty: 1,
    unit: item.main_unit || item.sub_unit || "",
    unit_price: Number(item.main_unit_price || item.unit_price || 0).toFixed(2),
    reason: "ต้องการสั่งซื้อเพิ่มเติม",
    actions: item.item_id,
  })), {
    order_qty: (v, item) => `<input class="table-input" data-manual-pr="${esc(item.item_id)}" data-field="order_qty" type="number" min="1" value="${esc(v)}">`,
    unit: (v, item) => `<input class="table-input" data-manual-pr="${esc(item.item_id)}" data-field="unit" value="${esc(v)}">`,
    unit_price: (v, item) => `<input class="table-input" data-manual-pr="${esc(item.item_id)}" data-field="unit_price" type="number" min="0" step="0.01" value="${esc(v)}">`,
    reason: (v, item) => `<input class="table-input wide" data-manual-pr="${esc(item.item_id)}" data-field="reason" value="${esc(v)}">`,
    actions: (_, item) => `<button data-add-manual-pr="${esc(item.item_id)}" type="button">เลือก</button>`,
  });
  $$("[data-add-manual-pr]").forEach((btn) => btn.addEventListener("click", () => addManualPrItem(btn.dataset.addManualPr)));
}

async function addManualPrItem(itemId) {
  const item = state.items.find((row) => row.item_id === itemId);
  if (!item) return toast("กรุณาเลือกรายการสินค้าจากฐานข้อมูล", true);
  const data = manualPrRowData(itemId, item);
  const ok = await confirmBox("ยืนยันเพิ่มรายการเข้าใบ PR", `เพิ่ม ${esc(item.reagent_name)} จำนวน ${esc(data.order_qty)} ${esc(data.unit)} เข้าใบ PR ใช่ไหม?`);
  if (!ok) return;
  state.prRows.push({
    id: nextClientId("PRM"),
    item_id: item.item_id,
    name: item.reagent_name,
    supplier: item.supplier || "",
    order_qty: Math.max(1, Number(data.order_qty || 1)),
    unit: data.unit || item.main_unit || item.sub_unit || "",
    unit_price: Number(data.unit_price || item.main_unit_price || item.unit_price || 0),
    current_stock: "",
    lot: "",
    expiry: "",
    reason: data.reason || "ต้องการสั่งซื้อเพิ่มเติม",
    source: "manual",
  });
  renderPurchaseRequisition();
  $("#manualPrDialog").close();
  toast("เพิ่มรายการเข้าใบ PR แล้ว");
}

function manualPrRowData(itemId, item) {
  const read = (field, fallback = "") => $(`[data-manual-pr="${CSS.escape(itemId)}"][data-field="${field}"]`)?.value || fallback;
  return {
    order_qty: read("order_qty", 1),
    unit: read("unit", item.main_unit || item.sub_unit || ""),
    unit_price: read("unit_price", item.main_unit_price || item.unit_price || 0),
    reason: read("reason", "ต้องการสั่งซื้อเพิ่มเติม"),
  };
}

function renderPurchaseRequisition() {
  renderTable($("#prTable"), [
    ["name", "ชื่อสินค้า"], ["supplier", "Supplier"], ["current_stock", "Stock ปัจจุบัน"], ["lot", "Lot"],
    ["expiry", "Expire"], ["order_qty", "จำนวนสั่ง"], ["unit", "หน่วย"], ["unit_price", "ราคาประมาณ"],
    ["total", "รวม"], ["reason", "เหตุผล"], ["actions", "ลบ"],
  ], state.prRows.map((row) => ({
    ...row,
    total: Number(row.order_qty || 0) * Number(row.unit_price || 0),
    actions: row.id,
  })), {
    order_qty: (v, row) => `<input class="table-input" data-pr-edit="${esc(row.id)}" data-field="order_qty" type="number" min="1" value="${esc(v)}">`,
    unit: (v, row) => `<input class="table-input" data-pr-edit="${esc(row.id)}" data-field="unit" value="${esc(v)}">`,
    unit_price: (v, row) => `<input class="table-input" data-pr-edit="${esc(row.id)}" data-field="unit_price" type="number" min="0" step="0.01" value="${esc(v)}">`,
    reason: (v, row) => `<input class="table-input wide" data-pr-edit="${esc(row.id)}" data-field="reason" value="${esc(v)}">`,
    total: money,
    actions: (_, row) => `<button class="danger" data-delete-pr="${esc(row.id)}" type="button">ลบ</button>`,
  });
  $$("[data-pr-edit]").forEach((input) => input.addEventListener("input", updatePrRow));
  $$("[data-delete-pr]").forEach((btn) => btn.addEventListener("click", () => deletePrRow(btn.dataset.deletePr)));
}

function updatePrRow(e) {
  const row = state.prRows.find((item) => item.id === e.target.dataset.prEdit);
  if (!row) return;
  const field = e.target.dataset.field;
  row[field] = ["order_qty", "unit_price"].includes(field) ? Number(e.target.value || 0) : e.target.value;
}

function deletePrRow(id) {
  state.prRows = state.prRows.filter((row) => row.id !== id);
  renderPurchaseRequisition();
}

async function clearPurchaseRequisition() {
  if (!state.prRows.length) return;
  if (!(await confirmBox("ล้างใบ PR", "ต้องการลบรายการทั้งหมดในใบ PR นี้ใช่ไหม?"))) return;
  state.prRows = [];
  renderPurchaseRequisition();
}

function printPurchaseRequisition() {
  if (!state.prRows.length) return toast("กรุณาเพิ่มรายการในใบ PR ก่อนพิมพ์", true);
  const meta = formData($("#prMetaForm"));
  const prNo = meta.pr_no || `PR-${dateInput(new Date()).replaceAll("-", "")}-${String(Date.now()).slice(-4)}`;
  const total = state.prRows.reduce((sum, row) => sum + Number(row.order_qty || 0) * Number(row.unit_price || 0), 0);
  const rows = state.prRows.map((row, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${esc(row.name)}</td>
      <td>${esc(row.supplier)}</td>
      <td>${esc(row.current_stock)}</td>
      <td>${esc(row.lot)}</td>
      <td>${esc(row.expiry)}</td>
      <td>${esc(row.order_qty)}</td>
      <td>${esc(row.unit)}</td>
      <td>${money(row.unit_price)}</td>
      <td>${money(Number(row.order_qty || 0) * Number(row.unit_price || 0))}</td>
      <td>${esc(row.reason)}</td>
    </tr>`).join("");
  const win = window.open("", "_blank");
  win.document.open();
  win.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(prNo)}</title>
    <style>
      body{font-family:-apple-system,BlinkMacSystemFont,"Sukhumvit Set","Segoe UI",Arial,sans-serif;margin:22px;color:#182334}
      header{display:flex;align-items:center;gap:14px;margin-bottom:14px;border-bottom:2px solid #182334;padding-bottom:12px}
      img{width:68px;height:68px;object-fit:contain} h1{font-size:24px;margin:0} p{margin:3px 0;color:#475569}
      .meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px 16px;margin:12px 0 18px;font-size:13px}
      table{width:100%;border-collapse:collapse;font-size:11px} th,td{border:1px solid #cbd7e6;padding:6px;text-align:left;vertical-align:top} th{background:#f3f6fa}
      .total{text-align:right;margin:12px 0 28px;font-weight:700}
      .signatures{display:grid;grid-template-columns:1fr 1fr;gap:42px;margin-top:42px}
      .sign{border-top:1px solid #182334;text-align:center;padding-top:8px;min-height:60px}
      button{margin-bottom:12px} @media print{button{display:none} body{margin:10mm}}
    </style></head><body>
    <button onclick="window.print()">พิมพ์ / Save PDF</button>
    <header><img src="/logo-medical-trend.png" alt=""><div><h1>Purchase Requisition</h1><p>Medical Trend Lab Stock</p></div></header>
    <section class="meta">
      <div><strong>เลขที่ PR:</strong> ${esc(prNo)}</div>
      <div><strong>วันที่ขอซื้อ:</strong> ${esc(meta.request_date || dateInput(new Date()))}</div>
      <div><strong>แผนก:</strong> ${esc(meta.department || "")}</div>
      <div><strong>ผู้ขอซื้อ:</strong> ${esc(meta.requester || state.user?.username || "")}</div>
      <div><strong>ผู้อนุมัติ:</strong> ${esc(meta.approver || "")}</div>
      <div><strong>หมายเหตุ:</strong> ${esc(meta.note || "")}</div>
    </section>
    <table><thead><tr><th>#</th><th>รายการ</th><th>Supplier</th><th>Stock</th><th>Lot</th><th>Exp</th><th>จำนวน</th><th>หน่วย</th><th>ราคา/หน่วย</th><th>รวม</th><th>เหตุผล</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="total">รวมประมาณ: ${money(total)}</div>
    <section class="signatures"><div class="sign">ผู้สั่งซื้อ / ผู้ขอซื้อ</div><div class="sign">ผู้บริหาร / ผู้อนุมัติ</div></section>
    </body></html>`);
  win.document.close();
}

function setDefaultPrMeta() {
  const form = $("#prMetaForm");
  form.request_date.value = todayText();
  form.requester.value = state.user?.username || "";
  renderPurchaseRequisition();
}

function defaultPrQty(row) {
  const subPerMain = Math.max(1, Number(row.sub_per_main || 1));
  const shortage = Math.max(0, Number(row.reorder_point_sub || 0) - Number(row.qty_sub || 0));
  return Math.max(1, Math.ceil(shortage / subPerMain));
}

function prReason(row) {
  if (row.status === "CRITICAL") return "Stock หมด";
  if (row.status === "REORDER") return "Stock ต่ำกว่า Safety Stock";
  if (row.status === "EXPIRED") return "มีรายการหมดอายุใน Stock";
  if (row.status === "EXPIRING") return "ใกล้หมดอายุ";
  return "ต้องการสั่งซื้อเพิ่มเติม";
}

async function saveItem(e) {
  e.preventDefault();
  const form = e.target;
  const data = formData(form);
  if (data.item_id) {
    await api(`/api/items/${encodeURIComponent(data.item_id)}`, { method: "PUT", body: data });
    toast("บันทึกแก้ไขรายการน้ำยาแล้ว");
  } else {
    await api("/api/items", { method: "POST", body: data });
    toast("เพิ่มรายการน้ำยาแล้ว");
  }
  resetItemForm();
  $("#itemDialog").close();
  await Promise.all([refreshItems(), refreshDashboard()]);
}

function openNewItemDialog() {
  resetItemForm();
  $("#itemDialogTitle").textContent = "เพิ่มน้ำยาใหม่";
  $("#itemDialog").showModal();
  $("#itemForm").reagent_name.focus();
}

function editItem(id) {
  const item = state.items.find((x) => x.item_id === id);
  const form = $("#itemForm");
  Object.entries(item).forEach(([k, v]) => { if (form[k]) form[k].value = v ?? ""; });
  form.item_id.value = id;
  $("#saveItemBtn").textContent = "บันทึกแก้ไขรายการ";
  $("#itemDialogTitle").textContent = "แก้ไขรายการน้ำยา";
  $("#itemDialog").showModal();
  form.reagent_name.focus();
}

async function deleteItem(id) {
  const item = state.items.find((x) => x.item_id === id);
  if (!(await confirmBox("ยืนยันลบรายการน้ำยา", `ต้องการลบ ${item?.reagent_name || id} ใช่ไหม?`))) return;
  await api(`/api/items/${encodeURIComponent(id)}`, { method: "DELETE" });
  await Promise.all([refreshItems(), refreshDashboard()]);
  toast("ลบรายการแล้ว");
}

function resetItemForm() {
  $("#itemForm").reset();
  $("#itemForm").item_id.value = "";
  $("#itemForm").machine.value = "Manual";
  $("#itemForm").sub_per_main.value = 1;
  $("#itemForm").unit_price.value = 0;
  $("#itemForm").main_unit_price.value = 0;
  $("#saveItemBtn").textContent = "บันทึกรายการ";
  $("#itemDialogTitle").textContent = "เพิ่มน้ำยาใหม่";
}

function closeItemDialog() {
  resetItemForm();
  $("#itemDialog").close();
}

function calcPrice(mode) {
  const form = $("#itemForm");
  form.dataset.lastPrice = mode;
  const factor = Math.max(1, Number(form.sub_per_main.value || 1));
  if (mode === "unit") {
    form.main_unit_price.value = (Number(form.unit_price.value || 0) * factor).toFixed(2);
  } else {
    form.unit_price.value = (Number(form.main_unit_price.value || 0) / factor).toFixed(2);
  }
}

async function receiveStock(e) {
  e.preventDefault();
  const res = await api("/api/receive", { method: "POST", body: formData(e.target) });
  state.lastLabels = res.labels;
  $("#lastLabels").classList.remove("hidden");
  $("#lastLabelsList").innerHTML = res.labels.map((l) => `<span class="chip">${esc(l.code)} ${l.type === "main" ? "(หน่วยหลัก)" : ""}</span>`).join("");
  await Promise.all([refreshDashboard(), refreshStock(), refreshReprintStock(), refreshLotOptions(), refreshAuditMaybe()]);
  if (await confirmBox("พิมพ์ QR code", "ต้องการเปิดหน้าพิมพ์ / Save PDF ตอนนี้ไหม?")) await printLabels(res.labels);
}

async function refreshLotOptions() {
  const form = $("#receiveForm");
  const itemId = form.item_id.value;
  if (!itemId) {
    state.lotOptions = [];
    $("#lotOptions").innerHTML = "";
    $("#lotHint").textContent = "เลือก Lot เดิมหรือพิมพ์ Lot ใหม่ได้";
    return;
  }
  const res = await api(`/api/lots?item_id=${encodeURIComponent(itemId)}`);
  state.lotOptions = res.rows;
  $("#lotOptions").innerHTML = res.rows.map((row) =>
    `<option value="${esc(row.lot)}" label="Exp ${esc(row.expiry_date)} | Stock ${Number(row.qty_in_stock || 0)}"></option>`
  ).join("");
  $("#lotHint").textContent = res.rows.length
    ? `พบ Lot เดิมที่ยังไม่หมดอายุ ${res.rows.length} รายการ หรือพิมพ์ Lot ใหม่ได้`
    : "ยังไม่มี Lot เดิมที่ยังไม่หมดอายุ สามารถพิมพ์ Lot ใหม่ได้";
}

function applySelectedLotExpiry() {
  const form = $("#receiveForm");
  const lot = form.lot.value.trim().toLowerCase();
  const match = state.lotOptions.find((row) => String(row.lot || "").toLowerCase() === lot);
  if (match?.expiry_date && !form.expiry_date.value) form.expiry_date.value = match.expiry_date;
}

async function printSelectedReprint() {
  const codes = $$(".reprint-check:checked").map((box) => box.value);
  if (!codes.length) return toast("กรุณาเลือกรายการ QR ที่ต้องการพิมพ์ซ้ำ", true);
  await printReprintRows(codes);
}

async function printReprintRows(codes) {
  const labels = codes.map((code) => {
    const target = state.reprintStock.find((x) => x.barcode.toLowerCase() === code.toLowerCase());
    return stockRowToLabel(target || { barcode: code });
  });
  await printLabels(labels);
}

function stockRowToLabel(row) {
  return {
    code: row.barcode,
    type: Number(row.is_package) ? "main" : "sub",
    lot: row.lot || "",
    expiry: row.expiry_date || "",
    sub_count: row.quantity_sub || 1,
    item: {
      reagent_name: row.reagent_name || "",
      machine: row.machine || "",
      main_unit: row.main_unit || "",
      sub_unit: row.sub_unit || "",
    },
  };
}

async function printLabels(labels) {
  const html = await apiText("/api/labels", { method: "POST", body: { labels } });
  const win = window.open("", "_blank");
  win.document.open();
  win.document.write(html);
  win.document.close();
}

async function consumeFromForm(e) {
  e.preventDefault();
  const form = e.target;
  const barcode = form.barcode.value.trim();
  if (!barcode) return;
  await consume({ barcode }, { scanned: true });
  form.reset();
  form.barcode.focus();
}

async function manualConsume(code) {
  const target = state.stock.find((x) => x.barcode === code);
  let qty = target?.is_package ? Number(prompt(`QR หน่วยหลักนี้มี ${target.quantity_sub} ${target.sub_unit || "ชิ้น"} ต้องการตัดกี่ชิ้น?`, target.quantity_sub) || 0) : 1;
  if (!qty || qty < 1) return;
  if (!(await confirmBox("ยืนยันตัด Stock แบบ Manual", `ตัด ${target.reagent_name} Lot ${target.lot} จำนวน ${qty} ${target.sub_unit || ""}?`))) return;
  await consume({ barcode: code, package_quantity: qty });
}

async function consume(data, options = {}) {
  try {
    const preview = await api("/api/consume/preview", { method: "POST", body: data });
    if (preview.target.is_package && !data.package_quantity) {
      const qty = prompt(`QR หน่วยหลักนี้มี ${preview.target.quantity_sub} ${preview.target.sub_unit || "ชิ้น"} ต้องการตัดกี่ชิ้น?`, preview.target.quantity_sub);
      if (!qty) return;
      data.package_quantity = qty;
    }
    if (preview.warnings.length) {
      const ok = await confirmBox("แจ้งเตือน FEFO", `${preview.warnings.join("<br>")}<br><br>ยืนยันว่าจะนำน้ำยา QR นี้ออกจาก stock ไปใช้จริงหรือไม่?`);
      if (!ok) return;
      data.confirm_fefo = true;
    }
    await api("/api/consume", { method: "POST", body: data });
    await Promise.all([refreshDashboard(), refreshStock(), refreshAuditMaybe()]);
    toast(options.scanned ? `ตัด Stock แล้ว: ${preview.target.reagent_name}` : "ตัด Stock แล้ว");
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (options.scanned) $("#consumeForm").barcode.focus();
  }
}

async function saveExpiring(e) {
  e.preventDefault();
  await api("/api/settings/expiring-days", { method: "PUT", body: formData(e.target) });
  await Promise.all([refreshSettings(), refreshDashboard(), refreshAuditMaybe()]);
  toast("บันทึกจำนวนวันใกล้หมดอายุแล้ว");
}

async function optimizeDb() {
  await api("/api/optimize", { method: "POST" });
  await Promise.all([refreshSettings(), refreshAuditMaybe()]);
  toast("ตรวจสอบ/Optimize database แล้ว");
}

async function clearDatabase(e) {
  e.preventDefault();
  if (!(await confirmBox("ลบข้อมูลใน Database ทั้งหมด", "ระบบจะลบ stock และซ่อนรายการน้ำยาทั้งหมด ยืนยันทำต่อ?"))) return;
  await api("/api/clear", { method: "POST", body: formData(e.target) });
  await refreshAll();
  toast("ลบข้อมูลแล้ว");
}

async function restoreBackup(e) {
  e.preventDefault();
  const file = e.target.file.files[0];
  if (!file) return toast("กรุณาเลือกไฟล์ backup", true);
  if (!(await confirmBox("Restore Database", "ระบบจะสร้าง safety backup ใน browser ก่อน restore ยืนยันทำต่อ?"))) return;
  const data = JSON.parse(await file.text());
  const res = await api("/api/restore", { method: "POST", body: data });
  downloadJson(res.safety_backup, `safety_backup_before_restore_${Date.now()}.json`);
  await refreshAll();
  toast("Restore database แล้ว และดาวน์โหลด safety backup ให้แล้ว");
}

async function refreshUsers() {
  const res = await api("/api/users");
  state.users = res.rows;
  renderTable($("#usersTable"), [["username", "Username"], ["role", "Role"], ["created_at", "Created"], ["actions", "จัดการ"]],
    res.rows.map((u) => ({ ...u, actions: u.user_id })), {
      actions: (_, user) => `<div class="row-actions"><button data-edit-user="${user.user_id}">แก้ไข</button><button class="danger" data-delete-user="${user.user_id}" ${user.username === "admin" ? "disabled" : ""}>ลบ</button></div>`,
    });
  $$("[data-edit-user]").forEach((btn) => btn.addEventListener("click", () => editUser(btn.dataset.editUser)));
  $$("[data-delete-user]").forEach((btn) => btn.addEventListener("click", () => deleteUser(btn.dataset.deleteUser)));
}

function editUser(id) {
  const user = state.users.find((x) => x.user_id === id);
  const form = $("#userForm");
  form.user_id.value = user.user_id;
  form.username.value = user.username;
  form.role.value = user.role;
  form.password.value = "";
}

function resetUserForm() { $("#userForm").reset(); $("#userForm").user_id.value = ""; }

async function saveUser(e) {
  e.preventDefault();
  const data = formData(e.target);
  if (data.user_id) await api(`/api/users/${encodeURIComponent(data.user_id)}`, { method: "PUT", body: data });
  else await api("/api/users", { method: "POST", body: data });
  resetUserForm();
  await Promise.all([refreshUsers(), refreshAuditMaybe(), refreshSettings()]);
  toast("บันทึกผู้ใช้งานแล้ว");
}

async function deleteUser(id) {
  const user = state.users.find((x) => x.user_id === id);
  if (!(await confirmBox("ลบผู้ใช้งาน", `ลบผู้ใช้งาน ${user.username}?`))) return;
  await api(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE" });
  await Promise.all([refreshUsers(), refreshAuditMaybe(), refreshSettings()]);
}

async function refreshAuditMaybe() { if (state.user?.role === "admin") await refreshAudit(); }

async function refreshAudit() {
  const res = await api("/api/audit");
  state.audits = res.rows;
  renderTable($("#auditTable"), [["timestamp", "เวลา"], ["username", "User"], ["action", "Action"], ["target_type", "Type"], ["target_id", "Target"], ["result", "Result"], ["details", "Details"]], res.rows);
}

function renderTable(table, cols, rows, formatters = {}, rowClass = null) {
  table.innerHTML = `<thead><tr>${cols.map(([k, label]) => `<th data-key="${k}">${label}</th>`).join("")}</tr></thead><tbody></tbody>`;
  const tbody = $("tbody", table);
  tbody.innerHTML = rows.map((row) => `<tr class="${rowClass ? rowClass(row) : ""}">${cols.map(([k]) => {
    const raw = row[k] ?? "";
    const value = formatters[k] ? formatters[k](raw, row) : esc(raw);
    return `<td data-key="${k}">${value}</td>`;
  }).join("")}</tr>`).join("");
  $$("th", table).forEach((th) => th.addEventListener("click", () => sortTable(table, th.cellIndex)));
}

function sortTable(table, index) {
  const tbody = $("tbody", table);
  const rows = $$("tr", tbody);
  const asc = table.dataset.sortIndex == index ? table.dataset.sortDir !== "asc" : true;
  rows.sort((a, b) => compare(a.children[index]?.innerText || "", b.children[index]?.innerText || "", asc));
  rows.forEach((r) => tbody.appendChild(r));
  table.dataset.sortIndex = index;
  table.dataset.sortDir = asc ? "asc" : "desc";
}

function compare(a, b, asc) {
  const na = Number(a.replace(/,/g, "")); const nb = Number(b.replace(/,/g, ""));
  const da = Date.parse(a); const db = Date.parse(b);
  let v = Number.isFinite(na) && Number.isFinite(nb) ? na - nb : (!Number.isNaN(da) && !Number.isNaN(db) ? da - db : a.localeCompare(b, "th"));
  return asc ? v : -v;
}

async function api(path, opts = {}) {
  const res = await fetch(path, jsonOpts(opts));
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function apiText(path, opts = {}) {
  const res = await fetch(path, jsonOpts(opts));
  if (!res.ok) throw new Error(await res.text());
  return res.text();
}

function jsonOpts(opts) {
  const out = { ...opts, headers: { ...(opts.headers || {}) } };
  if (out.body && !(out.body instanceof FormData)) {
    out.headers["content-type"] = "application/json";
    out.body = JSON.stringify(out.body);
  }
  return out;
}

function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
function enter(fn) { return (e) => { if (e.key === "Enter") { e.preventDefault(); fn(); } }; }
function money(v) { return Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function esc(v) { return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function todayText() { return dateInput(new Date()); }
function parseLocalDate(value) {
  const [y, m, d] = String(value).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
function dateInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function nextClientId(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`; }

function toast(message, bad = false) {
  const el = $("#toast");
  el.textContent = message;
  el.style.background = bad ? "#9f1d16" : "#10213f";
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3800);
}

async function confirmBox(title, html) {
  const dialog = $("#confirmDialog");
  $("#confirmTitle").textContent = title;
  $("#confirmBody").innerHTML = html;
  dialog.showModal();
  const value = await new Promise((resolve) => dialog.addEventListener("close", () => resolve(dialog.returnValue), { once: true }));
  return value === "ok";
}

function downloadJson(data, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
