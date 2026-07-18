// Harbor — a due-date-first budget app
// All data lives in localStorage. No accounts, no bank linking.
// (Storage key kept as "steady-budget-data-v1" so existing data isn't lost after the rename.)

const STORAGE_KEY = "steady-budget-data-v1";

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { income: [], bills: [] };
    const parsed = JSON.parse(raw);
    return { income: parsed.income || [], bills: parsed.bills || [] };
  } catch (e) {
    return { income: [], bills: [] };
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadData();
let viewMonthOffset = 0; // 0 = current month, for the "Month by month" calendar

// ---------- money helpers ----------

function fmtMoney(n) {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return sign + "$" + abs.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

const FREQ_MULTIPLIER = {
  monthly: 1,
  semimonthly: 2,
  biweekly: 2.1666667, // 26 payments / year / 12
  weekly: 4.3333333,
  annual: 1 / 12,
};

function monthlyAmount(amount, frequency) {
  const mult = FREQ_MULTIPLIER[frequency] ?? 1;
  return amount * mult;
}

function billFrequency(b) {
  return b.frequency || "monthly";
}

function totalMonthlyIncome() {
  return state.income.reduce((sum, i) => sum + monthlyAmount(i.amount, i.frequency), 0);
}

function activeBills() {
  return state.bills.filter(b => !b.paidOff);
}

function totalMonthlyBills() {
  return activeBills().reduce((sum, b) => sum + monthlyAmount(b.amount, billFrequency(b)), 0);
}

// ---------- due-date logic ----------

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseAnchorDate(str) {
  // "YYYY-MM-DD" -> local Date at midnight
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function nextWeekdayOnOrAfter(from, weekday) {
  const d = new Date(from);
  const diff = (weekday - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d;
}

function nextBiweeklyOnOrAfter(from, anchor) {
  const a = startOfDay(anchor);
  const f = startOfDay(from);
  const diffDays = Math.round((f - a) / 86400000);
  const cycles = Math.ceil(diffDays / 14);
  const d = new Date(a);
  d.setDate(d.getDate() + Math.max(0, cycles) * 14);
  while (d < f) d.setDate(d.getDate() + 14);
  return d;
}

// Returns the next occurrence of a bill that is today or in the future.
function nextDueDate(bill, today) {
  const t = startOfDay(today);
  const freq = billFrequency(bill);

  if (freq === "weekly") {
    return nextWeekdayOnOrAfter(t, bill.dueWeekday);
  }
  if (freq === "biweekly") {
    return nextBiweeklyOnOrAfter(t, parseAnchorDate(bill.anchorDate));
  }

  // monthly
  let year = t.getFullYear();
  let month = t.getMonth();
  let day = Math.min(bill.dueDay, daysInMonth(year, month));
  let due = new Date(year, month, day);
  if (due < t) {
    month += 1;
    if (month > 11) { month = 0; year += 1; }
    day = Math.min(bill.dueDay, daysInMonth(year, month));
    due = new Date(year, month, day);
  }
  return due;
}

// Every occurrence of a bill that falls within the given month.
function occurrencesInMonth(bill, year, monthIndex) {
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);
  const freq = billFrequency(bill);
  const results = [];

  if (freq === "weekly") {
    let d = nextWeekdayOnOrAfter(start, bill.dueWeekday);
    while (d <= end) {
      results.push(new Date(d));
      d = new Date(d);
      d.setDate(d.getDate() + 7);
    }
  } else if (freq === "biweekly") {
    let d = nextBiweeklyOnOrAfter(start, parseAnchorDate(bill.anchorDate));
    while (d <= end) {
      results.push(new Date(d));
      d = new Date(d);
      d.setDate(d.getDate() + 14);
    }
  } else {
    const day = Math.min(bill.dueDay, daysInMonth(year, monthIndex));
    results.push(new Date(year, monthIndex, day));
  }

  return results;
}

function dueDateKey(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function daysUntil(due, today) {
  const t = startOfDay(today);
  return Math.round((due - t) / 86400000);
}

// ---------- number animation ----------

let lastStats = { income: null, bills: null, leftover: null };

function animateNumber(el, from, to, duration = 650) {
  if (from === to) { el.textContent = fmtMoney(to); return; }
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const val = from + (to - from) * eased;
    el.textContent = fmtMoney(val);
    if (t < 1) requestAnimationFrame(tick);
    else el.textContent = fmtMoney(to);
  }
  requestAnimationFrame(tick);
}

function pulseOnce(el) {
  el.classList.remove("pulse");
  void el.offsetWidth; // restart animation
  el.classList.add("pulse");
}

// ---------- rendering ----------

function render() {
  const today = new Date();

  document.getElementById("todayLabel").textContent = today.toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });

  const income = totalMonthlyIncome();
  const bills = totalMonthlyBills();
  const leftover = income - bills;

  const incomeEl = document.getElementById("statIncome");
  const billsEl = document.getElementById("statBills");
  const leftoverEl = document.getElementById("statLeftover");

  const from = lastStats.income === null
    ? { income: 0, bills: 0, leftover: 0 }
    : lastStats;

  animateNumber(incomeEl, from.income, income);
  animateNumber(billsEl, from.bills, bills);
  animateNumber(leftoverEl, from.leftover, leftover);
  leftoverEl.style.color = leftover < 0 ? "var(--bad)" : (leftover < income * 0.1 ? "var(--warn)" : "var(--good)");
  if (lastStats.leftover !== null && lastStats.leftover !== leftover) pulseOnce(leftoverEl);

  lastStats = { income, bills, leftover };

  renderDueList(today);
  renderMonthPlanner();
  renderFeedback(income, bills, leftover, today);
  renderIncomeList();
  renderBillsList();
  renderCategoryBars();
  renderPayoffList();
  renderPaidOffList();
}

function renderDueList(today) {
  const list = document.getElementById("dueList");
  const empty = document.getElementById("dueEmpty");
  list.innerHTML = "";

  const bills = activeBills();
  if (bills.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const withDates = bills.map(b => {
    const due = nextDueDate(b, today);
    const key = dueDateKey(due);
    const paid = b.paidForCycle === key;
    return { bill: b, due, key, paid, days: daysUntil(due, today) };
  }).sort((a, b) => a.due - b.due);

  for (const item of withDates) {
    const row = document.createElement("div");
    let status = "good";
    if (!item.paid) {
      if (item.days <= 0) status = "bad";
      else if (item.days <= 3) status = "warn";
    }
    row.className = "due-item status-" + status + (item.paid ? " status-paid" : "");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "due-checkbox";
    checkbox.checked = item.paid;
    checkbox.addEventListener("change", () => {
      markOccurrence(item.bill, item.key, checkbox.checked);
    });

    const info = document.createElement("div");
    info.className = "due-info";
    info.innerHTML = `<div class="due-name">${escapeHtml(item.bill.name)}</div><div class="due-meta">${escapeHtml(item.bill.category)}</div>`;

    const amount = document.createElement("div");
    amount.className = "due-amount";
    amount.textContent = fmtMoney(item.bill.amount);

    const when = document.createElement("div");
    when.className = "due-when";
    when.textContent = item.paid ? "Paid" : whenLabel(item.days);

    row.appendChild(checkbox);
    row.appendChild(info);
    row.appendChild(amount);
    row.appendChild(when);
    list.appendChild(row);
  }
}

// Shared toggle used by both the due list checkboxes and calendar chips.
function markOccurrence(bill, key, paid) {
  bill.paidForCycle = paid ? key : null;
  if (paid && bill.isDebt && !bill.paidOff) {
    bill.balance = Math.max(0, (bill.balance ?? bill.amount) - bill.amount);
    if (bill.balance <= 0) {
      bill.paidOff = true;
      saveData();
      render();
      celebrate(bill.name, bill.amount);
      return;
    }
  }
  saveData();
  render();
}

function whenLabel(days) {
  if (days < 0) return Math.abs(days) + "d overdue";
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return "Due in " + days + "d";
}

// ---------- month-by-month calendar ----------

function occStatus(date, paid, today) {
  if (paid) return "paid";
  const days = daysUntil(date, today);
  if (days < 0) return "bad";
  if (days <= 3) return "warn";
  return "good";
}

function renderMonthPlanner() {
  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth() + viewMonthOffset, 1);
  const year = base.getFullYear();
  const monthIndex = base.getMonth();

  document.getElementById("monthLabel").textContent = base.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  document.getElementById("monthPrev").disabled = viewMonthOffset <= -1;
  document.getElementById("monthNext").disabled = viewMonthOffset >= 11;

  const rows = [];
  for (const b of activeBills()) {
    for (const d of occurrencesInMonth(b, year, monthIndex)) {
      const key = dueDateKey(d);
      rows.push({ bill: b, date: d, key, paid: b.paidForCycle === key });
    }
  }
  rows.sort((a, b) => a.date - b.date);

  const monthTotal = rows.reduce((sum, r) => sum + r.bill.amount, 0);
  const income = totalMonthlyIncome();
  const monthLeftover = income - monthTotal;

  document.getElementById("monthTotal").textContent = fmtMoney(monthTotal);
  document.getElementById("monthIncome").textContent = fmtMoney(income);
  const monthLeftoverEl = document.getElementById("monthLeftover");
  monthLeftoverEl.textContent = fmtMoney(monthLeftover);
  monthLeftoverEl.style.color = monthLeftover < 0 ? "var(--bad)" : (monthLeftover < income * 0.1 ? "var(--warn)" : "var(--good)");

  const hasBills = state.bills.length > 0;
  document.getElementById("calendarWrap").hidden = !hasBills;
  document.getElementById("monthEmpty").hidden = hasBills;

  if (hasBills) renderCalendarGrid(year, monthIndex, rows, today);
}

function renderCalendarGrid(year, monthIndex, rows, today) {
  const grid = document.getElementById("calendarGrid");
  grid.innerHTML = "";

  const byDay = {};
  for (const r of rows) {
    const day = r.date.getDate();
    (byDay[day] ||= []).push(r);
  }

  const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const totalDays = daysInMonth(year, monthIndex);
  const todayKey = dueDateKey(startOfDay(today));

  for (let i = 0; i < firstWeekday; i++) {
    const cell = document.createElement("div");
    cell.className = "cal-cell is-empty";
    grid.appendChild(cell);
  }

  for (let day = 1; day <= totalDays; day++) {
    const cellDate = new Date(year, monthIndex, day);
    const cell = document.createElement("div");
    cell.className = "cal-cell" + (dueDateKey(cellDate) === todayKey ? " is-today" : "");

    const num = document.createElement("span");
    num.className = "cal-daynum";
    num.textContent = String(day);
    cell.appendChild(num);

    const items = document.createElement("div");
    items.className = "cal-items";

    const dayRows = (byDay[day] || []).sort((a, b) => b.bill.amount - a.bill.amount);
    const shown = dayRows.slice(0, 3);
    for (const r of shown) {
      const chip = document.createElement("div");
      const status = occStatus(r.date, r.paid, today);
      chip.className = "cal-chip status-" + status;
      chip.textContent = `${r.bill.name} · ${fmtMoney(r.bill.amount)}`;
      chip.title = r.paid ? `${r.bill.name} — paid. Click to mark unpaid.` : `${r.bill.name} — click to mark paid.`;
      chip.addEventListener("click", () => {
        markOccurrence(r.bill, r.key, !r.paid);
      });
      items.appendChild(chip);
    }
    if (dayRows.length > shown.length) {
      const more = document.createElement("div");
      more.className = "cal-more";
      more.textContent = `+${dayRows.length - shown.length} more`;
      items.appendChild(more);
    }

    cell.appendChild(items);
    grid.appendChild(cell);
  }
}

document.getElementById("monthPrev").addEventListener("click", () => {
  if (viewMonthOffset <= -1) return;
  viewMonthOffset -= 1;
  renderMonthPlanner();
});
document.getElementById("monthNext").addEventListener("click", () => {
  if (viewMonthOffset >= 11) return;
  viewMonthOffset += 1;
  renderMonthPlanner();
});

// ---------- feedback ----------

function renderFeedback(income, bills, leftover, today) {
  const list = document.getElementById("feedbackList");
  list.innerHTML = "";
  const items = buildFeedback(income, bills, leftover, today);
  for (const item of items) {
    const div = document.createElement("div");
    div.className = "feedback-item " + item.level;
    div.textContent = item.text;
    list.appendChild(div);
  }
}

function buildFeedback(income, bills, leftover, today) {
  const items = [];

  if (state.income.length === 0 && state.bills.length === 0) {
    items.push({ level: "warn", text: "Add your income and bills below to see feedback here." });
    return items;
  }

  if (leftover < 0) {
    items.push({ level: "bad", text: `You're currently ${fmtMoney(Math.abs(leftover))} short each month. Look at the largest category below first — that's usually where the fastest fix is.` });
  } else if (income > 0 && leftover < income * 0.05) {
    items.push({ level: "warn", text: `Your budget is very tight — only ${fmtMoney(leftover)} left over each month. Even a small unexpected expense could push you negative.` });
  } else if (income > 0) {
    items.push({ level: "good", text: `You have ${fmtMoney(leftover)} of breathing room each month. That's ${Math.round((leftover / income) * 100)}% of your income.` });
  }

  const dueSoon = activeBills()
    .map(b => {
      const due = nextDueDate(b, today);
      const key = dueDateKey(due);
      return { b, due, days: daysUntil(due, today), paid: b.paidForCycle === key };
    })
    .filter(x => !x.paid && x.days <= 3)
    .sort((a, b) => a.days - b.days);

  for (const x of dueSoon) {
    items.push({
      level: x.days <= 0 ? "bad" : "warn",
      text: `${x.b.name} (${fmtMoney(x.b.amount)}) — ${whenLabel(x.days).toLowerCase()}.`,
    });
  }

  const almostDone = activeBills().filter(b => b.isDebt && b.balance <= b.amount);
  for (const b of almostDone) {
    items.push({ level: "good", text: `One more payment and ${b.name} is paid off — ${fmtMoney(b.balance)} left. 🎉` });
  }

  const catTotals = categoryTotals();
  const topCat = catTotals[0];
  if (topCat && bills > 0) {
    const pct = Math.round((topCat.amount / bills) * 100);
    if (pct >= 40) {
      items.push({ level: "warn", text: `${topCat.name} is ${pct}% of your monthly bills (${fmtMoney(topCat.amount)}). Worth a closer look if you need to cut back.` });
    }
  }

  // Cash coming due in the week after the immediate 3-day window —
  // gives a heads-up before things get urgent enough to turn red/yellow above.
  const weekAhead = activeBills()
    .map(b => {
      const due = nextDueDate(b, today);
      const key = dueDateKey(due);
      return { b, days: daysUntil(due, today), paid: b.paidForCycle === key };
    })
    .filter(x => !x.paid && x.days > 3 && x.days <= 7);
  if (weekAhead.length >= 2) {
    const sum = weekAhead.reduce((s, x) => s + x.b.amount, 0);
    items.push({
      level: "warn",
      text: `${weekAhead.length} more bills totaling ${fmtMoney(sum)} land in the 4-7 days after that. Worth setting the cash aside now rather than later.`,
    });
  }

  // Payoff timeline for debts that aren't already flagged as "almost done."
  const payoffEstimates = activeBills().filter(b => b.isDebt && b.balance > b.amount);
  for (const b of payoffEstimates) {
    const months = Math.ceil(b.balance / b.amount);
    if (months <= 24) {
      items.push({
        level: "good",
        text: `At ${fmtMoney(b.amount)} per payment, ${b.name} will be paid off in about ${months} more ${months === 1 ? "payment" : "payments"} — ${fmtMoney(b.balance)} left to go.`,
      });
    }
  }

  // Savings nudge when there's comfortable room and nothing urgent flagged.
  if (income > 0 && leftover > income * 0.15) {
    const suggestion = Math.round(leftover * 0.2);
    items.push({
      level: "good",
      text: `You've got solid breathing room this month. If you don't already have one, setting aside even ${fmtMoney(suggestion)} into an emergency fund helps absorb the next surprise expense.`,
    });
  }

  return items;
}

function categoryTotals() {
  const map = {};
  for (const b of activeBills()) {
    map[b.category] = (map[b.category] || 0) + monthlyAmount(b.amount, billFrequency(b));
  }
  return Object.entries(map)
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
}

function renderCategoryBars() {
  const wrap = document.getElementById("categoryBars");
  const empty = document.getElementById("categoryEmpty");
  wrap.innerHTML = "";
  const totals = categoryTotals();
  if (totals.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  const max = totals[0].amount;
  const fills = [];
  for (const t of totals) {
    const row = document.createElement("div");
    row.className = "cat-row";
    row.innerHTML = `
      <div class="cat-label">${escapeHtml(t.name)}</div>
      <div class="cat-track"><div class="cat-fill"></div></div>
      <div class="cat-amount">${fmtMoney(t.amount)}</div>
    `;
    wrap.appendChild(row);
    fills.push({ el: row.querySelector(".cat-fill"), pct: (t.amount / max) * 100 });
  }
  requestAnimationFrame(() => {
    for (const f of fills) f.el.style.width = f.pct + "%";
  });
}

function renderIncomeList() {
  const wrap = document.getElementById("incomeList");
  wrap.innerHTML = "";
  state.income.forEach((inc, idx) => {
    const row = document.createElement("div");
    row.className = "entry-row";
    row.innerHTML = `
      <div class="entry-row-main">
        <span>${escapeHtml(inc.name)}</span>
        <span class="entry-row-sub">${fmtMoney(inc.amount)} · ${freqLabel(inc.frequency)}</span>
      </div>
    `;
    const btn = document.createElement("button");
    btn.className = "remove-btn";
    btn.textContent = "Remove";
    btn.addEventListener("click", () => {
      state.income.splice(idx, 1);
      saveData();
      render();
    });
    row.appendChild(btn);
    wrap.appendChild(row);
  });
}

function billScheduleLabel(b) {
  const freq = billFrequency(b);
  if (freq === "weekly") {
    const names = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
    return "weekly, " + names[b.dueWeekday];
  }
  if (freq === "biweekly") {
    return "every 2 weeks";
  }
  return "due day " + b.dueDay;
}

function renderBillsList() {
  const wrap = document.getElementById("billsList");
  wrap.innerHTML = "";
  activeBills().forEach((b) => {
    const row = document.createElement("div");
    row.className = "entry-row";
    const debtNote = b.isDebt ? ` · ${fmtMoney(b.balance)} left` : "";
    row.innerHTML = `
      <div class="entry-row-main">
        <span>${escapeHtml(b.name)}</span>
        <span class="entry-row-sub">${fmtMoney(b.amount)} · ${billScheduleLabel(b)} · ${escapeHtml(b.category)}${debtNote}</span>
      </div>
    `;
    const btn = document.createElement("button");
    btn.className = "remove-btn";
    btn.textContent = "Remove";
    btn.addEventListener("click", () => {
      removeBillById(b.id);
    });
    row.appendChild(btn);
    wrap.appendChild(row);
  });
}

function removeBillById(id) {
  state.bills = state.bills.filter(b => b.id !== id);
  saveData();
  render();
}

function renderPayoffList() {
  const card = document.getElementById("payoffCard");
  const wrap = document.getElementById("payoffList");
  wrap.innerHTML = "";
  const debts = activeBills().filter(b => b.isDebt);
  if (debts.length === 0) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const fills = [];
  for (const b of debts) {
    const original = b.originalBalance || b.balance || 1;
    const pct = Math.min(100, Math.max(0, ((original - b.balance) / original) * 100));
    const item = document.createElement("div");
    item.className = "payoff-item";
    item.innerHTML = `
      <div class="payoff-item-top">
        <span class="payoff-name">${escapeHtml(b.name)}</span>
        <span class="payoff-fig">${fmtMoney(b.balance)} left of ${fmtMoney(original)}</span>
      </div>
      <div class="payoff-track"><div class="payoff-fill"></div></div>
      <div class="payoff-adjust">
        <input type="number" min="0" step="0.01" placeholder="Correct balance to..." data-id="${b.id}" />
        <button type="button" data-id="${b.id}">Update</button>
      </div>
    `;
    const btn = item.querySelector("button");
    const input = item.querySelector("input");
    btn.addEventListener("click", () => {
      const val = parseFloat(input.value);
      if (isNaN(val)) return;
      b.balance = Math.max(0, val);
      if (b.balance <= 0) {
        b.paidOff = true;
        saveData();
        render();
        celebrate(b.name, b.amount);
        return;
      }
      saveData();
      render();
    });
    wrap.appendChild(item);
    fills.push({ el: item.querySelector(".payoff-fill"), pct });
  }
  requestAnimationFrame(() => {
    for (const f of fills) f.el.style.width = f.pct + "%";
  });
}

function renderPaidOffList() {
  const card = document.getElementById("celebrateCard");
  const wrap = document.getElementById("paidOffList");
  wrap.innerHTML = "";
  const paidOff = state.bills.filter(b => b.paidOff);
  if (paidOff.length === 0) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  for (const b of paidOff) {
    const item = document.createElement("div");
    item.className = "paidoff-item";
    item.textContent = `🎉 ${b.name} is paid off! That frees up ${fmtMoney(b.amount)}/month.`;
    wrap.appendChild(item);
  }
}

function celebrate(name, amount) {
  showToast(`🎉 ${name} is paid off! That frees up ${fmtMoney(amount)}/month.`);
  const colors = ["#c1673f", "#4d7c5f", "#b5793a", "#b1503f", "#8a6fbf"];
  for (let i = 0; i < 40; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = Math.random() * 100 + "vw";
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    const duration = 2 + Math.random() * 1.5;
    piece.style.animationDuration = duration + "s";
    piece.style.animationDelay = Math.random() * 0.3 + "s";
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), (duration + 0.5) * 1000);
  }
}

