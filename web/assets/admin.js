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
    if (tab === "bookings") loadBookings();
    if (tab === "invoices") loadInvoices();
    if (tab === "notifications") loadNotifications();
    if (tab === "conversations") loadConversations();
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

  // ===== Bookings =====
  let bookingsCache = [], selectedBookingId = null;

  async function loadBookings() {
    await loadCustomersIndex();
    bookingsCache = await api("/api/bookings");
    $("#bookingsList").innerHTML = bookingsCache.map(b => `
      <div class="card${b.id === selectedBookingId ? " selected" : ""}" data-id="${b.id}">
        <div class="card-top">
          <span class="card-title">${customerName(b.customer_id)}</span>
          <span class="status-pill status-${b.status === "confirmed" ? "quoted" : b.status === "completed" ? "won" : b.status === "cancelled" ? "lost" : "new"}">${b.status}</span>
        </div>
        <div class="card-sub">${b.booking_type} — ${b.description}</div>
      </div>`).join("") || "<p class='muted'>No bookings yet.</p>";
    $$(".card[data-id]", $("#bookingsList")).forEach(card => card.addEventListener("click", () => selectBooking(Number(card.dataset.id))));
  }

  async function selectBooking(id) {
    selectedBookingId = id;
    $$(".card", $("#bookingsList")).forEach(c => c.classList.toggle("selected", Number(c.dataset.id) === id));
    const booking = await api(`/api/bookings/${id}`);
    const itemsTotal = booking.items.reduce((s, i) => s + i.quantity * i.unit_price_aed, 0);

    $("#bookingDetail").innerHTML = `
      <h2>${customerName(booking.customer_id)}</h2>
      <p class="muted">${booking.booking_type} — ${booking.description}</p>
      <div class="row">
        ${["draft", "confirmed", "completed", "cancelled"].map(s =>
          `<button class="btn-outline booking-status-btn${s === booking.status ? " active" : ""}" data-status="${s}">${s}</button>`).join("")}
      </div>
      <table>
        <tr><td>Travel dates</td><td>${booking.travel_date_start || "—"} to ${booking.travel_date_end || "—"}</td></tr>
        <tr><td>Items total</td><td>AED ${itemsTotal.toFixed(2)}</td></tr>
      </table>
      <h3>Line items</h3>
      <div class="timeline">${booking.items.map(i => `
        <div class="timeline-item">${i.description} — ${i.quantity} × AED ${i.unit_price_aed}</div>`).join("") || "<p class='muted'>No items yet.</p>"}</div>
      <form class="note-form" id="itemForm">
        <input name="description" placeholder="Item description" required style="flex:2">
        <input name="quantity" type="number" step="0.5" value="1" placeholder="Qty" style="width:70px">
        <input name="unitPriceAed" type="number" step="0.01" placeholder="AED" required style="width:100px">
        <button type="submit">Add</button>
      </form>
      <div class="row" style="margin-top:16px">
        <button class="btn-outline" id="genInvoiceBtn"${booking.items.length ? "" : " disabled"}>Generate invoice</button>
      </div>`;

    $$(".booking-status-btn", $("#bookingDetail")).forEach(btn => btn.addEventListener("click", async () => {
      await api(`/api/bookings/${id}/status`, { method: "PATCH", body: JSON.stringify({ status: btn.dataset.status }) });
      await loadBookings();
      selectBooking(id);
    }));

    $("#itemForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await api(`/api/bookings/${id}/items`, { method: "POST", body: JSON.stringify({ description: fd.get("description"), quantity: Number(fd.get("quantity")), unitPriceAed: Number(fd.get("unitPriceAed")) }) });
      selectBooking(id);
    });

    const genBtn = $("#genInvoiceBtn");
    genBtn && genBtn.addEventListener("click", async () => {
      const inv = await api("/api/invoices", { method: "POST", body: JSON.stringify({ bookingId: id }) });
      alert(`Invoice ${inv.invoiceNumber} created — AED ${inv.total} total.`);
      $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === "invoices"));
      $$(".tab").forEach(t => t.hidden = t.id !== "tab-invoices");
      await loadInvoices();
      selectInvoice(inv.id);
    });
  }

  // ===== Invoices =====
  let invoicesCache = [], selectedInvoiceId = null;

  async function loadInvoices() {
    await loadCustomersIndex();
    invoicesCache = await api("/api/invoices");
    $("#invoicesList").innerHTML = invoicesCache.map(inv => `
      <div class="card${inv.id === selectedInvoiceId ? " selected" : ""}" data-id="${inv.id}">
        <div class="card-top">
          <span class="card-title">${inv.invoice_number}</span>
          <span class="status-pill status-${inv.status === "paid" ? "won" : inv.status === "cancelled" ? "lost" : inv.status === "sent" ? "quoted" : "new"}">${inv.status}</span>
        </div>
        <div class="card-sub">${customerName(inv.customer_id)} — AED ${inv.total_aed}</div>
      </div>`).join("") || "<p class='muted'>No invoices yet.</p>";
    $$(".card[data-id]", $("#invoicesList")).forEach(card => card.addEventListener("click", () => selectInvoice(Number(card.dataset.id))));
  }

  async function selectInvoice(id) {
    selectedInvoiceId = id;
    $$(".card", $("#invoicesList")).forEach(c => c.classList.toggle("selected", Number(c.dataset.id) === id));
    const inv = await api(`/api/invoices/${id}`);

    $("#invoiceDetail").innerHTML = `
      <h2>${inv.invoice_number}</h2>
      <p class="muted">${customerName(inv.customer_id)}</p>
      <div class="row">
        ${["draft", "sent", "paid", "overdue", "cancelled"].map(s =>
          `<button class="btn-outline invoice-status-btn${s === inv.status ? " active" : ""}" data-status="${s}">${s}</button>`).join("")}
      </div>
      <table>
        <tr><td>Issue date</td><td>${inv.issue_date}</td></tr>
        <tr><td>Due date</td><td>${inv.due_date || "—"}</td></tr>
        <tr><td>Subtotal</td><td>AED ${inv.subtotal_aed}</td></tr>
        <tr><td>VAT (${inv.vat_rate_bps / 100}%)</td><td>AED ${inv.vat_amount_aed}</td></tr>
        <tr><td><b>Total</b></td><td><b>AED ${inv.total_aed}</b></td></tr>
        <tr><td>Balance due</td><td>AED ${inv.balanceDueAed}</td></tr>
      </table>
      <h3>Line items</h3>
      <div class="timeline">${inv.items.map(i => `
        <div class="timeline-item">${i.description} — ${i.quantity} × AED ${i.unit_price_aed} = AED ${i.line_total_aed}</div>`).join("")}</div>
      <h3>Payments</h3>
      <div class="timeline">${inv.payments.map(p => `
        <div class="timeline-item">AED ${p.amount_aed} via ${p.method}${p.reference ? " (" + p.reference + ")" : ""}<div class="meta">${timeAgo(p.paid_at)}</div></div>`).join("") || "<p class='muted'>No payments yet.</p>"}</div>
      ${inv.balanceDueAed > 0 ? `
      <form class="note-form" id="paymentForm">
        <select name="method"><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="cash">Cash</option><option value="stripe">Stripe</option><option value="telr">Telr</option></select>
        <input name="amountAed" type="number" step="0.01" placeholder="AED amount" value="${inv.balanceDueAed}" required>
        <button type="submit">Record payment</button>
      </form>` : ""}`;

    $$(".invoice-status-btn", $("#invoiceDetail")).forEach(btn => btn.addEventListener("click", async () => {
      await api(`/api/invoices/${id}/status`, { method: "PATCH", body: JSON.stringify({ status: btn.dataset.status }) });
      await loadInvoices();
      selectInvoice(id);
    }));

    const payForm = $("#paymentForm");
    payForm && payForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await api(`/api/invoices/${id}/payments`, { method: "POST", body: JSON.stringify({ amountAed: Number(fd.get("amountAed")), method: fd.get("method") }) });
      await loadInvoices();
      selectInvoice(id);
    });
  }

  // ===== AI Conversations =====
  let conversationsCache = [], selectedConversationId = null;

  async function loadConversations() {
    await loadCustomersIndex();
    conversationsCache = await api("/api/conversations");
    $("#conversationsList").innerHTML = conversationsCache.map(c => `
      <div class="card${c.id === selectedConversationId ? " selected" : ""}" data-id="${c.id}">
        <div class="card-top">
          <span class="card-title">${c.customer_name || (c.customer_id ? customerName(c.customer_id) : "Anonymous")}</span>
          <span class="status-pill status-${c.status === "handed_off" ? "quoted" : c.status === "closed" ? "lost" : "new"}">${c.status}</span>
        </div>
        <div class="card-sub">${c.agent_type.replace("_", " ")} · ${c.channel}</div>
        <div class="card-sub">${timeAgo(c.updated_at)}</div>
      </div>`).join("") || "<p class='muted'>No conversations yet.</p>";
    $$(".card[data-id]", $("#conversationsList")).forEach(card => card.addEventListener("click", () => selectConversation(Number(card.dataset.id))));
  }

  async function selectConversation(id) {
    selectedConversationId = id;
    $$(".card", $("#conversationsList")).forEach(c => c.classList.toggle("selected", Number(c.dataset.id) === id));
    const convo = conversationsCache.find(c => c.id === id);
    const messages = await api(`/api/conversations/${id}/messages`);

    $("#conversationDetail").innerHTML = `
      <h2>${convo.customer_name || (convo.customer_id ? customerName(convo.customer_id) : "Anonymous")}</h2>
      <p class="muted">${convo.agent_type.replace("_", " ")} · ${convo.channel} · <span class="status-pill status-${convo.status === "handed_off" ? "quoted" : convo.status === "closed" ? "lost" : "new"}">${convo.status}</span></p>
      <div class="timeline">${messages.map(m => `
        <div class="timeline-item">
          <b>${m.role === "user" ? "Customer" : m.role === "assistant" ? "AI" : m.role}:</b> ${m.content}
          <div class="meta">${timeAgo(m.created_at)}</div>
        </div>`).join("") || "<p class='muted'>No messages yet.</p>"}</div>`;
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
