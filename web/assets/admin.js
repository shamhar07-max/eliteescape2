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
  if (me.permissions.includes("admin.read")) $("#adminNavBtn").hidden = false;

  $("#logoutBtn").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    location.href = "/login.html";
  });

  $("#changePasswordBtn").addEventListener("click", () => {
    $("#changePasswordForm").hidden = !$("#changePasswordForm").hidden;
  });
  $("#changePasswordForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("/api/auth/password", { method: "PATCH", body: JSON.stringify({
        currentPassword: fd.get("currentPassword"), newPassword: fd.get("newPassword"),
      }) });
      alert("Password updated.");
      e.target.reset();
      e.target.hidden = true;
    } catch (err) { alert(err.message); }
  });

  // tabs
  $$(".nav-btn").forEach(btn => btn.addEventListener("click", () => {
    $$(".nav-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    $$(".tab").forEach(t => t.hidden = t.id !== `tab-${tab}`);
    if (tab === "customers") loadCustomers();
    if (tab === "quotations") loadQuotations();
    if (tab === "bookings") loadBookings();
    if (tab === "visa") loadVisaCases();
    if (tab === "invoices") loadInvoices();
    if (tab === "notifications") loadNotifications();
    if (tab === "conversations") loadConversations();
    if (tab === "ai-assistants") loadAiAssistants();
    if (tab === "employees") loadEmployees();
    if (tab === "leave") loadLeaveRequests();
    if (tab === "payroll") loadPayrollRuns();
    if (tab === "procurement") loadProcurement();
    if (tab === "campaigns") loadCampaigns();
    if (tab === "seo") loadSeoTools();
    if (tab === "admin") loadAdminTab();
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

  // ===== Quotations =====
  let quotationsCache = [];

  function parseItemsText(text) {
    return text.trim().split("\n").map(line => line.trim()).filter(Boolean).map(line => {
      const [serviceType, description, quantity, unitCostAed, unitPriceAed] = line.split("|").map(s => s.trim());
      return { serviceType, description, quantity: Number(quantity), unitCostAed: Number(unitCostAed || 0), unitPriceAed: Number(unitPriceAed) };
    });
  }

  async function loadQuotations() {
    await loadCustomersIndex();
    const select = $("#quoteCustomerSelect");
    select.innerHTML = Object.values(customersCache).map(c => `<option value="${c.id}">${c.full_name}</option>`).join("");

    const status = "";
    quotationsCache = await api(`/api/quotations${status}`);
    $("#quotationsList").innerHTML = quotationsCache.map(q => `
      <div class="card" data-id="${q.id}">
        <div class="card-top">
          <span class="card-title">${q.quotation_number} v${q.version}</span>
          <span class="status-pill status-${q.status === "accepted" ? "won" : q.status === "rejected" || q.status === "expired" ? "lost" : q.status === "sent" ? "quoted" : "new"}">${q.status}</span>
        </div>
        <div class="card-sub">${customerName(q.customer_id)} — AED ${q.total_aed}</div>
      </div>`).join("") || "<p class='muted'>No quotations yet.</p>";
    $$(".card[data-id]", $("#quotationsList")).forEach(card => card.addEventListener("click", () => selectQuotation(Number(card.dataset.id))));
  }

  async function selectQuotation(id) {
    $$(".card", $("#quotationsList")).forEach(c => c.classList.toggle("selected", Number(c.dataset.id) === id));
    const q = await api(`/api/quotations/${id}`);

    $("#quotationDetail").innerHTML = `
      <h2>${q.quotation_number} <span class="muted">v${q.version}</span></h2>
      <p class="muted">${customerName(q.customer_id)} · <span class="status-pill status-${q.status === "accepted" ? "won" : q.status === "rejected" || q.status === "expired" ? "lost" : q.status === "sent" ? "quoted" : "new"}">${q.status}</span></p>
      <table>
        <tr><td>Valid until</td><td>${q.valid_until || "—"}</td></tr>
        <tr><td>Subtotal</td><td>AED ${q.subtotal_aed}</td></tr>
        <tr><td>Discount</td><td>AED ${q.discount_aed}</td></tr>
        <tr><td>Service fee</td><td>AED ${q.service_fee_aed}</td></tr>
        <tr><td><b>Total</b></td><td><b>AED ${q.total_aed}</b></td></tr>
      </table>
      <h3>Line items</h3>
      <div class="timeline">${q.items.map(i => `
        <div class="timeline-item">${i.service_type} — ${i.description} — ${i.quantity} × AED ${i.unit_price_aed} = AED ${i.line_total_aed}</div>`).join("")}</div>
      <h3>Versions</h3>
      <div class="timeline">${q.versions.map(v => `
        <div class="timeline-item">v${v.version} — ${v.status} <div class="meta">${timeAgo(v.created_at)}</div></div>`).join("")}</div>
      ${q.status === "draft" || q.status === "sent" ? `
      <div class="row" style="margin-top:16px">
        ${q.status === "draft" ? `<button class="btn-outline" id="sendQuoteBtn">Mark sent</button>` : ""}
        <button class="btn-outline" id="acceptQuoteBtn">Accept → create booking</button>
        <button class="btn-outline" id="rejectQuoteBtn">Reject</button>
      </div>` : ""}`;

    const sendBtn = $("#sendQuoteBtn"), acceptBtn = $("#acceptQuoteBtn"), rejectBtn = $("#rejectQuoteBtn");
    sendBtn && sendBtn.addEventListener("click", async () => {
      await api(`/api/quotations/${id}/status`, { method: "PATCH", body: JSON.stringify({ status: "sent" }) });
      await loadQuotations(); selectQuotation(id);
    });
    acceptBtn && acceptBtn.addEventListener("click", async () => {
      try {
        const res = await api(`/api/quotations/${id}/accept`, { method: "POST" });
        alert(`Booking #${res.bookingId} created.`);
        await loadQuotations(); selectQuotation(id);
      } catch (err) { alert(err.message); }
    });
    rejectBtn && rejectBtn.addEventListener("click", async () => {
      await api(`/api/quotations/${id}/status`, { method: "PATCH", body: JSON.stringify({ status: "rejected" }) });
      await loadQuotations(); selectQuotation(id);
    });
  }

  $("#quotationForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const items = parseItemsText(fd.get("itemsText"));
      await api("/api/quotations", { method: "POST", body: JSON.stringify({
        customerId: Number(fd.get("customerId")), leadId: fd.get("leadId") ? Number(fd.get("leadId")) : undefined,
        validUntil: fd.get("validUntil") || undefined, discountAed: Number(fd.get("discountAed") || 0),
        serviceFeeAed: Number(fd.get("serviceFeeAed") || 0), items,
      }) });
      e.target.reset();
      await loadQuotations();
    } catch (err) { alert(err.message); }
  });

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

  // ===== Visa Cases =====
  const VISA_STATUSES = [
    "new", "documents_requested", "documents_received", "internal_review", "ready_for_submission",
    "submitted", "appointment_required", "additional_documents_requested", "under_processing",
    "decision_received", "completed", "rejected", "withdrawn", "cancelled",
  ];
  let visaCasesCache = [];

  const visaStatusPill = (s) => s === "completed" ? "won" : ["rejected", "withdrawn", "cancelled"].includes(s) ? "lost" : s === "new" ? "new" : "quoted";

  async function loadVisaCases() {
    await loadCustomersIndex();
    const select = $("#visaCustomerSelect");
    select.innerHTML = Object.values(customersCache).map(c => `<option value="${c.id}">${c.full_name}</option>`).join("");

    visaCasesCache = await api("/api/visa-cases");
    $("#visaCasesList").innerHTML = visaCasesCache.map(v => `
      <div class="card" data-id="${v.id}">
        <div class="card-top">
          <span class="card-title">${v.case_number}</span>
          <span class="status-pill status-${visaStatusPill(v.status)}">${v.status.replace(/_/g, " ")}</span>
        </div>
        <div class="card-sub">${customerName(v.customer_id)} — ${v.destination_country} (${v.visa_type})</div>
      </div>`).join("") || "<p class='muted'>No visa cases yet.</p>";
    $$(".card[data-id]", $("#visaCasesList")).forEach(card => card.addEventListener("click", () => selectVisaCase(Number(card.dataset.id))));
  }

  async function selectVisaCase(id) {
    $$(".card", $("#visaCasesList")).forEach(c => c.classList.toggle("selected", Number(c.dataset.id) === id));
    const v = await api(`/api/visa-cases/${id}`);

    $("#visaCaseDetail").innerHTML = `
      <h2>${v.case_number}</h2>
      <p class="muted">${customerName(v.customer_id)} · ${v.destination_country} · ${v.visa_type}</p>
      <select id="visaStatusSelect" style="margin-bottom:10px">
        ${VISA_STATUSES.map(s => `<option value="${s}"${s === v.status ? " selected" : ""}>${s.replace(/_/g, " ")}</option>`).join("")}
      </select>
      <table>
        <tr><td>Fee</td><td>${v.fee_aed != null ? "AED " + v.fee_aed : "—"}</td></tr>
        <tr><td>Submission ref</td><td>${v.submission_reference || "—"}</td></tr>
        <tr><td>Appointment</td><td>${v.appointment_date || "—"}</td></tr>
      </table>
      <h3>Applicants</h3>
      <div class="timeline">${v.applicants.map(a => `
        <div class="timeline-item">${a.full_name}${a.nationality ? " — " + a.nationality : ""}${a.passport_expiry ? " — passport exp. " + a.passport_expiry : ""}</div>`).join("") || "<p class='muted'>No applicants yet.</p>"}</div>
      <form class="note-form" id="applicantForm" style="flex-wrap:wrap">
        <input name="fullName" placeholder="Applicant full name" required style="flex:1.5">
        <input name="nationality" placeholder="Nationality" style="flex:1">
        <input name="passportExpiry" type="date" style="width:150px">
        <button type="submit">Add</button>
      </form>
      <h3>Documents</h3>
      <div class="timeline">${v.documents.map(d => `
        <div class="timeline-item">${d.document_type}${d.applicant_id ? " (applicant #" + d.applicant_id + ")" : ""}
          <span class="status-pill status-${d.status === "received" ? "won" : d.status === "rejected" ? "lost" : "new"}">${d.status}</span>
          <div class="row" style="margin-top:6px">
            <button class="btn-outline doc-status-btn" data-id="${d.id}" data-status="received">Received</button>
            <button class="btn-outline doc-status-btn" data-id="${d.id}" data-status="rejected">Rejected</button>
          </div>
        </div>`).join("") || "<p class='muted'>No documents requested yet.</p>"}</div>
      <form class="note-form" id="documentForm" style="flex-wrap:wrap">
        <input name="documentType" placeholder="Document type (e.g. passport_copy)" required style="flex:1.5">
        <input name="applicantId" type="number" placeholder="Applicant ID (optional)" style="width:160px">
        <button type="submit">Request</button>
      </form>
      <h3>Status history</h3>
      <div class="timeline">${v.statusHistory.map(h => `
        <div class="timeline-item">${h.status.replace(/_/g, " ")} — ${h.changed_by_name || "system"}${h.note ? " — " + h.note : ""}<div class="meta">${timeAgo(h.created_at)}</div></div>`).join("")}</div>`;

    $("#visaStatusSelect").addEventListener("change", async (e) => {
      await api(`/api/visa-cases/${id}/status`, { method: "PATCH", body: JSON.stringify({ status: e.target.value }) });
      await loadVisaCases(); selectVisaCase(id);
    });
    $("#applicantForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await api(`/api/visa-cases/${id}/applicants`, { method: "POST", body: JSON.stringify({
        fullName: fd.get("fullName"), nationality: fd.get("nationality") || undefined, passportExpiry: fd.get("passportExpiry") || undefined,
      }) });
      selectVisaCase(id);
    });
    $("#documentForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await api(`/api/visa-cases/${id}/documents`, { method: "POST", body: JSON.stringify({
        documentType: fd.get("documentType"), applicantId: fd.get("applicantId") ? Number(fd.get("applicantId")) : undefined,
      }) });
      selectVisaCase(id);
    });
    $$(".doc-status-btn", $("#visaCaseDetail")).forEach(btn => btn.addEventListener("click", async () => {
      await api(`/api/visa-documents/${btn.dataset.id}/status`, { method: "PATCH", body: JSON.stringify({ status: btn.dataset.status }) });
      selectVisaCase(id);
    }));
  }

  $("#visaCaseForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api("/api/visa-cases", { method: "POST", body: JSON.stringify({
      customerId: Number(fd.get("customerId")), destinationCountry: fd.get("destinationCountry"),
      visaType: fd.get("visaType"), feeAed: fd.get("feeAed") ? Number(fd.get("feeAed")) : undefined,
    }) });
    e.target.reset();
    await loadVisaCases();
  });

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

  // ===== AI Assistants (staff-facing, internal reporting) =====
  const STAFF_AI_AGENTS = [
    { key: "visa_assistant", label: "AI Visa Assistant", hint: "Open visa cases missing documents or gone quiet" },
    { key: "sales_assistant", label: "AI Sales Assistant", hint: "Pipeline by status + stale leads" },
    { key: "operations_assistant", label: "AI Operations Assistant", hint: "Upcoming departures + stalled draft bookings" },
    { key: "finance_assistant", label: "AI Finance Assistant", hint: "Overdue invoices + drafts" },
    { key: "marketing_assistant", label: "AI Marketing Assistant", hint: "Campaign performance + latest SEO audit" },
    { key: "executive_assistant", label: "AI Executive Assistant", hint: "Owner daily brief" },
  ];

  function loadAiAssistants() {
    $("#aiAssistantsGrid").innerHTML = STAFF_AI_AGENTS.map(a => `
      <div class="card" data-agent="${a.key}">
        <div class="card-top"><span class="card-title">${a.label}</span></div>
        <div class="card-sub">${a.hint}</div>
        <button class="btn ask-ai-btn" data-agent="${a.key}" style="margin-top:8px;">Ask</button>
        <div class="ai-reply muted" style="margin-top:8px;white-space:pre-wrap;"></div>
      </div>`).join("");
    $$(".ask-ai-btn", $("#aiAssistantsGrid")).forEach(btn => btn.addEventListener("click", () => askAiAssistant(btn.dataset.agent)));
  }

  async function askAiAssistant(agentType) {
    const card = $(`.card[data-agent="${agentType}"]`, $("#aiAssistantsGrid"));
    const replyEl = $(".ai-reply", card);
    const btn = $(".ask-ai-btn", card);
    btn.disabled = true;
    replyEl.textContent = "Thinking…";
    try {
      const res = await api("/api/ai/staff-chat", { method: "POST", body: JSON.stringify({ agentType }) });
      replyEl.textContent = res.reply;
    } catch (err) {
      replyEl.textContent = `Error: ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  }

  // ===== Employees =====
  let employeesCache = [], selectedEmployeeId = null;
  const employeeStatusPill = (s) => s === "active" ? "won" : s === "on_leave" ? "contacted" : "lost";

  async function loadEmployees() {
    employeesCache = await api("/api/employees");
    $("#employeesList").innerHTML = employeesCache.map(e => `
      <div class="card${e.id === selectedEmployeeId ? " selected" : ""}" data-id="${e.id}">
        <div class="card-top">
          <span class="card-title">${e.full_name}</span>
          <span class="status-pill status-${employeeStatusPill(e.status)}">${e.status}</span>
        </div>
        <div class="card-sub">${e.job_title} · ${e.department}</div>
        <div class="card-sub">AED ${e.basic_salary_aed}/mo</div>
      </div>`).join("") || "<p class='muted'>No employees yet.</p>";
    $$(".card[data-id]", $("#employeesList")).forEach(card => card.addEventListener("click", () => selectEmployee(Number(card.dataset.id))));
  }

  async function selectEmployee(id) {
    selectedEmployeeId = id;
    $$(".card", $("#employeesList")).forEach(c => c.classList.toggle("selected", Number(c.dataset.id) === id));
    const employee = await api(`/api/employees/${id}`);

    $("#employeeDetail").innerHTML = `
      <h2>${employee.full_name}</h2>
      <p class="muted">${employee.job_title} · ${employee.department} · ${employee.employment_type.replace("_", " ")}</p>
      <div class="row">
        ${["active", "on_leave", "terminated"].map(s =>
          `<button class="btn-outline emp-status-btn${s === employee.status ? " active" : ""}" data-status="${s}">${s.replace("_", " ")}</button>`).join("")}
      </div>
      <table>
        <tr><td>Email</td><td>${employee.email || "—"}</td></tr>
        <tr><td>Phone</td><td>${employee.phone || "—"}</td></tr>
        <tr><td>Basic salary</td><td>AED ${employee.basic_salary_aed}/mo</td></tr>
        <tr><td>Joined</td><td>${employee.join_date}</td></tr>
      </table>
      <h3>Leave history</h3>
      <div class="timeline">${employee.leaveRequests.map(l => `
        <div class="timeline-item">
          ${l.leave_type} — ${l.start_date} to ${l.end_date}
          <span class="status-pill status-${l.status === "approved" ? "won" : l.status === "rejected" ? "lost" : "new"}">${l.status}</span>
        </div>`).join("") || "<p class='muted'>No leave requests yet.</p>"}</div>`;

    $$(".emp-status-btn", $("#employeeDetail")).forEach(btn => btn.addEventListener("click", async () => {
      await api(`/api/employees/${id}/status`, { method: "PATCH", body: JSON.stringify({ status: btn.dataset.status }) });
      await loadEmployees();
      selectEmployee(id);
    }));
  }

  $("#employeeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api("/api/employees", { method: "POST", body: JSON.stringify({
      fullName: fd.get("fullName"), jobTitle: fd.get("jobTitle"), department: fd.get("department"),
      basicSalaryAed: Number(fd.get("basicSalaryAed")), joinDate: fd.get("joinDate"),
    }) });
    e.target.reset();
    await loadEmployees();
  });

  // ===== Leave Requests =====
  let leaveCache = [], selectedLeaveId = null;

  async function loadLeaveRequests() {
    if (!employeesCache.length) await loadEmployees();
    const select = $("#leaveEmployeeSelect");
    select.innerHTML = employeesCache.map(e => `<option value="${e.id}">${e.full_name}</option>`).join("");

    leaveCache = await api("/api/leave-requests");
    $("#leaveList").innerHTML = leaveCache.map(l => `
      <div class="card${l.id === selectedLeaveId ? " selected" : ""}" data-id="${l.id}">
        <div class="card-top">
          <span class="card-title">${l.employee_name}</span>
          <span class="status-pill status-${l.status === "approved" ? "won" : l.status === "rejected" ? "lost" : "new"}">${l.status}</span>
        </div>
        <div class="card-sub">${l.leave_type} — ${l.start_date} to ${l.end_date}</div>
      </div>`).join("") || "<p class='muted'>No leave requests yet.</p>";
    $$(".card[data-id]", $("#leaveList")).forEach(card => card.addEventListener("click", () => selectLeave(Number(card.dataset.id))));
  }

  async function selectLeave(id) {
    selectedLeaveId = id;
    $$(".card", $("#leaveList")).forEach(c => c.classList.toggle("selected", Number(c.dataset.id) === id));
    const leave = leaveCache.find(l => l.id === id);

    $("#leaveDetail").innerHTML = `
      <h2>${leave.employee_name}</h2>
      <p class="muted">${leave.leave_type} · ${leave.start_date} to ${leave.end_date}</p>
      <table>
        <tr><td>Reason</td><td>${leave.reason || "—"}</td></tr>
        <tr><td>Status</td><td>${leave.status}</td></tr>
        <tr><td>Requested</td><td>${leave.created_at}</td></tr>
      </table>
      ${leave.status === "pending" ? `
      <div class="row">
        <button class="btn-outline" id="approveLeaveBtn">Approve</button>
        <button class="btn-outline" id="rejectLeaveBtn">Reject</button>
      </div>` : ""}`;

    const approveBtn = $("#approveLeaveBtn"), rejectBtn = $("#rejectLeaveBtn");
    const decide = async (status) => {
      await api(`/api/leave-requests/${id}/decision`, { method: "PATCH", body: JSON.stringify({ status }) });
      await loadLeaveRequests();
      selectLeave(id);
    };
    approveBtn && approveBtn.addEventListener("click", () => decide("approved"));
    rejectBtn && rejectBtn.addEventListener("click", () => decide("rejected"));
  }

  $("#leaveForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api("/api/leave-requests", { method: "POST", body: JSON.stringify({
      employeeId: Number(fd.get("employeeId")), leaveType: fd.get("leaveType"),
      startDate: fd.get("startDate"), endDate: fd.get("endDate"), reason: fd.get("reason") || undefined,
    }) });
    e.target.reset();
    await loadLeaveRequests();
  });

  // ===== Payroll =====
  let payrollRunsCache = [], selectedPayrollRunId = null;
  const monthName = (m) => ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m];

  async function loadPayrollRuns() {
    payrollRunsCache = await api("/api/payroll-runs");
    $("#payrollRunsList").innerHTML = payrollRunsCache.map(r => `
      <div class="card${r.id === selectedPayrollRunId ? " selected" : ""}" data-id="${r.id}">
        <div class="card-top">
          <span class="card-title">${monthName(r.period_month)} ${r.period_year}</span>
          <span class="status-pill status-${r.status === "paid" ? "won" : r.status === "processed" ? "quoted" : "new"}">${r.status}</span>
        </div>
      </div>`).join("") || "<p class='muted'>No payroll runs yet.</p>";
    $$(".card[data-id]", $("#payrollRunsList")).forEach(card => card.addEventListener("click", () => selectPayrollRun(Number(card.dataset.id))));
  }

  async function selectPayrollRun(id) {
    selectedPayrollRunId = id;
    $$(".card", $("#payrollRunsList")).forEach(c => c.classList.toggle("selected", Number(c.dataset.id) === id));
    const run = await api(`/api/payroll-runs/${id}`);

    $("#payrollRunDetail").innerHTML = `
      <h2>${monthName(run.period_month)} ${run.period_year}</h2>
      <p class="muted"><span class="status-pill status-${run.status === "paid" ? "won" : run.status === "processed" ? "quoted" : "new"}">${run.status}</span></p>
      <table>
        <tr><td>Employees</td><td>${run.payslips.length}</td></tr>
        <tr><td><b>Total net pay</b></td><td><b>AED ${run.totalNetAed}</b></td></tr>
      </table>
      <h3>Payslips</h3>
      <div class="timeline">${run.payslips.map(p => `
        <div class="timeline-item">
          <b>${p.employee_name}</b> (${p.job_title}) — basic AED ${p.basic_salary_aed}, allowances AED ${p.allowances_aed}, deductions AED ${p.deductions_aed}
          <div class="meta">Net pay: AED ${p.net_pay_aed} · ${p.status}</div>
          ${run.status === "draft" ? `
          <form class="note-form payslip-edit-form" data-payslip-id="${p.id}" style="margin-top:8px">
            <input name="allowancesAed" type="number" step="0.01" placeholder="Allowances" value="${p.allowances_aed}" style="width:110px">
            <input name="deductionsAed" type="number" step="0.01" placeholder="Deductions" value="${p.deductions_aed}" style="width:110px">
            <button type="submit">Update</button>
          </form>` : ""}
        </div>`).join("")}</div>
      <div class="row" style="margin-top:16px">
        ${run.status === "draft" ? `<button class="btn-outline" id="processRunBtn">Process run</button>` : ""}
        ${run.status === "processed" ? `<button class="btn-outline" id="payRunBtn">Mark as paid</button>` : ""}
      </div>`;

    $$(".payslip-edit-form", $("#payrollRunDetail")).forEach(form => form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await api(`/api/payslips/${form.dataset.payslipId}`, { method: "PATCH", body: JSON.stringify({
        allowancesAed: Number(fd.get("allowancesAed")), deductionsAed: Number(fd.get("deductionsAed")),
      }) });
      selectPayrollRun(id);
    }));

    const processBtn = $("#processRunBtn"), payBtn = $("#payRunBtn");
    processBtn && processBtn.addEventListener("click", async () => {
      await api(`/api/payroll-runs/${id}/process`, { method: "PATCH" });
      await loadPayrollRuns();
      selectPayrollRun(id);
    });
    payBtn && payBtn.addEventListener("click", async () => {
      await api(`/api/payroll-runs/${id}/pay`, { method: "PATCH" });
      await loadPayrollRuns();
      selectPayrollRun(id);
    });
  }

  $("#payrollRunForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("/api/payroll-runs", { method: "POST", body: JSON.stringify({
        periodYear: Number(fd.get("periodYear")), periodMonth: Number(fd.get("periodMonth")),
      }) });
      await loadPayrollRuns();
    } catch (err) { alert(err.message); }
  });

  // ===== Procurement =====
  let vendorsCache = [], purchaseOrdersCache = [], selectedPoId = null;
  const poStatusPill = (s) => s === "paid" ? "won" : s === "cancelled" ? "lost" : s === "approved" ? "quoted" : s === "received" ? "contacted" : "new";

  async function loadProcurement() {
    vendorsCache = await api("/api/vendors");
    $("#vendorsList").innerHTML = vendorsCache.map(v => `
      <div class="card">
        <div class="card-top"><span class="card-title">${v.name}</span><span class="card-sub">${v.category}</span></div>
        <div class="card-sub">${v.email || ""} ${v.phone || ""}</div>
      </div>`).join("") || "<p class='muted'>No vendors yet.</p>";

    const select = $("#poVendorSelect");
    select.innerHTML = vendorsCache.map(v => `<option value="${v.id}">${v.name}</option>`).join("");

    purchaseOrdersCache = await api("/api/purchase-orders");
    $("#purchaseOrdersList").innerHTML = purchaseOrdersCache.map(po => `
      <div class="card${po.id === selectedPoId ? " selected" : ""}" data-id="${po.id}">
        <div class="card-top">
          <span class="card-title">${po.po_number}</span>
          <span class="status-pill status-${poStatusPill(po.status)}">${po.status}</span>
        </div>
        <div class="card-sub">${po.vendor_name} — AED ${po.amount_aed}</div>
      </div>`).join("") || "<p class='muted'>No purchase orders yet.</p>";
    $$(".card[data-id]", $("#purchaseOrdersList")).forEach(card => card.addEventListener("click", () => selectPo(Number(card.dataset.id))));
  }

  async function selectPo(id) {
    selectedPoId = id;
    $$(".card", $("#purchaseOrdersList")).forEach(c => c.classList.toggle("selected", Number(c.dataset.id) === id));
    const po = await api(`/api/purchase-orders/${id}`);

    $("#purchaseOrderDetail").innerHTML = `
      <h2>${po.po_number}</h2>
      <p class="muted">${po.vendor_name}</p>
      <div class="row">
        ${["draft", "approved", "received", "paid", "cancelled"].map(s =>
          `<button class="btn-outline po-status-btn${s === po.status ? " active" : ""}" data-status="${s}">${s}</button>`).join("")}
      </div>
      <table>
        <tr><td>Description</td><td>${po.description}</td></tr>
        <tr><td>Amount</td><td>AED ${po.amount_aed}</td></tr>
        <tr><td>Created</td><td>${po.created_at}</td></tr>
      </table>`;

    $$(".po-status-btn", $("#purchaseOrderDetail")).forEach(btn => btn.addEventListener("click", async () => {
      await api(`/api/purchase-orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status: btn.dataset.status }) });
      await loadProcurement();
      selectPo(id);
    }));
  }

  $("#vendorForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api("/api/vendors", { method: "POST", body: JSON.stringify({
      name: fd.get("name"), category: fd.get("category"), email: fd.get("email") || undefined,
    }) });
    e.target.reset();
    await loadProcurement();
  });

  $("#poForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api("/api/purchase-orders", { method: "POST", body: JSON.stringify({
      vendorId: Number(fd.get("vendorId")), description: fd.get("description"), amountAed: Number(fd.get("amountAed")),
    }) });
    e.target.reset();
    await loadProcurement();
  });

  // ===== Marketing Campaigns =====
  let campaignsCache = [], selectedCampaignId = null;

  async function loadCampaigns() {
    campaignsCache = await api("/api/campaigns");
    $("#campaignsList").innerHTML = campaignsCache.map(c => `
      <div class="card${c.id === selectedCampaignId ? " selected" : ""}" data-id="${c.id}">
        <div class="card-top">
          <span class="card-title">${c.name}</span>
          <span class="status-pill status-${c.status === "sent" ? "won" : "new"}">${c.status}</span>
        </div>
        <div class="card-sub">${c.channel} · ${c.audience_source}</div>
        ${c.status === "sent" ? `<div class="card-sub">Sent to ${c.sent_count}</div>` : ""}
      </div>`).join("") || "<p class='muted'>No campaigns yet.</p>";
    $$(".card[data-id]", $("#campaignsList")).forEach(card => card.addEventListener("click", () => selectCampaign(Number(card.dataset.id))));
  }

  async function selectCampaign(id) {
    selectedCampaignId = id;
    $$(".card", $("#campaignsList")).forEach(c => c.classList.toggle("selected", Number(c.dataset.id) === id));
    const campaign = await api(`/api/campaigns/${id}`);

    $("#campaignDetail").innerHTML = `
      <h2>${campaign.name}</h2>
      <p class="muted"><span class="status-pill status-${campaign.status === "sent" ? "won" : "new"}">${campaign.status}</span> · ${campaign.channel}</p>
      <table>
        ${campaign.subject ? `<tr><td>Subject</td><td>${campaign.subject}</td></tr>` : ""}
        <tr><td>Message</td><td>${campaign.message}</td></tr>
        <tr><td>Audience</td><td>${campaign.audience_source}${campaign.filter_interest_type ? ` · ${campaign.filter_interest_type}` : ""}${campaign.filter_lead_status ? ` · ${campaign.filter_lead_status}` : ""}${campaign.filter_source ? ` · ${campaign.filter_source}` : ""}</td></tr>
      </table>
      <div class="row" id="campaignActions">
        ${campaign.status === "draft" ? `<button class="btn-outline" id="previewAudienceBtn">Preview audience</button><button class="btn-outline" id="sendCampaignBtn">Send now</button>` : ""}
      </div>
      <div id="audiencePreviewResult"></div>
      <h3>Send history</h3>
      <div class="timeline">${campaign.sends.map(s => `
        <div class="timeline-item">${s.recipient}<div class="meta">${timeAgo(s.sent_at)}</div></div>`).join("") || "<p class='muted'>Not sent yet.</p>"}</div>`;

    const previewBtn = $("#previewAudienceBtn"), sendBtn = $("#sendCampaignBtn");
    previewBtn && previewBtn.addEventListener("click", async () => {
      const preview = await api(`/api/campaigns/${id}/audience-preview`);
      $("#audiencePreviewResult").innerHTML = `<p class="muted" style="margin-top:10px">${preview.count} recipient(s) match — ${preview.sample.map(p => p.full_name).join(", ")}${preview.count > preview.sample.length ? "…" : ""}</p>`;
    });
    sendBtn && sendBtn.addEventListener("click", async () => {
      if (!confirm("Send this campaign now? This cannot be undone.")) return;
      try {
        await api(`/api/campaigns/${id}/send`, { method: "POST" });
        await loadCampaigns();
        selectCampaign(id);
      } catch (err) { alert(err.message); }
    });
  }

  $("#campaignForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api("/api/campaigns", { method: "POST", body: JSON.stringify({
      name: fd.get("name"), channel: fd.get("channel"), subject: fd.get("subject") || undefined,
      message: fd.get("message"), audienceSource: fd.get("audienceSource"),
      filterInterestType: fd.get("filterInterestType") || undefined,
      filterLeadStatus: fd.get("filterLeadStatus") || undefined,
      filterSource: fd.get("filterSource") || undefined,
    }) });
    e.target.reset();
    await loadCampaigns();
  });

  // ===== SEO Tools =====
  let seoAuditsCache = [], selectedAuditId = null;

  async function loadSeoTools() {
    seoAuditsCache = await api("/api/seo/audits");
    $("#seoAuditsList").innerHTML = seoAuditsCache.map(a => `
      <div class="card${a.id === selectedAuditId ? " selected" : ""}" data-id="${a.id}">
        <div class="card-top">
          <span class="card-title">${a.base_url}</span>
          <span class="status-pill status-${a.issues_found === 0 ? "won" : "lost"}">${a.issues_found} issue(s)</span>
        </div>
        <div class="card-sub">${a.pages_checked} page(s) · ${timeAgo(a.run_at)}</div>
      </div>`).join("") || "<p class='muted'>No audits run yet.</p>";
    $$(".card[data-id]", $("#seoAuditsList")).forEach(card => card.addEventListener("click", () => selectAudit(Number(card.dataset.id))));

    const items = await api("/api/seo/content-items");
    $("#contentItemsList").innerHTML = items.map(i => `
      <div class="card" data-id="${i.id}">
        <div class="card-top">
          <span class="card-title">${i.title}</span>
          <span class="status-pill status-${i.status === "published" ? "won" : i.status === "review" ? "quoted" : i.status === "drafting" ? "contacted" : "new"}">${i.status}</span>
        </div>
        <div class="card-sub">${i.target_keyword || ""}${i.target_url ? ` → ${i.target_url}` : ""}</div>
        <div class="row" style="margin-top:8px">
          ${["idea", "drafting", "review", "published"].map(s =>
            `<button class="btn-outline content-status-btn${s === i.status ? " active" : ""}" data-id="${i.id}" data-status="${s}">${s}</button>`).join("")}
        </div>
      </div>`).join("") || "<p class='muted'>No content items yet.</p>";
    $$(".content-status-btn", $("#contentItemsList")).forEach(btn => btn.addEventListener("click", async () => {
      await api(`/api/seo/content-items/${btn.dataset.id}/status`, { method: "PATCH", body: JSON.stringify({ status: btn.dataset.status }) });
      await loadSeoTools();
    }));
  }

  async function selectAudit(id) {
    selectedAuditId = id;
    $$(".card", $("#seoAuditsList")).forEach(c => c.classList.toggle("selected", Number(c.dataset.id) === id));
    const audit = await api(`/api/seo/audits/${id}`);

    $("#seoAuditDetail").innerHTML = `
      <h2>${audit.base_url}</h2>
      <p class="muted">${audit.pages_checked} page(s) checked · ${audit.issues_found} issue(s) found · ${timeAgo(audit.run_at)}</p>
      <div class="timeline">${audit.pages.map(p => `
        <div class="timeline-item">
          <b>${p.path}</b> ${p.status !== 200 ? `<span class="status-pill status-lost">HTTP ${p.status}</span>` : ""}
          <div class="meta">Title: ${p.title_length} chars · Meta: ${p.meta_description_length} chars · H1: ${p.h1_count} · Images: ${p.image_count} (${p.images_missing_alt} missing alt) · ${p.word_count} words</div>
          ${p.issues.length ? `<div class="meta" style="color:var(--danger);margin-top:4px">${p.issues.join(" · ")}</div>` : `<div class="meta" style="color:var(--success);margin-top:4px">No issues found</div>`}
        </div>`).join("")}</div>`;
  }

  $("#seoAuditForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const paths = fd.get("paths").split(",").map(p => p.trim()).filter(Boolean);
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Auditing…";
    try {
      const audit = await api("/api/seo/audits", { method: "POST", body: JSON.stringify({ baseUrl: fd.get("baseUrl"), paths }) });
      await loadSeoTools();
      selectAudit(audit.id);
    } catch (err) { alert(err.message); }
    btn.disabled = false; btn.textContent = "Run audit";
  });

  $("#contentItemForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api("/api/seo/content-items", { method: "POST", body: JSON.stringify({
      title: fd.get("title"), targetKeyword: fd.get("targetKeyword") || undefined, targetUrl: fd.get("targetUrl") || undefined,
    }) });
    e.target.reset();
    await loadSeoTools();
  });

  // ===== Platform Admin =====
  let usersCache = [], selectedUserId = null;

  async function loadAdminTab() {
    await Promise.all([loadMetrics(), loadUsers(), loadAuditLog()]);
  }

  async function loadMetrics() {
    const m = await api("/api/admin/metrics");
    const cards = [
      ["Active users", m.activeUsers], ["Active sessions", m.activeSessions],
      ["Customers", m.customers], ["Open leads", m.openLeads],
      ["Bookings this month", m.bookingsThisMonth], ["Revenue this month", `AED ${m.revenueThisMonthAed}`],
      ["Active employees", m.activeEmployees], ["Pending leave", m.pendingLeaveRequests],
      ["Pending POs", m.pendingPurchaseOrders], ["Unread notifications", m.unreadNotifications],
      ["DB size", m.dbSizeBytes ? `${(m.dbSizeBytes / 1024).toFixed(0)} KB` : "—"],
      ["Uptime", `${Math.floor(m.uptimeSeconds / 60)}m`],
      ["Requests served", m.totalRequests], ["Errors (4xx/5xx)", m.totalErrors],
    ];
    $("#metricsGrid").innerHTML = cards.map(([label, value]) => `
      <div class="metric-card"><div class="metric-value">${value}</div><div class="metric-label">${label}</div></div>`).join("");
  }

  async function loadUsers() {
    usersCache = await api("/api/admin/users");
    $("#usersList").innerHTML = usersCache.map(u => `
      <div class="card${u.id === selectedUserId ? " selected" : ""}" data-id="${u.id}">
        <div class="card-top">
          <span class="card-title">${u.full_name}</span>
          <span class="status-pill status-${u.is_active ? "won" : "lost"}">${u.is_active ? "active" : "disabled"}</span>
        </div>
        <div class="card-sub">${u.email} · ${u.role}</div>
        <div class="card-sub">${u.active_sessions} active session(s)</div>
      </div>`).join("") || "<p class='muted'>No users yet.</p>";
    $$(".card[data-id]", $("#usersList")).forEach(card => card.addEventListener("click", () => selectUser(Number(card.dataset.id))));
  }

  async function selectUser(id) {
    selectedUserId = id;
    $$(".card", $("#usersList")).forEach(c => c.classList.toggle("selected", Number(c.dataset.id) === id));
    const user = usersCache.find(u => u.id === id);
    const isSelf = id === me.id;

    $("#userDetail").innerHTML = `
      <h2>${user.full_name}</h2>
      <p class="muted">${user.email}</p>
      <table>
        <tr><td>Role</td><td>${user.role}</td></tr>
        <tr><td>Status</td><td>${user.is_active ? "active" : "disabled"}</td></tr>
        <tr><td>Last login</td><td>${user.last_login_at ? timeAgo(user.last_login_at) : "never"}</td></tr>
        <tr><td>Active sessions</td><td>${user.active_sessions}</td></tr>
      </table>
      <div class="row">
        ${["owner", "admin", "sales", "ops", "finance", "hr", "marketing"].map(r =>
          `<button class="btn-outline user-role-btn${r === user.role ? " active" : ""}" data-role="${r}">${r}</button>`).join("")}
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn-outline" id="toggleActiveBtn"${isSelf ? " disabled" : ""}>${user.is_active ? "Deactivate" : "Activate"}</button>
        <button class="btn-outline" id="revokeSessionsBtn"${user.active_sessions === 0 ? " disabled" : ""}>Revoke sessions</button>
      </div>`;

    $$(".user-role-btn", $("#userDetail")).forEach(btn => btn.addEventListener("click", async () => {
      await api(`/api/admin/users/${id}/role`, { method: "PATCH", body: JSON.stringify({ role: btn.dataset.role }) });
      await loadUsers();
      selectUser(id);
    }));

    $("#toggleActiveBtn").addEventListener("click", async () => {
      try {
        await api(`/api/admin/users/${id}/status`, { method: "PATCH", body: JSON.stringify({ isActive: !user.is_active }) });
        await loadUsers();
        selectUser(id);
      } catch (err) { alert(err.message); }
    });
    $("#revokeSessionsBtn").addEventListener("click", async () => {
      await api(`/api/admin/users/${id}/revoke-sessions`, { method: "POST" });
      await loadUsers();
      selectUser(id);
    });
  }

  $("#createUserForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("/api/admin/users", { method: "POST", body: JSON.stringify({
        fullName: fd.get("fullName"), email: fd.get("email"), password: fd.get("password"), role: fd.get("role"),
      }) });
      e.target.reset();
      await loadUsers();
    } catch (err) { alert(err.message); }
  });

  async function loadAuditLog() {
    const entityType = $("#auditEntityFilter").value;
    const rows = await api(`/api/admin/audit-log${entityType ? `?entityType=${entityType}` : ""}`);
    $("#auditLogList").innerHTML = rows.map(a => `
      <div class="card">
        <div class="card-top">
          <span class="card-title">${a.action} ${a.entity_type}${a.entity_id ? ` #${a.entity_id}` : ""}</span>
          <span class="card-sub">${timeAgo(a.created_at)}</span>
        </div>
        <div class="card-sub">${a.actor_name || "system"}${a.detail ? ` — ${a.detail}` : ""}</div>
      </div>`).join("") || "<p class='muted'>No activity recorded yet.</p>";
  }

  $("#auditEntityFilter").addEventListener("change", loadAuditLog);

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
