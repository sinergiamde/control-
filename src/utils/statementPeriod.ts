import { normalizeAnalysisTransactions } from "./reportTypes";
import { normalizePeriod } from "./normalizePeriod";
import { translateCategory } from "./i18n";

/** Inclusive date interval (to = end of that day). */
export interface DateInterval {
  from: Date;
  to: Date;
}

export interface StatementRow {
  id: string;
  user_id: string;
  client_id: string | null;
  period: string;
  original_filename: string;
  created_at: string;
  full_analysis: any;
}

export const TXN_LISTS = ["revenues", "cogs", "opex", "fees", "personal"] as const;
export type TxnList = (typeof TXN_LISTS)[number];

export interface Txn {
  list: TxnList;
  amount: number;
  date: Date;
  category: string;
}

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const toNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.abs(value);
  if (typeof value === "string") {
    const normalized = value.replace(/[^\d.,-]/g, "").replace(/,(?=\d{3}(\D|$))/g, "").replace(/,/g, ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
  }
  return 0;
};

const getSource = (full: any) => full?.analysis ?? full;

const US_RANGE = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(?:-|–|—|to|al|a)\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i;
const ISO_RANGE = /(\d{4})-(\d{1,2})-(\d{1,2})\s*(?:-|–|—|to|al|a)\s*(\d{4})-(\d{1,2})-(\d{1,2})/i;

/** The dates a statement covers, read from the period the analyzer wrote ("04/01/2025 -
 * 04/30/2025"); falls back to the whole month the period names, then to the upload month. */
export const statementRange = (row: StatementRow): DateInterval => {
  const src = getSource(row.full_analysis);
  const text = String(src?.period || row.period || "");
  const us = text.match(US_RANGE);
  if (us) {
    return {
      from: new Date(+us[3], +us[1] - 1, +us[2]),
      to: endOfDay(new Date(+us[6], +us[4] - 1, +us[5])),
    };
  }
  const iso = text.match(ISO_RANGE);
  if (iso) {
    return {
      from: new Date(+iso[1], +iso[2] - 1, +iso[3]),
      to: endOfDay(new Date(+iso[4], +iso[5] - 1, +iso[6])),
    };
  }
  for (const candidate of [text, row.period, src?.period_en, src?.period_es, row.original_filename]) {
    const ym = normalizePeriod(String(candidate || ""));
    const m = ym.match(/^(\d{4})-(\d{2})$/);
    if (m) {
      const from = new Date(+m[1], +m[2] - 1, 1);
      return { from, to: endOfDay(new Date(+m[1], +m[2], 0)) };
    }
  }
  const created = new Date(row.created_at);
  return {
    from: new Date(created.getFullYear(), created.getMonth(), 1),
    to: endOfDay(new Date(created.getFullYear(), created.getMonth() + 1, 0)),
  };
};

/** A transaction's real date. The analyzer writes "MM/DD" without a year, so the year comes from
 * the statement's own range (a Dec 15 – Jan 14 statement puts "01/03" in the later year). */
export const transactionDate = (raw: unknown, range: DateInterval): Date | null => {
  const s = String(raw || "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return new Date(year, +m[1] - 1, +m[2]);
  }
  m = s.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (m) {
    const month = +m[1] - 1;
    const startYear = range.from.getFullYear();
    const endYear = range.to.getFullYear();
    const year = startYear !== endYear && month < range.from.getMonth() ? endYear : startYear;
    return new Date(year, month, +m[2]);
  }
  return null;
};

const inInterval = (d: Date, interval: DateInterval) => d >= interval.from && d <= interval.to;
const overlaps = (a: DateInterval, b: DateInterval) => a.from <= b.to && a.to >= b.from;

export interface FilteredStatement {
  row: StatementRow;
  /** A cleaned, deep-copied full_analysis holding only the transactions inside the interval —
   * safe to hand to buildConsolidatedReport for a PDF/Excel of exactly the selected dates. */
  data: any;
  range: DateInterval;
  txns: Txn[];
  /** Some of this statement's transactions fall outside the selected dates. */
  partial: boolean;
}

/** Keeps only the transactions inside `interval` (null = everything). Returns null when nothing
 * in the statement falls inside it. */
export const filterStatement = (row: StatementRow, interval: DateInterval | null): FilteredStatement | null => {
  const data = structuredClone(row.full_analysis ?? {});
  const src = getSource(data);
  if (!src || typeof src !== "object") return null;
  // Same duplicate-removal and category rebucketing the reports apply, so the numbers here match
  // the PDF/Excel for the same selection.
  normalizeAnalysisTransactions(src);
  const range = statementRange(row);

  const txns: Txn[] = [];
  let total = 0;
  let kept = 0;
  for (const list of TXN_LISTS) {
    const items = Array.isArray(src[list]) ? src[list] : [];
    total += items.length;
    const keptItems = items.filter((item: any) => {
      const date = transactionDate(item?.date, range) ?? range.from;
      if (interval && !inInterval(date, interval)) return false;
      txns.push({
        list,
        amount: toNumber(item?.amt ?? item?.amount),
        date,
        category: String(item?.category || item?.desc || item?.name || ""),
      });
      return true;
    });
    kept += keptItems.length;
    src[list] = keptItems;
  }

  if (interval) {
    if (total > 0 ? kept === 0 : !overlaps(range, interval)) return null;
    if (Array.isArray(src.thirdPartyPayments)) {
      src.thirdPartyPayments = src.thirdPartyPayments.filter((p: any) => {
        const date = transactionDate(p?.date, range) ?? range.from;
        return inInterval(date, interval);
      });
    }
  }

  const partial = kept < total;
  // The bank's printed opening/closing summary only reconciles against the WHOLE statement.
  if (partial) delete src.bankSummary;
  return { row, data, range, txns, partial };
};

export interface DashboardTotals {
  revenue: number;
  cogs: number;
  opex: number;
  fees: number;
  personal: number;
  expenses: number;
  net: number;
}

export const totalsOf = (txns: Txn[]): DashboardTotals => {
  const sum = (list: TxnList) => txns.filter((t) => t.list === list).reduce((s, t) => s + t.amount, 0);
  const revenue = sum("revenues");
  const cogs = sum("cogs");
  const opex = sum("opex");
  const fees = sum("fees");
  const personal = sum("personal");
  const expenses = cogs + opex + fees + personal;
  // Same formula as the consolidated report: revenue − COGS − OpEx (incl. meals & fees) − personal.
  return { revenue, cogs, opex, fees, personal, expenses, net: revenue - expenses };
};

/** Income vs expenses per calendar month, oldest first. */
export const monthlySeries = (txns: Txn[]) => {
  const map = new Map<string, { income: number; expenses: number }>();
  for (const t of txns) {
    const key = monthKey(t.date);
    const entry = map.get(key) || { income: 0, expenses: 0 };
    if (t.list === "revenues") entry.income += t.amount;
    else entry.expenses += t.amount;
    map.set(key, entry);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, v]) => ({ key, ...v, net: v.income - v.expenses }));
};

/** Expense categories, largest first. */
export const expenseCategories = (txns: Txn[], isEnglish: boolean) => {
  const map = new Map<string, number>();
  for (const t of txns) {
    if (t.list === "revenues" || t.amount <= 0) continue;
    const name = translateCategory(t.category, isEnglish) || t.category || "—";
    map.set(name, (map.get(name) || 0) + t.amount);
  }
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
};