function showToast(text) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = text;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 350);
  }, 3500);
}

function freqLabel(f) {
  return { monthly: "monthly", semimonthly: "twice a month", biweekly: "every 2 weeks", weekly: "weekly", annual: "annually" }[f] || f;
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// ---------- forms ----------

document.getElementById("incomeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("incName").value.trim();
  const amount = parseFloat(document.getElementById("incAmount").value);
  const frequency = document.getElementById("incFrequency").value;
  if (!name || isNaN(amount)) return;
  state.income.push({ id: crypto.randomUUID(), name, amount, frequency });
  saveData();
  e.target.reset();
  render();
});

const billIsDebtCheckbox = document.getElementById("billIsDebt");
const billBalanceInput = document.getElementById("billBalance");
billIsDebtCheckbox.addEventListener("change", () => {
  billBalanceInput.hidden = !billIsDebtCheckbox.checked;
  billBalanceInput.required = billIsDebtCheckbox.checked;
  if (!billIsDebtCheckbox.checked) billBalanceInput.value = "";
});

const billFrequencySelect = document.getElementById("billFrequency");
const billDueDayInput = document.getElementById("billDueDay");
const billWeekdaySelect = document.getElementById("billWeekday");
const billAnchorDateInput = document.getElementById("billAnchorDate");

