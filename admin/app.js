// Must point to Render *web* service (FastAPI), not the worker.
// Override (no code change): add ?api=https%3A%2F%2Fyour-api.onrender.com
// to the admin URL, or set localStorage key `krab_api_base` to a full base URL
// (no trailing slash), then reload.
//
// Highkage handle split override:
//   ?highkage=kingkrab,haruhatsu
// or set localStorage key `krab_highkage_handles` to a comma-separated handle list
// (without @). Default highkage handle: haruhatsu
const DEFAULT_API_BASE = "https://krab-sender-api.onrender.com";

function resolveApiBase() {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = (params.get("api") || "").trim();
    if (fromQuery.startsWith("https://") || fromQuery.startsWith("http://")) {
      const normalized = fromQuery.replace(/\/+$/, "");
      localStorage.setItem("krab_api_base", normalized);
      return normalized;
    }
  } catch {
    // ignore
  }
  try {
    const stored = (localStorage.getItem("krab_api_base") || "").trim();
    if (stored.startsWith("https://") || stored.startsWith("http://")) {
      return stored.replace(/\/+$/, "");
    }
  } catch {
    // ignore
  }
  return DEFAULT_API_BASE;
}

const API_BASE = resolveApiBase();

function resolveHighkageHandleSet() {
  const parseList = (raw) => {
    return String(raw || "")
      .split(",")
      .map((h) => h.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean);
  };

  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = (params.get("highkage") || "").trim();
    if (fromQuery) {
      const handles = parseList(fromQuery);
      if (handles.length > 0) {
        localStorage.setItem("krab_highkage_handles", handles.join(","));
        return new Set(handles);
      }
    }
  } catch {
    // ignore
  }

  try {
    const stored = (localStorage.getItem("krab_highkage_handles") || "").trim();
    const handles = parseList(stored);
    if (handles.length > 0) {
      return new Set(handles);
    }
  } catch {
    // ignore
  }

  return new Set(["haruhatsu"]);
}

const HIGHKAGE_FALLBACK_HANDLES = resolveHighkageHandleSet();

function formatNy(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    const nyDate = new Date(
      d.toLocaleString("en-US", { timeZone: "America/New_York" })
    );
    const day = nyDate.getDate();
    const month = nyDate.toLocaleString("en-US", {
      month: "long",
    });
    const year = nyDate.getFullYear();

    let hours = nyDate.getHours();
    const minutes = nyDate.getMinutes().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    if (hours === 0) hours = 12;

    return `${month} ${day} ${year} ${hours}:${minutes}${ampm.toLowerCase()}`;
  } catch {
    return ts;
  }
}

function formatRevenueUsd(totalCount) {
  const n = Number(totalCount) || 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n * 100);
}

function normalizeHandle(rawHandle) {
  return String(rawHandle || "").trim().toLowerCase().replace(/^@/, "");
}

function formatHandleWithAt(rawHandle) {
  const h = normalizeHandle(rawHandle);
  return h ? "@" + h : "";
}

function issuerGroupFromHandle(rawHandle) {
  const h = normalizeHandle(rawHandle);
  return HIGHKAGE_FALLBACK_HANDLES.has(h) ? "highkage_group" : "sensei_group";
}

function getStoredPassword() {
  try {
    return localStorage.getItem("krab_admin_password") || "";
  } catch {
    return "";
  }
}

function storePassword(pw) {
  try {
    localStorage.setItem("krab_admin_password", pw);
  } catch {
    // ignore
  }
}

async function fetchWithAdmin(path, opts = {}) {
  const pw = getStoredPassword();
  if (!pw) {
    throw new Error("NO_PASSWORD");
  }
  const headers = Object.assign({}, opts.headers || {}, {
    "X-Admin-Password": pw,
  });
  let res;
  try {
    res = await fetch(API_BASE + path, {
    ...opts,
    headers,
  });
  } catch (e) {
    const msg = (e && e.message) || String(e);
    throw new Error("NETWORK: " + msg);
  }
  if (res.status === 401) {
    throw new Error("UNAUTHORIZED");
  }
  if (!res.ok) {
    throw new Error("HTTP_" + res.status);
  }
  return res.json();
}

