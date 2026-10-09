// moneyReport.js — money in and out by period, for the Profit & Loss by Month
// report and Year in Review (Reports plan, phase 1). A derived read, like
// incomeView.js and litterFinances.js: nothing stored.
//
// It reads the SAME two sources the Financials Overview does, scoped the same
// way, so the reports can never disagree with it: income rows from
// incomeView.getIncomeRows (scoped at the source) and the Expense ledger, each
// expense scoped through the subject it hangs off (Multi-Kennel Scope Spec §7).
//
// P&L is CASH BASIS: earned income is filed under the date its money moved (each
// component's `when`, incomeView.saleComponentDate), expenses under expense_date.
// Anticipated income is reported separately, under its due date, never in Net.
// Non-cash pick value is never money in.
import { getIncomeRows } from './incomeView.js';
import { expenseRepo } from './expenseRepo.js';
import { dogRepo } from './dogRepo.js';
import { litterRepo } from './litterRepo.js';
import { pairingRepo } from './pairingRepo.js';
import { subjectInScope } from './kennelScope.js';
import { periodKey } from './reportMath.js';

// The in-scope income rows and expenses, loaded once.
export async function loadMoney() {
  const [incomeRows, allExpenses, dogs, litters, pairings] = await Promise.all([
    getIncomeRows({ includeArchived: false }),
    expenseRepo.getAll({ includeArchived: false }),
    dogRepo.getAll({ includeArchived: true }),
    litterRepo.getAll({ includeArchived: true }),
    pairingRepo.getAll({ includeArchived: true })
  ]);
  const maps = {
    dog: new Map(dogs.map((d) => [d.id, d])),
    litter: new Map(litters.map((l) => [l.id, l])),
    pairing: new Map(pairings.map((p) => [p.id, p]))
  };
  const expenses = allExpenses.filter((x) => subjectInScope(x.subject_type, x.subject_id, maps));
  return { incomeRows, expenses };
}

// Flatten income rows into one dated entry per cash component:
// { date, amount, state: 'earned' | 'anticipated', component, source_type, row }.
// PURE.
export function incomeEntries(incomeRows) {
  const out = [];
  for (const r of incomeRows) {
    for (const c of r.components || []) {
      if (c.state !== 'earned' && c.state !== 'anticipated') continue; // pick is non-cash
      out.push({ date: c.when || r.date || '', amount: Number(c.amount) || 0, state: c.state, component: c.component, source_type: r.source_type, row: r });
    }
  }
  return out;
}

// One row per period: { period, income (earned), anticipated, expenses, net,
// cumulative } with every period present. Entries/expenses outside the periods
// are left out. PURE.
export function plByPeriod(entries, expenses, periods, granularity = 'month') {
  const rows = new Map(periods.map((p) => [p, { period: p, income: 0, anticipated: 0, expenses: 0, net: 0, cumulative: 0 }]));
  for (const e of entries) {
    const row = rows.get(periodKey(e.date, granularity));
    if (!row) continue;
    if (e.state === 'earned') row.income += e.amount;
    else row.anticipated += e.amount;
  }
  for (const x of expenses) {
    const row = rows.get(periodKey(x.expense_date, granularity));
    if (row) row.expenses += Number(x.amount) || 0;
  }
  let run = 0;
  for (const row of rows.values()) {
    row.net = row.income - row.expenses;
    run += row.net;
    row.cumulative = run;
  }
  return [...rows.values()];
}

// Totals by key over a date range: earned income by component, expenses by
// category. PURE. `inRangeFn(ymd)` decides membership.
export function moneyBreakdown(entries, expenses, inRangeFn) {
  const income = new Map();
  const spent = new Map();
  for (const e of entries) if (e.state === 'earned' && inRangeFn(e.date)) income.set(e.component, (income.get(e.component) || 0) + e.amount);
  for (const x of expenses) if (inRangeFn(x.expense_date)) spent.set(x.category, (spent.get(x.category) || 0) + (Number(x.amount) || 0));
  return { income, spent };
}
