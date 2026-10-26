const state = {
  user: null,
  items: [],
  dashboard: [],
  prSuggestionRows: [],
  dashboardCardFilter: "all",
  stock: [],
  reprintStock: [],
  lotOptions: [],
  reportRows: [],
  reportMeta: null,
  prRows: [],
  prRequests: [],
  editingPrId: "",
  branding: {
    lab_name: "Medical Trend",
    logo_data_url: "/logo-medical-trend.png",
  },
  users: [],
  audits: [],
  lastLabels: [],
  consumeScanTimer: null,
  consumeScanBusy: false,
  stockViewsDirty: new Set(),
};

const dashboardColumns = [
  ["status", "สถานะ"], ["name", "ชื่อ"], ["lot", "Lot"], ["expiry", "Expire"], ["machine", "เครื่อง"],
  ["qty_sub", "จำนวนคงเหลือ"], ["qty_main_display", "จำนวนหลัก"], ["sub_unit", "หน่วย"], ["unit_price", "ราคาย่อย"],
  ["main_unit_price", "ราคาหลัก"], ["stock_value", "มูลค่า Stock"], ["reorder_point_sub", "Safety Stock"],
  ["lead_time_days", "Lead"], ["supplier", "Supplier"],
];
const priceColumnKeys = new Set(["unit_price", "main_unit_price", "stock_value", "total", "total_value"]);

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const workflowUi = {busy:false,consumeBusy:false,operations:[],cursor:null,counts:[],prLines:[],recent:[]};
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
  bindWorkflowUi();
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    showLoginError("");
    try {
      const data = formData(e.target);
      const res = await api("/api/login", { method: "POST", body: data });
      state.user = res.user;
      showApp();
      await refreshAll();
    } catch (error) {
      showLoginError(error.message || "ใส่ username หรือ password ผิด");
    }
  });
  $("#loginForm").username.addEventListener("input", () => showLoginError(""));
  $("#loginForm").password.addEventListener("input", () => showLoginError(""));
  $("#logoutBtn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    location.reload();
  });
  $$(".nav").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

  $("#dashboardSearchBtn").addEventListener("click", refreshDashboard);
  $("#dashboardSearch").addEventListener("keydown", enter(refreshDashboard));
  $("#dashboardMachineFilter").addEventListener("change", refreshDashboard);
  $("#refreshDashboardBtn").addEventListener("click", refreshDashboard);
  $('#dashboardPeriod').addEventListener('change',()=>{const custom=$('#dashboardPeriod').value==='custom';$('#dashboardStartLabel').hidden=!custom;$('#dashboardEndLabel').hidden=!custom;if(!custom||($('#dashboardStart').value&&$('#dashboardEnd').value))refreshDashboard().catch(e=>toast(e.message,true));});
  for(const id of ['dashboardStart','dashboardEnd'])$('#'+id).addEventListener('change',()=>{if($('#dashboardStart').value&&$('#dashboardEnd').value)refreshDashboard().catch(e=>toast(e.message,true));});
  $('#setPurchaseTotalBtn').addEventListener('click',()=>{const a=state.analytics;if(!a)return;$('#purchaseTotalPeriod').textContent=`${a.range.start} ถึง ${a.range.end}`;$('#purchaseTotalForm').total_value.value=a.purchase_total??'';$('#purchaseTotalDialog').showModal();});
  $('#closePurchaseTotal').addEventListener('click',()=>$('#purchaseTotalDialog').close());
  $('#purchaseTotalForm').addEventListener('submit',async event=>{event.preventDefault();try{const a=state.analytics;await api('/api/dashboard/purchase-total',{method:'PUT',body:{start:a.range.start,end:a.range.end,total_value:Number(event.target.total_value.value)}});$('#purchaseTotalDialog').close();await refreshDashboard();toast('บันทึกมูลค่าซื้อแล้ว');}catch(e){toast(e.message,true);}});
  $('#closeDeliveryTerms').addEventListener('click',()=>$('#deliveryTermsDialog').close());
  $('#deliveryTermsForm').addEventListener('submit',async event=>{event.preventDefault();try{await api('/api/dashboard/delivery',{method:'PUT',body:formData(event.target)});$('#deliveryTermsDialog').close();$('#analyticsDetailsDialog').close();await refreshDashboard();toast('บันทึกวันจัดซื้อแล้ว');}catch(e){toast(e.message,true);}});
  $$(".dashboard-filter-card").forEach((card) => {
    card.addEventListener("click", () => setDashboardCardFilter(card.dataset.dashboardFilter));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setDashboardCardFilter(card.dataset.dashboardFilter);
      }
    });
  });
  $("#itemSearchBtn").addEventListener("click", refreshItems);
  $("#itemSearch").addEventListener("keydown", enter(refreshItems));
  $("#itemMachineFilter").addEventListener("change", refreshItems);
  $("#receiveItemSearchBtn").addEventListener("click", renderReceiveItems);
  $("#receiveItemSearch").addEventListener("keydown", enter(renderReceiveItems));
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
  $$('[data-pr-source]').forEach(button=>button.addEventListener('click',()=>{ togglePrSource(button.dataset.prSource);renderPrSuggestions(); }));
  $("#refreshPrSuggestionsBtn").addEventListener("click", () => refreshPrSuggestions(true));
  $("#addSelectedPrBtn").addEventListener("click", addSelectedPrSuggestions);
  $("#addAllVisiblePrBtn").addEventListener("click", addAllVisiblePrSuggestions);
  $("#openManualPrDialogBtn").addEventListener("click", openManualPrDialog);
  $("#closeManualPrDialogBtn").addEventListener("click", () => $("#manualPrDialog").close());
  $("#manualPrSearchBtn").addEventListener("click", renderManualPrItems);
  $("#manualPrSearch").addEventListener("keydown", enter(renderManualPrItems));
  $("#printPrBtn").addEventListener("click", printPurchaseRequisition);
  $('#splitPrBtn').addEventListener('click',previewSupplierPrs);
  $('#closeSplitPrBtn').addEventListener('click',()=>$('#splitPrDialog').close());
  $('#confirmSplitPrBtn').addEventListener('click',submitSupplierPrs);
  $("#submitPrBtn").addEventListener("click", submitPurchaseRequisition);
  $("#refreshPrRequestsBtn").addEventListener("click", refreshPurchaseRequisitions);
  $("#clearPrBtn").addEventListener("click", clearPurchaseRequisition);
  $("#cancelEditPrBtn").addEventListener("click", cancelPurchaseRequisitionEdit);

  const itemForm = $("#itemForm");
  itemForm.addEventListener("submit", saveItem);
  itemForm.has_sub_unit.addEventListener("change", syncItemUnits);
  itemForm.unit_price.addEventListener("input", () => calcPrice("unit"));
  itemForm.main_unit_price.addEventListener("input", () => calcPrice("main"));
  itemForm.sub_per_main.addEventListener("input", () => calcPrice(itemForm.dataset.lastPrice || "unit"));
  $("#openItemFormBtn").addEventListener("click", openNewItemDialog);
  $("#cancelEditItemBtn").addEventListener("click", closeItemDialog);

  $("#receiveForm").addEventListener("submit", receiveStock);
  $("#receiveForm").lot.addEventListener("change", applySelectedLotExpiry);
  $("#closeReceiveDialogBtn").addEventListener("click", () => $("#receiveDialog").close());
  $("#printLastLabelsBtn").addEventListener("click", () => printLabels(state.lastLabels));
  $("#consumeForm").addEventListener("submit", consumeFromForm);
  $("#consumeForm").barcode.addEventListener("input", scheduleConsumeScan);

  $("#expiringForm").addEventListener("submit", saveExpiring);
  $("#brandingForm").addEventListener("submit", saveBranding);
  $("#brandingForm").logo.addEventListener("change", previewBrandingLogo);
  $("#changePasswordForm").addEventListener("submit", changeOwnPassword);
  $("#restoreForm").addEventListener("submit", restoreBackup);
  $("#clearForm").addEventListener("submit", clearDatabase);
  $("#optimizeBtn").addEventListener("click", optimizeDb);
  for(const id of ['dashboardTable','analyticsDetailsTable'])$('#'+id).addEventListener('click',event=>{const button=event.target.closest('[data-expired-dispose]');if(button)openExpiredDisposal(button.dataset.expiredDispose,button.dataset.lot,button.dataset.expiry).catch(e=>toast(e.message,true));});
  $('#cancelExpiredDisposalBtn').addEventListener('click',()=>$('#expiredDisposalDialog').close());
  $('#expiredDisposalForm').lot_index.addEventListener('change',updateExpiredDisposalBalance);
  $('#expiredDisposalForm').addEventListener('submit',saveExpiredDisposal);
  $('#cancelEditLotBtn').addEventListener('click',()=>$('#editLotDialog').close());
  $('#moreLotUnitsBtn').addEventListener('click',()=>loadLotUnits(true).catch(e=>toast(e.message,true)));
  $('#editLotForm').addEventListener('submit',async event=>{event.preventDefault();try{const old=state.managedLot,body={...formData(event.target),item_id:state.managedLotItem,lot:old.lot,expiry_date:old.expiry_date,expected_count:old.total};await stockWrite('/api/item-lots/edit',body);$('#editLotDialog').close();await openItemLots(state.managedLotItem);['dashboard','reprint','reports','pr','settings'].forEach(tab=>state.stockViewsDirty.add(tab));await refreshStock();toast('แก้ไข Lot แล้ว กรุณาพิมพ์ฉลากใหม่');}catch(e){toast(e.message,true);}});
  $('#supplierSearchBtn').addEventListener('click',()=>refreshSuppliers().catch(e=>toast(e.message,true)));
  $('#supplierSearch').addEventListener('keydown',enter(refreshSuppliers));
  $('#newSupplierBtn').addEventListener('click',()=>openSupplierForm());
  $('#cancelSupplierBtn').addEventListener('click',()=>$('#supplierDialog').close());
  $('#supplierForm').addEventListener('submit',async event=>{event.preventDefault();try{const body=formData(event.target),id=body.supplier_id;await api('/api/suppliers'+(id?'/'+encodeURIComponent(id):''),{method:id?'PUT':'POST',body});$('#supplierDialog').close();await Promise.all([refreshSuppliers(),refreshItems(),refreshDashboard()]);toast('บันทึก Supplier แล้ว');}catch(e){toast(e.message,true);}});
  $("#userForm").addEventListener("submit", saveUser);
  setDefaultReportDates();
  setDefaultPrMeta();
}

function showApp() {
  showPendingStockWrite();
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  $("#userLabel").textContent = `${state.user.username} (${state.user.role})`;
  if ($("#prMetaForm") && !$("#prMetaForm").requester.value) $("#prMetaForm").requester.value = state.user.username;
  $$(".admin-only").forEach((el) => el.classList.toggle("hidden", state.user.role !== "admin"));
  $$(".price-only").forEach((el) => el.classList.toggle("hidden", !canViewPrices()));
}

function switchTab(tab) {
  $$(".nav").forEach((b) => {
    const isPrParent = b.classList.contains("nav-parent") && tab === "pr-list";
    b.classList.toggle("active", b.dataset.tab === tab || isPrParent);
  });
  $$(".tab").forEach((el) => el.classList.toggle("active", el.id === tab));
  location.hash = tab;
  if (tab === "items") resizeItemsTable();
  if (tab === "suppliers") refreshSuppliers().catch(error=>toast(error.message,true));
  if (tab === "operations") refreshOperations().catch(error=>toast(error.message,true));
  if (tab === "counts") refreshCounts().catch(error=>toast(error.message,true));
  if (state.stockViewsDirty.has(tab)) {
    const refreshers = {
      dashboard: refreshDashboard,
      pr: refreshPrSuggestions,
      reprint: refreshReprintStock,
      reports: refreshReport,
      settings: async () => { await refreshSettings(); await refreshAuditMaybe(); },
    };
    if (refreshers[tab]) {
      state.stockViewsDirty.delete(tab);
      refreshers[tab]().catch((error) => { state.stockViewsDirty.add(tab); toast(error.message, true); });
    }
  }
  if (tab === "consume") setTimeout(() => $("#consumeForm").barcode.focus(), 0);
}

function showLoginError(message) {
  const el = $("#loginError");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("hidden", !message);
}

async function refreshAll() {
  await Promise.all([refreshSupplierMaster(), refreshSettings(), refreshItems(), refreshDashboard(), refreshPrSuggestions(), refreshStock(), refreshReprintStock()]);
  await Promise.all([refreshReport(), refreshPurchaseRequisitions()]);
  if (state.user.role === "admin") await Promise.all([refreshUsers(), refreshAudit()]);
  if (location.hash) switchTab(location.hash.slice(1));
}