// Like fetchWithAdmin, but does not throw on non-2xx; callers can branch.
async function requestWithAdminJson(path, opts = {}) {
  const pw = getStoredPassword();
  if (!pw) {
    return { ok: false, status: 0, error: "NO_PASSWORD" };
  }
  const headers = Object.assign({}, opts.headers || {}, {
    "X-Admin-Password": pw,
  });
  let res;
  try {
    res = await fetch(API_BASE + path, { ...opts, headers });
  } catch (e) {
    const msg = (e && e.message) || String(e);
    return { ok: false, status: 0, error: "NETWORK: " + msg };
  }
  if (res.status === 401) {
    return { ok: false, status: res.status, error: "UNAUTHORIZED" };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: "HTTP_" + res.status };
  }
  try {
    const data = await res.json();
    return { ok: true, status: res.status, data };
  } catch (e) {
    return { ok: false, status: res.status, error: "BAD_JSON" };
  }
}

async function checkHealth() {
  const pill = document.getElementById("status-pill");
  const text = document.getElementById("status-text");
  try {
    const res = await fetch(API_BASE + "/health");
    const data = await res.json();
    if (data.status === "ok") {
      pill.querySelector(".dot").classList.remove("dot-bad");
      pill.querySelector(".dot").classList.add("dot-ok");
      text.textContent = "API online · " + API_BASE;
    } else {
      text.textContent = "API up but health check is not OK";
    }
  } catch (e) {
    pill.querySelector(".dot").classList.remove("dot-ok");
    pill.querySelector(".dot").classList.add("dot-bad");
    text.textContent = "API unreachable (check Render) · " + API_BASE;
  }
}

