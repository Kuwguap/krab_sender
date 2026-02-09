const API_BASE = "";

function formatNy(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return (
      d.toLocaleString("en-US", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }) + " ET"
    );
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
  const res = await fetch(API_BASE + path, {
    ...opts,
    headers,
  });
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
      text.textContent = "Bot & API healthy";
    } else {
      text.textContent = "API responding with errors";
    }
  } catch (e) {
    text.textContent = "Unable to reach API";
  }
}

function renderTransactions(items) {
  const body = document.getElementById("tx-body");
  body.innerHTML = "";
  if (!items || items.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
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
  try {
    const data = await fetchWithAdmin("/transactions");
    renderTransactions(data);
  } catch (e) {
    console.error(e);
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
      <div class="small">Status: ${data.delivery_status}</div>
    `;
  } catch (e) {
    console.error(e);
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
    td.colSpan = 5;
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

  for (const key of senderKeys) {
    const [name, handle] = key.split("||");
    const senderItems = grouped[key];

    // Optional: a small separator row per sender (visually lightweight)
    const sep = document.createElement("tr");
    const sepTd = document.createElement("td");
    sepTd.colSpan = 5;
    sepTd.className = "small";
    sepTd.textContent = `${name} ${handle ? "(" + handle + ")" : ""} · ${
      senderItems.length
    } item(s)`;
    sep.appendChild(sepTd);
    tbody.appendChild(sep);

    for (const it of senderItems) {
      const tr = document.createElement("tr");

      const tdSender = document.createElement("td");
      tdSender.textContent = name;
      tr.appendChild(tdSender);

      const tdHandle = document.createElement("td");
      tdHandle.textContent = handle || "—";
      tr.appendChild(tdHandle);

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
    ["SenderName", "SenderHandle", "Filename", "Time_NJ", "Status"],
  ];

  for (const it of lastSummary.items) {
    rows.push([
      it.telegram_name || "",
      it.telegram_handle || "",
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

async function refreshSummary() {
  const periodEl = document.getElementById("summary-period");
  const totalEl = document.getElementById("summary-total");
  const deliveredEl = document.getElementById("summary-delivered");
  const pfEl = document.getElementById("summary-pending-failed");
  const statusEl = document.getElementById("summary-status");

  try {
    if (statusEl) {
      statusEl.textContent = "Generating 7‑day summary (America/New_York)...";
    }
    const data = await fetchWithAdmin("/summaries/weekly/previous");
    lastSummary = data;
    periodEl.textContent = `${formatNy(
      data.period_start_ny
    )} → ${formatNy(data.period_end_ny)}`;
    totalEl.textContent = `${data.total_transactions} total`;
    deliveredEl.textContent = data.delivered;
    pfEl.textContent = `${data.pending} / ${data.failed}`;
    if (statusEl) {
      if (data.total_transactions === 0) {
        statusEl.textContent =
          "No transmissions in the last 7 NJ days. This is expected if you just started using the bot.";
      } else {
        statusEl.textContent =
          "Summary generated for the last 7 NJ days.";
      }
    }

    renderSummaryTable(data);
  } catch (e) {
    console.error(e);
    if (statusEl) {
      statusEl.textContent = "Failed to load summary. Check console/network.";
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
}

window.addEventListener("DOMContentLoaded", () => {
  checkHealth();
  setupEvents();
  tryInitialLogin();
});