async function refreshSettings() {
  const res = await api("/api/settings");
  if (res.subscription) {
    let banner = document.getElementById('subscriptionBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'subscriptionBanner';
      banner.className = 'panel';
      banner.setAttribute('role', 'status');
      document.querySelector('.content').prepend(banner);
    }
    const end = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(new Date(res.subscription.expires_at));
    banner.textContent = res.subscription.status === 'expired'
      ? `Subscription หมดอายุเมื่อ ${end} — ดูและส่งออกข้อมูลได้ กรุณาติดต่อผู้ให้บริการเพื่อต่ออายุ`
      : `${res.subscription.name} · ${res.subscription.status === 'trial' ? 'ทดลองใช้' : 'Subscription'} ถึง ${end}`;
  }
  state.branding = {
    lab_name: res.branding?.lab_name || "Medical Trend",
    logo_data_url: res.branding?.logo_data_url || "/logo-medical-trend.png",
  };
  applyBranding();
  $("#brandingForm").lab_name.value = state.branding.lab_name;
  $("#brandingPreview").src = state.branding.logo_data_url;
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

function applyBranding() {
  document.title = `${state.branding.lab_name} Lab Stock`;
  $$(".lab-name").forEach((el) => { el.textContent = state.branding.lab_name; });
  $$(".brand-logo").forEach((img) => { img.src = state.branding.logo_data_url; });
}

async function refreshDashboard() {
  const q = encodeURIComponent($("#dashboardSearch").value.trim());
  const selectedMachine = $("#dashboardMachineFilter").value.trim();
  const machine = encodeURIComponent(selectedMachine);
  const dates=new URLSearchParams({period:$('#dashboardPeriod').value,start:$('#dashboardStart').value,end:$('#dashboardEnd').value});
  const res = await api(`/api/dashboard?q=${q}&machine=${machine}&${dates}`);
  state.analytics=res.analytics;
  state.dashboard = res.rows;
  renderAnalytics();
  renderMachineFilter($("#dashboardMachineFilter"), res.machines || [], selectedMachine);
  $("#sumExpiringItems").textContent = res.rows.filter((row) => row.status === "EXPIRING").length;
  $("#sumExpiredItems").textContent = res.rows.filter((row) => row.status === "EXPIRED").length;
  $("#sumCriticalItems").textContent = res.rows.filter((row) => row.status === "CRITICAL").length;
  $("#sumReorderItems").textContent = res.rows.filter((row) => Number(row.qty_sub) <= Number(row.reorder_point_sub)).length;
  if (canViewPrices()) {
    $("#sumValue").textContent = money(res.total_value);
    $("#sumAgingValue").textContent = money(res.rows
      .filter((row) => ["EXPIRED", "EXPIRING"].includes(row.status))
      .reduce((sum, row) => sum + Number(row.stock_value || 0), 0));
  }
  renderDashboardCardFilterState();
  renderDashboardColumns();
  renderDashboardTable();
}

function setDashboardCardFilter(filter) {
  const next = filter || "all";
  state.dashboardCardFilter = state.dashboardCardFilter === next && next !== "all" ? "all" : next;
  renderDashboardCardFilterState();
  renderDashboardTable();
  if(!$("#dashboardStockDialog").open)$("#dashboardStockDialog").showModal();
}

function renderDashboardCardFilterState() {
  $$(".dashboard-filter-card").forEach((card) => {
    const filter = card.dataset.dashboardFilter || "all";
    card.classList.toggle("active", filter === state.dashboardCardFilter);
  });
}

function filteredDashboardRows() {
  if (state.dashboardCardFilter === "expiring") return state.dashboard.filter((row) => row.status === "EXPIRING");
  if (state.dashboardCardFilter === "expired") return state.dashboard.filter((row) => row.status === "EXPIRED");
  if (state.dashboardCardFilter === "critical") return state.dashboard.filter((row) => row.status === "CRITICAL");
  if (state.dashboardCardFilter === "reorder") return state.dashboard.filter((row) => Number(row.qty_sub) <= Number(row.reorder_point_sub));
  if (state.dashboardCardFilter === "aging") return state.dashboard.filter((row) => ["EXPIRED", "EXPIRING"].includes(row.status));
  return state.dashboard;
}

function renderDashboardTable() {
  const rows=filteredDashboardRows(),columns=dashboardVisibleColumns();if(rows.some(row=>row.status==='EXPIRED'))columns.push(['dispose_action','ตัดทิ้ง']);
  renderTable($("#dashboardTable"), columns, rows, {
    dispose_action:(_,row)=>row.status==='EXPIRED'?expiredDisposeButton(row.item_id):'',
    status: (v) => `<span class="badge ${v}">${v}</span>`,
    unit_price: money, main_unit_price: money, stock_value: money,
  }, (row) => row.status);
  applyDashboardColumnVisibility();
}

function renderDashboardColumns() {
  const host = $("#dashboardColumns");
  const visible = loadDashboardColumnPreference();
  if (host.children.length) {
    $$("input", host).forEach((box) => { box.checked = visible.has(box.dataset.col); });
    return;
  }
  host.innerHTML = dashboardVisibleColumns().map(([key, label]) =>
    `<label><input type="checkbox" data-col="${key}" ${visible.has(key) ? "checked" : ""}> ${label}</label>`
  ).join("");
  $$("input", host).forEach((box) => box.addEventListener("change", () => {
    let nextVisible = new Set($$("input:checked", host).map((b) => b.dataset.col));
    if (!nextVisible.size) {
      box.checked = true;
      nextVisible = new Set([box.dataset.col]);
    }
    saveDashboardColumnPreference(nextVisible);
    applyDashboardColumnVisibility();
  }));
}

function dashboardColumnStorageKey() {
  return `mt_dashboard_columns_${state.user?.username || "guest"}`;
}

function loadDashboardColumnPreference() {
  const all = dashboardVisibleColumns().map(([key]) => key);
  try {
    const saved = JSON.parse(localStorage.getItem(dashboardColumnStorageKey()) || "null");
    const valid = Array.isArray(saved) ? saved.filter((key) => all.includes(key)) : [];
    return new Set(valid.length ? valid : all);
  } catch {
    return new Set(all);
  }
}

function saveDashboardColumnPreference(visible) {
  localStorage.setItem(dashboardColumnStorageKey(), JSON.stringify([...visible]));
}

function applyDashboardColumnVisibility() {
  const visible = new Set($$("input:checked", $("#dashboardColumns")).map((box) => box.dataset.col));
  $$("[data-key]", $("#dashboardTable")).forEach((cell) => cell.classList.toggle("hidden", cell.dataset.key!=='dispose_action'&&!visible.has(cell.dataset.key)));
}

async function refreshItems() {
  state.stockViewsDirty.add("pr");
  const q = encodeURIComponent($("#itemSearch").value.trim());
  const selectedMachine = $("#itemMachineFilter").value.trim();
  const machine = encodeURIComponent(selectedMachine);
  const res = await api(`/api/items?q=${q}&machine=${machine}`);
  state.items = res.rows;
  renderMachineFilter($("#itemMachineFilter"), res.machines || [], selectedMachine);
  renderReceiveItems();
  renderManualPrItems();
  renderTable($("#itemsTable"), itemVisibleColumns(), state.items.map((item) => ({
    ...item,
    active_label: Number(item.is_active ?? 1) ? "Active" : "Inactive",
    sub_unit: Number(item.has_sub_unit ?? 1) ? item.sub_unit : "—",
    sub_per_main: Number(item.has_sub_unit ?? 1) ? item.sub_per_main : "—",
    actions: item.item_id,
  })), {
    active_label: (v) => `<span class="badge ${esc(v.toUpperCase())}">${esc(v)}</span>`,
    unit_price: money,
    main_unit_price: money,
    actions: (_, item) => {
      const active = Number(item.is_active ?? 1) === 1;
      return `<div class="row-actions"><button data-edit-item="${item.item_id}">แก้ไข</button><button data-item-lots="${esc(item.item_id)}">จัดการ Lot</button><button data-toggle-item="${item.item_id}" class="${active ? "warning" : "primary"}">${active ? "Inactive" : "Active"}</button><button class="danger" data-delete-item="${item.item_id}">ลบ</button></div>`;
    },
  });
  $$("[data-edit-item]").forEach((btn) => btn.addEventListener("click", () => editItem(btn.dataset.editItem)));
  $$('[data-item-lots]').forEach(button=>button.addEventListener('click',()=>openItemLots(button.dataset.itemLots).catch(e=>toast(e.message,true))));
  $$("[data-toggle-item]").forEach((btn) => btn.addEventListener("click", () => toggleItemActive(btn.dataset.toggleItem)));
  $$("[data-delete-item]").forEach((btn) => btn.addEventListener("click", () => deleteItem(btn.dataset.deleteItem)));
}

function dashboardVisibleColumns() {
  return dashboardColumns.filter(([key]) => canViewPrices() || !priceColumnKeys.has(key));
}

function itemVisibleColumns() {
  return [
    ["active_label", "สถานะ"], ["reagent_name", "ชื่อ"], ["machine", "เครื่อง"], ["main_unit", "หน่วยหลัก"], ["sub_unit", "หน่วยย่อย"],
    ["sub_per_main", "ย่อย/หลัก"], ["supplier", "Supplier"], ["lead_time_days", "Lead"],
    ["reorder_point_sub", "Safety Stock"], ["actions", "จัดการ"],
  ];
}

function canViewPrices() {
  return state.user?.role === "admin";
}

function renderMachineFilter(select, machines, selected) {
  const unique = [...new Set((machines || []).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "th"));
  const options = [`<option value="">ทุกเครื่อง</option>`].concat(
    unique.map((machine) => `<option value="${esc(machine)}" ${machine === selected ? "selected" : ""}>${esc(machine)}</option>`)
  );
  if (selected && !unique.includes(selected)) {
    options.push(`<option value="${esc(selected)}" selected>${esc(selected)}</option>`);
  }
  select.innerHTML = options.join("");
}

function renderReceiveItems() {
  const q = ($("#receiveItemSearch")?.value || "").trim().toLowerCase();
  const rows = state.items.filter((item) => Number(item.is_active ?? 1) === 1).filter((item) => !q
    || String(item.reagent_name || "").toLowerCase().includes(q)
    || String(item.machine || "").toLowerCase().includes(q)
    || String(item.supplier || "").toLowerCase().includes(q));
  renderTable($("#receiveItemsTable"), [
    ["reagent_name", "ชื่อ"], ["machine", "เครื่อง"], ["main_unit", "หน่วยหลัก"], ["sub_unit", "หน่วยย่อย"],
    ["sub_per_main", "ย่อย/หลัก"], ["supplier", "Supplier"], ["actions", "รับเข้า"],
  ], rows.map((item) => ({ ...item, actions: item.item_id })), {
    actions: (_, item) => `<button data-receive-item="${esc(item.item_id)}" type="button">รับเข้า</button>`,
  });
  $$("[data-receive-item]").forEach((btn) => btn.addEventListener("click", () => openReceiveDialog(btn.dataset.receiveItem)));
}

async function openReceiveDialog(itemId) {
  const item = state.items.find((row) => row.item_id === itemId);
  if (!item) return toast("ไม่พบรายการสินค้า", true);
  const form = $("#receiveForm");
  form.reset();
  form.item_id.value = item.item_id;
  form.quantity.value = 1;
  form.unit_mode.value = "sub";
  form.sticker_mode.value = "sub";
  $("#receiveDialogTitle").textContent = `รับเข้า: ${item.reagent_name}`;
  $("#receiveDialogMeta").textContent = `${item.machine || "-"} | ${item.main_unit || "-"} / ${item.sub_unit || "-"} | Supplier: ${item.supplier || "-"}`;
  const enabled = Number(item.has_sub_unit ?? 1) === 1;
  form.unit_mode.innerHTML = enabled ? `<option value="sub">${esc(item.sub_unit)}</option><option value="main">${esc(item.main_unit)}</option>` : `<option value="main">${esc(item.main_unit)}</option>`;
  form.sticker_mode.innerHTML = enabled ? '<option value="sub">หน่วยย่อยหลายดวง</option><option value="main">หน่วยหลัก 1 ดวง</option>' : '<option value="sub">หน่วยหลักแยกดวง</option>';
  await refreshLotOptions();
  await refreshReceiptLines(itemId);
  $("#receiveDialog").showModal();
  form.quantity.focus();
}

async function refreshStock() {
  state.stockViewsDirty.add("pr");
  const q = encodeURIComponent($("#stockSearch").value.trim());
  const res = await api(`/api/stock/available?q=${q}`);
  state.stock = res.rows;
  renderStock();
}

function renderStock() {
  renderTable($("#stockTable"), [
    ["barcode", "QR code"], ["reagent_name", "ชื่อ"], ["lot", "Lot"], ["expiry_date", "Expire"],
    ["quantity_sub", "จำนวน"], ["sub_unit", "หน่วย"], ["received_at", "รับเมื่อ"], ["actions", "ตัดออก"],
  ], state.stock.map((row) => ({ ...row, actions: row.barcode })), {
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
    ["quantity_sub", "จำนวน"], ["sub_unit", "หน่วย"], ["type", "ประเภท"], ["actions", "พิมพ์"],
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
  renderTable($("#reportTable"), reportColumns(res.report_type), res.rows.map((row) => ({
    ...row,
    type_label: workflowTypeLabel(row.type)+(row.reversed_by?" (กลับรายการแล้ว)":""),
  })));
}

function reportColumns(reportType) {
  const columns = [
    ["timestamp", "เวลา"], ["type_label", "ประเภท"], ["reagent_name", "ชื่อ"], ["lot", "Lot"],
    ["barcode", "QR code"], ["quantity_sub", "จำนวน"], ["display_unit", "หน่วย"], ["operator_username", "ผู้ทำรายการ"], ["operator_note", "Note"],
  ];
  return reportType === "receive" ? columns.filter(([key]) => key !== "barcode") : columns;
}

async function setReportType(type) {
  const form = $("#reportForm");
  form.type.value = ["receive","consume","dispose","adjustment","all"].includes(type)?type:"receive";
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
  const labName = state.branding.lab_name;
  const logoSrc = state.branding.logo_data_url;
  const title = ({receive:"รายงานรับเข้า",consume:"รายงานนำไปใช้",dispose:"รายงานตัดทิ้ง",adjustment:"รายงานปรับยอด",all:"ประวัติการเคลื่อนไหว"})[meta.report_type]||"รายงาน";
  const showBarcode = meta.report_type !== "receive";
  const rows = state.reportRows.map((row) => `
    <tr>
      <td>${esc(formatDateTime(row.timestamp))}</td>
      <td>${esc(workflowTypeLabel(row.type))}${row.reversed_by?" (กลับรายการแล้ว)":""}</td>
      <td>${esc(row.reagent_name)}</td>
      <td>${esc(row.lot)}</td>
      ${showBarcode ? `<td>${esc(row.barcode)}</td>` : ""}
      <td>${esc(row.quantity_sub)} ${esc(row.display_unit||"")}</td>
      <td>${esc(row.operator_username)}</td>
      <td>${esc(row.operator_note)}</td>
    </tr>`).join("");
  const barcodeHeader = showBarcode ? "<th>QR code</th>" : "";
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
    <header><img src="${esc(logoSrc)}" alt=""><div><h1>${title}</h1><p>${esc(labName)}</p><p>ช่วงวันที่ ${esc(meta.from || "")} ถึง ${esc(meta.to || "")}</p></div></header>
    <div class="summary"><span>จำนวนรายการ: ${esc(meta.summary?.rows || 0)}</span><span>ผลรวมแยกหน่วย (ไม่รวมรายการที่กลับแล้ว): ${esc(Object.entries(meta.summary?.totals_by_unit||{}).map(([unit,qty])=>`${qty} ${unit}`).join(" / "))}</span><span>จำนวนชนิดสินค้า: ${esc(meta.summary?.items || 0)}</span></div>
    <table><thead><tr><th>เวลา</th><th>ประเภท</th><th>ชื่อ</th><th>Lot</th>${barcodeHeader}<th>จำนวน / หน่วย</th><th>ผู้ทำรายการ</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>
    </body></html>`);
  win.document.close();
}

async function refreshPrSuggestions(notify=false) {
  const res=await api('/api/pr-suggestions');
  state.prSuggestionRows=res.rows||[];
  renderPrSuggestions();
  if(notify)toast("รีเฟรชรายการแนะนำแล้ว");
}

function renderPrSuggestions() {
  $$('[data-pr-source]').forEach(button=>button.setAttribute('aria-pressed',String(prSources().has(button.dataset.prSource))));
  const table = $("#prSuggestedTable");
  if (!table) return;
  const rows = suggestedPrRows();
  renderTable(table, [
    ["select", ""], ["status", "สถานะ"], ["name", "ชื่อ"], ["qty_main_display", "Stock ปัจจุบัน"], ["order_qty", "จำนวนสั่ง"], ["actions", "เพิ่ม"],
  ], rows.map((row) => ({
    ...row,
    select: row.item_id,
    order_qty: state.prSuggestionQuantities?.[row.item_id] ?? defaultPrQty(row),
    unit: row.main_unit || row.sub_unit || "",
    reason: prReason(row),
    actions: row.item_id,
  })), {
    select: (_, row) => `<input class="row-check pr-suggest-check" type="checkbox" value="${esc(row.item_id)}">`,
    status: (v) => `<span class="badge ${v}">${v}</span>`,
    name: (v,row)=>`<button type="button" class="pr-detail-link" data-pr-suggest-detail="${esc(row.item_id)}" aria-label="ดูรายละเอียด ${esc(v)}">${esc(v)}</button>`,
    order_qty: (v, row) => `<div class="pr-suggest-quantity"><input class="table-input pr-suggest-qty" aria-label="จำนวนสั่ง ${esc(row.name)}" data-pr-qty="${esc(row.item_id)}" type="number" min="1" step="1" value="${esc(v)}"><span>${esc(row.main_unit||row.sub_unit||'')}</span></div>`,
    actions: (_, row) => `<button data-add-pr-suggest="${esc(row.item_id)}" type="button">เพิ่ม</button>`,
  }, (row) => row.status);
  $$('[data-pr-qty]',table).forEach(input=>input.addEventListener('input',()=>{state.prSuggestionQuantities??={};state.prSuggestionQuantities[input.dataset.prQty]=input.value;}));
  $$('[data-pr-suggest-detail]',table).forEach(button=>button.addEventListener('click',()=>openPrSuggestionDetails(button.dataset.prSuggestDetail)));
  $$("[data-add-pr-suggest]").forEach((btn) => btn.addEventListener("click", () => addPrSuggestion(btn.dataset.addPrSuggest)));
}

function prSources(){
 return new Set(($('#prSource')?.value??'expiring').split(',').filter(value=>['expiring','reorder_point','reorder'].includes(value)));
}
function togglePrSource(source){
 const selected=prSources();if(selected.has(source))selected.delete(source);else selected.add(source);
 $('#prSource').value=[...selected].join(',');
}
function suggestedPrRows() {
  const sources=prSources();
  const drafted=new Set(state.prRows.map(row=>row.item_id).filter(Boolean));
  return state.prSuggestionRows.filter((row) => {
    if(drafted.has(row.item_id))return false;
    const expiring = ["EXPIRING", "EXPIRED"].includes(row.status);
    const reorder = ["REORDER", "CRITICAL"].includes(row.status);
    return (sources.has('expiring')&&expiring)||(sources.has('reorder_point')&&row.status==='REORDER')||(sources.has('reorder')&&reorder);
  });
}

function addSelectedPrSuggestions() {
  const ids = $$(".pr-suggest-check:checked").map((box) => box.value);
  if (!ids.length) return toast("กรุณาเลือกรายการที่ต้องการเพิ่มเข้าใบ PR", true);
  ids.forEach(id=>addPrSuggestion(id,false));
  renderPurchaseRequisition();
  toast("เพิ่มรายการที่เลือกเข้าใบ PR แล้ว");
}

function addAllVisiblePrSuggestions() {
  const rows = suggestedPrRows();
  if (!rows.length) return toast("ไม่มีรายการแนะนำที่แสดงอยู่", true);
  rows.forEach((row) => addPrSuggestion(row.item_id,false));
  renderPurchaseRequisition();
  toast(`เพิ่มรายการทั้งหมดที่แสดงเข้าใบ PR แล้ว (${rows.length} รายการ)`);
}

function addPrSuggestion(itemId,refresh=true) {
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
  if(refresh)renderPurchaseRequisition();
}

function openManualPrDialog() {
  $("#manualPrSearch").value = "";
  renderManualPrItems();
  $("#manualPrDialog").showModal();
  $("#manualPrSearch").focus();
}

function renderManualPrItems() {
  const q = ($("#manualPrSearch")?.value || "").trim().toLowerCase();
  const rows = state.items.filter((item) => Number(item.is_active ?? 1) === 1).filter((item) => !q
    || String(item.reagent_name || "").toLowerCase().includes(q)
    || String(item.machine || "").toLowerCase().includes(q)
    || String(item.supplier || "").toLowerCase().includes(q));
  const columns = [
    ["reagent_name", "ชื่อสินค้า"], ["machine", "เครื่อง"], ["supplier", "Supplier"], ["order_qty", "จำนวน"],
    ["unit", "หน่วย"], ["unit_price", "ราคา"], ["reason", "เหตุผล"], ["actions", "เลือก"],
  ].filter(([key]) => canViewPrices() || !priceColumnKeys.has(key));
  renderTable($("#manualPrTable"), columns, rows.map((item) => ({
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
  $("#splitPrBtn")?.classList.toggle("hidden",Boolean(state.editingPrId));
  const columns = [
    ["name", "ชื่อสินค้า"], ["supplier", "Supplier"], ["current_stock", "Stock ปัจจุบัน"], ["lot", "Lot"],
    ["expiry", "Expire"], ["order_qty", "จำนวนสั่ง"], ["unit", "หน่วย"], ["unit_price", "ราคาประมาณ"],
    ["total", "รวม"], ["reason", "เหตุผล"], ["actions", "ลบ"],
  ].filter(([key]) => canViewPrices() || !priceColumnKeys.has(key));
  renderTable($("#prTable"), columns, state.prRows.map((row) => ({
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
  renderPrSuggestions();
}

function updatePrRow(e) {
  const row = state.prRows.find((item) => item.id === e.target.dataset.prEdit);
  if (!row) return;
  const field = e.target.dataset.field;
  row[field] = ["order_qty", "unit_price"].includes(field) ? Number(e.target.value || 0) : e.target.value;
}

function deletePrRow(id) {
  const removed=state.prRows.find(row=>row.id===id);if(removed?.item_id){state.prSuggestionQuantities??={};state.prSuggestionQuantities[removed.item_id]=removed.order_qty;}
  state.prRows = state.prRows.filter((row) => row.id !== id);
  renderPurchaseRequisition();
}

async function clearPurchaseRequisition() {
  if (!state.prRows.length) return;
  if (!(await confirmBox("ล้างใบ PR", "ต้องการลบรายการทั้งหมดในใบ PR นี้ใช่ไหม?"))) return;
  state.prRows = [];
  renderPurchaseRequisition();
}

async function refreshPurchaseRequisitions() {
  const res = await api("/api/purchase-requisitions");
  state.prRequests = res.rows || [];
  const columns = [
    ["pr_no", "เลขที่ PR"], ["status", "สถานะ"], ["request_date", "วันที่ขอซื้อ"], ["requester", "ผู้ขอซื้อ"],
    ["department", "แผนก"], ["requested_by", "ส่งโดย"], ["approved_by", "อนุมัติโดย"], ["approved_at", "อนุมัติเมื่อ"],
    ["total_value", "มูลค่า"], ["actions", "จัดการ"],
  ].filter(([key]) => canViewPrices() || !priceColumnKeys.has(key));
  renderTable($("#prRequestsTable"), columns, state.prRequests.map((row) => ({ ...row, actions: row.pr_id })), {
    status: (v) => `<span class="badge ${esc(v)}">${esc(v)}</span>`,
    total_value: money,
    actions: (_, row) => prRequestActions(row),
  }, (row) => row.status);
  $$("[data-approve-pr]").forEach((btn) => btn.addEventListener("click", () => approvePurchaseRequisition(btn.dataset.approvePr)));
  $$("[data-unapprove-pr]").forEach((btn) => btn.addEventListener("click", () => unapprovePurchaseRequisition(btn.dataset.unapprovePr)));
  $$("[data-receive-pr]").forEach(btn=>btn.addEventListener("click",()=>openPrReceiving(btn.dataset.receivePr)));
  $$("[data-print-pr]").forEach((btn) => btn.addEventListener("click", () => printSavedPurchaseRequisition(btn.dataset.printPr)));
  $$("[data-edit-pr-request]").forEach((btn) => btn.addEventListener("click", () => editPurchaseRequisition(btn.dataset.editPrRequest)));
  $$("[data-delete-pr-request]").forEach((btn) => btn.addEventListener("click", () => deletePurchaseRequisition(btn.dataset.deletePrRequest)));
}

function prRequestActions(row) {
  const isAdmin = canViewPrices();
  const canEdit = row.status === "PENDING" && (isAdmin || row.requested_by === state.user?.username);
  const canDelete = row.status === "PENDING" && (isAdmin || row.requested_by === state.user?.username);
  const approve = row.status === "PENDING" ? `<button data-approve-pr="${esc(row.pr_id)}" type="button">อนุมัติ</button>` : "";
  const unapprove = row.status === "APPROVED" && !row.has_receipt_history ? `<button class="warning" data-unapprove-pr="${esc(row.pr_id)}" type="button">ถอยอนุมัติ</button>` : "";
  const receive = row.status==='APPROVED' ? `<button data-receive-pr="${esc(row.pr_id)}">รับของ / ดูยอดค้างรับ</button>` : '';
  const print = isAdmin ? `<button data-print-pr="${esc(row.pr_id)}" type="button">พิมพ์</button>` : "";
  const edit = canEdit ? `<button data-edit-pr-request="${esc(row.pr_id)}" type="button">แก้ไข</button>` : "";
  const remove = canDelete ? `<button class="danger" data-delete-pr-request="${esc(row.pr_id)}" type="button">ลบ</button>` : "";
  return `<div class="row-actions">${isAdmin ? approve + unapprove : ""}${receive}${print}${edit}${remove}</div>`;
}

function supplierPrGroups(rows,suppliers){
 const groups=new Map();
 for(const row of rows){
  const supplier=suppliers.find(s=>!s.is_placeholder&&Number(s.is_active)&&s.name.toLowerCase()===String(row.supplier||'').trim().toLowerCase());
  if(!supplier)throw new Error(`กรุณากำหนด Supplier ที่เปิดใช้งานให้ ${row.name||'รายการสินค้า'}`);
  if(!Number.isFinite(Number(row.order_qty))||Number(row.order_qty)<=0)throw new Error(`จำนวนสั่งของ ${row.name} ต้องมากกว่าศูนย์`);
  if(!groups.has(supplier.supplier_id))groups.set(supplier.supplier_id,{supplier:supplier.name,rows:[]});
  groups.get(supplier.supplier_id).rows.push(row);
 }
 return [...groups.values()];
}
function previewSupplierPrs(){
 try{
  if(state.editingPrId)throw new Error('การแยก Supplier ใช้สำหรับสร้าง PR ใหม่ กรุณาจบการแก้ไขใบเดิมก่อน');
  if(!state.prRows.length)throw new Error('กรุณาเพิ่มรายการในใบ PR ก่อน');
  const groups=supplierPrGroups(state.prRows,state.suppliers||[]),meta=formData($('#prMetaForm'));
  const body={...meta,items:JSON.parse(JSON.stringify(state.prRows))};
  const payload=JSON.stringify(body);
  if(state.splitPrPayload!==payload){state.splitPrPayload=payload;state.splitPrRequest={...body,request_id:crypto.randomUUID()};}
  $('#splitPrPreview').innerHTML=`<p>สร้าง ${groups.length} ใบ · ${state.prRows.length} รายการ${meta.pr_no?' · เลขเอกสาร '+esc(meta.pr_no)+'-01, -02, …':' · ระบบออกเลข PR อัตโนมัติ'}</p>`+groups.map(group=>`<section class="panel"><h4>${esc(group.supplier)} · ${group.rows.length} รายการ</h4><ul>${group.rows.map(row=>`<li>${esc(row.name)} — ${esc(row.order_qty)} ${esc(row.unit)}</li>`).join('')}</ul></section>`).join('');
  $('#splitPrError').textContent='';$('#splitPrDialog').showModal();
 }catch(error){toast(error.message,true);}
}
async function submitSupplierPrs(){
 const button=$('#confirmSplitPrBtn');if(button.disabled)return;button.disabled=true;$('#closeSplitPrBtn').disabled=true;
 try{
  const result=await api('/api/purchase-requisitions/split',{method:'POST',body:state.splitPrRequest});
  $('#splitPrDialog').close();state.splitPrRequest=null;state.splitPrPayload='';resetPurchaseRequisitionEditor();
  toast(`สร้าง PR แยก Supplier ${result.rows.length} ใบ เพื่อรออนุมัติแล้ว`);
  await Promise.all([refreshPurchaseRequisitions(),refreshAuditMaybe()]);
 }catch(error){$('#splitPrError').textContent=error.message+' · สามารถกดยืนยันเพื่อลองอีกครั้งได้';}
 finally{button.disabled=false;$('#closeSplitPrBtn').disabled=false;}
}

async function submitPurchaseRequisition() {
  if (!state.prRows.length) return toast("กรุณาเพิ่มรายการในใบ PR ก่อนส่งอนุมัติ", true);
  const meta = formData($("#prMetaForm"));
  const editing = Boolean(state.editingPrId);
  const path = editing ? `/api/purchase-requisitions/${encodeURIComponent(state.editingPrId)}` : "/api/purchase-requisitions";
  const res = await api(path, { method: editing ? "PUT" : "POST", body: { ...meta, items: state.prRows } });
  resetPurchaseRequisitionEditor();
  await Promise.all([refreshPurchaseRequisitions(), refreshAuditMaybe()]);
  toast(editing ? `บันทึกแก้ไขใบ PR ${res.pr_no} แล้ว` : `ส่งใบ PR ${res.pr_no} เพื่อรออนุมัติแล้ว`);
}

async function approvePurchaseRequisition(prId) {
  const row = state.prRequests.find((item) => item.pr_id === prId);
  if (!row) return;
  if (!(await confirmBox("อนุมัติใบ PR", `อนุมัติใบ PR ${row.pr_no} ใช่ไหม?`))) return;
  await api(`/api/purchase-requisitions/${encodeURIComponent(prId)}/approve`, { method: "PUT", body: {} });
  await Promise.all([refreshPurchaseRequisitions(), refreshAuditMaybe()]);
  toast(`อนุมัติใบ PR ${row.pr_no} แล้ว`);
}

async function unapprovePurchaseRequisition(prId) {
  const row = state.prRequests.find((item) => item.pr_id === prId);
  if (!row) return;
  if (!(await confirmBox("ยืนยันถอยการอนุมัติ", `ต้องการถอยการอนุมัติใบ PR ${row.pr_no} ใช่ไหม? สถานะจะกลับเป็น PENDING`))) return;
  await api(`/api/purchase-requisitions/${encodeURIComponent(prId)}/unapprove`, { method: "PUT", body: {} });
  await Promise.all([refreshPurchaseRequisitions(), refreshAuditMaybe()]);
  toast(`ถอยอนุมัติใบ PR ${row.pr_no} แล้ว`);
}

async function deletePurchaseRequisition(prId) {
  const row = state.prRequests.find((item) => item.pr_id === prId);
  if (!row) return;
  if (!(await confirmBox("ยืนยันลบใบ PR", `ต้องการลบใบ PR ${row.pr_no} ใช่ไหม? ลบได้เฉพาะใบที่ยังไม่ได้รับอนุมัติ`))) return;
  await api(`/api/purchase-requisitions/${encodeURIComponent(prId)}`, { method: "DELETE" });
  await Promise.all([refreshPurchaseRequisitions(), refreshAuditMaybe()]);
  toast(`ลบใบ PR ${row.pr_no} แล้ว`);
}

function editPurchaseRequisition(prId) {
  const row = state.prRequests.find((item) => item.pr_id === prId);
  if (!row) return;
  state.editingPrId = prId;
  const form = $("#prMetaForm");
  form.pr_no.value = row.pr_no || "";
  form.request_date.value = row.request_date || todayText();
  form.requester.value = row.requester || state.user?.username || "";
  form.department.value = row.department || "Laboratory";
  state.prRows = (row.items || []).map((item) => ({
    id: nextClientId("PRE"),
    item_id: item.item_id || "",
    name: item.item_name || "",
    supplier: item.supplier || "",
    order_qty: Number(item.order_qty || 0),
    unit: item.unit || "",
    unit_price: Number(item.unit_price || 0),
    current_stock: item.current_stock || "",
    lot: item.lot || "",
    expiry: item.expiry || "",
    reason: item.reason || "",
    source: item.source || "edit",
  }));
  $("#prEditBanner").textContent = `กำลังแก้ไขใบ PR ${row.pr_no}${row.status === "APPROVED" ? " (อนุมัติแล้ว)" : ""}`;
  $("#prEditBanner").classList.remove("hidden");
  $("#cancelEditPrBtn").classList.remove("hidden");
  $("#submitPrBtn").textContent = "บันทึกแก้ไขใบ PR";
  renderPurchaseRequisition();
  switchTab("pr");
}

function cancelPurchaseRequisitionEdit() {
  resetPurchaseRequisitionEditor();
  toast("ยกเลิกการแก้ไขใบ PR แล้ว");
}

function printSavedPurchaseRequisition(prId) {
  const row = state.prRequests.find((item) => item.pr_id === prId);
  if (!row) return;
  printPrDocument({
    pr_no: row.pr_no,
    request_date: row.request_date,
    requester: row.requester,
    department: row.department,
    approver: row.approver || row.approved_by,
    status: row.status,
    approved_by: row.approved_by,
    approved_at: row.approved_at,
  }, (row.items || []).map((item) => ({
    ...item,
    name: item.item_name,
    expiry: item.expiry,
  })));
}

function printPurchaseRequisition() {
  if (!state.prRows.length) return toast("กรุณาเพิ่มรายการในใบ PR ก่อนพิมพ์", true);
  printPrDocument(formData($("#prMetaForm")), state.prRows);
}

function printPrDocument(meta, rowsData) {
  const labName = state.branding.lab_name;
  const logoSrc = state.branding.logo_data_url;
  const prNo = meta.pr_no || `PR-${dateInput(new Date()).replaceAll("-", "")}-${String(Date.now()).slice(-4)}`;
  const showPrices = canViewPrices();
  const total = showPrices ? rowsData.reduce((sum, row) => sum + Number(row.order_qty || 0) * Number(row.unit_price || 0), 0) : 0;
  const rows = rowsData.map((row, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${esc(row.name)}</td>
      <td>${esc(row.supplier)}</td>
      <td>${esc(row.current_stock)}</td>
      <td>${esc(row.lot)}</td>
      <td>${esc(row.expiry)}</td>
      <td>${esc(row.order_qty)}</td>
      <td>${esc(row.unit)}</td>
      ${showPrices ? `<td>${money(row.unit_price)}</td><td>${money(Number(row.order_qty || 0) * Number(row.unit_price || 0))}</td>` : ""}
      <td>${esc(row.reason)}</td>
    </tr>`).join("");
  const priceHeaders = showPrices ? "<th>ราคา/หน่วย</th><th>รวม</th>" : "";
  const totalBlock = showPrices ? `<div class="total">รวมประมาณ: ${money(total)}</div>` : "";
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
    <header><img src="${esc(logoSrc)}" alt=""><div><h1>Purchase Requisition</h1><p>${esc(labName)} Lab Stock</p></div></header>
    <section class="meta">
      <div><strong>เลขที่ PR:</strong> ${esc(prNo)}</div>
      <div><strong>วันที่ขอซื้อ:</strong> ${esc(meta.request_date || dateInput(new Date()))}</div>
      <div><strong>แผนก:</strong> ${esc(meta.department || "")}</div>
      <div><strong>ผู้ขอซื้อ:</strong> ${esc(meta.requester || state.user?.username || "")}</div>
      <div><strong>ผู้อนุมัติ:</strong> ${esc(meta.approver || "")}</div>
      <div><strong>สถานะ:</strong> ${esc(meta.status || "DRAFT")}</div>
      <div><strong>อนุมัติโดย:</strong> ${esc(meta.approved_by || "")}</div>
      <div><strong>อนุมัติเมื่อ:</strong> ${esc(formatDateTime(meta.approved_at || ""))}</div>
    </section>
    <table><thead><tr><th>#</th><th>รายการ</th><th>Supplier</th><th>Stock</th><th>Lot</th><th>Exp</th><th>จำนวน</th><th>หน่วย</th>${priceHeaders}<th>เหตุผล</th></tr></thead><tbody>${rows}</tbody></table>
    ${totalBlock}
    <section class="signatures"><div class="sign">ผู้สั่งซื้อ / ผู้ขอซื้อ</div><div class="sign">ผู้บริหาร / ผู้อนุมัติ</div></section>
    </body></html>`);
  win.document.close();
}

function setDefaultPrMeta() {
  const form = $("#prMetaForm");
  form.request_date.value = todayText();
  form.requester.value = state.user?.username || "";
  form.pr_no.value = "";
  form.department.value = form.department.value || "Laboratory";
  renderPurchaseRequisition();
}

function resetPurchaseRequisitionEditor() {
  state.editingPrId = "";
  state.prRows = [];
  $("#prEditBanner").textContent = "";
  $("#prEditBanner").classList.add("hidden");
  $("#cancelEditPrBtn").classList.add("hidden");
  $("#submitPrBtn").textContent = "ส่งใบ PR เพื่ออนุมัติ";
  setDefaultPrMeta();
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
  data.has_sub_unit = form.has_sub_unit.checked ? 1 : 0;
  if (!data.has_sub_unit) { data.sub_unit = data.main_unit; data.sub_per_main = 1; data.unit_price = data.main_unit_price; }
  if (data.item_id) {
    await api(`/api/items/${encodeURIComponent(data.item_id)}`, { method: "PUT", body: data });
    toast("บันทึกแก้ไขรายการสินค้าแล้ว");
  } else {
    await api("/api/items", { method: "POST", body: data });
    toast("เพิ่มรายการสินค้าแล้ว");
  }
  resetItemForm();
  $("#itemDialog").close();
  await Promise.all([refreshItems(), refreshDashboard(), refreshSuppliers()]);
}

function openNewItemDialog() {
  resetItemForm();
  renderSupplierOptions('');
  $("#itemDialogTitle").textContent = "เพิ่มสินค้าใหม่";
  $("#itemDialog").showModal();
  $("#itemForm").reagent_name.focus();
}

function editItem(id) {
  const item = state.items.find((x) => x.item_id === id);
  const form = $("#itemForm");
  renderSupplierOptions(item.supplier_id);
  Object.entries(item).forEach(([k, v]) => { if (form[k]) form[k].value = v ?? ""; });
  form.item_id.value = id;
  form.has_sub_unit.checked = Number(item.has_sub_unit ?? 1) === 1;
  syncItemUnits();
  $("#saveItemBtn").textContent = "บันทึกแก้ไขรายการ";
  $("#itemDialogTitle").textContent = "แก้ไขรายการสินค้า";
  $("#itemDialog").showModal();
  form.reagent_name.focus();
}

async function deleteItem(id) {
  const item = state.items.find((x) => x.item_id === id);
  if (!(await confirmBox("ยืนยันลบรายการสินค้า", `ต้องการลบ ${item?.reagent_name || id} ใช่ไหม?`))) return;
  await api(`/api/items/${encodeURIComponent(id)}`, { method: "DELETE" });
  await Promise.all([refreshItems(), refreshDashboard()]);
  toast("ลบรายการแล้ว");
}

async function toggleItemActive(id) {
  const item = state.items.find((x) => x.item_id === id);
  const active = Number(item?.is_active ?? 1) === 1;
  const nextText = active ? "Inactive" : "Active";
  const message = active
    ? `ตั้ง ${item?.reagent_name || id} เป็น Inactive ใช่ไหม? รายการนี้จะไม่แสดงใน Dashboard และไม่ถูกคำนวณสถานะ/มูลค่า Stock`
    : `เปิด ${item?.reagent_name || id} กลับมาเป็น Active ใช่ไหม? รายการนี้จะกลับไปคำนวณใน Dashboard ตามปกติ`;
  if (!(await confirmBox(`ยืนยัน ${nextText} รายการสินค้า`, message))) return;
  await api(`/api/items/${encodeURIComponent(id)}/active`, { method: "PUT", body: { is_active: active ? 0 : 1 } });
  await Promise.all([refreshItems(), refreshDashboard(), refreshStock(), refreshReprintStock(), refreshAuditMaybe()]);
  toast(`เปลี่ยนสถานะเป็น ${nextText} แล้ว`);
}

function resetItemForm() {
  $("#itemForm").reset();
  $("#itemForm").item_id.value = "";
  $("#itemForm").machine.value = "Manual";
  $("#itemForm").sub_per_main.value = 1;
  $("#itemForm").unit_price.value = 0;
  $("#itemForm").main_unit_price.value = 0;
  $("#itemForm").has_sub_unit.checked = false;
  syncItemUnits();
  $("#saveItemBtn").textContent = "บันทึกรายการ";
  $("#itemDialogTitle").textContent = "เพิ่มสินค้าใหม่";
}

function closeItemDialog() {
  resetItemForm();
  $("#itemDialog").close();
}

function resizeItemsTable() {
  const items = $("#items");
  if (items?.classList.contains("active")) items.style.setProperty("--items-top", `${items.getBoundingClientRect().top}px`);
}
window.addEventListener("resize", resizeItemsTable);

function syncItemUnits() {
  const form = $("#itemForm");
  const enabled = form.has_sub_unit.checked;
  $$('[data-sub-unit-field]', form).forEach((label) => { label.hidden = !enabled; });
  form.sub_unit.disabled = !enabled;
  form.sub_per_main.disabled = !enabled;
  form.unit_price.disabled = !enabled;
  form.sub_unit.required = enabled;
  form.sub_per_main.required = enabled;
  if (!enabled) { form.sub_per_main.value = 1; form.unit_price.value = form.main_unit_price.value; }
}

function calcPrice(mode) {
  const form = $("#itemForm");
  form.dataset.lastPrice = mode;
  const factor = form.has_sub_unit.checked ? Math.max(1, Number(form.sub_per_main.value || 1)) : 1;
  if (mode === "unit") {
    form.main_unit_price.value = (Number(form.unit_price.value || 0) * factor).toFixed(2);
  } else {
    form.unit_price.value = (Number(form.main_unit_price.value || 0) / factor).toFixed(2);
  }
}

async function receiveStock(e) {
  e.preventDefault();
  try {
  const res = await stockWrite("/api/receive", formData(e.target));
  state.lastLabels = res.labels;
  $("#lastLabels").classList.remove("hidden");
  $("#lastLabelsList").innerHTML = res.labels.map((l) => `<span class="chip">${esc(l.code)} ${l.type === "main" ? "(หน่วยหลัก)" : ""}</span>`).join("");
  $("#receiveDialog").close();
  await Promise.all([refreshDashboard(), refreshStock(), refreshReprintStock(), refreshLotOptions(), refreshAuditMaybe()]);
  if(e.target.pr_line_id.value) await refreshPurchaseRequisitions();
  if (await confirmBox("พิมพ์ QR code", "ต้องการเปิดหน้าพิมพ์ / Save PDF ตอนนี้ไหม?")) await printLabels(res.labels);
  } catch(error) { toast(error.message,true); }
}

async function refreshLotOptions() {
  const form = $("#receiveForm");
  const itemId = form.item_id.value;
  if (!itemId) {
    state.lotOptions = [];
    if ($("#lotOptions")) $("#lotOptions").innerHTML = "";
    if ($("#lotHint")) $("#lotHint").textContent = "เลือก Lot เดิมหรือพิมพ์ Lot ใหม่ได้";
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
  clearTimeout(state.consumeScanTimer);
  await consumeScannedBarcode(form);
}

function scheduleConsumeScan(e) {
  clearTimeout(state.consumeScanTimer);
  const form = e.target.form;
  const barcode = form.barcode.value.trim();
  if (barcode.length < 8 || !$("#autoScanEnabled").checked) return;
  state.consumeScanTimer = setTimeout(() => consumeScannedBarcode(form), 420);
}

async function consumeScannedBarcode(form) {
  const barcode = form.barcode.value.trim();
  if (!barcode || state.consumeScanBusy) return;
  state.consumeScanBusy = true;
  try {
    await consume({ barcode }, { scanned: true });
    form.barcode.value = "";
    form.barcode.focus();
  } finally {
    state.consumeScanBusy = false;
  }
}

async function manualConsume(code) {
  const target = state.stock.find((x) => x.barcode === code);
  let qty = target?.is_package ? Number(prompt(`QR หน่วยหลักนี้มี ${target.quantity_sub} ${target.sub_unit || "ชิ้น"} ต้องการตัดกี่ชิ้น?`, target.quantity_sub) || 0) : 1;
  if (!qty || qty < 1) return;
  if (!(await confirmBox("ยืนยันตัด Stock แบบ Manual", `ตัด ${esc(target.reagent_name)} Lot ${esc(target.lot)} จำนวน ${qty} ${esc(target.sub_unit || "")}?`))) return;
  await consume({ barcode: code, package_quantity: qty });
}

async function consume(data, options = {}) {
  if(workflowUi.consumeBusy) return toast('กำลังตรวจและบันทึกการสแกน กรุณารอ',true);
  workflowUi.consumeBusy=true;
  try {
    if (workflowUi.busy || readPendingStockWrite()) throw new Error("กรุณาตรวจรายการที่ค้างก่อนทำรายการใหม่");
    if (workflowUi.recent.some(r=>r.barcode.toLowerCase()===data.barcode.toLowerCase()&&Date.now()-r.time<10000)) {
      if (!(await confirmBox("สแกนรหัสเดิมซ้ำ", "รหัสนี้เพิ่งทำรายการใน 10 วินาทีที่ผ่านมา ต้องการตัดเพิ่มจริงหรือไม่?"))) return;
    }
    const form=$("#consumeForm"); data.kind=form.kind?.value||"CONSUME";
    data.reason=form.reason?.value.trim()||""; data.note=data.reason;
    if (data.kind==='DISPOSE' && data.reason.length<3) throw new Error("กรุณาระบุเหตุผลตัดทิ้งอย่างน้อย 3 ตัวอักษร");
    const preview = await api("/api/consume/preview", { method: "POST", body: data });
    if (preview.target.is_package && !data.package_quantity) {
      const qty = prompt(`QR หน่วยหลักนี้มี ${preview.target.quantity_sub} ${preview.target.sub_unit || "ชิ้น"} ต้องการตัดกี่ชิ้น?`, preview.target.quantity_sub);
      if (!qty) return;
      data.package_quantity = qty;
    }
    if (preview.warnings.length && data.kind!=="DISPOSE") {
      const ok = await confirmBox("แจ้งเตือน FEFO", `${preview.warnings.map(esc).join("<br>")}<br><br>ยืนยันว่าจะนำสินค้า QR นี้ออกจาก stock ไปใช้จริงหรือไม่?`);
      if (!ok) return;
      data.confirm_fefo = true;
    }
    const result = await stockWrite("/api/consume",data);
    // Keep the scanner responsive without reading the whole inventory after every scan.
    state.stock = state.stock.flatMap((row) => {
      if (row.barcode !== result.barcode && row.barcode !== result.parent_barcode) return [row];
      const remaining = result.remaining_sub;
      return remaining > 0 ? [{ ...row, quantity_sub: remaining }] : [];
    });
    ["dashboard", "pr", "reprint", "reports", "settings"].forEach((tab) => state.stockViewsDirty.add(tab));
    renderStock();
    showScanResult(result,preview.target);
    toast(options.scanned ? `ตัด Stock แล้ว: ${preview.target.reagent_name}` : "ตัด Stock แล้ว");
  } catch (error) {
    toast(error.message, true);
  } finally {
    workflowUi.consumeBusy=false;
    if (options.scanned) $("#consumeForm").barcode.focus();
  }
}

async function previewBrandingLogo(e) {
  const file = e.target.files[0];
  if (!file) {
    $("#brandingPreview").src = state.branding.logo_data_url;
    return;
  }
  try {
    const dataUrl = await readLogoFile(file);
    $("#brandingPreview").src = dataUrl;
  } catch (error) {
    e.target.value = "";
    $("#brandingPreview").src = state.branding.logo_data_url;
    toast(error.message, true);
  }
}

async function saveBranding(e) {
  e.preventDefault();
  const form = e.target;
  let logoDataUrl = state.branding.logo_data_url.startsWith("data:") ? state.branding.logo_data_url : "";
  const file = form.logo.files[0];
  if (file) logoDataUrl = await readLogoFile(file);
  const res = await api("/api/settings/branding", {
    method: "PUT",
    body: { lab_name: form.lab_name.value.trim(), logo_data_url: logoDataUrl },
  });
  state.branding = {
    lab_name: res.branding.lab_name,
    logo_data_url: res.branding.logo_data_url || "/logo-medical-trend.png",
  };
  form.logo.value = "";
  applyBranding();
  $("#brandingPreview").src = state.branding.logo_data_url;
  await refreshAuditMaybe();
  toast("บันทึก Logo / ชื่อแล็บแล้ว");
}

async function readLogoFile(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("กรุณาเลือกไฟล์ PNG, JPG หรือ WebP");
  if (file.size > 500 * 1024) throw new Error("ไฟล์โลโก้ใหญ่เกินไป กรุณาใช้ไฟล์ไม่เกิน 500 KB");
  const dataUrl = await fileToDataUrl(file);
  const size = await imageSize(dataUrl);
  if (size.width !== size.height) throw new Error("โลโก้ต้องเป็นสัดส่วน 1:1 เช่น 512x512 px");
  return dataUrl;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("อ่านไฟล์โลโก้ไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
}

function imageSize(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("ไฟล์รูปไม่ถูกต้อง"));
    img.src = src;
  });
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

async function changeOwnPassword(e) {
  e.preventDefault();
  const form = e.target;
  const data = formData(form);
  if (data.new_password !== data.confirm_password) {
    toast("รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน", true);
    return;
  }
  await api("/api/me/password", { method: "PUT", body: data });
  form.reset();
  await refreshAuditMaybe();
  toast("เปลี่ยนรหัสผ่านเรียบร้อยแล้ว");
}

async function clearDatabase(e) {
  e.preventDefault();
  if (!(await confirmBox("ลบข้อมูลใน Database ทั้งหมด", "ระบบจะลบ stock และซ่อนรายการสินค้าทั้งหมด ยืนยันทำต่อ?"))) return;
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
  try {
    const data = formData(e.target);
    if (data.user_id) await api(`/api/users/${encodeURIComponent(data.user_id)}`, { method: "PUT", body: data });
    else await api("/api/users", { method: "POST", body: data });
    resetUserForm();
    await Promise.all([refreshUsers(), refreshAuditMaybe(), refreshSettings()]);
    toast("บันทึกผู้ใช้งานแล้ว");
  } catch (error) {
    toast(error.message || "บันทึกผู้ใช้งานไม่สำเร็จ", true);
  }
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
  const wrap=table.closest('.table-wrap');if(wrap){wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','ตารางข้อมูล เลื่อนดูคอลัมน์เพิ่มเติมได้');}
  table.innerHTML = `<thead><tr>${cols.map(([k, label]) => `<th data-key="${k}">${label}</th>`).join("")}</tr></thead><tbody></tbody>`;
  const tbody = $("tbody", table);
  tbody.innerHTML = rows.map((row) => `<tr class="${rowClass ? rowClass(row) : ""}">${cols.map(([k]) => {
    const raw = row[k] ?? "";
    const value = formatters[k] ? formatters[k](raw, row) : formatDisplayValue(k, raw);
    return `<td data-key="${k}">${value}</td>`;
  }).join("")}</tr>`).join("");
  $$("th", table).forEach((th) => th.addEventListener("click", () => sortTable(table, th.cellIndex)));
}

function formatDisplayValue(key, value) {
  if (isDateTimeKey(key)) return esc(formatDateTime(value));
  if (isDateOnlyKey(key)) return esc(formatDateOnly(value));
  return esc(value);
}

function isDateTimeKey(key) {
  return ["timestamp", "created_at", "updated_at", "received_at", "used_at"].includes(key);
}

function isDateOnlyKey(key) {
  return ["expiry", "expiry_date", "request_date"].includes(key);
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
  if (!res.ok || data.ok === false) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), {status:res.status});
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
function formatDateOnly(value) {
  if (!value) return "";
  const text = String(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString("en-GB", { timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric" });
}
function formatDateTime(value) {
  if (!value) return "";
  const text = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text) ? text.replace(" ", "T") : text;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).replace(",", "");
}
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

// Durable client request IDs let a lost response be checked or retried safely.
function pendingStockKey(){ return `stock-pending:${state.user?.username||'anonymous'}`; }
function readPendingStockWrite(){
 try{return JSON.parse(localStorage.getItem(pendingStockKey())||'null');}catch{return null;}
}
function showPendingStockWrite(){
 const pending=readPendingStockWrite(),panel=$('#pendingStockWrite');
 if(!panel)return;
 panel.classList.toggle('hidden',!pending);
 if(pending)$('#pendingStockText').textContent=`${pending.path} · รหัส ${pending.body.request_id} · ${formatDateTime(pending.created_at)}`;
}
async function stockWrite(path,data){
 if(workflowUi.busy)throw new Error('กำลังบันทึก กรุณารอผล');
 if(readPendingStockWrite())throw new Error('มีรายการที่ยังไม่ยืนยันผล กรุณาตรวจสถานะหรือส่งคำขอเดิมอีกครั้ง');
 const command={path,body:{...data,request_id:crypto.randomUUID()},created_at:new Date().toISOString()};
 // Fail before sending if this browser cannot persist the recovery key.
 localStorage.setItem(pendingStockKey(),JSON.stringify(command));showPendingStockWrite();
 return sendPendingStockWrite(command);
}
async function sendPendingStockWrite(command){
 if(workflowUi.busy)throw new Error('กำลังบันทึก กรุณารอผล');
 workflowUi.busy=true;
 try{
  const result=await api(command.path,{method:'POST',body:command.body});
  localStorage.removeItem(pendingStockKey());showPendingStockWrite();return result;
 }catch(error){
  // A client validation error confirms no mutation. Server/network errors are uncertain.
  if(error.status>=400&&error.status<500){localStorage.removeItem(pendingStockKey());showPendingStockWrite();throw error;}
  try{
   const status=await api(`/api/operations/status?request_id=${encodeURIComponent(command.body.request_id)}`);
   if(status.found){localStorage.removeItem(pendingStockKey());showPendingStockWrite();return {...status.result,replayed:true};}
  }catch{}
  showPendingStockWrite();throw new Error('ยังยืนยันผลบันทึกไม่ได้ อย่าทำรายการใหม่ ให้ใช้ตรวจสถานะหรือส่งคำขอเดิมอีกครั้ง');
 }finally{workflowUi.busy=false;}
}
async function recoverPendingStockWrite(retry){
 const command=readPendingStockWrite();if(!command||workflowUi.busy)return;
 try{
  let result;
  if(retry)result=await sendPendingStockWrite(command);
  else{
   const status=await api(`/api/operations/status?request_id=${encodeURIComponent(command.body.request_id)}`);
   if(!status.found){toast('ยังไม่พบรายการที่บันทึกสำเร็จ สามารถส่งคำขอเดิมอีกครั้งได้โดยใช้ปุ่มด้านล่าง',true);return;}
   result=status.result;localStorage.removeItem(pendingStockKey());showPendingStockWrite();
  }
  if(result.labels?.length)showWorkflowLabels(result.labels);
  if(command.path==='/api/consume')showScanResult(result,{reagent_name:result.item_name});
  await refreshAll();toast('ยืนยันผลสำเร็จ · '+result.operation_id);
 }catch(error){toast(error.message,true);}
}
function showWorkflowLabels(labels){
 state.lastLabels=labels;
 $('#lastLabels').classList.remove('hidden');
 $('#lastLabelsList').innerHTML=labels.map(l=>`<span class="chip">${esc(l.code)}</span>`).join('');
 // Printing is also available after recovering a response or a count adjustment.
 const panel=$('#workflowLabels');
 if(panel){panel.hidden=!labels.length;}
}
function workflowTypeLabel(kind){return ({RECEIVE:'รับเข้า',CONSUME:'นำไปใช้',DISPOSE:'ตัดทิ้ง',ADJUSTMENT:'ปรับยอด',COUNT_DRAFT:'บันทึกผลนับ',REVERSAL:'กลับรายการ',LOT_EDIT:'แก้ไขข้อมูล Lot',REVERSAL_RECEIVE:'กลับการรับเข้า',REVERSAL_CONSUME:'คืนจากการใช้',REVERSAL_DISPOSE:'คืนจากการตัดทิ้ง',REVERSAL_ADJUSTMENT:'กลับการปรับยอด'})[kind]||kind;}
function showScanResult(result,target){
 const row={barcode:result.barcode,item:result.item_name||target.reagent_name,lot:result.lot||target.lot,quantity:result.consumed,unit:result.unit||target.sub_unit||'',time:Date.now(),kind:result.kind||'CONSUME'};
 if(!workflowUi.recent.some(r=>r.operation_id===result.operation_id))workflowUi.recent.unshift({...row,operation_id:result.operation_id});
 workflowUi.recent=workflowUi.recent.slice(0,10);
 $('#scanFeedback').textContent=`สำเร็จ: ${workflowTypeLabel(row.kind)} ${row.item} · Lot ${row.lot} · ${row.quantity} ${row.unit} · คงเหลือใน QR นี้ ${result.remaining_sub} ${row.unit}`;
 $('#recentScans').innerHTML='<strong>รายการสแกนล่าสุด (ในหน้านี้)</strong>'+workflowUi.recent.map(r=>`<p>${esc(new Date(r.time).toLocaleTimeString('th-TH'))} · ${esc(workflowTypeLabel(r.kind))} ${esc(r.item)} · Lot ${esc(r.lot)} · ${esc(r.quantity)} ${esc(r.unit)} · ${esc(r.barcode)}</p>`).join('');
}
function bindWorkflowUi(){
 const safe=fn=>async event=>{try{await fn(event);}catch(error){toast(error.message,true);}};
 $('#refreshOperationsBtn').addEventListener('click',safe(()=>refreshOperations()));
 $('#moreOperationsBtn').addEventListener('click',safe(()=>refreshOperations(true)));
 $('#refreshCountsBtn').addEventListener('click',safe(refreshCounts));
 $('#countForm').addEventListener('submit',safe(async event=>{
  event.preventDefault();if(!$('#countForm').item_id.value){$('#countItemSearch').setCustomValidity('กรุณาเลือกสินค้าจากผลการค้นหา');$('#countItemSearch').reportValidity();return;}const body=formData(event.target);
  const res=await stockWrite('/api/stock-counts',body);
  toast(`บันทึกผลนับแล้ว: ในระบบ ${res.system_qty} / นับจริง ${res.counted_qty} / ต่าง ${res.difference}`);
  await refreshCounts();
 }));
 $('#countItemSearch').addEventListener('input',safe(async()=>{
  const form=$('#countForm'),search=$('#countItemSearch');
  search.setCustomValidity('');
  const item=state.items.find(i=>Number(i.is_active??1)&&countItemLabel(i)===search.value);
  const next=item?.item_id||'';
  if(form.item_id.value===next)return;
  form.item_id.value=next;form.lot.value='';form.expiry_date.value='';
  await refreshCountLots();
 }));
 $('#countLotSelect').addEventListener('change',()=>{
  const selected=$('#countLotSelect').selectedOptions[0];
  $('#countForm').lot.value=selected.dataset.lot||'';
  $('#countForm').expiry_date.value=selected.dataset.expiry||'';
 });
 $('#checkPendingWrite').addEventListener('click',()=>recoverPendingStockWrite(false));
 $('#retryPendingWrite').addEventListener('click',()=>recoverPendingStockWrite(true));
 $('#receiveForm').pr_line_id.addEventListener('change',updateReceiptHint);
 $('#autoScanEnabled').addEventListener('change',()=>clearTimeout(state.consumeScanTimer));
 $('#consumeForm').kind.addEventListener('change',()=>{
  $('#consumeForm').reason.required=$('#consumeForm').kind.value==='DISPOSE';
  $('#consumeForm').reason.minLength=$('#consumeForm').kind.value==='DISPOSE'?3:0;
 });
 $('#printWorkflowLabels').addEventListener('click',()=>printLabels(state.lastLabels));
}
async function refreshOperations(append=false){
 const res=await api('/api/operations'+(append&&workflowUi.cursor?`?before=${encodeURIComponent(workflowUi.cursor)}`:''));
 workflowUi.operations=append?[...workflowUi.operations,...res.rows]:res.rows;workflowUi.cursor=res.next_cursor;
 $('#moreOperationsBtn').hidden=!res.next_cursor;
 renderTable($('#operationsTable'),[['created_at','เวลา'],['kind','ประเภท'],['reagent_name','สินค้า'],['lot','Lot'],['quantity','จำนวน'],['unit','หน่วย'],['username','ผู้ทำรายการ'],['reason','เหตุผล'],['operation_id','รหัสรายการ'],['action','การดำเนินการ']],workflowUi.operations,{
  kind:workflowTypeLabel,
  action:(_,row)=>`<button data-detail-operation="${esc(row.operation_id)}">ดู QR</button>`+(row.reversed_by?'กลับรายการแล้ว':state.user.role==='admin'&&['RECEIVE','CONSUME','DISPOSE','ADJUSTMENT'].includes(row.kind)?`<button data-reverse-operation="${esc(row.operation_id)}">กลับรายการ</button>`:''),
 });
 $$('[data-detail-operation]').forEach(button=>button.addEventListener('click',async()=>{
  try { const result=await api(`/api/operations/${encodeURIComponent(button.dataset.detailOperation)}/units`);$('#operationDetailsRows').innerHTML='';renderTable($('#operationDetailsRows').appendChild(document.createElement('table')),[['barcode','QR'],['after_status','สถานะหลังทำรายการ'],['current_status','สถานะปัจจุบัน']],result.rows);$('#operationDetailsDialog').showModal(); }catch(error){toast(error.message,true);}
 }));
 $$('[data-reverse-operation]').forEach(button=>button.addEventListener('click',async()=>{
  const why=prompt('ระบุเหตุผลการกลับรายการ (อย่างน้อย 3 ตัวอักษร)');if(!why)return;
  const row=workflowUi.operations.find(r=>r.operation_id===button.dataset.reverseOperation);
  if(!await confirmBox('ยืนยันกลับรายการ',`${esc(workflowTypeLabel(row.kind))} ${esc(row.reagent_name)} · Lot ${esc(row.lot)} · ${row.quantity} ${esc(row.unit)}<br>เหตุผล: ${esc(why)}<br>ระบบจะเปลี่ยนสถานะ QR และคืน/หักยอดตามรายการเดิม โดยเก็บประวัติไว้ ต้องการดำเนินการหรือไม่?`))return;
  try{await stockWrite(`/api/operations/${encodeURIComponent(button.dataset.reverseOperation)}/reverse`,{reason:why});await refreshOperations();await refreshStock();['dashboard','reprint','reports','pr','settings'].forEach(tab=>state.stockViewsDirty.add(tab));toast('กลับรายการสำเร็จ');}catch(error){toast(error.message,true);}
 }));
}
function countItemLabel(item){return `${item.reagent_name} (${item.sub_unit||item.main_unit}) · ${item.item_id}`;}
async function refreshCounts(){
 const form=$('#countForm'),selected=state.items.find(i=>i.item_id===form.item_id.value&&Number(i.is_active??1));
 $('#countItemOptions').innerHTML=state.items.filter(i=>Number(i.is_active??1)).map(item=>`<option value="${esc(countItemLabel(item))}"></option>`).join('');
 if(!selected){form.item_id.value='';$('#countItemSearch').value='';}
 else $('#countItemSearch').value=countItemLabel(selected);
 await refreshCountLots();
 const res=await api('/api/stock-counts');workflowUi.counts=res.rows;
 renderTable($('#countsTable'),[['created_at','วันที่นับ'],['reagent_name','สินค้า'],['lot','Lot'],['expiry_date','หมดอายุ'],['system_qty','ยอดระบบ ณ ตอนนับ'],['counted_qty','นับจริง'],['difference','ผลต่าง'],['unit','หน่วย'],['reason','เหตุผล'],['status','สถานะ'],['approved_by','ผู้ยืนยัน'],['actions','ยืนยัน']],res.rows.map(row=>({...row,difference:row.counted_qty-row.system_qty})),{
  status:(value,row)=>row.status==='APPROVED'?`ยืนยันแล้ว${row.reversed_by?' (กลับรายการแล้ว)':''}`:'รอยืนยัน',
  actions:(_,row)=>state.user.role==='admin'&&row.status==='PENDING'?`<button data-approve-count="${esc(row.count_id)}">ตรวจผลต่าง / ยืนยัน</button>`:'',
 });
 $$('[data-approve-count]').forEach(button=>button.addEventListener('click',async()=>{
  const row=workflowUi.counts.find(r=>r.count_id===button.dataset.approveCount);
  if(!await confirmBox('ยืนยันผลตรวจนับ',`${esc(row.reagent_name)} Lot ${esc(row.lot)}: ยอดระบบ ${row.system_qty} → นับจริง ${row.counted_qty} ${esc(row.unit)} (ผลต่าง ${row.counted_qty-row.system_qty})<br>เหตุผล: ${esc(row.reason)}<br>หากยอดเคลื่อนไประหว่างนับ ระบบจะให้ตรวจนับใหม่`))return;
  try{const result=await stockWrite(`/api/stock-counts/${encodeURIComponent(row.count_id)}/approve`,{});if(result.labels?.length){showWorkflowLabels(result.labels);if(await confirmBox('พิมพ์ QR สำหรับยอดที่เพิ่ม','ต้องการพิมพ์ QR สำหรับสินค้าที่ตรวจพบเพิ่มหรือไม่?'))await printLabels(result.labels);}await refreshCounts();await refreshStock();['dashboard','reprint','reports','pr','settings'].forEach(tab=>state.stockViewsDirty.add(tab));toast('ยืนยันผลนับแล้ว');}catch(error){toast(error.message,true);}
 }));
}
async function refreshCountLots(){
 const itemId=$('#countForm').item_id.value,item=state.items.find(i=>i.item_id===itemId);
 $('#countUnit').textContent=item?.sub_unit||item?.main_unit||'หน่วย';
 if(!itemId){$('#countLotSelect').innerHTML='<option value="">ระบุ Lot / วันหมดอายุเอง</option>';return;}
 const result=await api(`/api/stock-counts/lots?item_id=${encodeURIComponent(itemId)}`);
 if($('#countForm').item_id.value!==itemId)return;
 $('#countLotSelect').innerHTML='<option value="">ระบุ Lot / วันหมดอายุเอง</option>'+result.rows.map((row,index)=>`<option value="${index}" data-lot="${esc(row.lot)}" data-expiry="${esc(row.expiry_date)}">${esc(row.lot)} · ${esc(row.expiry_date)} · ${row.quantity} ${esc(item?.sub_unit||'')}</option>`).join('');
}
async function refreshReceiptLines(itemId){
 const result=await api('/api/pr-receiving');workflowUi.prLines=result.rows;
 $('#receiveForm').pr_line_id.innerHTML='<option value="">รับเข้าทั่วไป</option>'+result.rows.filter(line=>!line.item_id||line.item_id===itemId).map(line=>`<option value="${esc(line.line_id)}">${esc(line.pr_no)} · ${esc(line.item_name)} · ค้าง ${Number(line.order_qty)-Number(line.received_qty)} ${esc(line.unit)}</option>`).join('');
 updateReceiptHint();
}
function updateReceiptHint(){
 const form=$('#receiveForm'),line=workflowUi.prLines.find(l=>l.line_id===form.pr_line_id.value);
 $('#prReceiptHint').textContent=line?`ขอซื้อ ${line.order_qty} ${line.unit} · รับแล้ว ${line.received_qty} · ค้างรับ ${Number(line.order_qty)-Number(line.received_qty)} ${line.unit} — ตรวจหน่วยรับเข้าให้ตรงก่อนบันทึก`:'';
 const item=state.items.find(i=>i.item_id===form.item_id.value);
 if(line&&item)form.unit_mode.value=line.unit===item.main_unit?'main':'sub';
}
async function openPrReceiving(prId){
 const row=state.prRequests.find(r=>r.pr_id===prId);if(!row)return;
 $('#prReceivingTitle').textContent=`รับของจาก ${row.pr_no}`;
 $('#prReceivingRows').innerHTML='<table id="prReceivingTable"></table>';
 renderTable($('#prReceivingTable'),[['item_name','รายการ'],['order_qty','ขอซื้อ'],['received_qty','รับแล้ว'],['remaining_qty','ค้างรับ'],['unit','หน่วย'],['actions','รับสินค้า']],row.items.map(line=>({...line,received_qty:Number(line.received_qty||0),remaining_qty:Number(line.order_qty)-Number(line.received_qty||0)})),{actions:(_,line)=>line.remaining_qty>0?`<button type="button" data-open-pr-line="${esc(line.line_id)}">รับเข้า</button>`:'ครบแล้ว'});
 $('#prReceiptItem').closest('label').hidden=!row.items.some(line=>!line.item_id);
 $('#prReceivingDialog').showModal();
 $$('[data-open-pr-line]').forEach(button=>button.addEventListener('click',async()=>{
  const line=row.items.find(l=>l.line_id===button.dataset.openPrLine);
  let itemId=line.item_id;
  if(!itemId){itemId=$('#prReceiptItem').value;if(!itemId)return toast('กรุณาเลือกสินค้าสำหรับรายการที่เพิ่มเอง',true);}
  try{$('#prReceivingDialog').close();await openReceiveDialog(itemId);$('#receiveForm').pr_line_id.value=line.line_id;updateReceiptHint();}catch(error){toast(error.message,true);}
 }));
 $('#prReceiptItem').innerHTML='<option value="">เลือกสินค้าเมื่อบรรทัด PR เพิ่มเอง</option>'+state.items.map(i=>`<option value="${esc(i.item_id)}">${esc(i.reagent_name)}</option>`).join('');
}

function stockValueChanges(list,filters={}){
 const rows=list.filter(row=>(!filters.machine||row.machine===filters.machine)&&(!filters.supplier||row.supplier===filters.supplier)).map(row=>({...row,change:Math.round((Number(row.closing_value||0)-Number(row.opening_value||0))*100)/100})).filter(row=>Number.isFinite(row.change)&&row.change!==0);
 const byName=(a,b)=>String(a.name||'').localeCompare(String(b.name||''),'th',{numeric:true,sensitivity:'base'});
 rows.sort(filters.sort==='name'?byName:filters.sort==='asc'?(a,b)=>a.change-b.change||byName(a,b):(a,b)=>b.change-a.change||byName(a,b));
 return {rows,max:Math.max(1,...rows.map(row=>Math.abs(row.change)))};
}
function renderInventoryVisual(a,rows){
 const host=$('#inventoryVisualBoard');if(!host)return;
 const list=a.inventory||[],sum=key=>list.reduce((total,row)=>total+Number(row[key]||0),0);
 const opening=sum('opening_value'),closing=sum('closing_value'),average=sum('average_value'),used=sum('used_value');
 const metric=(title,value,note,icon)=>`<article class="visual-kpi"><span>${title}<b aria-hidden="true">${icon}</b></span><strong>${value}</strong><small>${note}</small></article>`;
 const colors=['#1f6feb','#6c9fe6','#1757bd','#8192a8','#5a78a0','#a7bdd9'];
 const groups=new Map();for(const r of list)groups.set(r.machine,(groups.get(r.machine)||0)+Math.max(0,Number(r.closing_value)||0));
 const distribution=[...groups].filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]),total=distribution.reduce((s,[,v])=>s+v,0);
 let offset=0;const stops=distribution.map(([,v],i)=>{const start=offset;offset+=v/total*100;return `${colors[i%colors.length]} ${start}% ${offset}%`;});
 const chartFilters=state.valueChartFilters||{sort:'desc',machine:'',supplier:''};
 const dashboardById=new Map(rows.map(row=>[row.item_id,row]));
 const chartList=list.map(row=>({...row,supplier:dashboardById.get(row.item_id)?.supplier||'ยังไม่ระบุ Supplier'}));
 const {rows:comparisons,max}=stockValueChanges(chartList.filter(row=>row.has_movement),chartFilters);
 const options=(key,label)=>`<option value="">${label}</option>`+[...new Set([...chartList.map(row=>row[key]),...(chartFilters[key]?[chartFilters[key]]:[])])].sort((a,b)=>a.localeCompare(b,'th',{numeric:true})).map(value=>`<option value="${esc(value)}"${chartFilters[key]===value?' selected':''}>${esc(value)}</option>`).join('');
 const chartControls=`<div class="visual-change-filters"><label>เรียงตาม<select data-change-filter="sort" aria-label="เรียงผลต่างมูลค่า">${[['desc','มากไปน้อย'],['asc','น้อยไปมาก'],['name','ตามตัวอักษร']].map(([value,label])=>`<option value="${value}"${(chartFilters.sort||'desc')===value?' selected':''}>${label}</option>`).join('')}</select></label><label>เครื่อง<select data-change-filter="machine" aria-label="กรองเครื่องในกราฟผลต่าง">${options('machine','ทุกเครื่อง')}</select></label><label>Supplier<select data-change-filter="supplier" aria-label="กรอง Supplier ในกราฟผลต่าง">${options('supplier','ทุก Supplier')}</select></label></div>`;
 const changeTotal=comparisons.reduce((total,row)=>total+row.change,0);
 const signed=value=>(value>0?'+':'')+money(value);
 const turnovers=list.filter(r=>r.turnover!==null&&Number.isFinite(r.turnover)).sort((a,b)=>b.turnover-a.turnover),maxTurn=Math.max(1,...turnovers.map(r=>r.turnover));
 const empty='<p class="visual-empty">ยังไม่มีมูลค่าสำหรับช่วงเวลานี้</p>';
 const itemButton=r=>`<button class="visual-name" data-visual-item="${esc(r.item_id)}" title="ดูรายละเอียด ${esc(r.name)}">${esc(r.name)}</button>`;
 host.innerHTML=`<div class="visual-kpis">${a.inventory?metric('Total Inventory Value',money(closing),'มูลค่าปลายงวด · บาท','◈'):''}${metric('Active Items',rows.length,'รายการที่เปิดใช้งานตามตัวกรอง','▤')}${a.inventory?metric('Inventory Turnover',average>0?(used/average).toFixed(2)+'×':'—','ใช้งานสุทธิ ÷ มูลค่าคงเหลือเฉลี่ย','↻')+metric('Total Usage (Net)',money(used),'มูลค่าใช้งานสุทธิในช่วง · บาท','↗'):''}</div>${a.inventory?`<div class="visual-charts"><article class="visual-panel visual-comparison"><h3>STOCK VALUE CHANGE</h3><p>มูลค่าปลายงวด − ต้นงวด · บาท · เฉพาะรายการที่มีผลต่างมูลค่าในงวด ไม่รวมผลต่างศูนย์</p>${chartControls}<div class="visual-change-summary">ผลต่างรวมตามตัวกรอง <strong>${signed(Math.round(changeTotal*100)/100)}</strong> บาท · ${comparisons.length} รายการ</div><div class="visual-change-axis"><span>−${money(max)}</span><span>0</span><span>+${money(max)}</span></div><div class="visual-scroll">${comparisons.length?comparisons.map(r=>`<div class="visual-change-row">${itemButton(r)}<div class="visual-change-track" role="img" aria-label="${esc(r.name)} ผลต่าง ${signed(r.change)} บาท"><i title="${esc(r.name)} · ต้นงวด ${money(r.opening_value)} บาท · ปลายงวด ${money(r.closing_value)} บาท · ผลต่าง ${signed(r.change)} บาท" class="${r.change<0?'negative':'positive'}" style="left:${r.change<0?50-Math.abs(r.change)/max*50:50}%;width:${Math.abs(r.change)/max*50}%"></i></div><b class="visual-change-value ${r.change<0?'negative':r.change>0?'positive':''}">${signed(r.change)}</b></div>`).join(''):'<p class="visual-empty">ไม่มีรายการที่ตรงกับตัวกรอง</p>'}</div><div class="visual-change-legend"><span>← ลดลง (ลบ)</span><span>เพิ่มขึ้น (บวก) →</span></div></article><article class="visual-panel"><h3>STOCK DISTRIBUTION BY ANALYZER</h3><p>สัดส่วนมูลค่าปลายงวดตามเครื่อง / ยี่ห้อ</p><div class="visual-distribution"><div class="visual-donut" role="img" aria-label="สัดส่วนมูลค่าปลายงวดตามเครื่อง ดูตัวเลขในรายการข้างเคียง" style="background:${total?'conic-gradient('+stops.join(',')+')':'#e7edf5'}"><span>${distribution.length}<small>เครื่อง / ยี่ห้อ</small></span></div><div class="visual-legend">${distribution.map(([name,v],i)=>`<button data-visual-machine="${esc(name)}"><i style="background:${colors[i%colors.length]}"></i><span>${esc(name)}</span><b>${(v/total*100).toFixed(1)}%</b></button>`).join('')||empty}</div></div></article><article class="visual-panel"><h3>ITEM TURNOVER RATE</h3><p>อัตราหมุนเวียนรายสินค้า · เท่าในช่วงที่เลือก</p><div class="visual-scroll visual-turnovers">${turnovers.length?turnovers.map(r=>`<div class="visual-pair">${itemButton(r)}<div class="visual-barline"><i class="turnover_value" style="width:${Math.max(0,r.turnover)/maxTurn*100}%"></i><b>${r.turnover.toFixed(2)}×</b></div></div>`).join(''):'<p class="visual-empty">คำนวณไม่ได้เมื่อมูลค่าคงเหลือเฉลี่ยเป็นศูนย์</p>'}</div></article></div>`:''}`;
 host.querySelectorAll('[data-change-filter]').forEach(select=>select.addEventListener('change',()=>{state.valueChartFilters={...chartFilters,[select.dataset.changeFilter]:select.value};renderInventoryVisual(a,rows);host.querySelector(`[data-change-filter="${select.dataset.changeFilter}"]`)?.focus();}));
 host.querySelectorAll('[data-visual-item]').forEach(button=>button.addEventListener('click',()=>openAnalyticsDetails('turnover',{item:button.dataset.visualItem})));
 host.querySelectorAll('[data-visual-machine]').forEach(button=>button.addEventListener('click',()=>openAnalyticsDetails('turnover',{machine:button.dataset.visualMachine})));
}

function renderAnalytics(){
 const a=state.analytics,rows=state.dashboard||[];
 if(!a)return;
 renderInventoryVisual(a,rows);
 const all=rows.length,empty=rows.filter(r=>Number(r.qty_sub)<=0).length,rop=rows.filter(r=>Number(r.qty_sub)<=Number(r.reorder_point_sub)).length;
 const pct=(n,d)=>d>0?(n/d*100).toFixed(1)+'%':'ไม่มีข้อมูล';
 const pie=(n,d,color)=>`<div class="pie-layout"><div class="analytics-pie" style="background:conic-gradient(${color} 0 ${d?n/d*100:0}%,#e7edf5 0 100%)"><span>${pct(n,d)}</span></div><div><strong>${n} / ${d} รายการ</strong><p>นับเฉพาะรายการที่เปิดใช้งาน</p></div></div>`;
 const card=(key,title,sub,content,price=false)=>`<article class="analytics-card${price?' price-only':''}" ${key==='near'?'':'tabindex="0" role="button"'} data-analytic="${key}"><h3>${title}</h3><p>${sub}</p>${content}</article>`;
 const sum=(list,key)=>list.reduce((s,r)=>s+Number(r[key]||0),0);
 const inventory=a.inventory||[],groups=new Map();for(const row of inventory){if(!groups.has(row.machine))groups.set(row.machine,[]);groups.get(row.machine).push(row);}
 const machines=[...groups].map(([name,list])=>{const average=sum(list,'average_value'),used=sum(list,'used_value');return {name,average,used,value:average>0?used/average:null};});
 const bars=(list,suffix='',color='#3b82f6',scale=null)=>{const max=scale||Math.max(...list.map(r=>r.value||0),1);return list.length?list.map(r=>`<div class="analytics-bar"><span>${esc(r.name)}</span><div class="analytics-track"><i style="width:${Math.max(0,Math.min(100,(r.value||0)/max*100))}%;background:${color}"></i></div><b>${r.value===null?'—':Number(r.value).toFixed(2)+suffix}</b></div>`).join(''):'<p>ยังไม่มีข้อมูล</p>';};
 const used=sum(inventory,'used_value'),closing=sum(inventory,'closing_value'),waste=sum(inventory,'wasted_value'),received=sum(inventory,'received_value');
 const due=a.deliveries.filter(d=>d.eligible),vendors=[...new Set(due.map(d=>d.vendor))].map(name=>{const list=due.filter(d=>d.vendor===name);return {name,value:100*list.filter(d=>d.on_time).length/list.length};});
 const leads=a.deliveries.filter(d=>d.complete&&d.issued_date&&d.received_date>=a.range.start&&d.received_date<=a.range.end&&d.lead_days>=0);
 const nearBuckets=['หมดอายุ','<30 วัน','30–59 วัน','60–89 วัน'],colors=['#be123c','#ef4444','#f59e0b','#3b82f6'];
 const reasons=['หมดอายุ','เสื่อมสภาพ / เสียหาย','อื่น ๆ'];
 const heatRows=[...groups].map(([name,list])=>({name,values:reasons.map(reason=>list.reduce((s,r)=>s+(r.reasons[reason]||0),0))}));
 const maxWaste=Math.max(...heatRows.flatMap(r=>r.values),1);
 const heat=`<span>เครื่อง / สาเหตุ</span>${reasons.map(r=>`<span>${esc(r)}</span>`).join('')}`+heatRows.map(r=>`<span>${esc(r.name)}</span>${r.values.map(v=>`<span style="background:rgba(239,68,68,${.08+.6*Math.min(1,Math.max(0,v)/maxWaste)})"><b>${money(v)}</b></span>`).join('')}`).join('');
 const nearMachines=[...new Set(a.near.map(r=>r.machine||'ไม่ระบุเครื่อง'))];
 const maxLots=Math.max(...nearMachines.map(machine=>a.near.filter(r=>(r.machine||'ไม่ระบุเครื่อง')===machine).length),1);
 const stacked=nearMachines.map(machine=>{const list=a.near.filter(r=>(r.machine||'ไม่ระบุเครื่อง')===machine);return `<div class="analytics-bar"><button class="near-machine" data-near-machine="${esc(machine)}" aria-label="ดูสินค้าเครื่อง ${esc(machine)}">${esc(machine)}</button><div class="analytics-track" data-near-machine="${esc(machine)}">${nearBuckets.map((bucket,index)=>{const count=list.filter(r=>r.bucket===bucket).length;return count?`<button class="near-segment" data-near-machine="${esc(machine)}" data-near-bucket="${esc(bucket)}" title="${esc(machine)} · ${esc(bucket)}: ${count} Lot" aria-label="${esc(machine)} · ${esc(bucket)}: ${count} Lot" style="width:${count/maxLots*100}%;background:${colors[index]}"></button>`:'';}).join('')}</div><button class="near-machine" data-near-machine="${esc(machine)}" aria-label="ดูทั้งหมด ${list.length} Lot ของ ${esc(machine)}">${list.length} Lot</button></div>`;}).join('')||'<p>ไม่มี Lot ที่หมดอายุหรือใกล้หมดอายุภายใน 90 วัน</p>';

 const legend=nearBuckets.map((bucket,index)=>`<span style="color:${colors[index]}">● ${esc(bucket)}</span>`).join(' · ');
 const trendGroups=new Map();for(const l of leads){const month=l.received_date.slice(0,7);if(!trendGroups.has(month))trendGroups.set(month,[]);trendGroups.get(month).push(l.lead_days);}
 const trend=[...trendGroups].sort().map(([name,v])=>({name,value:v.reduce((s,n)=>s+n,0)/v.length})),maxLead=Math.max(...trend.map(r=>r.value),1);
 const points=trend.map((r,i)=>`${trend.length===1?150:20+i*260/(trend.length-1)},${95-r.value/maxLead*75}`).join(' ');
 const line=trend.length?`<svg class="analytics-trend" viewBox="0 0 300 120" role="img" aria-label="แนวโน้ม Lead Time รายเดือน"><polyline points="${points}" fill="none" stroke="#2563eb" stroke-width="3"/>${trend.map((r,i)=>{const x=trend.length===1?150:20+i*260/(trend.length-1),y=95-r.value/maxLead*75;return `<circle cx="${x}" cy="${y}" r="4" fill="#2563eb"/><text x="${x}" y="115" text-anchor="middle" font-size="9">${esc(r.name)}</text><text x="${x}" y="${y-8}" text-anchor="middle" font-size="10">${r.value.toFixed(1)}</text>`;}).join('')}</svg>`:'<p>ยังไม่มีรายการรับครบที่ระบุวันออก PO</p>';
 $('#analyticsPeriodNote').textContent=`ช่วงวิเคราะห์ ${a.range.start} ถึง ${a.range.end} (${a.range.days} วัน) • กรองตามเครื่องและคำค้นด้านบน`;
 $('#dashboardCharts').innerHTML=
 card('stockout','Stockout Rate','อัตรารายการสินค้าหมดสต๊อก ณ ปัจจุบัน',pie(empty,all,'#ef4444'))+
 card('reorder','Reorder Point Trigger','คงเหลือ ≤ ROP รวมรายการที่หมดสต๊อก',pie(rop,all,'#f59e0b'))+
 (a.inventory?card('turnover','Inventory Turnover Ratio','มูลค่าใช้งานสุทธิ ÷ มูลค่าคงเหลือเฉลี่ย · แยกตามเครื่อง',bars(machines,' เท่า'),true)+
 card('doh','Days On Hand','มูลค่าปลายงวด ÷ มูลค่าใช้งานเฉลี่ยต่อวัน',`<strong class="metric">${used>0?(closing/(used/a.range.days)).toFixed(1)+' วัน':'คำนวณไม่ได้'}</strong><p>อ้างอิงการใช้ ${a.range.days} วัน • เป้าหมายตัวอย่าง 30–45 วัน ปรับตาม Lead Time</p>`,true)+
 card('wastage','Wastage Rate','มูลค่าตัดทิ้งสุทธิ ÷ มูลค่าการสั่งซื้อในงบประมาณ',`<strong class="metric">${a.purchase_total===null?'รอระบุมูลค่าซื้อ':pct(waste,a.purchase_total)}</strong><p>เป้าหมาย &lt;1–2% • ฐานซื้อทั้งคลัง ${a.purchase_total===null?'ยังไม่ระบุ':money(a.purchase_total)+' บาท'} • มูลค่าตัดทิ้งตามตัวกรอง</p><div class="analytics-heat">${heat}</div><p>กำหนดฐานที่ปุ่ม “มูลค่าซื้อในงบประมาณ” • ยอดรับเข้าในช่วงนี้ ${money(received)} บาท</p>`,true):'')+
 card('near','Near-Expiry Alerts','FEFO · จำนวน Lot / รายการ แยกกลุ่มวันแบบไม่ซ้ำกัน',stacked+`<p>${legend}</p>`+'<p>คลิกชื่อเครื่องเพื่อดูทุก Lot หรือคลิกช่วงสีเพื่อดูเฉพาะกลุ่มวันหมดอายุ</p><button type="button" data-near-all>ดูทุกเครื่อง / ยี่ห้อ</button>')+
 card('otif','On-Time In-Full','สัดส่วนเอกสารที่รับครบภายในวันนัดส่ง · แยก Vendor',bars(vendors,'%', '#10b981',100)+`<p>ฐาน ${due.length} คู่เอกสาร/Vendor ที่ออกในช่วงและถึงวันนัดส่งแล้ว • ไม่รวมเอกสารที่ยังไม่ได้ระบุวันที่</p>`)+
 card('lead','Average Lead Time','วันรับครบจริง − วันออก PO · เฉลี่ยต่อเอกสาร/Vendor',`<strong class="metric">${leads.length?(sum(leads,'lead_days')/leads.length).toFixed(1)+' วัน':'ไม่มีข้อมูล'}</strong>${line}<p>จัดกลุ่มแนวโน้มตามเดือนที่รับครบ • คลิกเพื่อบันทึกวันออก PO / นัดส่ง</p>`);
 $$('[data-analytic]').forEach(el=>{el.addEventListener('click',event=>{const drill=event.target.closest('[data-near-machine]');if(el.dataset.analytic==='near'&&drill){openAnalyticsDetails('near',{machine:drill.dataset.nearMachine,bucket:drill.dataset.nearBucket});return;}openAnalyticsDetails(el.dataset.analytic);});el.addEventListener('keydown',e=>{if(e.target!==el)return;if(e.key==='Enter'||e.key===' '){e.preventDefault();openAnalyticsDetails(el.dataset.analytic);}});});
}
function openAnalyticsDetails(key,filter={}){
 if(key==='stockout'||key==='reorder'){state.dashboardCardFilter=key==='stockout'?'critical':'reorder';renderDashboardCardFilterState();renderDashboardTable();$('#dashboardStockDialog').showModal();return;}
 const a=state.analytics;let rows,columns,title;
 if(key==='near'){title='สินค้าใกล้หมดอายุ / หมดอายุ'+(filter.machine?' · '+filter.machine:' · ทุกเครื่อง / ยี่ห้อ')+(filter.bucket?' · '+filter.bucket:'')+' (FEFO)';rows=nearExpiryRows(a.near,filter);columns=[['name','สินค้า'],['machine','เครื่อง'],['lot','Lot'],['expiry_date','หมดอายุ'],['days','วันคงเหลือ'],['bucket','กลุ่ม'],['quantity','จำนวน'],['unit','หน่วย']];}
 else if(key==='otif'||key==='lead'){
  title='การส่งมอบและระยะเวลารอของ — เอกสารที่อนุมัติ';rows=a.deliveries.map(d=>({...d,complete:d.complete?'รับครบ':'ยังไม่ครบ',on_time:d.eligible?(d.on_time?'ตรงเวลาและครบ':'ไม่ผ่าน'):'ยังไม่เข้าเกณฑ์ / วันที่ไม่ครบ',lead_days:d.lead_days??'—',actions:state.user.role==='admin'?`<button data-delivery="${esc(d.pr_id)}">กำหนดวันที่</button>`:''}));
  columns=[['pr_no','เอกสาร PR ที่อ้างอิง PO'],['vendor','Vendor'],['issued_date','ออก PO'],['expected_date','นัดส่ง'],['received_date','รับครบ'],['complete','สถานะ'],['on_time','OTIF ในช่วงที่เลือก'],['lead_days','Lead Time (วัน)'],['actions','วันที่']];
 }else{title=key==='wastage'?'รายละเอียดมูลค่ารับเข้า / ใช้งาน / ตัดทิ้ง':'รายละเอียดการหมุนเวียนและมูลค่าคลัง';rows=(a.inventory||[]).filter(r=>(!filter.item||r.item_id===filter.item)&&(!filter.machine||r.machine===filter.machine));columns=[['name','สินค้า'],['machine','เครื่อง'],['opening_value','มูลค่าต้นงวด'],['closing_value','มูลค่าปลายงวด'],['average_value','มูลค่าเฉลี่ย'],['used_value','ใช้งานสุทธิ'],['received_value','รับเข้าสุทธิ'],['wasted_value','ตัดทิ้งสุทธิ'],['turnover','หมุนเวียน (เท่า)']];}
 if(key==='near'&&rows.some(row=>row.days<0)){columns.push(['dispose_action','ตัดทิ้ง']);rows=rows.map(row=>({...row,dispose_action:row.days<0?expiredDisposeButton(row.item_id,row.lot,row.expiry_date):''}));}
 $('#analyticsDetailsTitle').textContent=title;renderTable($('#analyticsDetailsTable'),columns,rows,{dispose_action:v=>v,actions:v=>v,opening_value:money,closing_value:money,average_value:money,used_value:money,received_value:money,wasted_value:money,turnover:v=>v===null?'—':Number(v).toFixed(2)});
 $$('[data-delivery]').forEach(button=>button.addEventListener('click',()=>{const row=a.deliveries.find(r=>r.pr_id===button.dataset.delivery),form=$('#deliveryTermsForm');form.pr_id.value=row.pr_id;form.issued_date.value=row.issued_date||'';form.expected_date.value=row.expected_date||'';$('#deliveryTermsDialog').showModal();}));
 $('#analyticsDetailsDialog').showModal();
}

function renderSupplierOptions(selected=$('#itemForm').supplier_id.value){
 const options=(state.suppliers||[]).filter(s=>!s.is_placeholder&&(Number(s.is_active)||s.supplier_id===selected));
 $('#itemForm').supplier_id.innerHTML='<option value="">เลือก Supplier จากทะเบียน</option>'+options.map(s=>`<option value="${esc(s.supplier_id)}">${esc(s.name)}${s.is_active?'':' (ปิดใช้งาน)'}</option>`).join('');
 $('#itemForm').supplier_id.value=selected||'';
}
async function refreshSupplierMaster(){const res=await api('/api/suppliers?master=1');state.suppliers=res.rows;renderSupplierOptions();}
async function refreshSuppliers(){
 // Fetch the small master once; search locally so item selectors always retain the full registry.
 const response=await api('/api/suppliers');state.suppliers=response.rows;renderSupplierOptions();
 const q=$('#supplierSearch').value.trim().toLowerCase();
 const rows=response.rows.filter(s=>[s.name,s.contact_name,s.phone,s.email].some(v=>String(v||'').toLowerCase().includes(q)));
 renderTable($('#suppliersTable'),[['name','Supplier'],['contact_name','ผู้ติดต่อ'],['phone','โทรศัพท์'],['email','อีเมล'],['item_count','รายการสินค้าที่ผูก'],['stock_items','รายการที่มี Stock'],['stock_lots','Lot ใน Stock'],['is_active','สถานะ'],['actions','จัดการ']],rows,{
  is_active:(v,r)=>r.is_placeholder?'รอระบุผู้ขายจริง':v?'เปิดใช้งาน':'ปิดใช้งาน',
  actions:(_,r)=>`<button data-supplier-view="${esc(r.supplier_id)}">สินค้า / Stock</button> ${state.user.role==='admin'&&!r.is_placeholder?`<button data-supplier-edit="${esc(r.supplier_id)}">แก้ไข</button><button class="danger" data-supplier-delete="${esc(r.supplier_id)}">ลบ</button>`:''}`
 });
 $$('[data-supplier-view]').forEach(button=>button.addEventListener('click',()=>openSupplierDetails(button.dataset.supplierView).catch(e=>toast(e.message,true))));
 $$('[data-supplier-delete]').forEach(button=>button.addEventListener('click',async()=>{const row=state.suppliers.find(s=>s.supplier_id===button.dataset.supplierDelete);if(!await confirmBox('ลบ Supplier',`ลบ ${esc(row.name)} และย้ายรายการสินค้า สต๊อก และการอ้างอิงเอกสาร ไปยัง “ยังไม่ระบุ Supplier” อัตโนมัติ โดยจำนวนสต๊อกไม่เปลี่ยน ต้องการดำเนินการหรือไม่?`))return;try{await api('/api/suppliers/'+encodeURIComponent(row.supplier_id),{method:'DELETE'});await Promise.all([refreshSuppliers(),refreshItems(),refreshDashboard()]);toast('ลบ Supplier และย้ายข้อมูลไปยังยังไม่ระบุ Supplier แล้ว');}catch(e){toast(e.message,true);}}));
 $$('[data-supplier-edit]').forEach(button=>button.addEventListener('click',()=>openSupplierForm(button.dataset.supplierEdit)));
}
function openSupplierForm(id){
 const form=$('#supplierForm');form.reset();form.supplier_id.value='';
 if(id){const row=state.suppliers.find(s=>s.supplier_id===id);for(const [key,value] of Object.entries(row))if(form.elements.namedItem(key))form.elements.namedItem(key).value=value??'';}
 $('#supplierDialogTitle').textContent=id?'แก้ไข Supplier':'เพิ่ม Supplier';$('#supplierDialog').showModal();
}
async function openSupplierDetails(id){
 const res=await api('/api/suppliers/'+encodeURIComponent(id));
 $('#supplierDetailsTitle').textContent=res.supplier.name;
 $('#supplierDetailsContact').textContent=[res.supplier.contact_name,res.supplier.phone,res.supplier.email,res.supplier.address,res.supplier.note].filter(Boolean).join(' · ');
 renderTable($('#supplierItemsTable'),[['reagent_name','รายการสินค้า'],['machine','เครื่อง'],['main_unit','หน่วยหลัก'],['sub_unit','หน่วยตัดจริง'],['is_active','สถานะ'],['actions','จัดการ']],res.items,{is_active:v=>v?'เปิดใช้งาน':'ปิดใช้งาน',actions:(_,r)=>`<button data-supplier-item="${esc(r.item_id)}">แก้ไขสินค้า / Supplier</button>`});
 renderTable($('#supplierPurchasedTable'),[['reagent_name','รายการสินค้า'],['machine','เครื่อง'],['received_qty','จำนวนสะสมในประวัติ'],['sub_unit','หน่วย'],['verified','ที่มาผู้ขาย']],res.purchased,{verified:v=>v?'ระบุจากการรับเข้า':'อ้างอิงข้อมูลเดิม / ตรวจนับ'});
 renderTable($('#supplierStockTable'),[['reagent_name','รายการสินค้า'],['machine','เครื่อง'],['lot','Lot'],['expiry_date','หมดอายุ'],['quantity','จำนวนคงเหลือ'],['sub_unit','หน่วย'],['verified','ที่มาผู้ขาย']],res.stock,{verified:v=>v?'ระบุจากการรับเข้า':'อ้างอิงข้อมูลเดิม / ตรวจนับ'});
 $$('[data-supplier-item]').forEach(button=>button.addEventListener('click',async()=>{try{const res=await api('/api/items');state.items=res.rows;$('#supplierDetailsDialog').close();editItem(button.dataset.supplierItem);}catch(e){toast(e.message,true);}}));
 $('#supplierDetailsDialog').showModal();
}

async function openItemLots(itemId){
 const res=await api('/api/item-lots?item_id='+encodeURIComponent(itemId));state.managedLotItem=itemId;state.managedLots=res.rows;
 $('#itemLotsTitle').textContent=`จัดการ Lot: ${res.item.reagent_name} (${res.item.sub_unit||res.item.main_unit})`;
 renderTable($('#itemLotsTable'),[['lot','Lot'],['expiry_date','หมดอายุ'],['in_stock','คงเหลือ'],['used','ใช้แล้ว'],['disposed','ตัดทิ้ง'],['adjusted_out','ปรับออก'],['voided','ยกเลิก'],['total','หน่วยทั้งหมด'],['first_received','รับครั้งแรก'],['actions','จัดการ']],res.rows,{
  first_received:v=>esc(formatDateTime(v)),
  actions:(_,row)=>{const index=res.rows.indexOf(row);return `<button data-lot-units="${index}">ดู QR / พิมพ์</button>${row.in_stock&&res.item.is_active?`<button data-lot-count="${index}">ตรวจนับ</button>`:''}${state.user.role==='admin'&&row.in_stock===row.total&&row.total<=2000?`<button data-lot-edit="${index}">แก้ไข Lot / หมดอายุ</button>`:''}`;}
 });
 $$('[data-lot-units]').forEach(button=>button.addEventListener('click',async()=>{try{state.managedLot=res.rows[Number(button.dataset.lotUnits)];await loadLotUnits();$('#lotUnitsDialog').showModal();}catch(e){toast(e.message,true);}}));
 $$('[data-lot-edit]').forEach(button=>button.addEventListener('click',()=>{const row=res.rows[Number(button.dataset.lotEdit)];state.managedLot=row;const form=$('#editLotForm');form.reset();form.new_lot.value=row.lot;form.new_expiry_date.value=row.expiry_date;$('#editLotDialog').showModal();}));
 $$('[data-lot-count]').forEach(button=>button.addEventListener('click',async()=>{try{const row=res.rows[Number(button.dataset.lotCount)];$('#itemLotsDialog').close();switchTab('counts');await refreshCounts();const form=$('#countForm');form.item_id.value=itemId;$('#countItemSearch').value=countItemLabel(res.item); // Use the full item below when available.
 const item=state.items.find(i=>i.item_id===itemId);if(item)$('#countItemSearch').value=countItemLabel(item);
 await refreshCountLots();const option=[...$('#countLotSelect').options].find(o=>o.dataset.lot===row.lot&&o.dataset.expiry===row.expiry_date);if(option)$('#countLotSelect').value=option.value;form.lot.value=row.lot;form.expiry_date.value=row.expiry_date;form.counted_qty.value='';form.reason.value='';form.counted_qty.focus();}catch(e){toast(e.message,true);}}));
 if(!$('#itemLotsDialog').open)$('#itemLotsDialog').showModal();
}
async function loadLotUnits(append=false){
 const row=state.managedLot,params=new URLSearchParams({item_id:state.managedLotItem,lot:row.lot,expiry_date:row.expiry_date,after:append?state.lotUnitsNext||'':''});
 const res=await api('/api/item-lots/units?'+params);state.lotUnitRows=append?[...state.lotUnitRows,...res.rows]:res.rows;state.lotUnitsNext=res.next;$('#moreLotUnitsBtn').hidden=!res.next;
 renderTable($('#lotUnitsTable'),[['barcode','QR'],['parent_barcode','QR หน่วยหลัก'],['lot','Lot'],['expiry_date','หมดอายุ'],['status','สถานะ'],['received_at','รับเข้า'],['actions','พิมพ์']],state.lotUnitRows,{actions:(_,r)=>r.status==='IN_STOCK'?`<button data-print-lot-qr="${esc(r.barcode)}">พิมพ์ฉลาก</button>`:''});
 $$('[data-print-lot-qr]').forEach(button=>button.addEventListener('click',()=>printLabels([stockRowToLabel(state.lotUnitRows.find(r=>r.barcode===button.dataset.printLotQr))])));
}

function nearExpiryRows(rows,filter={}){return rows.filter(row=>(!filter.machine||(row.machine||'ไม่ระบุเครื่อง')===filter.machine)&&(!filter.bucket||row.bucket===filter.bucket));}

function expiredDisposeButton(itemId,lot='',expiry=''){return `<button class="danger" data-expired-dispose="${esc(itemId)}" data-lot="${esc(lot)}" data-expiry="${esc(expiry)}">ตัดสินค้าทิ้ง</button>`;}
async function openExpiredDisposal(itemId,lot,expiry){
 const res=await api('/api/item-lots?item_id='+encodeURIComponent(itemId)),today=new Date().toISOString().slice(0,10);
 const rows=res.rows.filter(r=>r.in_stock>0&&r.expiry_date<today);
 if(!rows.length){toast('ไม่มีสินค้าหมดอายุคงเหลือแล้ว กรุณารีเฟรช Dashboard');await refreshDashboard();return;}
 state.expiredDisposal={item:res.item,rows};const form=$('#expiredDisposalForm');form.reset();
 $('#expiredDisposalItem').textContent=res.item.reagent_name;
 form.lot_index.innerHTML=rows.map((r,index)=>`<option value="${index}">${esc(r.lot)} · ${esc(formatDateOnly(r.expiry_date))} · คงเหลือ ${r.in_stock} ${esc(res.item.sub_unit||res.item.main_unit)}</option>`).join('');
 const match=rows.findIndex(r=>r.lot===lot&&r.expiry_date===expiry);form.lot_index.value=String(match>=0?match:0);updateExpiredDisposalBalance();$('#expiredDisposalDialog').showModal();
}
function updateExpiredDisposalBalance(){
 const {item,rows}=state.expiredDisposal,form=$('#expiredDisposalForm'),row=rows[Number(form.lot_index.value)];
 const unit=item.sub_unit||item.main_unit;$('#expiredDisposalUnit').textContent=unit;$('#expiredDisposalBalance').textContent=`คงเหลือ ${row.in_stock} ${unit} · บันทึกได้ครั้งละไม่เกิน 2,000 หน่วย`;
 form.quantity.max=String(Math.min(row.in_stock,2000));form.quantity.value=String(Math.min(row.in_stock,2000));
}
async function saveExpiredDisposal(event){
 event.preventDefault();const button=$('#saveExpiredDisposalBtn');if(button.disabled)return;button.disabled=true;
 try{
  const {item,rows}=state.expiredDisposal,form=event.target,row=rows[Number(form.lot_index.value)],quantity=Number(form.quantity.value),why=form.reason.value.trim();
  if(!await confirmBox('ยืนยันตัดสินค้าหมดอายุทิ้ง',`${esc(item.reagent_name)} · Lot ${esc(row.lot)} · หมดอายุ ${esc(formatDateOnly(row.expiry_date))}<br>จำนวน ${esc(quantity)} ${esc(item.sub_unit||item.main_unit)}<br>เหตุผล: ${esc(why)}<br>ต้องการบันทึกตัดทิ้งรายการนี้หรือไม่?`))return;
  const res=await stockWrite('/api/dispose-expired',{item_id:item.item_id,lot:row.lot,expiry_date:row.expiry_date,quantity,expected_count:row.in_stock,reason:why});
  $('#expiredDisposalDialog').close();if($('#analyticsDetailsDialog').open)$('#analyticsDetailsDialog').close();
  await refreshDashboard();await refreshStock();['reprint','reports','pr','settings'].forEach(tab=>state.stockViewsDirty.add(tab));toast(`ตัดทิ้งแล้ว ${res.quantity} ${res.unit} · Lot ${res.lot} · คงเหลือ ${res.remaining_sub} ${res.unit}`);
 }catch(e){toast(e.message,true);}finally{button.disabled=false;}
}

function openPrSuggestionDetails(itemId){
 const row=state.prSuggestionRows.find(r=>r.item_id===itemId);if(!row)return;
 const fields=[['สถานะ',row.status],['เครื่อง / ยี่ห้อ',row.machine],['Stock ปัจจุบัน',row.qty_main_display],['Lot',row.lot||'—'],['วันหมดอายุ',row.expiry?formatDateOnly(row.expiry):'—'],['จุดสั่งซื้อ ('+(row.sub_unit||'หน่วย')+')',row.reorder_point_sub],['Supplier',row.supplier||'ยังไม่ระบุ Supplier'],['หน่วยสั่งซื้อ',row.main_unit||row.sub_unit],['หน่วยตัดจริง',row.sub_unit],['อัตราแปลง',`${row.sub_per_main||1} ${row.sub_unit||''} / ${row.main_unit||''}`],['Lead Time',`${row.lead_time_days||0} วัน`],['เหตุผลแนะนำ',prReason(row)]];
 if(canViewPrices())fields.push(['ราคาต่อหน่วยหลัก',money(row.main_unit_price)],['ราคาต่อหน่วยย่อย',money(row.unit_price)]);
 $('#prSuggestionDetailsTitle').textContent=row.name;
 $('#prSuggestionDetailsBody').innerHTML=fields.map(([label,value])=>`<div><p class="muted">${esc(label)}</p><strong>${esc(value??'—')}</strong></div>`).join('');
 $('#prSuggestionDetailsDialog').showModal();
}