function syncBillFrequencyFields() {
  const freq = billFrequencySelect.value;
  billDueDayInput.hidden = freq !== "monthly";
  billDueDayInput.required = freq === "monthly";
  billWeekdaySelect.hidden = freq === "monthly";
  billAnchorDateInput.hidden = freq !== "biweekly";
  billAnchorDateInput.required = freq === "biweekly";
}
billFrequencySelect.addEventListener("change", syncBillFrequencyFields);
syncBillFrequencyFields();

document.getElementById("billForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("billName").value.trim();
  const amount = parseFloat(document.getElementById("billAmount").value);
  const frequency = billFrequencySelect.value;
  const category = document.getElementById("billCategory").value;
  const isDebt = billIsDebtCheckbox.checked;
  const balanceInput = parseFloat(billBalanceInput.value);

  if (!name || isNaN(amount)) return;
  if (isDebt && isNaN(balanceInput)) return;

  const bill = { id: crypto.randomUUID(), name, amount, category, paidForCycle: null, isDebt, paidOff: false, frequency };

  if (frequency === "monthly") {
    const dueDay = parseInt(billDueDayInput.value, 10);
    if (isNaN(dueDay)) return;
    bill.dueDay = dueDay;
  } else if (frequency === "weekly") {
    bill.dueWeekday = parseInt(billWeekdaySelect.value, 10);
  } else if (frequency === "biweekly") {
    bill.dueWeekday = parseInt(billWeekdaySelect.value, 10);
    if (!billAnchorDateInput.value) return;
    bill.anchorDate = billAnchorDateInput.value;
  }

  if (isDebt) {
    bill.balance = balanceInput;
    bill.originalBalance = balanceInput;
  }

  state.bills.push(bill);
  saveData();
  e.target.reset();
  billBalanceInput.hidden = true;
  syncBillFrequencyFields();
  render();
});

// ---------- export / import ----------

document.getElementById("exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "harbor-budget-backup.json";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("importFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      state = { income: parsed.income || [], bills: parsed.bills || [] };
      saveData();
      render();
    } catch (err) {
      alert("Couldn't read that file. Make sure it's a Harbor backup JSON.");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

render();
