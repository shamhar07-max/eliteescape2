(async function () {
  "use strict";
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const api = (path, opts = {}) => fetch(path, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts })
    .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText); return r.status === 204 ? null : r.json(); });

  // gate: must be logged in
  let me;
  try { me = await api("/api/auth/me"); }
  catch { location.href = "/login.html"; return; }
  $("#whoami").textContent = `${me.fullName} · ${me.role}`;

  $("#logoutBtn").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    location.href = "/login.html";
  });

  // tabs
  $$(".nav-btn").forEach(btn => btn.addEventListener("click", () => {
    $$(".nav-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    $$(".tab").forEach(t => t.hidden = t.id !== `tab-${tab}`);
    if (tab === "customers") loadCustomers();
    if (tab === "notifications") loadNotifications();
  }));

  const timeAgo = (iso) => {
    const s = Math.floor((Date.now() - new Date(iso + "Z")) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };

  // ===== Leads =====
  let leadsCache = [], customersCache = {}, selectedLeadId = null;

  const customerName = (id) => customersCache[id]?.full_name || `Customer #${id}`;

  async function loadCustomersIndex() {
    const rows = await api("/api/customers");
    customersCache = Object.fromEntries(rows.map(c => [c.id, c]));
  }

  async function loadLeads() {
    const status = $("#statusFilter").value;
    await loadCustomersIndex();
    leadsCache = await api(`/api/leads${status ? `?status=${status}` : ""}`);
    const list = $("#leadsList");
    list.innerHTML = leadsCache.map(l => `
      <div class="card${l.id === selectedLeadId ? " selected" : ""}" data-id="${l.id}">
        <div class="card-top">
          <span class="card-title">${customerName(l.customer_id)}</span>
          <span class="status-pill status-${l.status}">${l.status}</span>
        </div>
        <div class="card-sub">${l.interest_type}${l.interest_detail ? " — " + l.interest_detail : ""}</div>
        <div class="card-sub">${timeAgo(l.created_at)}</div>
      </div>`).join("") || `<p class="muted">No leads${status ? ` with status "${status}"` : ""}.</p>`;
    $$(".card[data-id]", list).forEach(card => card.addEventListener("click", () => selectLead(Number(card.dataset.id))));
  }

  async function selectLead(id) {
    selectedLeadId = id;
    $$(".card", $("#leadsList")).forEach(c => c.classList.toggle("selected", Number(c.dataset.id) === id));
    const lead = leadsCache.find(l => l.id === id);
    const customer = customersCache[lead.customer_id] || {};
    const activities = await api(`/api/leads/${id}/activities`);

    $("#leadDetail").innerHTML = `
      <h2>${customerName(lead.customer_id)}</h2>
      <p class="muted">${customer.email || ""} ${customer.whatsapp || customer.phone || ""}</p>
      <div class="row">
        ${["new", "contacted", "quoted", "won", "lost"].map(s =>
          `<button class="btn-outline status-btn${s === lead.status ? " active" : ""}" data-status="${s}">${s}</button>`).join("")}
      </div>
      <table>
        <tr><td>Interest</td><td>${lead.interest_type}${lead.interest_detail ? " — " + lead.interest_detail : ""}</td></tr>
        <tr><td>Budget</td><td>${lead.budget_aed ? "AED " + lead.budget_aed : "—"}</td></tr>
        <tr><td>Travel date</td><td>${lead.travel_date || "—"}</td></tr>
        <tr><td>Created</td><td>${lead.created_at}</td></tr>
      </table>
      <h3>Activity</h3>
      <div class="timeline">${activities.map(a => `
        <div class="timeline-item">
          ${a.body}
          <div class="meta">${a.channel} · ${timeAgo(a.created_at)}</div>
        </div>`).join("") || "<p class='muted'>No activity yet.</p>"}</div>
      <form class="note-form" id="noteForm">
        <select name="channel"><option value="note">Note</option><option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option></select>
        <input name="body" placeholder="Add an activity note…" required>
        <button type="submit">Add</button>
      </form>`;

    $$(".status-btn", $("#leadDetail")).forEach(btn => btn.addEventListener("click", async () => {
      await api(`/api/leads/${id}/status`, { method: "PATCH", body: JSON.stringify({ status: btn.dataset.status }) });
      await loadLeads();
      selectLead(id);
    }));

    $("#noteForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await api(`/api/leads/${id}/activities`, { method: "POST", body: JSON.stringify({ channel: fd.get("channel"), body: fd.get("body") }) });
      selectLead(id);
    });
  }

  $("#statusFilter").addEventListener("change", loadLeads);
  await loadLeads();

  // ===== Customers =====
  async function loadCustomers() {
    const rows = await api("/api/customers");
    $("#customersList").innerHTML = rows.map(c => `
      <div class="card">
        <div class="card-top"><span class="card-title">${c.full_name}</span><span class="card-sub">${c.source}</span></div>
        <div class="card-sub">${c.email || ""} ${c.whatsapp || c.phone || ""}</div>
      </div>`).join("") || "<p class='muted'>No customers yet.</p>";
  }

  // ===== Notifications =====
  async function refreshBadge() {
    const { count } = await api("/api/notifications/unread-count");
    const badge = $("#unreadBadge");
    if (count > 0) { badge.textContent = count; badge.hidden = false; } else badge.hidden = true;
  }

  async function loadNotifications() {
    const rows = await api("/api/notifications");
    $("#notificationsList").innerHTML = rows.map(n => `
      <div class="card notif-item${n.is_read ? "" : " unread"}" data-id="${n.id}">
        <div>
          <div class="title">${n.title}</div>
          <div class="body">${n.body || ""}</div>
          <div class="card-sub">${timeAgo(n.created_at)}</div>
        </div>
      </div>`).join("") || "<p class='muted'>No notifications.</p>";
    $$(".notif-item", $("#notificationsList")).forEach(card => card.addEventListener("click", async () => {
      await api(`/api/notifications/${card.dataset.id}/read`, { method: "PATCH" });
      card.classList.remove("unread");
      refreshBadge();
    }));
  }

  $("#markAllRead").addEventListener("click", async () => {
    await api("/api/notifications/read-all", { method: "POST" });
    loadNotifications();
    refreshBadge();
  });

  await refreshBadge();
  setInterval(refreshBadge, 30000);
})();