function renderTransactions(items) {
  const body = document.getElementById("tx-body");
  body.innerHTML = "";
  if (!items || items.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.className = "muted";
    td.textContent = "No transmissions yet.";
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  items.forEach((tx, index) => {
    const tr = document.createElement("tr");

    const tdNum = document.createElement("td");
    tdNum.textContent = String(index + 1);
    tr.appendChild(tdNum);

    const tdTime = document.createElement("td");
    tdTime.textContent = formatNy(tx.timestamp_ny);
    tr.appendChild(tdTime);

    const tdClient = document.createElement("td");
    tdClient.innerHTML = `<strong>${tx.filename}</strong>`;
    tr.appendChild(tdClient);

    const tdTelegram = document.createElement("td");
    tdTelegram.textContent = tx.telegram_name || "—";
    tr.appendChild(tdTelegram);

    const tdDriver = document.createElement("td");
    if (tx.recipient_name) {
      tdDriver.textContent = tx.recipient_name;
    } else {
      tdDriver.textContent = "Not recorded";
    }
    tr.appendChild(tdDriver);

    const tdStatus = document.createElement("td");
    tdStatus.className = "status";
    const pill = document.createElement("span");
    const status = (tx.delivery_status || "").toUpperCase();
    pill.classList.add("pill");
    if (status === "DELIVERED") {
      pill.classList.add("delivered");
    } else if (status === "PENDING") {
      pill.classList.add("pending");
    } else {
      pill.classList.add("failed");
    }
    pill.textContent = status || "UNKNOWN";
    tdStatus.appendChild(pill);
    tr.appendChild(tdStatus);

    body.appendChild(tr);
  });
}

async function refreshTransactions() {
  const body = document.getElementById("tx-body");
  try {
    const data = await fetchWithAdmin("/transactions");
    renderTransactions(data);
  } catch (e) {
    console.error(e);
    if (!body) {
      return;
    }
    body.innerHTML = "";
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.className = "muted";
    td.textContent =
      (e && e.message && String(e.message).startsWith("NETWORK:")
        ? "API unreachable. Check Render service and network, or point admin to the correct API. Base: " +
          API_BASE
        : "Failed to load data. " + (e && e.message ? e.message : "")) +
      "";
    tr.appendChild(td);
    body.appendChild(tr);
  }
}

async function refreshLatest() {
  const el = document.getElementById("latest-tx");
  try {
    const data = await fetchWithAdmin("/transactions/latest");
    if (!data) {
      el.textContent = "No transmissions yet.";
      return;
    }
    el.innerHTML = `
      <div><strong>${data.filename}</strong></div>
      <div class="small">
        ${data.telegram_name || "—"} · ${formatNy(data.timestamp_ny)}
      </div>
      <div class="small">Driver: ${data.recipient_name || "Not recorded"}</div>
      <div class="small">Status: ${data.delivery_status}</div>
    `;
  } catch (e) {
    console.error(e);
    if (el) {
      el.textContent =
        (e && e.message && String(e.message).startsWith("NETWORK:")
          ? "API unreachable. Base: " + API_BASE
          : "Failed to load latest. " + (e && e.message ? e.message : ""));
    }
  }
}

let lastSummary = null;

function renderSummaryTable(summary) {
  const tbody = document.getElementById("summary-tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  const items = (summary && summary.items) || [];
  if (items.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 7;
    td.className = "muted";
    td.textContent = "No transmissions in this summary window.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  // Group by sender (name + handle), but render as a flat table sorted by sender.
  const grouped = {};
  for (const item of items) {
    const key = `${item.telegram_name}||${item.telegram_handle || ""}`;
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(item);
  }

  const senderKeys = Object.keys(grouped).sort();

  let rowNum = 1;
  for (const key of senderKeys) {
    const [name, handle] = key.split("||");
    const senderItems = grouped[key];

    // Optional: a small separator row per sender (visually lightweight)
    const sep = document.createElement("tr");
    const sepTd = document.createElement("td");
    sepTd.colSpan = 7;
    sepTd.className = "small";
    sepTd.textContent = `${name} ${handle ? "(" + handle + ")" : ""} · ${
      senderItems.length
    } item(s)`;
    sep.appendChild(sepTd);
    tbody.appendChild(sep);

    for (const it of senderItems) {
      const tr = document.createElement("tr");

      const tdNum = document.createElement("td");
      tdNum.textContent = String(rowNum++);
      tr.appendChild(tdNum);

      const tdSender = document.createElement("td");
      tdSender.textContent = name;
      tr.appendChild(tdSender);

      const tdHandle = document.createElement("td");
      tdHandle.textContent = handle || "—";
      tr.appendChild(tdHandle);

      const tdDriver = document.createElement("td");
      tdDriver.textContent = it.recipient_name || "—";
      tr.appendChild(tdDriver);

      const tdFile = document.createElement("td");
      tdFile.textContent = it.filename;
      tr.appendChild(tdFile);

      const tdTime = document.createElement("td");
      tdTime.textContent = formatNy(it.timestamp_ny);
      tr.appendChild(tdTime);

      const tdStatus = document.createElement("td");
      tdStatus.textContent = (it.delivery_status || "").toUpperCase();
      tr.appendChild(tdStatus);

      tbody.appendChild(tr);
    }
  }
}

function downloadSummaryCsv() {
  if (!lastSummary || !lastSummary.items || lastSummary.items.length === 0) {
    alert("No summary data to download. Generate a summary first.");
    return;
  }

  const rows = [
    [
      "Row",
      "SenderName",
      "SenderHandle",
      "IssuerGroup",
      "DriverName",
      "Filename",
      "Time_NJ",
      "Status",
    ],
  ];

  for (let i = 0; i < lastSummary.items.length; i += 1) {
    const it = lastSummary.items[i];
    rows.push([
      i + 1,
      it.telegram_name || "",
      formatHandleWithAt(it.telegram_handle),
      issuerGroupFromHandle(it.telegram_handle),
      it.recipient_name || "Not recorded",
      it.filename || "",
      formatNy(it.timestamp_ny || ""),
      (it.delivery_status || "").toUpperCase(),
    ]);
  }

  const csv = rows
    .map((r) =>
      r
        .map((field) => {
          const v = String(field ?? "");
          if (v.includes(",") || v.includes('"') || v.includes("\n")) {
            return `"${v.replace(/"/g, '""')}"`;
          }
          return v;
        })
        .join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "krab_sender_summary.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Issuer team totals for the dashboard.
 *
 * Important: do NOT trust `issuer_group` alone — production data may label
 * highkage senders (e.g. @haruhatsu) as sensei. Telegram handle list wins.
 */
function deriveGroupCountsForDashboard(data) {
  const items = (data && data.items) || [];
  const counts = {
    sensei_group: { issued: 0, sent: 0 },
    highkage_group: { issued: 0, sent: 0 },
  };

  for (const it of items) {
    const status = (it.delivery_status || "").toUpperCase();
    const handle = String(it.telegram_handle || "")
      .trim()
      .toLowerCase()
      .replace(/^@/, "");
    const bucket = HIGHKAGE_FALLBACK_HANDLES.has(handle)
      ? "highkage_group"
      : "sensei_group";
    counts[bucket].issued += 1;
    if (status === "DELIVERED") {
      counts[bucket].sent += 1;
    }
  }

  return counts;
}

function windowKeyToDays(windowKey) {
  const k = (windowKey || "1w").toLowerCase();
  const map = {
    "1w": 7,
    "1m": 30,
    "3m": 90,
    "6m": 180,
    "1y": 365,
    all: null,
  };
  return map[k] === undefined ? 7 : map[k];
}

function parseItemTimeMs(item) {
  const raw = (item && item.timestamp_ny) || "";
  if (!raw) {
    return NaN;
  }
  const t = new Date(raw);
  const ms = t.getTime();
  return Number.isNaN(ms) ? NaN : ms;
}

async function fetchAllAdminTransactions() {
  const all = [];
  const pageSize = 200;
  let offset = 0;
  const maxItems = 20000;
  while (all.length < maxItems) {
    const pageRes = await requestWithAdminJson(
      "/transactions?limit=" + pageSize + "&offset=" + offset
    );
    if (!pageRes.ok) {
      throw new Error(pageRes.error || "FAILED_PAGE");
    }
    const page = pageRes.data;
    if (!page || page.length === 0) {
      break;
    }
    for (const row of page) {
      all.push(row);
    }
    if (page.length < pageSize) {
      break;
    }
    offset += pageSize;
  }
  return all;
}

function buildClientWindowSummary(allTx, windowKey) {
  const nowMs = Date.now();
  const days = windowKeyToDays(windowKey);
  const startMs = days == null ? null : nowMs - days * 24 * 60 * 60 * 1000;

  const filtered = [];
  for (const it of allTx) {
    const tms = parseItemTimeMs(it);
    if (Number.isNaN(tms)) {
      continue;
    }
    if (startMs == null || tms >= startMs) {
      filtered.push(it);
    }
  }
  filtered.sort((a, b) => parseItemTimeMs(a) - parseItemTimeMs(b));

  let delivered = 0;
  let pending = 0;
  let failed = 0;
  for (const it of filtered) {
    const status = (it.delivery_status || "").toUpperCase();
    if (status === "DELIVERED") {
      delivered += 1;
    } else if (status === "PENDING") {
      pending += 1;
    } else {
      failed += 1;
    }
  }

  const firstItemMs = filtered.length > 0 ? parseItemTimeMs(filtered[0]) : NaN;
  const lastItemMs =
    filtered.length > 0
      ? parseItemTimeMs(filtered[filtered.length - 1])
      : NaN;

  let periodStartMs = nowMs;
  if (filtered.length > 0 && !Number.isNaN(firstItemMs)) {
    periodStartMs = firstItemMs;
  } else if (startMs != null) {
    periodStartMs = startMs;
  } else {
    // "all" and no data: use now as a harmless anchor for formatting
    periodStartMs = nowMs;
  }

  let periodEndMs = nowMs;
  if (filtered.length > 0 && !Number.isNaN(lastItemMs)) {
    periodEndMs = lastItemMs;
  }

  return {
    period_start_ny: new Date(periodStartMs).toISOString(),
    period_end_ny: new Date(periodEndMs).toISOString(),
    total_transactions: filtered.length,
    delivered,
    pending,
    failed,
    items: filtered,
    _client_window: true,
  };
}

async function refreshSummary() {
  const windowEl = document.getElementById("summary-window");
  const periodEl = document.getElementById("summary-period");
  const totalEl = document.getElementById("summary-total");
  const revenueEl = document.getElementById("summary-revenue");
  const deliveredEl = document.getElementById("summary-delivered");
  const pfEl = document.getElementById("summary-pending-failed");
  const senseiEl = document.getElementById("summary-sensei");
  const highkageEl = document.getElementById("summary-highkage");
  const statusEl = document.getElementById("summary-status");

  try {
    const windowKey = (windowEl && windowEl.value) || "1w";
    if (statusEl) {
      statusEl.textContent = "Loading summary (NJ)...";
    }

    // Primary path: server-side rolling window summary (avoids large /transactions scans).
    const rollRes = await requestWithAdminJson(
      "/summaries/rolling?window=" + encodeURIComponent(windowKey)
    );
    let data = null;
    if (rollRes.ok) {
      data = rollRes.data;
    } else {
      if (statusEl) {
        statusEl.textContent =
          "Rolling summary API unavailable, building summary locally (can be slow)...";
      }
      const allTx = await fetchAllAdminTransactions();
      data = buildClientWindowSummary(allTx, windowKey);
    }
    lastSummary = data;
    periodEl.textContent =
      data.period_start_ny && data.period_end_ny
        ? `${formatNy(data.period_start_ny)} → ${formatNy(data.period_end_ny)}`
        : `All time → ${formatNy(data.period_end_ny)}`;
    totalEl.textContent = `${data.total_transactions} total`;
    if (revenueEl) {
      revenueEl.textContent = formatRevenueUsd(data.total_transactions);
    }
    deliveredEl.textContent = data.delivered;
    pfEl.textContent = `${data.pending} / ${data.failed}`;
    const fallbackCounts = deriveGroupCountsForDashboard(data);
    const apiGc = data.group_counts;
    const useApiGroupCounts =
      apiGc &&
      apiGc.sensei_group &&
      apiGc.highkage_group &&
      !data._client_window;
    const sensei = useApiGroupCounts
      ? apiGc.sensei_group
      : fallbackCounts.sensei_group;
    const highkage = useApiGroupCounts
      ? apiGc.highkage_group
      : fallbackCounts.highkage_group;
    senseiEl.textContent = `${sensei.issued} / ${sensei.sent}`;
    highkageEl.textContent = `${highkage.issued} / ${highkage.sent}`;
    if (statusEl) {
      if (data.total_transactions === 0) {
        statusEl.textContent = "No transmissions in the selected window.";
      } else {
        const omitted = Number(data.items_omitted) || 0;
        const extra =
          omitted > 0
            ? ` Table lists the latest ${
                (data.items && data.items.length) || 0
              } rows; ${omitted} older rows are omitted from the table.`
            : "";
        statusEl.textContent = "Summary generated successfully." + extra;
      }
    }

    renderSummaryTable(data);
  } catch (e) {
    console.error(e);
    const revenueOnErr = document.getElementById("summary-revenue");
    if (revenueOnErr) {
      revenueOnErr.textContent = "—";
    }
    if (statusEl) {
      statusEl.textContent =
        e && e.message && String(e.message).startsWith("NETWORK:")
          ? "API unreachable. Check Render service, then try again. Base: " + API_BASE
          : "Failed to load summary. " + (e && e.message ? e.message : "");
    }
  }
}

function applyLoggedInUI(loggedIn) {
  const authArea = document.getElementById("auth-area");
  const dashArea = document.getElementById("dashboard-area");
  const logoutBtn = document.getElementById("logout-btn");

  authArea.style.display = loggedIn ? "none" : "block";
  dashArea.style.display = loggedIn ? "block" : "none";
  logoutBtn.style.display = loggedIn ? "inline-flex" : "none";
}

async function tryInitialLogin() {
  const pw = getStoredPassword();
  if (!pw) return;
  try {
    await refreshTransactions();
    await refreshLatest();
    await refreshSummary();
    applyLoggedInUI(true);
  } catch {
    // stored password invalid
    storePassword("");
    applyLoggedInUI(false);
  }
}

function setupEvents() {
  const loginBtn = document.getElementById("login-btn");
  const input = document.getElementById("admin-password-input");
  const err = document.getElementById("auth-error");
  const logoutBtn = document.getElementById("logout-btn");
  const refreshTableBtn = document.getElementById("refresh-table-btn");
  const summaryBtn = document.getElementById("summary-btn");
  const summaryDownloadBtn = document.getElementById(
    "summary-download-btn"
  );

  async function doLogin() {
    const pw = input.value.trim();
    if (!pw) return;
    storePassword(pw);
    err.style.display = "none";
    try {
      await refreshTransactions();
      await refreshLatest();
      await refreshSummary();
      applyLoggedInUI(true);
      // Recipients will be refreshed by the modified applyLoggedInUI
    } catch (e) {
      console.error(e);
      storePassword("");
      err.style.display = "block";
    }
  }

  loginBtn.addEventListener("click", doLogin);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      doLogin();
    }
  });

  logoutBtn.addEventListener("click", () => {
    storePassword("");
    applyLoggedInUI(false);
  });

  refreshTableBtn.addEventListener("click", () => {
    refreshTransactions();
    refreshLatest();
  });

  summaryBtn.addEventListener("click", () => {
    refreshSummary();
  });

  if (summaryDownloadBtn) {
    summaryDownloadBtn.addEventListener("click", () => {
      downloadSummaryCsv();
    });
  }

  // Recipient management
  const addRecipientBtn = document.getElementById("add-recipient-btn");
  const recipientForm = document.getElementById("recipient-form");
  const recipientNameInput = document.getElementById("recipient-name-input");
  const recipientEmailInput = document.getElementById("recipient-email-input");
  const saveRecipientBtn = document.getElementById("save-recipient-btn");
  const cancelRecipientBtn = document.getElementById("cancel-recipient-btn");
  const recipientError = document.getElementById("recipient-error");
  const recipientsBody = document.getElementById("recipients-body");

  async function refreshRecipients() {
    try {
      const recipients = await fetchWithAdmin("/recipients/all");
      renderRecipients(recipients);
    } catch (e) {
      console.error("Failed to fetch recipients:", e);
      recipientsBody.innerHTML = `
        <tr>
          <td colspan="3" class="muted">Failed to load recipients.</td>
        </tr>
      `;
    }
  }

  function renderRecipients(recipients) {
    recipientsBody.innerHTML = "";
    if (!recipients || recipients.length === 0) {
      recipientsBody.innerHTML = `
        <tr>
          <td colspan="3" class="muted">No recipients yet. Click "Add" to create one.</td>
        </tr>
      `;
      return;
    }

    for (const r of recipients) {
      const tr = document.createElement("tr");

      const tdName = document.createElement("td");
      tdName.textContent = r.name;
      tr.appendChild(tdName);

      const tdEmail = document.createElement("td");
      tdEmail.textContent = r.email;
      tr.appendChild(tdEmail);

      const tdActions = document.createElement("td");
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "secondary";
      deleteBtn.style.fontSize = "0.75rem";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => deleteRecipient(r.id));
      tdActions.appendChild(deleteBtn);
      tr.appendChild(tdActions);

      recipientsBody.appendChild(tr);
    }
  }

  async function deleteRecipient(id) {
    if (!confirm("Are you sure you want to delete this recipient?")) {
      return;
    }
    try {
      await fetchWithAdmin(`/recipients/${id}`, { method: "DELETE" });
      await refreshRecipients();
    } catch (e) {
      console.error("Failed to delete recipient:", e);
      alert("Failed to delete recipient. Please try again.");
    }
  }

  async function saveRecipient() {
    const name = recipientNameInput.value.trim();
    const email = recipientEmailInput.value.trim();

    if (!name || !email) {
      recipientError.textContent = "Name and email are required.";
      recipientError.style.display = "block";
      return;
    }

    if (!email.includes("@")) {
      recipientError.textContent = "Please enter a valid email address.";
      recipientError.style.display = "block";
      return;
    }

    recipientError.style.display = "none";

    try {
      await fetchWithAdmin("/recipients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      recipientNameInput.value = "";
      recipientEmailInput.value = "";
      recipientForm.style.display = "none";
      await refreshRecipients();
    } catch (e) {
      console.error("Failed to save recipient:", e);
      recipientError.textContent = "Failed to save recipient. Please try again.";
      recipientError.style.display = "block";
    }
  }

  addRecipientBtn.addEventListener("click", () => {
    recipientForm.style.display = "block";
    recipientNameInput.focus();
  });

  cancelRecipientBtn.addEventListener("click", () => {
    recipientForm.style.display = "none";
    recipientNameInput.value = "";
    recipientEmailInput.value = "";
    recipientError.style.display = "none";
  });

  saveRecipientBtn.addEventListener("click", saveRecipient);

  recipientNameInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      recipientEmailInput.focus();
    }
  });

  recipientEmailInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      saveRecipient();
    }
  });

  // Refresh recipients when logged in
  const originalApplyLoggedInUI = applyLoggedInUI;
  applyLoggedInUI = (loggedIn) => {
    originalApplyLoggedInUI(loggedIn);
    if (loggedIn) {
      refreshRecipients();
    }
  };
}

window.addEventListener("DOMContentLoaded", () => {
  checkHealth();
  setupEvents();
  tryInitialLogin();
});


