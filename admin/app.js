// Must point to Render *web* service (FastAPI), not the worker.
// Override (no code change): add ?api=https%3A%2F%2Fyour-api.onrender.com
// to the admin URL, or set localStorage key `krab_api_base` to a full base URL
// (no trailing slash), then reload.
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

    return `Timestamp ${month} ${day} ${year} ${hours}:${minutes}${ampm.toLowerCase()}`;
  } catch {
    return ts;
  }
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
    td.colSpan = 5;
    td.className = "muted";
    td.textContent = "No transmissions yet.";
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  for (const tx of items) {
    const tr = document.createElement("tr");

    const tdTime = document.createElement("td");
    tdTime.textContent = formatNy(tx.timestamp_ny);
    tr.appendChild(tdTime);

    const tdClient = document.createElement("td");
    tdClient.innerHTML = `<strong>${tx.filename}</strong>`;
    tr.appendChild(tdClient);

    const tdTelegram = document.createElement("td");
    tdTelegram.textContent = `${tx.telegram_name} ${
      tx.telegram_handle ? "(@" + tx.telegram_handle + ")" : ""
    }`;
    tr.appendChild(tdTelegram);

    const tdDriver = document.createElement("td");
    if (tx.recipient_name || tx.recipient_email) {
      tdDriver.textContent = `${tx.recipient_name || "Unknown"}${
        tx.recipient_email ? " (" + tx.recipient_email + ")" : ""
      }`;
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
  }
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
    td.colSpan = 5;
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
        ${data.telegram_name} ${
      data.telegram_handle ? "(@" + data.telegram_handle + ")" : ""
    } · ${formatNy(data.timestamp_ny)}
      </div>
      <div class="small">Driver lead: ${data.recipient_name || "Not recorded"}${
      data.recipient_email ? " (" + data.recipient_email + ")" : ""
    }</div>
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
const HIGHKAGE_FALLBACK_HANDLES = new Set(["haruhatsu"]);

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
      "DriverEmail",
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
      it.telegram_handle || "",
      it.issuer_group || "",
      it.recipient_name || "",
      it.recipient_email || "",
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

function deriveGroupCountsFallback(data) {
  const items = (data && data.items) || [];
  const counts = {
    sensei_group: { issued: 0, sent: 0 },
    highkage_group: { issued: 0, sent: 0 },
  };

  let hasIssuerGroupData = false;
  for (const it of items) {
    const status = (it.delivery_status || "").toUpperCase();
    const group = (it.issuer_group || "").toLowerCase();
    if (group === "sensei_group" || group === "highkage_group") {
      hasIssuerGroupData = true;
      counts[group].issued += 1;
      if (status === "DELIVERED") {
        counts[group].sent += 1;
      }
    }
  }

  // Legacy payload fallback: classify by Telegram handle when issuer_group
  // is not present in backend payloads yet.
  if (!hasIssuerGroupData) {
    for (const it of items) {
      const status = (it.delivery_status || "").toUpperCase();
      const handle = (it.telegram_handle || "").toLowerCase().replace(/^@/, "");
      const bucket = HIGHKAGE_FALLBACK_HANDLES.has(handle)
        ? "highkage_group"
        : "sensei_group";
      counts[bucket].issued += 1;
      if (status === "DELIVERED") {
        counts[bucket].sent += 1;
      }
    }
  }

  return { counts, hasIssuerGroupData };
}

async function refreshSummary() {
  const windowEl = document.getElementById("summary-window");
  const periodEl = document.getElementById("summary-period");
  const totalEl = document.getElementById("summary-total");
  const deliveredEl = document.getElementById("summary-delivered");
  const pfEl = document.getElementById("summary-pending-failed");
  const senseiEl = document.getElementById("summary-sensei");
  const highkageEl = document.getElementById("summary-highkage");
  const statusEl = document.getElementById("summary-status");

  try {
    const windowKey = (windowEl && windowEl.value) || "1w";
    if (statusEl) {
      statusEl.textContent = "Generating summary (America/New_York)...";
    }
    // Production backend currently supports weekly endpoint reliably.
    const data = await fetchWithAdmin("/summaries/weekly/previous");
    lastSummary = data;
    periodEl.textContent =
      data.period_start_ny && data.period_end_ny
        ? `${formatNy(data.period_start_ny)} → ${formatNy(data.period_end_ny)}`
        : `All time → ${formatNy(data.period_end_ny)}`;
    totalEl.textContent = `${data.total_transactions} total`;
    deliveredEl.textContent = data.delivered;
    pfEl.textContent = `${data.pending} / ${data.failed}`;
    const apiSensei = data.group_counts && data.group_counts.sensei_group;
    const apiHighkage = data.group_counts && data.group_counts.highkage_group;
    const { counts: fallbackCounts, hasIssuerGroupData } =
      deriveGroupCountsFallback(data);
    const sensei = apiSensei || fallbackCounts.sensei_group;
    const highkage = apiHighkage || fallbackCounts.highkage_group;
    senseiEl.textContent = `${sensei.issued} / ${sensei.sent}`;
    highkageEl.textContent = `${highkage.issued} / ${highkage.sent}`;
    if (statusEl) {
      if (data.total_transactions === 0) {
        statusEl.textContent = "No transmissions in the weekly summary window.";
      } else if (!apiSensei && !apiHighkage && !hasIssuerGroupData) {
        statusEl.textContent =
          "Summary generated. Group split is approximate until backend issuer-group fields are deployed.";
      } else {
        statusEl.textContent =
          windowKey === "1w"
            ? "Summary generated successfully."
            : "Weekly summary loaded. Deploy latest backend to enable custom windows.";
      }
    }

    renderSummaryTable(data);
  } catch (e) {
    console.error(e);
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


