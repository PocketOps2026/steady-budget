// Harbor — a due-date-first budget app
// All data lives in localStorage. No accounts, no bank linking.
// (Storage key kept as "steady-budget-data-v1" so existing data isn't lost after the rename.)

const STORAGE_KEY = "steady-budget-data-v1";

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { income: [], bills: [], sinkingFunds: [], monthlySnapshots: [] };
    const parsed = JSON.parse(raw);
    return {
      income: parsed.income || [],
      bills: parsed.bills || [],
      sinkingFunds: parsed.sinkingFunds || [],
      monthlySnapshots: parsed.monthlySnapshots || [],
    };
  } catch (e) {
    return { income: [], bills: [], sinkingFunds: [], monthlySnapshots: [] };
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

// Variable/commission income: computed from a history of logged monthly
// amounts rather than a fixed amount + frequency.
function computeVariableMonthly(inc) {
  const hist = (inc.history || []).slice().sort((a, b) => a.month.localeCompare(b.month));
  const recent = hist.slice(-6); // trailing up to 6 logged months
  if (recent.length === 0) return { avg: 0, lowest: 0, count: 0, basisValue: 0 };
  const amounts = recent.map(h => h.amount);
  const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
  const lowest = Math.min(...amounts);
  const basisValue = inc.basis === "average" ? avg : lowest;
  return { avg, lowest, count: recent.length, basisValue };
}

function monthLabel(m) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function ordinalSuffix(n) {
  const j = n % 10, k = n % 100;
  if (j === 1 && k !== 11) return "st";
  if (j === 2 && k !== 12) return "nd";
  if (j === 3 && k !== 13) return "rd";
  return "th";
}

function incomeScheduleLabel(inc) {
  const freq = inc.frequency;
  if (freq === "monthly" && inc.payDay) return `payday ${inc.payDay}${ordinalSuffix(inc.payDay)}`;
  if (freq === "semimonthly" && inc.payDay1 && inc.payDay2) {
    return `paydays ${inc.payDay1}${ordinalSuffix(inc.payDay1)} & ${inc.payDay2}${ordinalSuffix(inc.payDay2)}`;
  }
  if (freq === "weekly" && inc.payWeekday !== undefined && inc.payWeekday !== null) {
    const names = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
    return names[inc.payWeekday];
  }
  if (freq === "biweekly" && inc.anchorDate) return "every 2 weeks";
  return null;
}

// Next specific pay date for a fixed income source, if it has enough info to compute one.
// Returns null (no date info) rather than guessing, so the paycheck view can prompt for it.
function nextPayDate(inc, today) {
  const t = startOfDay(today);
  const freq = inc.frequency;

  if (freq === "weekly" && inc.payWeekday !== undefined && inc.payWeekday !== null) {
    return nextWeekdayOnOrAfter(t, inc.payWeekday);
  }
  if (freq === "biweekly" && inc.payWeekday !== undefined && inc.payWeekday !== null && inc.anchorDate) {
    return nextBiweeklyOnOrAfter(t, parseAnchorDate(inc.anchorDate));
  }
  if (freq === "monthly" && inc.payDay) {
    let year = t.getFullYear(), month = t.getMonth();
    let day = Math.min(inc.payDay, daysInMonth(year, month));
    let due = new Date(year, month, day);
    if (due < t) {
      month += 1;
      if (month > 11) { month = 0; year += 1; }
      day = Math.min(inc.payDay, daysInMonth(year, month));
      due = new Date(year, month, day);
    }
    return due;
  }
  if (freq === "semimonthly" && inc.payDay1 && inc.payDay2) {
    const candidates = [inc.payDay1, inc.payDay2].map(d => {
      let year = t.getFullYear(), month = t.getMonth();
      let day = Math.min(d, daysInMonth(year, month));
      let due = new Date(year, month, day);
      if (due < t) {
        month += 1;
        if (month > 11) { month = 0; year += 1; }
        day = Math.min(d, daysInMonth(year, month));
        due = new Date(year, month, day);
      }
      return due;
    });
    return candidates.sort((a, b) => a - b)[0];
  }
  return null;
}

function totalMonthlyIncome() {
  return state.income.reduce((sum, i) => {
    if (i.type === "variable") return sum + computeVariableMonthly(i).basisValue;
    return sum + monthlyAmount(i.amount, i.frequency);
  }, 0);
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

// ---------- month-over-month trend ----------

function monthKey(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

// Keeps a running snapshot of income/bills/leftover per calendar month. The
// current month's entry stays live (updates as you edit data); past months
// are left as a frozen historical record once you move on from them.
function upsertMonthlySnapshot(today, income, bills, leftover) {
  const key = monthKey(today);
  state.monthlySnapshots = state.monthlySnapshots || [];
  const existing = state.monthlySnapshots.find(s => s.month === key);
  const rIncome = Math.round(income), rBills = Math.round(bills), rLeftover = Math.round(leftover);
  let changed = false;
  if (existing) {
    if (existing.income !== rIncome || existing.bills !== rBills || existing.leftover !== rLeftover) {
      existing.income = rIncome; existing.bills = rBills; existing.leftover = rLeftover;
      changed = true;
    }
  } else {
    state.monthlySnapshots.push({ month: key, income: rIncome, bills: rBills, leftover: rLeftover });
    changed = true;
  }
  if (changed) {
    state.monthlySnapshots.sort((a, b) => a.month.localeCompare(b.month));
    if (state.monthlySnapshots.length > 24) state.monthlySnapshots = state.monthlySnapshots.slice(-24);
    saveData();
  }
}

function renderTrend() {
  const wrap = document.getElementById("trendList");
  const empty = document.getElementById("trendEmpty");
  const snaps = (state.monthlySnapshots || []).slice(-6);

  if (snaps.length < 2) {
    wrap.hidden = true;
    empty.hidden = false;
    return;
  }
  wrap.hidden = false;
  empty.hidden = true;
  wrap.innerHTML = "";

  const maxAbs = Math.max(1, ...snaps.map(s => Math.abs(s.leftover)));
  const fills = [];
  for (const s of snaps) {
    const positive = s.leftover >= 0;
    const pct = Math.min(50, (Math.abs(s.leftover) / maxAbs) * 50);
    const row = document.createElement("div");
    row.className = "trend-row";
    row.innerHTML = `
      <span class="trend-month">${monthLabel(s.month)}</span>
      <span class="trend-figures">${fmtMoney(s.income)} in · ${fmtMoney(s.bills)} out</span>
      <div class="trend-bar-track">
        <div class="trend-bar-mid"></div>
        <div class="trend-bar-fill ${positive ? "positive" : "negative"}"></div>
      </div>
      <span class="trend-leftover" style="color:${positive ? "var(--good)" : "var(--bad)"}">${fmtMoney(s.leftover)}</span>
    `;
    wrap.appendChild(row);
    fills.push({ el: row.querySelector(".trend-bar-fill"), pct });
  }
  requestAnimationFrame(() => {
    for (const f of fills) f.el.style.width = f.pct + "%";
  });
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

  upsertMonthlySnapshot(today, income, bills, leftover);

  renderPaycheckWindow(today);
  renderDueList(today);
  renderMonthPlanner();
  renderFeedback(income, bills, leftover, today);
  renderIncomeList();
  renderBillsList();
  renderCategoryBars();
  renderPayoffList();
  renderPaidOffList();
  renderSinkingList();
  renderTrend();
  renderDebtStrategy();
  renderCoverage();
  syncBillPaidFromOptions();
}

function renderPaycheckWindow(today) {
  const sub = document.getElementById("paycheckSub");
  const summary = document.getElementById("paycheckSummary");
  const list = document.getElementById("paycheckList");
  const empty = document.getElementById("paycheckEmpty");
  list.innerHTML = "";

  const datedIncomes = state.income
    .filter(i => (i.type || "fixed") !== "variable")
    .map(i => ({ inc: i, date: nextPayDate(i, today) }))
    .filter(x => x.date);

  if (datedIncomes.length === 0) {
    sub.textContent = "Add a pay day to an income source below to turn this on.";
    summary.hidden = true;
    list.hidden = true;
    empty.hidden = true;
    return;
  }
  list.hidden = false;

  const nextDate = datedIncomes.reduce((min, x) => (x.date < min ? x.date : min), datedIncomes[0].date);
  const nextKey = dueDateKey(nextDate);
  const arriving = datedIncomes.filter(x => dueDateKey(x.date) === nextKey);
  const arrivingTotal = arriving.reduce((s, x) => s + Number(x.inc.amount || 0), 0);
  const arrivingNames = arriving.map(x => x.inc.name).join(" & ");

  const days = daysUntil(nextDate, today);
  sub.textContent = `Everything due through ${nextDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} — ${days === 0 ? "today" : days === 1 ? "1 day from now" : days + " days from now"}.`;

  const dueRows = activeBills()
    .map(b => {
      const due = nextDueDate(b, today);
      const key = dueDateKey(due);
      return { bill: b, due, key, paid: b.paidForCycle === key, days: daysUntil(due, today) };
    })
    .filter(x => x.due <= nextDate)
    .sort((a, b) => a.due - b.due);

  const unpaidTotal = dueRows.filter(x => !x.paid).reduce((s, x) => s + x.bill.amount, 0);

  document.getElementById("paycheckDue").textContent = fmtMoney(unpaidTotal);
  document.getElementById("paycheckIncoming").textContent = fmtMoney(arrivingTotal) + (arrivingNames ? ` (${arrivingNames})` : "");
  const coversEl = document.getElementById("paycheckCovers");
  const diff = arrivingTotal - unpaidTotal;
  coversEl.textContent = diff >= 0 ? `Yes, +${fmtMoney(diff)} left` : `Short by ${fmtMoney(Math.abs(diff))}`;
  coversEl.style.color = diff >= 0 ? "var(--good)" : "var(--bad)";
  summary.hidden = false;

  if (dueRows.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  for (const item of dueRows) {
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
    checkbox.addEventListener("change", () => markOccurrence(item.bill, item.key, checkbox.checked));

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

  // When money's tight, point at specifically flexible spending rather than
  // just the biggest category (which is often rent — not something you can cut).
  const tight = leftover < 0 || (income > 0 && leftover < income * 0.05);
  if (tight) {
    const flexibleBills = activeBills().filter(b => b.priority === "flexible");
    if (flexibleBills.length > 0) {
      const flexTotal = flexibleBills.reduce((s, b) => s + monthlyAmount(b.amount, billFrequency(b)), 0);
      const topFlex = flexibleBills
        .slice()
        .sort((a, b) => monthlyAmount(b.amount, billFrequency(b)) - monthlyAmount(a.amount, billFrequency(a)))
        .slice(0, 3)
        .map(b => `${b.name} (${fmtMoney(monthlyAmount(b.amount, billFrequency(b)))})`)
        .join(", ");
      items.push({
        level: "warn",
        text: `You've tagged ${fmtMoney(flexTotal)}/month as flexible spending — the biggest of those: ${topFlex}. These are the easiest places to trim first.`,
      });
    } else if (activeBills().length > 0) {
      items.push({
        level: "warn",
        text: "None of your bills are tagged Flexible yet — mark any non-essential ones (subscriptions, dining out, etc.) as Flexible when adding them to get specific suggestions on what to cut.",
      });
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
  // Interest-aware when a rate has been entered.
  const payoffEstimates = activeBills().filter(b => b.isDebt && b.balance > b.amount);
  for (const b of payoffEstimates) {
    const months = monthsToPayoff(b.balance, b.amount, b.interestRate || 0);
    if (months === Infinity) {
      items.push({
        level: "bad",
        text: `${b.name}'s payment (${fmtMoney(b.amount)}) doesn't cover the interest being charged at ${b.interestRate}% APR — the balance will keep growing unless the payment goes up.`,
      });
    } else if (months <= 24) {
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

  // Variable/commission income guidance.
  for (const inc of state.income.filter(i => i.type === "variable")) {
    const calc = computeVariableMonthly(inc);
    if (calc.count === 0) continue;
    if (calc.count < 3) {
      items.push({
        level: "warn",
        text: `${inc.name} only has ${calc.count} ${calc.count === 1 ? "month" : "months"} logged so far — add a couple more as they come in so the average and low-month figures are more reliable.`,
      });
    } else if (inc.basis === "average" && calc.avg > calc.lowest * 1.1) {
      items.push({
        level: "warn",
        text: `${inc.name} is budgeted off its average (${fmtMoney(calc.avg)}/mo), but its lowest recent month was ${fmtMoney(calc.lowest)}. A slow month could leave you short — switching to "lowest recent month" as the basis is the safer bet.`,
      });
    } else if ((inc.basis || "lowest") === "lowest" && calc.avg > calc.lowest * 1.15) {
      items.push({
        level: "good",
        text: `${inc.name} is budgeted conservatively off its lowest month (${fmtMoney(calc.lowest)}/mo). On an average month you're actually bringing in about ${fmtMoney(calc.avg)} — the extra ${fmtMoney(calc.avg - calc.lowest)} is a good candidate for savings or extra debt payments.`,
      });
    }
  }

  // Bill price creep — flag notable jumps between the last two logged prices.
  for (const b of activeBills()) {
    const jump = billPriceJump(b);
    if (jump && jump.pctChange >= 8) {
      items.push({
        level: "warn",
        text: `${b.name} jumped from ${fmtMoney(jump.prev.amount)} to ${fmtMoney(jump.cur.amount)} (+${Math.round(jump.pctChange)}%) since ${monthLabel(jump.prev.month)} — worth a call to negotiate or shop around.`,
      });
    }
  }

  // Month-over-month comparison, once there's history to compare against.
  const sortedSnaps = (state.monthlySnapshots || []).slice().sort((a, b) => a.month.localeCompare(b.month));
  const curIdx = sortedSnaps.findIndex(s => s.month === monthKey(today));
  if (curIdx > 0) {
    const prev = sortedSnaps[curIdx - 1];
    const cur = sortedSnaps[curIdx];
    const delta = cur.leftover - prev.leftover;
    if (Math.abs(delta) >= 20) {
      items.push({
        level: delta > 0 ? "good" : "warn",
        text: delta > 0
          ? `You're ahead of ${monthLabel(prev.month)} by ${fmtMoney(delta)} in leftover cash this month.`
          : `You're behind ${monthLabel(prev.month)} by ${fmtMoney(Math.abs(delta))} in leftover cash this month.`,
      });
    }
  }

  // Sinking fund pacing.
  const activeFunds = (state.sinkingFunds || []).filter(f => f.saved < f.target);
  if (activeFunds.length > 0) {
    let totalSuggested = 0;
    for (const f of activeFunds) {
      const monthsLeft = sinkingMonthsRemaining(f, today);
      const remaining = Math.max(0, f.target - f.saved);
      totalSuggested += monthsLeft > 0 ? remaining / monthsLeft : remaining;
    }
    if (totalSuggested > 0 && leftover > 0) {
      if (totalSuggested > leftover) {
        items.push({
          level: "warn",
          text: `Staying on pace for your savings goals needs about ${fmtMoney(Math.round(totalSuggested))}/month, but you've only got ${fmtMoney(Math.round(leftover))} left over. One or more goals may need a later target date.`,
        });
      } else {
        items.push({
          level: "good",
          text: `Setting aside about ${fmtMoney(Math.round(totalSuggested))}/month keeps all your savings goals on pace.`,
        });
      }
    }
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
    if (inc.type === "variable") {
      wrap.appendChild(renderVariableIncomeRow(inc, idx));
      return;
    }
    const row = document.createElement("div");
    row.className = "entry-row";
    const schedule = incomeScheduleLabel(inc);
    row.innerHTML = `
      <div class="entry-row-main">
        <span>${escapeHtml(inc.name)}</span>
        <span class="entry-row-sub">${fmtMoney(inc.amount)} · ${freqLabel(inc.frequency)}${schedule ? " · " + schedule : ""}</span>
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

function renderVariableIncomeRow(inc, idx) {
  const wrap = document.createElement("div");
  wrap.className = "entry-row variable-row";

  const calc = computeVariableMonthly(inc);
  const basisLabel = inc.basis === "average" ? "average" : "lowest";

  const main = document.createElement("div");
  main.className = "variable-main";
  const mainInfo = document.createElement("div");
  mainInfo.className = "entry-row-main";
  mainInfo.innerHTML = `
    <span>${escapeHtml(inc.name)}<span class="badge">Variable</span></span>
    <span class="entry-row-sub">${calc.count === 0
      ? "No months logged yet — add one below."
      : `Using ${basisLabel} of last ${calc.count} ${calc.count === 1 ? "month" : "months"}: ${fmtMoney(calc.basisValue)}/mo`}</span>
  `;
  main.appendChild(mainInfo);
  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-btn";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => {
    state.income.splice(idx, 1);
    saveData();
    render();
  });
  main.appendChild(removeBtn);
  wrap.appendChild(main);

  if (calc.count > 0) {
    const controls = document.createElement("div");
    controls.className = "variable-controls";
    const basisSelect = document.createElement("select");
    basisSelect.innerHTML = `
      <option value="lowest">Budget off: lowest recent month (safer)</option>
      <option value="average">Budget off: average</option>
    `;
    basisSelect.value = inc.basis === "average" ? "average" : "lowest";
    basisSelect.addEventListener("change", () => {
      inc.basis = basisSelect.value;
      saveData();
      render();
    });
    controls.appendChild(basisSelect);
    wrap.appendChild(controls);
  }

  const hist = (inc.history || []).slice().sort((a, b) => b.month.localeCompare(a.month));
  if (hist.length > 0) {
    const histWrap = document.createElement("div");
    histWrap.className = "variable-history";
    for (const h of hist) {
      const hrow = document.createElement("div");
      hrow.className = "variable-hist-row";
      const label = document.createElement("span");
      label.textContent = monthLabel(h.month);
      const amt = document.createElement("span");
      amt.textContent = fmtMoney(h.amount);
      const rm = document.createElement("button");
      rm.className = "remove-btn";
      rm.textContent = "×";
      rm.title = "Remove this month";
      rm.addEventListener("click", () => {
        inc.history = inc.history.filter(x => x.id !== h.id);
        saveData();
        render();
      });
      hrow.appendChild(label);
      hrow.appendChild(amt);
      hrow.appendChild(rm);
      histWrap.appendChild(hrow);
    }
    wrap.appendChild(histWrap);
  }

  const addForm = document.createElement("form");
  addForm.className = "variable-add-form";
  addForm.setAttribute("autocomplete", "off");
  addForm.innerHTML = `
    <input type="month" autocomplete="off" required />
    <input type="number" min="0" step="0.01" placeholder="Amount" autocomplete="off" required />
    <button type="submit" class="add-btn">Log month</button>
  `;
  addForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const monthInput = addForm.querySelector('input[type="month"]');
    const amountInput = addForm.querySelector('input[type="number"]');
    const month = monthInput.value;
    const amount = parseFloat(amountInput.value);
    if (!month || isNaN(amount)) return;
    inc.history = inc.history || [];
    const existing = inc.history.find(h => h.month === month);
    if (existing) existing.amount = amount;
    else inc.history.push({ id: crypto.randomUUID(), month, amount });
    saveData();
    render();
  });
  wrap.appendChild(addForm);

  return wrap;
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

// Which bill IDs currently have their "update price" mini-form expanded.
// UI-only state — not persisted, reset each page load.
const expandedPriceBillIds = new Set();

function billPriceJump(bill) {
  const hist = (bill.priceHistory || []).slice().sort((a, b) => a.month.localeCompare(b.month));
  if (hist.length < 2) return null;
  const prev = hist[hist.length - 2];
  const cur = hist[hist.length - 1];
  if (!prev.amount || prev.amount <= 0) return null;
  const pctChange = ((cur.amount - prev.amount) / prev.amount) * 100;
  return { prev, cur, pctChange };
}

function updateBillPrice(bill, newAmount) {
  const key = monthKey(new Date());
  bill.priceHistory = bill.priceHistory || [];
  const existing = bill.priceHistory.find(h => h.month === key);
  if (existing) existing.amount = newAmount;
  else bill.priceHistory.push({ id: crypto.randomUUID(), month: key, amount: newAmount });
  bill.priceHistory.sort((a, b) => a.month.localeCompare(b.month));
  bill.amount = newAmount;
  saveData();
  render();
}

function renderBillsList() {
  const wrap = document.getElementById("billsList");
  wrap.innerHTML = "";
  activeBills().forEach((b) => {
    const row = document.createElement("div");
    row.className = "entry-row";
    const debtNote = b.isDebt ? ` · ${fmtMoney(b.balance)} left` : "";
    const flexBadge = (b.priority === "flexible") ? `<span class="badge">Flexible</span>` : "";
    row.innerHTML = `
      <div class="entry-row-main">
        <span>${escapeHtml(b.name)}${flexBadge}</span>
        <span class="entry-row-sub">${fmtMoney(b.amount)} · ${billScheduleLabel(b)} · ${escapeHtml(b.category)}${debtNote}</span>
      </div>
    `;
    const priceBtn = document.createElement("button");
    priceBtn.className = "remove-btn";
    priceBtn.textContent = expandedPriceBillIds.has(b.id) ? "Hide" : "Update price";
    priceBtn.addEventListener("click", () => {
      if (expandedPriceBillIds.has(b.id)) expandedPriceBillIds.delete(b.id);
      else expandedPriceBillIds.add(b.id);
      renderBillsList();
    });
    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      removeBillById(b.id);
    });
    row.appendChild(priceBtn);
    row.appendChild(removeBtn);
    wrap.appendChild(row);

    if (expandedPriceBillIds.has(b.id)) {
      const form = document.createElement("form");
      form.className = "variable-add-form";
      form.setAttribute("autocomplete", "off");

      // Built with createElement + property assignment (not innerHTML string
      // interpolation) since the bill name goes into an attribute here —
      // property assignment is injection-safe regardless of special characters.
      const priceInput = document.createElement("input");
      priceInput.type = "number";
      priceInput.min = "0";
      priceInput.step = "0.01";
      priceInput.placeholder = "New amount for " + b.name;
      priceInput.autocomplete = "off";
      priceInput.required = true;

      const submitBtn = document.createElement("button");
      submitBtn.type = "submit";
      submitBtn.className = "add-btn";
      submitBtn.textContent = "Log new price";

      form.appendChild(priceInput);
      form.appendChild(submitBtn);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const newAmount = parseFloat(priceInput.value);
        if (isNaN(newAmount) || newAmount < 0) return;
        updateBillPrice(b, newAmount);
      });
      wrap.appendChild(form);
    }
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
        <input type="number" min="0" step="0.01" placeholder="Correct balance to..." autocomplete="off" data-id="${b.id}" />
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

// ---------- debt strategy ----------

// Months to pay off a balance at a fixed payment, accounting for interest
// compounding monthly. Returns Infinity if the payment doesn't even cover
// the interest charged (balance would never shrink).
function monthsToPayoff(balance, payment, annualRatePct) {
  const monthlyRate = (annualRatePct || 0) / 100 / 12;
  if (monthlyRate <= 0) return payment > 0 ? Math.ceil(balance / payment) : Infinity;
  if (payment <= balance * monthlyRate) return Infinity;
  let months = 0;
  let bal = balance;
  while (bal > 0 && months < 600) {
    bal = bal + bal * monthlyRate - payment;
    months++;
  }
  return months;
}

function syncBillPaidFromOptions() {
  const select = document.getElementById("billPaidFrom");
  const current = select.value;
  select.innerHTML = `<option value="">Paid from: unassigned</option>` +
    state.income.map(inc => `<option value="${inc.id}">Paid from: ${escapeHtml(inc.name)}</option>`).join("");
  if ([...select.options].some(o => o.value === current)) select.value = current;
}

function renderCoverage() {
  const card = document.getElementById("coverageCard");
  const wrap = document.getElementById("coverageList");
  wrap.innerHTML = "";
  if (state.income.length < 2) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  const bills = activeBills();
  for (const inc of state.income) {
    const assigned = bills.filter(b => b.paidFrom === inc.id);
    const total = assigned.reduce((s, b) => s + monthlyAmount(b.amount, billFrequency(b)), 0);
    const incMonthly = inc.type === "variable" ? computeVariableMonthly(inc).basisValue : monthlyAmount(inc.amount, inc.frequency);
    const diff = incMonthly - total;
    const row = document.createElement("div");
    row.className = "entry-row";
    row.innerHTML = `
      <div class="entry-row-main">
        <span>${escapeHtml(inc.name)}</span>
        <span class="entry-row-sub">${fmtMoney(total)} of ${fmtMoney(incMonthly)} allocated · ${fmtMoney(Math.abs(diff))} ${diff >= 0 ? "left over" : "short"}</span>
      </div>
    `;
    wrap.appendChild(row);
  }

  const unassigned = bills.filter(b => !b.paidFrom);
  if (unassigned.length > 0) {
    const unassignedTotal = unassigned.reduce((s, b) => s + monthlyAmount(b.amount, billFrequency(b)), 0);
    const row = document.createElement("div");
    row.className = "entry-row";
    row.innerHTML = `
      <div class="entry-row-main">
        <span>Not assigned</span>
        <span class="entry-row-sub">${fmtMoney(unassignedTotal)}/mo across ${unassigned.length} bill${unassigned.length === 1 ? "" : "s"} — pick a source when adding a bill to track this.</span>
      </div>
    `;
    wrap.appendChild(row);
  }
}

function renderDebtStrategy() {
  const card = document.getElementById("debtStrategyCard");
  const wrap = document.getElementById("debtStrategyList");
  const debts = activeBills().filter(b => b.isDebt);
  if (debts.length < 2) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  wrap.innerHTML = "";

  const withStats = debts.map(d => ({
    d,
    months: monthsToPayoff(d.balance, d.amount, d.interestRate || 0),
    monthlyInterest: d.balance * ((d.interestRate || 0) / 100 / 12),
  }));

  // Explicit undefined check, not truthy — a legitimately-entered 0% APR
  // debt (e.g. a promo card) is still "a rate was entered."
  const hasRates = debts.some(d => d.interestRate !== undefined);
  const ranked = hasRates
    ? withStats.slice().sort((a, b) => (b.d.interestRate ?? 0) - (a.d.interestRate ?? 0))
    : withStats.slice().sort((a, b) => a.d.balance - b.d.balance);

  const intro = document.createElement("p");
  intro.className = "empty-note";
  intro.style.marginBottom = "12px";
  intro.textContent = hasRates
    ? "Ranked by interest rate, highest first (avalanche order) — this saves the most money overall. Put any extra payment toward #1."
    : "No interest rates added yet, so this is ranked by smallest balance first (snowball order) — add a rate when you add a debt for a money-optimal order instead.";
  wrap.appendChild(intro);

  const list = document.createElement("div");
  list.className = "payoff-list";
  ranked.forEach((x, i) => {
    const rateTxt = x.d.interestRate !== undefined ? `${x.d.interestRate}% APR` : "no rate entered";
    const monthsTxt = x.months === Infinity
      ? "won't pay off at this rate — the payment doesn't cover the interest being charged"
      : `about ${x.months} ${x.months === 1 ? "month" : "months"} left at the current payment`;
    const row = document.createElement("div");
    row.className = "payoff-item";
    row.innerHTML = `
      <div class="payoff-item-top">
        <span class="payoff-name">${i + 1}. ${escapeHtml(x.d.name)}</span>
        <span class="payoff-fig">${fmtMoney(x.d.balance)} · ${rateTxt}</span>
      </div>
      <p class="empty-note" style="margin:0;">${monthsTxt}${x.monthlyInterest > 0 ? ` · costing about ${fmtMoney(x.monthlyInterest)}/mo in interest right now` : ""}</p>
    `;
    list.appendChild(row);
  });
  wrap.appendChild(list);

  if (hasRates) {
    const totalInterest = withStats.reduce((s, x) => s + x.monthlyInterest, 0);
    if (totalInterest > 0) {
      const note = document.createElement("p");
      note.className = "empty-note";
      note.style.marginTop = "12px";
      note.textContent = `Together these debts are costing about ${fmtMoney(totalInterest)}/month in interest — that's what an extra payment toward #1 saves you the fastest.`;
      wrap.appendChild(note);
    }
  }
}

// ---------- sinking funds ----------

function sinkingMonthsRemaining(fund, today) {
  const [ty, tm] = fund.month.split("-").map(Number);
  const target = new Date(ty, tm - 1, 1);
  const cur = new Date(today.getFullYear(), today.getMonth(), 1);
  const months = (target.getFullYear() - cur.getFullYear()) * 12 + (target.getMonth() - cur.getMonth());
  return Math.max(0, months);
}

function renderSinkingList() {
  const wrap = document.getElementById("sinkingList");
  const empty = document.getElementById("sinkingEmpty");
  wrap.innerHTML = "";
  const funds = state.sinkingFunds || [];
  if (funds.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const today = new Date();
  const fills = [];
  for (const f of funds) {
    const pct = Math.min(100, Math.max(0, (f.saved / f.target) * 100));
    const monthsLeft = sinkingMonthsRemaining(f, today);
    const remaining = Math.max(0, f.target - f.saved);
    const suggested = monthsLeft > 0 ? remaining / monthsLeft : remaining;
    const funded = f.saved >= f.target;

    const item = document.createElement("div");
    item.className = "payoff-item";
    item.innerHTML = `
      <div class="payoff-item-top">
        <span class="payoff-name">${escapeHtml(f.name)}</span>
        <span class="payoff-fig">${fmtMoney(f.saved)} of ${fmtMoney(f.target)}${funded ? " — funded! 🎉" : ""}</span>
      </div>
      <div class="payoff-track"><div class="payoff-fill sinking-fill"></div></div>
      ${funded ? "" : `<p class="empty-note" style="margin:0 0 8px;">${monthLabel(f.month)} target — about ${fmtMoney(Math.ceil(suggested))}/mo to get there</p>`}
      <div class="payoff-adjust">
        <input type="number" min="0" step="0.01" placeholder="Add contribution" autocomplete="off" />
        <button type="button">Add</button>
      </div>
    `;
    const btn = item.querySelector(".payoff-adjust button");
    const input = item.querySelector(".payoff-adjust input");
    btn.addEventListener("click", () => {
      const val = parseFloat(input.value);
      if (isNaN(val) || val <= 0) return;
      const wasFunded = f.saved >= f.target;
      f.saved = (f.saved || 0) + val;
      saveData();
      render();
      if (!wasFunded && f.saved >= f.target) celebrate(f.name + " fund", f.target);
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.textContent = "Remove goal";
    removeBtn.addEventListener("click", () => {
      state.sinkingFunds = state.sinkingFunds.filter(x => x.id !== f.id);
      saveData();
      render();
    });
    item.appendChild(removeBtn);

    wrap.appendChild(item);
    fills.push({ el: item.querySelector(".sinking-fill"), pct });
  }
  requestAnimationFrame(() => {
    for (const x of fills) x.el.style.width = x.pct + "%";
  });
}

document.getElementById("sinkingForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("sinkingName").value.trim();
  const target = parseFloat(document.getElementById("sinkingTarget").value);
  const month = document.getElementById("sinkingMonth").value;
  if (!name || isNaN(target) || !month) return;
  state.sinkingFunds = state.sinkingFunds || [];
  state.sinkingFunds.push({ id: crypto.randomUUID(), name, target, month, saved: 0 });
  saveData();
  e.target.reset();
  render();
});

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

const incTypeSelect = document.getElementById("incType");
const incAmountInput = document.getElementById("incAmount");
const incFrequencySelect = document.getElementById("incFrequency");
const incFirstMonthInput = document.getElementById("incFirstMonth");
const incFirstAmountInput = document.getElementById("incFirstAmount");
const incPayDayInput = document.getElementById("incPayDay");
const incPayDay1Input = document.getElementById("incPayDay1");
const incPayDay2Input = document.getElementById("incPayDay2");
const incPayWeekdaySelect = document.getElementById("incPayWeekday");
const incPayAnchorDateInput = document.getElementById("incPayAnchorDate");

function syncIncomeFields() {
  const variable = incTypeSelect.value === "variable";
  const freq = incFrequencySelect.value;

  incAmountInput.hidden = variable;
  incAmountInput.required = !variable;
  incFrequencySelect.hidden = variable;

  incFirstMonthInput.hidden = !variable;
  incFirstMonthInput.required = variable;
  incFirstAmountInput.hidden = !variable;
  incFirstAmountInput.required = variable;
  if (variable && !incFirstMonthInput.value) {
    const now = new Date();
    incFirstMonthInput.value = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  }

  // Pay-date fields are optional and only apply to fixed income.
  incPayDayInput.hidden = variable || freq !== "monthly";
  incPayDay1Input.hidden = variable || freq !== "semimonthly";
  incPayDay2Input.hidden = variable || freq !== "semimonthly";
  incPayWeekdaySelect.hidden = variable || (freq !== "weekly" && freq !== "biweekly");
  incPayAnchorDateInput.hidden = variable || freq !== "biweekly";
}
incTypeSelect.addEventListener("change", syncIncomeFields);
incFrequencySelect.addEventListener("change", syncIncomeFields);
syncIncomeFields();

document.getElementById("incomeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("incName").value.trim();
  if (!name) return;

  if (incTypeSelect.value === "variable") {
    const month = incFirstMonthInput.value;
    const amount = parseFloat(incFirstAmountInput.value);
    if (!month || isNaN(amount)) return;
    state.income.push({
      id: crypto.randomUUID(),
      name,
      type: "variable",
      basis: "lowest",
      history: [{ id: crypto.randomUUID(), month, amount }],
    });
  } else {
    const amount = parseFloat(incAmountInput.value);
    const frequency = incFrequencySelect.value;
    if (isNaN(amount)) return;
    const entry = { id: crypto.randomUUID(), name, type: "fixed", amount, frequency };

    if (frequency === "monthly" && incPayDayInput.value) {
      entry.payDay = parseInt(incPayDayInput.value, 10);
    } else if (frequency === "semimonthly" && incPayDay1Input.value && incPayDay2Input.value) {
      entry.payDay1 = parseInt(incPayDay1Input.value, 10);
      entry.payDay2 = parseInt(incPayDay2Input.value, 10);
    } else if (frequency === "weekly" && incPayWeekdaySelect.value !== "") {
      entry.payWeekday = parseInt(incPayWeekdaySelect.value, 10);
    } else if (frequency === "biweekly" && incPayWeekdaySelect.value !== "" && incPayAnchorDateInput.value) {
      entry.payWeekday = parseInt(incPayWeekdaySelect.value, 10);
      entry.anchorDate = incPayAnchorDateInput.value;
    }

    state.income.push(entry);
  }

  saveData();
  e.target.reset();
  syncIncomeFields();
  render();
});

const billIsDebtCheckbox = document.getElementById("billIsDebt");
const billBalanceInput = document.getElementById("billBalance");
const billInterestRateInput = document.getElementById("billInterestRate");
billIsDebtCheckbox.addEventListener("change", () => {
  billBalanceInput.hidden = !billIsDebtCheckbox.checked;
  billBalanceInput.required = billIsDebtCheckbox.checked;
  billInterestRateInput.hidden = !billIsDebtCheckbox.checked;
  if (!billIsDebtCheckbox.checked) {
    billBalanceInput.value = "";
    billInterestRateInput.value = "";
  }
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

  const priority = document.getElementById("billPriority").value;
  const paidFrom = document.getElementById("billPaidFrom").value || null;
  const bill = {
    id: crypto.randomUUID(), name, amount, category, paidForCycle: null, isDebt, paidOff: false, frequency, priority, paidFrom,
    priceHistory: [{ id: crypto.randomUUID(), month: monthKey(new Date()), amount }],
  };

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
    const rate = parseFloat(billInterestRateInput.value);
    if (!isNaN(rate) && rate >= 0) bill.interestRate = rate;
  }

  state.bills.push(bill);
  saveData();
  e.target.reset();
  billBalanceInput.hidden = true;
  billInterestRateInput.hidden = true;
  syncBillFrequencyFields();
  render();
});

// ---------- export / import ----------

document.getElementById("printBtn").addEventListener("click", () => {
  window.print();
});

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
      state = {
        income: parsed.income || [],
        bills: parsed.bills || [],
        sinkingFunds: parsed.sinkingFunds || [],
        monthlySnapshots: parsed.monthlySnapshots || [],
      };
      saveData();
      render();
    } catch (err) {
      alert("Couldn't read that file. Make sure it's a Harbor backup JSON.");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

// ---------- tabs ----------

const TAB_STORAGE_KEY = "harbor-active-tab";
const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");

function setActiveTab(tab) {
  const valid = [...tabButtons].some(b => b.dataset.tab === tab);
  if (!valid) tab = "today";
  tabButtons.forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tab));
  tabPanels.forEach(panel => panel.classList.toggle("active", panel.dataset.tabPanel === tab));
  try { localStorage.setItem(TAB_STORAGE_KEY, tab); } catch (e) {}
}

tabButtons.forEach(btn => {
  btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
});

let initialTab = "today";
try { initialTab = localStorage.getItem(TAB_STORAGE_KEY) || "today"; } catch (e) {}
setActiveTab(initialTab);

render();
