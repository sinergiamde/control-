import { useState, useEffect, useRef, useMemo } from "react";
import ChatBot from "@/components/ChatBot";
import { useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DollarSign, TrendingUp, Receipt, ArrowLeft, Download, ChevronDown,
  ChevronUp, AlertTriangle, BarChart3, PieChart, Wallet, CreditCard,
  Building2, UtensilsCrossed, Car, ShoppingBag, Zap, Target, FileSpreadsheet, FileText,
  CheckCircle2, Users, Pencil, Loader2, Sparkles, Info,
} from "lucide-react";
import { generateProfessionalExcel } from "@/utils/generateExcel";
import { generateProfessionalPDF } from "@/utils/generatePDF";
import { saveReportToStorage } from "@/utils/saveReport";
import { reconcileStatement, normalizeBankSummary } from "@/utils/reconciliation";
import {
  FOOD_OPEX_CATEGORY,
  PERSONAL_TRANSFER_CATEGORY,
  PERSONAL_THIRD_PARTY_CATEGORIES,
  REASSIGN_TAXONOMY,
  normalizeAnalysisTransactions,
  type SectionKind,
  type ThirdPartyPayment,
  type ThirdPartyBuckets,
  type BankSummary,
  type ReconciliationResult,
  type TransactionList,
} from "@/utils/reportTypes";
import { STR, tr, translateCategory, pickText, pickArray } from "@/utils/i18n";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { openReceiptFile, receiptTxnKey, txnKey, type ReceiptRow } from "@/utils/receipts";
import { balanceDates, balanceLabel } from "@/utils/balanceDates";
import PeriodPicker, { selectionLabel, selectionToInterval, type PeriodSelection } from "@/components/PeriodPicker";
import { filterStatement, monthKey, statementRange, type FilteredStatement, type StatementRow } from "@/utils/statementPeriod";
import { deserializeSelection, mergeStatements, selectionForRange, serializeSelection } from "@/utils/periodView";
import { moveTransaction } from "@/utils/reassign";

interface LineItem {
  name: string;
  amount: number;
  percentage: number;
  detail?: string;
  category?: string;
  /** Present only for items that map 1:1 to a raw transaction in analysis.<list>[index] — lets the
   * "reassign" action find and move the exact underlying transaction. Synthetic/derived rows (the
   * "moved to Third Party Payments" reference line, third-party payment entries, etc.) omit these,
   * so they simply don't get a reassign button. */
  sourceList?: TransactionList;
  sourceIndex?: number;
  /** Identifies the raw transaction (date · description · amount) so a saved receipt can be shown
   * next to it — the same key Receipts stores when the receipt is linked. */
  txnKey?: string;
  receipt?: ReceiptRow;
}

interface Section {
  title: string;
  kind?: SectionKind;
  /** Short explanation shown under the section title. */
  note?: string;
  icon: React.ElementType;
  items: LineItem[];
  total: number;
  totalLabel: string;
  color: string;
}

interface KPI {
  label: string;
  value: string;
  description: string;
  color: string;
}

interface ResultsData {
  companyName?: string;
  period?: string;
  totalRevenue: number;
  totalCOGS: number;
  grossProfit: number;
  totalOpex: number;
  totalFood?: number;
  ebitda: number;
  totalPersonal: number;
  netIncome: number;
  sections: Section[];
  kpis: KPI[];
  redFlags?: string[];
  thirdPartyPayments?: ThirdPartyPayment[];
  thirdPartyBuckets?: ThirdPartyBuckets;
  bankSummary?: BankSummary;
  reconciliation?: ReconciliationResult;
  balanceLabels?: { beginning: string; ending: string };
}

const normalizeThirdParty = (items: any[] = [], isEnglish = true): ThirdPartyPayment[] =>
  (Array.isArray(items) ? items : []).map((p) => ({
    method: String(p?.method || ""),
    direction: p?.direction === "incoming" ? "incoming" : "outgoing",
    identifier: String(p?.identifier || ""),
    payee: p?.payee ? String(p.payee) : "",
    date: p?.date ? String(p.date) : "",
    amt: toNumber(p?.amt ?? p?.amount),
    category: p?.category ? translateCategory(String(p.category), isEnglish) : "",
    classification: pickText(p, "classification", isEnglish),
    alert: pickText(p, "alert", isEnglish),
  }));

const buildThirdPartyBuckets = (thirdParty: ThirdPartyPayment[], personalTransfers: LineItem[]): ThirdPartyBuckets => ({
  checks: thirdParty.filter((p) => p.method === "Check"),
  zelleOutgoing: thirdParty.filter((p) => p.method === "Zelle" && p.direction === "outgoing"),
  zelleIncoming: thirdParty.filter((p) => p.method === "Zelle" && p.direction === "incoming"),
  personalTransfers,
});

const AnimatedNumber = ({ value, prefix = "$", delay = 0 }: { value: number; prefix?: string; delay?: number }) => {
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const duration = 1200;
      const start = Date.now();
      const animate = () => {
        const elapsed = Date.now() - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setDisplay(Math.floor(value * eased));
        if (progress < 1) requestAnimationFrame(animate);
        else setDisplay(value);
      };
      animate();
    }, delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return (
    <span ref={ref}>
      {prefix}{display.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
};

const CollapsibleSection = ({
  section, index, onReassign, receiptLabel,
}: { section: Section; index: number; onReassign?: (item: LineItem) => void; receiptLabel: string }) => {
  const [open, setOpen] = useState(false);
  const Icon = section.icon;

  return (
    <div
      className={`opacity-0 animate-slide-up rounded-xl overflow-hidden border border-border/50 hover-lift`}
      style={{ animationDelay: `${0.15 * index}s` }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 sm:p-5 bg-card hover:bg-muted/50 transition-colors group"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${section.color}20`, border: `1px solid ${section.color}40` }}>
            <Icon className="h-5 w-5" style={{ color: section.color }} />
          </div>
          <div className="text-left">
            <h3 className="font-semibold text-foreground text-sm sm:text-base">{section.title}</h3>
            <p className="text-xs text-muted-foreground">{section.items.length} items</p>
            {section.note && (
              <p className="mt-1 flex items-start gap-1 text-xs text-sky-600 dark:text-sky-400">
                <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
                <span>{section.note}</span>
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="font-bold text-foreground">${section.total.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
            <p className="text-xs text-muted-foreground">{section.totalLabel}</p>
          </div>
          <div className="text-muted-foreground group-hover:text-primary transition-colors">
            {open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-border/50 bg-background/50 animate-fade-in">
          <div className="divide-y divide-border/30">
            {section.items.map((item, i) => (
              <div key={i} className="flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors group/item">
                <div className="flex-1 min-w-0 pr-4">
                  <p className="text-sm text-foreground truncate">{item.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {item.category && (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80 bg-muted px-1.5 py-0.5 rounded shrink-0">
                        {item.category}
                      </span>
                    )}
                    {item.detail && <p className="text-xs text-muted-foreground truncate">{item.detail}</p>}
                  </div>
                  {item.receipt && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openReceiptFile(item.receipt!.storage_path); }}
                      className="mt-1 inline-flex max-w-full items-center gap-1 rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/20"
                    >
                      <Receipt className="h-3 w-3 shrink-0" />
                      <span className="truncate">{receiptLabel}{item.receipt.note ? ` · ${item.receipt.note}` : ""}</span>
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="text-xs text-muted-foreground w-12 text-right">{item.percentage.toFixed(1)}%</span>
                  <span className="text-sm font-semibold text-foreground w-24 text-right">
                    ${item.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </span>
                  {onReassign && item.sourceList !== undefined && item.sourceIndex !== undefined && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onReassign(item); }}
                      className="text-muted-foreground hover:text-primary transition-colors opacity-0 group-hover/item:opacity-100 shrink-0"
                      title="Reassign"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between px-5 py-3 bg-muted/40 font-semibold text-sm">
            <span className="text-primary">{section.totalLabel}</span>
            <span className="text-primary">${section.total.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const iconMap: Record<string, React.ElementType> = {
  revenue: DollarSign, ingresos: DollarSign,
  cogs: Building2, costo: Building2, cost: Building2,
  opex: CreditCard, operativo: CreditCard, operating: CreditCard,
  personal: ShoppingBag, "no deducible": ShoppingBag, "non-deductible": ShoppingBag,
  food: UtensilsCrossed, alimentación: UtensilsCrossed,
  transport: Car, transporte: Car, fuel: Car,
  default: Receipt,
};

const getIconForSection = (title: string): React.ElementType => {
  const lower = title.toLowerCase();
  for (const [key, icon] of Object.entries(iconMap)) {
    if (lower.includes(key)) return icon;
  }
  return Receipt;
};

const sectionColors = [
  "hsl(96, 100%, 50%)",
  "hsl(38, 90%, 55%)",
  "hsl(210, 60%, 50%)",
  "hsl(0, 70%, 55%)",
  "hsl(280, 60%, 55%)",
  "hsl(180, 60%, 45%)",
];

const reassignListLabel = (list: TransactionList) => {
  switch (list) {
    case "revenues": return STR.revenue;
    case "cogs": return STR.cogsFull;
    case "opex": return STR.operatingExpenses;
    case "fees": return STR.feesFallback;
    case "personal": return STR.otherExpensesDeductions;
  }
};

const toNumber = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const normalized = value.trim().replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const toPercent = (value: number, total: number) => (total > 0 ? (value / total) * 100 : 0);

const sumAnalysisItems = (items: any[] = []) =>
  items.reduce((sum, item) => sum + toNumber(item?.amt ?? item?.amount), 0);

/** Tags each item with which raw array (and original index within it) it came from, so a later
 * "reassign" edit knows exactly where to remove/re-insert it — filtering/splitting an array
 * afterwards (e.g. pulling Food items out of opex) preserves these tags on each object. */
const tagList = (items: any[] = [], list: TransactionList) =>
  items.map((item, idx) => ({ ...item, __list: list, __idx: idx }));

const normalizeAnalysisItems = (items: any[] = [], totalRevenue: number, isEnglish = true): LineItem[] =>
  items.map((item) => {
    const amount = toNumber(item?.amt ?? item?.amount);
    const detailParts = [item?.date, pickText(item, "detail", isEnglish)].filter(Boolean);

    return {
      name: item?.desc || item?.name || "Unknown",
      amount,
      percentage: toPercent(amount, totalRevenue),
      detail: detailParts.length > 0 ? detailParts.join(" • ") : undefined,
      category: item?.category ? translateCategory(String(item.category), isEnglish) : undefined,
      sourceList: item?.__list,
      sourceIndex: typeof item?.__idx === "number" ? item.__idx : undefined,
      txnKey: txnKey(item?.date, item?.desc || item?.name, amount),
    };
  });

const formatCurrencyText = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatPercentText = (value: number, total: number) => `${toPercent(value, total).toFixed(1)}%`;

const transformAPIResponse = (raw: any, isEnglish: boolean): ResultsData => {
  const source = raw?.analysis ?? raw;

  // Defensive cleanup applied at render time too (not just at analyze-time in Dashboard.tsx) so
  // statements already stored with the bug — a transaction double-classified into two categories,
  // or a category like "Fuel (work)" landing in a different section from one month to the next —
  // self-correct the moment they're viewed again, with no need to re-upload or re-analyze them.
  if (Array.isArray(source?.revenues) || Array.isArray(source?.cogs) || Array.isArray(source?.opex) || Array.isArray(source?.fees) || Array.isArray(source?.personal)) {
    const { notesEn, notesEs } = normalizeAnalysisTransactions(source);
    if (notesEn.length > 0) {
      const legacyAlerts = Array.isArray(source.alerts) ? source.alerts : [];
      source.alerts_en = [...(Array.isArray(source.alerts_en) ? source.alerts_en : legacyAlerts), ...notesEn];
      source.alerts_es = [...(Array.isArray(source.alerts_es) ? source.alerts_es : legacyAlerts), ...notesEs];
    }
  }

  if (source?.sections && Array.isArray(source.sections)) {
    const sections = source.sections.map((s: any, i: number) => ({
      ...s,
      icon: typeof s.icon === "string" ? getIconForSection(s.title || s.icon) : (s.icon || Receipt),
      color: s.color || sectionColors[i % sectionColors.length],
      items: (s.items || []).map((item: any) => ({
        name: item.name || "Unknown",
        amount: toNumber(item.amount),
        percentage: toNumber(item.percentage),
        detail: item.detail || "",
      })),
      total: toNumber(s.total),
      totalLabel: s.totalLabel || s.title || "Total",
    }));

    return {
      companyName: source.companyName || source.company_name || source.company || "",
      period: pickText(source, "period", isEnglish),
      totalRevenue: toNumber(source.totalRevenue ?? source.total_revenue),
      totalCOGS: toNumber(source.totalCOGS ?? source.total_cogs),
      grossProfit: toNumber(source.grossProfit ?? source.gross_profit),
      totalOpex: toNumber(source.totalOpex ?? source.total_opex),
      ebitda: toNumber(source.ebitda),
      totalPersonal: toNumber(source.totalPersonal ?? source.total_personal),
      netIncome: toNumber(source.netIncome ?? source.net_income),
      sections,
      kpis: (source.kpis || []).map((kpi: any, i: number) => ({
        label: kpi.label || "KPI",
        value: kpi.value || "-",
        description: kpi.description || "",
        color: kpi.color || sectionColors[i % sectionColors.length],
      })),
      redFlags: source.redFlags || source.red_flags || source.alerts || [],
    };
  }

  if (
    Array.isArray(source?.revenues) ||
    Array.isArray(source?.cogs) ||
    Array.isArray(source?.opex) ||
    Array.isArray(source?.fees) ||
    Array.isArray(source?.personal)
  ) {
    const revenues = tagList(Array.isArray(source?.revenues) ? source.revenues : [], "revenues");
    const cogs = tagList(Array.isArray(source?.cogs) ? source.cogs : [], "cogs");
    const rawOpex = tagList(Array.isArray(source?.opex) ? source.opex : [], "opex");
    const fees = tagList(Array.isArray(source?.fees) ? source.fees : [], "fees");
    const personal = tagList(Array.isArray(source?.personal) ? source.personal : [], "personal");

    const foodItems = rawOpex.filter((item: any) => item?.category === FOOD_OPEX_CATEGORY);
    const opexWithoutFood = rawOpex.filter((item: any) => item?.category !== FOOD_OPEX_CATEGORY);
    const operatingExpenses = [...opexWithoutFood, ...fees];

    const totalRevenue = sumAnalysisItems(revenues);
    const totalCOGS = sumAnalysisItems(cogs);
    const totalOpex = sumAnalysisItems(operatingExpenses);
    const totalFood = sumAnalysisItems(foodItems);
    const totalPersonal = sumAnalysisItems(personal);
    const grossProfit = totalRevenue - totalCOGS;
    const ebitda = grossProfit - totalOpex - totalFood;
    const netIncome = ebitda - totalPersonal;

    const insights = pickArray(source, "insights", isEnglish);
    const alertsArr = pickArray(source, "alerts", isEnglish);

    const thirdPartyPayments = normalizeThirdParty(source?.thirdPartyPayments, isEnglish);
    const personalTransfers = normalizeAnalysisItems(
      personal.filter((item: any) => item?.category === PERSONAL_TRANSFER_CATEGORY),
      totalRevenue,
      isEnglish
    );
    const bankSummary = normalizeBankSummary(source?.bankSummary);
    const reconciliation = reconcileStatement(source, isEnglish);
    const thirdPartyBuckets = buildThirdPartyBuckets(thirdPartyPayments, personalTransfers);

    // Checks/Zelle/transfers already get their own itemized breakdown in the Third Party Payments
    // section below — pull them out of the Personal item list so the same transaction isn't listed
    // twice. totalPersonal (and therefore Net Income) is untouched: we roll the moved amount back in
    // as a single reference line so the section's own subtotal still adds up.
    const personalDisplayItems = personal.filter(
      (item: any) => !(PERSONAL_THIRD_PARTY_CATEGORIES as readonly string[]).includes(item?.category)
    );
    const movedPersonalTotal = sumAnalysisItems(personal) - sumAnalysisItems(personalDisplayItems);
    const personalSectionItems = normalizeAnalysisItems(personalDisplayItems, totalRevenue, isEnglish);
    if (movedPersonalTotal > 0) {
      personalSectionItems.push({
        name: tr(STR.movedPersonalName, isEnglish),
        amount: movedPersonalTotal,
        percentage: toPercent(movedPersonalTotal, totalRevenue),
        detail: tr(STR.movedPersonalDetail, isEnglish),
      });
    }

    const thirdPartyLineItems: LineItem[] = [
      ...thirdPartyBuckets.checks.map((p) => ({
        name: `${tr(STR.checkPrefix, isEnglish)}${p.identifier || "?"} — ${p.payee || tr(STR.payeeNotShown, isEnglish)}`,
        amount: p.amt,
        percentage: toPercent(p.amt, totalRevenue),
        detail: [p.date, p.classification].filter(Boolean).join(" • "),
        category: translateCategory(p.category, isEnglish),
      })),
      ...[...thirdPartyBuckets.zelleOutgoing, ...thirdPartyBuckets.zelleIncoming].map((p) => ({
        name: `Zelle ${p.direction === "incoming" ? tr(STR.zelleFrom, isEnglish) : tr(STR.zelleTo, isEnglish)} ${p.identifier || "Unknown"}`,
        amount: p.amt,
        percentage: toPercent(p.amt, totalRevenue),
        detail: [p.date, p.classification, p.alert].filter(Boolean).join(" • "),
        category: translateCategory(p.category, isEnglish),
      })),
      ...thirdPartyBuckets.personalTransfers,
    ];
    const totalThirdParty = thirdPartyLineItems.reduce((sum, item) => sum + item.amount, 0);

    const allSections: Section[] = [
      {
        title: tr(STR.revenue, isEnglish),
        kind: "revenue",
        icon: DollarSign,
        items: normalizeAnalysisItems(revenues, totalRevenue, isEnglish),
        total: totalRevenue,
        totalLabel: tr(STR.totalRevenue, isEnglish),
        color: sectionColors[0],
      },
      {
        title: "COGS",
        kind: "cogs",
        icon: Building2,
        items: normalizeAnalysisItems(cogs, totalRevenue, isEnglish),
        total: totalCOGS,
        totalLabel: tr(STR.totalCOGS, isEnglish),
        color: sectionColors[1],
      },
      {
        title: tr(STR.operatingExpensesFees, isEnglish),
        kind: "opex",
        icon: CreditCard,
        items: normalizeAnalysisItems(operatingExpenses, totalRevenue, isEnglish),
        total: totalOpex,
        totalLabel: tr(STR.totalOpex, isEnglish),
        color: sectionColors[2],
      },
      {
        title: tr(STR.foodFull, isEnglish),
        kind: "food",
        icon: UtensilsCrossed,
        items: normalizeAnalysisItems(foodItems, totalRevenue, isEnglish),
        total: totalFood,
        totalLabel: tr(STR.totalFood, isEnglish),
        color: sectionColors[4],
      },
      {
        title: tr(STR.otherExpensesDeductions, isEnglish),
        kind: "personal",
        icon: ShoppingBag,
        items: personalSectionItems,
        total: totalPersonal,
        totalLabel: tr(STR.totalPersonal, isEnglish),
        color: sectionColors[3],
      },
      {
        title: tr(STR.thirdPartyPayments, isEnglish),
        kind: "thirdParty",
        note: tr(STR.thirdPartyPageNote, isEnglish),
        icon: Users,
        items: thirdPartyLineItems,
        total: totalThirdParty,
        totalLabel: tr(STR.totalThirdParty, isEnglish),
        color: sectionColors[5],
      },
    ];
    const sections = allSections.filter((section) => section.items.length > 0 || section.total !== 0);

    return {
      companyName: source.company || source.companyName || source.company_name || "",
      period: pickText(source, "period", isEnglish),
      totalRevenue,
      totalCOGS,
      grossProfit,
      totalOpex,
      totalFood,
      ebitda,
      totalPersonal,
      netIncome,
      sections,
      kpis: [
        {
          label: tr(STR.revenue, isEnglish),
          value: formatCurrencyText(totalRevenue),
          description: insights[0] || tr(STR.revenueKpiDesc, isEnglish),
          color: sectionColors[0],
        },
        {
          label: tr(STR.grossMargin, isEnglish),
          value: formatPercentText(grossProfit, totalRevenue),
          description: insights[1] || tr(STR.grossMarginDesc, isEnglish),
          color: sectionColors[1],
        },
        {
          label: tr(STR.ebitdaMargin, isEnglish),
          value: formatPercentText(ebitda, totalRevenue),
          description: insights[2] || tr(STR.ebitdaMarginDesc, isEnglish),
          color: sectionColors[2],
        },
        {
          label: tr(STR.netMargin, isEnglish),
          value: formatPercentText(netIncome, totalRevenue),
          description: insights[3] || tr(STR.netMarginDesc, isEnglish),
          color: sectionColors[3],
        },
      ],
      redFlags: [...reconciliation.discrepancies, ...(alertsArr.length ? alertsArr : (source.redFlags || source.red_flags || []))],
      thirdPartyPayments,
      thirdPartyBuckets,
      bankSummary,
      reconciliation,
    };
  }

  const totalSpent = toNumber(source?.total_spent);
  const categories = Array.isArray(source?.expenses_by_category) ? source.expenses_by_category : [];
  const items = categories.map((cat: any) => ({
    name: cat.category || cat.name || "Unknown",
    amount: toNumber(cat.amount),
    percentage: totalSpent > 0 ? (toNumber(cat.amount) / totalSpent) * 100 : 0,
    detail: cat.detail || "",
  }));

  return {
    companyName: source?.company_name || source?.companyName || source?.company || "",
    period: pickText(source, "period", isEnglish),
    totalRevenue: totalSpent,
    totalCOGS: 0,
    grossProfit: totalSpent,
    totalOpex: totalSpent,
    ebitda: 0,
    totalPersonal: 0,
    netIncome: 0,
    sections: [{
      title: tr({ en: "Expense Breakdown", es: "Desglose de Gastos" }, isEnglish),
      icon: Receipt,
      color: sectionColors[0],
      total: totalSpent,
      totalLabel: tr(STR.total, isEnglish),
      items,
    }],
    kpis: [],
    redFlags: source?.red_flags || source?.redFlags || source?.alerts || [],
  };
};

const results0Bank = (source: any, key: "beginningBalance" | "endingBalance"): number | null => {
  const bank = normalizeBankSummary(source?.bankSummary);
  return bank.found ? bank[key] : null;
};

/** Picker value for statements that belong to no client. */
const NO_CLIENT = "__none__";

interface StatementOption {
  id: string;
  client_id: string | null;
  period: string | null;
  created_at: string;
  original_filename: string | null;
  clients: { name: string } | null;
}

const Results = () => {
  const { t, lang } = useLanguage();
  const isEnglish = lang === "en";
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  const navState = (location.state as any) || {};
  // A report another page already built (History's multi-statement selection) is shown as it came.
  const [handedReport, setHandedReport] = useState<any>(
    !navState.analysisId && !navState.period && navState.results ? navState.results : null
  );
  // Otherwise the page shows one client over a date range: every statement of that client inside the
  // range, read from the database (never from a copy handed over by the previous page, which can be
  // stale). `statements` (light, newest first) feeds the client list and the initial choice.
  const [statements, setStatements] = useState<StatementOption[] | null>(null);
  const [clientKey, setClientKey] = useState<string | null>(navState.clientKey ?? null);
  const [selection, setSelection] = useState<PeriodSelection | null>(deserializeSelection(navState.period));
  const [pendingAnalysisId, setPendingAnalysisId] = useState<string | null>(navState.analysisId ?? null);
  const [clientRows, setClientRows] = useState<StatementRow[] | null>(null);
  const [reassignItem, setReassignItem] = useState<LineItem | null>(null);
  const [reassignTarget, setReassignTarget] = useState<string>("");
  const [savingReassign, setSavingReassign] = useState(false);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);

  // A new visit to /results (from a statement, a client, the menu, or a reload) starts from what it was
  // asked to show; the chosen client and dates live in the history state so a reload keeps them.
  useEffect(() => {
    const st = (location.state as any) || {};
    setHandedReport(!st.analysisId && !st.period && st.results ? st.results : null);
    setClientKey(st.clientKey ?? null);
    setSelection(deserializeSelection(st.period));
    setPendingAnalysisId(st.analysisId ?? null);
  }, [location.key]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("analyses")
      .select("id, client_id, period, created_at, original_filename, clients(name)")
      .order("created_at", { ascending: false })
      .then(({ data }) => setStatements((data as unknown as StatementOption[]) || []));
  }, [user]);

  const lightRow = (st: StatementOption): StatementRow => ({
    id: st.id, user_id: "", client_id: st.client_id, period: st.period || "",
    original_filename: st.original_filename || "", created_at: st.created_at, full_analysis: {},
  });

  const showPeriod = (key: string, sel: PeriodSelection) => {
    setClientKey(key);
    setSelection(sel);
    setPendingAnalysisId(null);
    navigate("/results", { replace: true, state: { clientKey: key, period: serializeSelection(sel) } });
  };

  // Nothing chosen yet: the statement another page handed over, else the newest one (of the chosen
  // client, if any), decides the client and the dates — that statement's own month.
  useEffect(() => {
    if (handedReport || !statements || statements.length === 0 || (clientKey && selection)) return;
    const pool = clientKey ? statements.filter((st) => (st.client_id ?? NO_CLIENT) === clientKey) : statements;
    const target = (pendingAnalysisId && statements.find((st) => st.id === pendingAnalysisId)) || pool[0] || statements[0];
    showPeriod(target.client_id ?? NO_CLIENT, selectionForRange(statementRange(lightRow(target))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statements, handedReport, clientKey, selection, pendingAnalysisId]);

  useEffect(() => {
    if (!clientKey || handedReport) return;
    let cancelled = false;
    setClientRows(null);
    let query = supabase.from("analyses").select("id, user_id, client_id, period, original_filename, created_at, full_analysis");
    query = clientKey === NO_CLIENT ? query.is("client_id", null) : query.eq("client_id", clientKey);
    query.then(({ data, error }) => {
      if (cancelled) return;
      if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
      setClientRows((data as StatementRow[]) || []);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientKey, handedReport]);

  // What is on screen: the transactions of every statement inside the dates, as one analysis.
  const view = useMemo(() => {
    if (handedReport) return { raw: handedReport, analysisId: undefined as string | undefined, count: 0 };
    if (!clientRows || !selection) return null;
    const filtered = clientRows
      .map((row) => filterStatement(row, selectionToInterval(selection)))
      .filter((f): f is FilteredStatement => !!f);
    if (filtered.length === 0) return { raw: null, analysisId: undefined, count: 0 };
    const n = filtered.length;
    const label = { en: selectionLabel(selection, true), es: selectionLabel(selection, false) };
    return {
      raw: mergeStatements(filtered, n > 1 ? { en: `${label.en} · ${n} statements`, es: `${label.es} · ${n} extractos` } : label),
      analysisId: n === 1 ? filtered[0].row.id : undefined,
      count: n,
    };
  }, [handedReport, clientRows, selection]);
  const rawResults = view?.raw ?? null;
  const analysisId = view?.analysisId;
  const clientId = clientKey && clientKey !== NO_CLIENT ? clientKey : null;

  // Months and days that have transactions, marked in the date picker.
  const pickerData = useMemo(() => {
    const months = new Set<string>();
    const days: Date[] = [];
    for (const row of clientRows || []) {
      const f = filterStatement(row, null);
      if (!f) continue;
      for (const txn of f.txns) {
        months.add(monthKey(txn.date));
        days.push(txn.date);
      }
    }
    return { months: [...months], days };
  }, [clientRows]);

  const clientOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const st of statements || []) names.set(st.client_id ?? NO_CLIENT, st.clients?.name || tr(STR.noClientLabel, isEnglish));
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [statements, isEnglish]);

  // Switching client keeps the dates when that client has statements in them, else shows its newest.
  const changeClient = (key: string) => {
    const own = (statements || []).filter((st) => (st.client_id ?? NO_CLIENT) === key);
    const interval = selection ? selectionToInterval(selection) : null;
    const fits = selection && own.some((st) => {
      const range = statementRange(lightRow(st));
      return !interval || (range.from <= interval.to && range.to >= interval.from);
    });
    if (fits && selection) showPeriod(key, selection);
    else if (own[0]) showPeriod(key, selectionForRange(statementRange(lightRow(own[0]))));
  };

  // Receipts linked to this statement's transactions, shown next to each one (and in the exports).
  useEffect(() => {
    if (!analysisId) return;
    supabase
      .from("receipts")
      .select("*")
      .eq("analysis_id", analysisId)
      .then(({ data }) => setReceipts((data as ReceiptRow[]) || []));
  }, [analysisId]);

  if (!user) {
    navigate("/");
    return null;
  }

  const pickerBar = !handedReport && statements && statements.length > 0 && clientKey && selection ? (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground shrink-0">{tr(STR.showPnlOf, isEnglish)}</span>
      <Select value={clientKey} onValueChange={changeClient}>
        <SelectTrigger className="h-9 w-48 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {clientOptions.map(([key, name]) => (
            <SelectItem key={key} value={key}>{name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <PeriodPicker
        value={selection}
        onChange={(sel) => showPeriod(clientKey, sel)}
        monthsWithData={pickerData.months}
        daysWithData={pickerData.days}
        isEnglish={isEnglish}
      />
    </div>
  ) : null;

  if (!handedReport && (statements === null || (statements.length > 0 && (!clientKey || !selection || clientRows === null)))) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-muted-foreground gap-2 text-sm">
        <Loader2 className="h-5 w-5 animate-spin" />
        {tr(STR.loadingStatement, isEnglish)}
      </div>
    );
  }

  if (!rawResults && pickerBar) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto w-full">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{tr(STR.profitLoss, isEnglish)}</h1>
          {pickerBar}
          <Card className="neon-border bg-card mt-6">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              {tr(STR.noStatementsInRange, isEnglish)}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!rawResults) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="flex-1 flex items-center justify-center p-8">
          <Card className="neon-border bg-card max-w-md w-full">
            <CardContent className="p-8 text-center">
              <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
              <h2 className="text-xl font-bold text-foreground mb-2">{tr(STR.noDataTitle, isEnglish)}</h2>
              <p className="text-muted-foreground text-sm mb-6">
                {tr(STR.noDataDesc, isEnglish)}
              </p>
              <Button onClick={() => navigate("/analyze")} className="neon-glow">
                <Sparkles className="h-4 w-4 mr-2" />
                {tr(STR.analyzeNav, isEnglish)}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Account details as read from the statement header (new analyses), falling back to the bank's
  // printed summary box for the balances (older ones).
  const acctSource = rawResults?.analysis ?? rawResults;
  const acctRaw = acctSource?.accountInfo ?? {};
  const validBalance = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > -999999990 ? n : null);
  const account = (() => {
    const beginning = validBalance(acctRaw.beginningBalance) ?? results0Bank(acctSource, "beginningBalance");
    const ending = validBalance(acctRaw.endingBalance) ?? results0Bank(acctSource, "endingBalance");
    const info = {
      bankName: String(acctRaw.bankName || ""),
      accountHolder: String(acctRaw.accountHolder || acctSource?.company || ""),
      accountType: String(acctRaw.accountType || ""),
      last4: String(acctRaw.accountNumberLast4 || ""),
      periodStart: String(acctRaw.periodStart || ""),
      periodEnd: String(acctRaw.periodEnd || ""),
    };
    return {
      ...info, beginning, ending,
      hasAnyMissing: beginning === null || ending === null || !info.bankName || !info.last4,
    };
  })();
  // Dates that cut a statement in half have no printed balance for the days they start or end on.
  const partialRange = !!acctSource?.balancesPartial;
  const dates = partialRange ? { beginning: null, ending: null } : balanceDates(rawResults);
  const beginningLabel = balanceLabel(tr(STR.beginningBalance, isEnglish), dates.beginning, isEnglish);
  const endingLabel = balanceLabel(tr(STR.endingBalance, isEnglish), dates.ending, isEnglish);
  const missingBalanceText = tr(partialRange ? STR.balanceNeedsWholeMonths : STR.notReadFromStatement, isEnglish);
  const fmtBalance = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

  const receiptByKey = new Map(receipts.map((r) => [receiptTxnKey(r), r]));
  const receiptWord = tr(STR.receiptWord, isEnglish);
  const baseResults: ResultsData = transformAPIResponse(rawResults, isEnglish);
  const results: ResultsData = receipts.length === 0 ? baseResults : {
    ...baseResults,
    sections: baseResults.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => {
        const receipt = item.txnKey ? receiptByKey.get(item.txnKey) : undefined;
        return receipt ? { ...item, receipt } : item;
      }),
    })),
  };
  // PDF / Excel have no chip to click: the backing receipt goes into the line's detail instead.
  const exportResults: ResultsData = receipts.length === 0 ? { ...results, balanceLabels: { beginning: beginningLabel, ending: endingLabel } } : {
    ...results,
    balanceLabels: { beginning: beginningLabel, ending: endingLabel },
    sections: results.sections.map((section) => ({
      ...section,
      items: section.items.map((item) =>
        item.receipt
          ? { ...item, detail: [item.detail, `${receiptWord}: ${item.receipt.note || item.receipt.merchant || "✓"}`].filter(Boolean).join(" • ") }
          : item
      ),
    })),
  };

  const openReassign = (item: LineItem) => {
    setReassignItem(item);
    setReassignTarget("");
  };

  const handleConfirmReassign = async () => {
    if (!reassignItem || !reassignTarget || reassignItem.sourceList === undefined || reassignItem.sourceIndex === undefined) return;
    const separatorIndex = reassignTarget.indexOf("::");
    const targetList = reassignTarget.slice(0, separatorIndex) as TransactionList;
    const targetCategory = reassignTarget.slice(separatorIndex + 2);
    if (!targetList || !targetCategory) return;

    setSavingReassign(true);
    try {
      // The transaction is saved in the statement it belongs to (the view may combine several).
      const viewSource = rawResults?.analysis ?? rawResults;
      const rawItem = viewSource?.[reassignItem.sourceList]?.[reassignItem.sourceIndex];
      const rowId: string | undefined = rawItem?._analysisId ?? analysisId;
      const row = clientRows?.find((r) => r.id === rowId);
      if (!rawItem || !row) throw new Error(tr(STR.reassignError, isEnglish));
      const { full, totals } = moveTransaction(
        row.full_analysis,
        {
          list: reassignItem.sourceList,
          rawDate: String(rawItem.date ?? ""),
          desc: String(rawItem.desc || rawItem.name || ""),
          amount: toNumber(rawItem.amt ?? rawItem.amount),
        },
        targetList,
        targetCategory
      );
      const { data: updated, error } = await supabase
        .from("analyses")
        .update({ full_analysis: full, ...totals })
        .eq("id", row.id)
        .select("id");
      if (error) throw error;
      // No row changed means the database refused it (no permission): never report it as saved.
      if (!updated || updated.length === 0) throw new Error(tr(STR.reassignNotSaved, isEnglish));
      setClientRows((prev) => (prev || []).map((r) => (r.id === row.id ? { ...r, full_analysis: full } : r)));
      setReassignItem(null);
      toast({ title: "✅", description: tr(STR.reassignSuccess, isEnglish) });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : tr(STR.reassignError, isEnglish),
        variant: "destructive",
      });
    } finally {
      setSavingReassign(false);
    }
  };

  const handleDownloadExcel = async () => {
    const { blob, fileName } = await generateProfessionalExcel(exportResults, isEnglish);
    saveReportToStorage({ blob, fileName, type: "excel", clientId, analysisId, periodLabel: results.period || "" });
  };

  const handleDownloadPDF = () => {
    const { blob, fileName } = generateProfessionalPDF(exportResults, isEnglish);
    saveReportToStorage({ blob, fileName, type: "pdf", clientId, analysisId, periodLabel: results.period || "" });
  };

  const summaryCards = [
    { label: tr(STR.totalIncome, isEnglish), value: results.totalRevenue, icon: DollarSign, color: "hsl(var(--primary))", sub: "100%" },
    { label: "COGS", value: results.totalCOGS, icon: Building2, color: "hsl(38, 90%, 55%)", sub: `${((results.totalCOGS / results.totalRevenue) * 100).toFixed(1)}%` },
    { label: tr(STR.grossProfitShort, isEnglish), value: results.grossProfit, icon: TrendingUp, color: "hsl(var(--primary))", sub: `${((results.grossProfit / results.totalRevenue) * 100).toFixed(1)}%` },
    { label: "EBITDA", value: results.ebitda, icon: BarChart3, color: "hsl(210, 60%, 50%)", sub: `${((results.ebitda / results.totalRevenue) * 100).toFixed(1)}%` },
    { label: tr(STR.netIncomeShort, isEnglish), value: results.netIncome, icon: Wallet, color: "hsl(142, 76%, 36%)", sub: `${((results.netIncome / results.totalRevenue) * 100).toFixed(1)}%` },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto w-full">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 opacity-0 animate-fade-in">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
              {tr(STR.profitLoss, isEnglish)}
            </h1>
            {results.companyName && (
              <p className="text-primary text-sm font-medium mt-1 neon-text">{results.companyName}</p>
            )}
            {results.period && (
              <p className="text-muted-foreground text-xs mt-0.5">{results.period}</p>
            )}
            {pickerBar}
            {view && view.count > 1 && (
              <p className="mt-2 text-xs text-muted-foreground">{tr(STR.combinedStatementsHint, isEnglish).replace("{n}", String(view.count))}</p>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => navigate(clientId ? `/clients/${clientId}` : "/clients")}
              className="border-border text-foreground hover:bg-muted hover:text-primary transition-all duration-300">
              <ArrowLeft className="h-4 w-4 mr-1" />
              {t("backToDashboard")}
            </Button>
            <Button onClick={handleDownloadExcel}
              className="neon-glow neon-glow-hover transition-all duration-300">
              <FileSpreadsheet className="h-4 w-4 mr-1" />
              Excel
            </Button>
            <Button onClick={handleDownloadPDF}
              variant="secondary"
              className="transition-all duration-300 hover:shadow-lg">
              <FileText className="h-4 w-4 mr-1" />
              PDF
            </Button>
          </div>
        </div>

        {/* Account details exactly as the bank prints them, plus the opening and closing balance. A value the
            statement didn't show is marked "not read" instead of being hidden or guessed. */}
        <Card className="neon-border bg-card mb-6 opacity-0 animate-fade-in" style={{ animationDelay: "0.25s" }}>
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: tr(STR.bankLabel, isEnglish), value: account.bankName },
                { label: tr(STR.accountHolderLabel, isEnglish), value: account.accountHolder },
                { label: tr(STR.accountLabel, isEnglish), value: [account.accountType, account.last4 ? `•••• ${account.last4}` : ""].filter(Boolean).join(" · ") },
                { label: tr(STR.statementPeriodLabel, isEnglish), value: pickText(acctSource, "period", isEnglish) || results.period || "" },
              ].map((f) => (
                <div key={f.label} className="min-w-0">
                  <p className="text-xs text-muted-foreground">{f.label}</p>
                  <p className={`text-sm font-semibold truncate ${f.value ? "text-foreground" : "text-muted-foreground/60 font-normal"}`} title={f.value}>
                    {f.value || tr(STR.notReadFromStatement, isEnglish)}
                  </p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3 text-center border-t border-border pt-4">
              <div>
                <p className="text-xs text-muted-foreground">{beginningLabel}</p>
                <p className={`text-lg font-bold ${account.beginning === null || partialRange ? "text-muted-foreground/60 text-sm font-normal" : "text-foreground"}`}>
                  {account.beginning === null || partialRange ? missingBalanceText : fmtBalance(account.beginning)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{tr(STR.netIncomeShort, isEnglish)}</p>
                <p className={`text-lg font-bold ${results.netIncome >= 0 ? "text-primary" : "text-destructive"}`}>
                  {results.netIncome >= 0 ? "+" : ""}${results.netIncome.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{endingLabel}</p>
                <p className={`text-lg font-bold ${account.ending === null || partialRange ? "text-muted-foreground/60 text-sm font-normal" : "text-foreground"}`}>
                  {account.ending === null || partialRange ? missingBalanceText : fmtBalance(account.ending)}
                </p>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground text-center">
              {partialRange
                ? tr(STR.balanceNeedsWholeMonthsNote, isEnglish)
                : account.hasAnyMissing ? tr(STR.accountMissingNote, isEnglish) : tr(STR.balanceVsNetIncomeNote, isEnglish)}
            </p>
          </CardContent>
        </Card>

        {results.reconciliation?.bankSummaryFound && (
          <div
            className={`mb-6 flex items-start gap-2 text-sm rounded-lg border px-3 py-2 opacity-0 animate-fade-in ${
              results.reconciliation.ok
                ? "border-primary/30 bg-primary/5 text-primary"
                : "border-destructive/50 bg-destructive/5 text-destructive"
            }`}
            style={{ animationDelay: "0.3s" }}
          >
            {results.reconciliation.ok ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            )}
            <span>
              {results.reconciliation.ok
                ? tr(STR.reconciledBanner, isEnglish)
                : `${results.reconciliation.discrepancies.length} ${tr(STR.discrepancyBanner, isEnglish)}`}
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
          {summaryCards.map((card, i) => (
            <Card key={card.label}
              className={`neon-border bg-card shadow-xl opacity-0 animate-count-up hover-lift cursor-default`}
              style={{ animationDelay: `${0.1 * (i + 1)}s` }}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <card.icon className="h-4 w-4" style={{ color: card.color }} />
                  <span className="text-xs text-muted-foreground font-medium">{card.label}</span>
                </div>
                <p className="text-lg sm:text-xl font-bold text-foreground">
                  <AnimatedNumber value={card.value} delay={200 + i * 100} />
                </p>
                <p className="text-xs mt-1" style={{ color: card.color }}>{card.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="neon-border bg-card shadow-xl mb-8 opacity-0 animate-slide-up" style={{ animationDelay: "0.4s" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-foreground flex items-center gap-2 text-base">
              <PieChart className="h-5 w-5 text-primary" />
              {tr(STR.financialFlow, isEnglish)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { label: tr(STR.revenue, isEnglish), value: results.totalRevenue, pct: 100, color: "hsl(96, 100%, 50%)" },
                { label: "COGS", value: results.totalCOGS, pct: (results.totalCOGS / results.totalRevenue) * 100, color: "hsl(38, 90%, 55%)" },
                { label: tr(STR.grossProfitShort, isEnglish), value: results.grossProfit, pct: (results.grossProfit / results.totalRevenue) * 100, color: "hsl(96, 100%, 50%)" },
                { label: "OpEx", value: results.totalOpex, pct: (results.totalOpex / results.totalRevenue) * 100, color: "hsl(210, 60%, 50%)" },
                { label: "EBITDA", value: results.ebitda, pct: (results.ebitda / results.totalRevenue) * 100, color: "hsl(142, 76%, 36%)" },
                { label: "Personal", value: results.totalPersonal, pct: (results.totalPersonal / results.totalRevenue) * 100, color: "hsl(0, 70%, 55%)" },
                { label: tr(STR.netIncomeShort, isEnglish), value: results.netIncome, pct: (results.netIncome / results.totalRevenue) * 100, color: "hsl(142, 76%, 36%)" },
              ].map((item, i) => (
                <div key={item.label} className="group">
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium text-foreground">{item.label}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground text-xs">{item.pct.toFixed(1)}%</span>
                      <span className="font-semibold w-28 text-right" style={{ color: item.color }}>
                        ${item.value.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                  <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-1000 ease-out progress-bar"
                      style={{
                        backgroundColor: item.color,
                        ["--target-width" as string]: `${item.pct}%`,
                        animationDelay: `${0.5 + i * 0.1}s`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-3 mb-8">
          <h2 className="text-lg font-bold text-foreground mb-4 opacity-0 animate-fade-in" style={{ animationDelay: "0.5s" }}>
            {tr(STR.detailedBreakdown, isEnglish)}
          </h2>
          {results.sections.map((section, i) => (
            <CollapsibleSection key={section.title} section={section} index={i} onReassign={!handedReport && clientRows ? openReassign : undefined} receiptLabel={receiptWord} />
          ))}
        </div>

        <Card className="neon-border bg-card shadow-xl mb-8 opacity-0 animate-slide-up" style={{ animationDelay: "0.7s" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-foreground flex items-center gap-2 text-base">
              <Target className="h-5 w-5 text-primary" />
              {tr(STR.keyIndicatorsHeading, isEnglish)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {results.kpis.map((kpi, i) => (
                <div key={kpi.label}
                  className="text-center p-3 rounded-lg bg-muted/50 border border-border/50 hover-scale cursor-default kpi-highlight opacity-0 animate-scale-in"
                  style={{ animationDelay: `${0.8 + i * 0.08}s` }}
                >
                  <p className="text-2xl font-bold" style={{ color: kpi.color }}>{kpi.value}</p>
                  <p className="text-xs font-medium text-foreground mt-1">{kpi.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{kpi.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {results.redFlags && results.redFlags.length > 0 && (
          <Card className="border-destructive/50 bg-destructive/5 shadow-xl mb-8 opacity-0 animate-slide-up" style={{ animationDelay: "0.9s" }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-destructive flex items-center gap-2 text-base">
                <AlertTriangle className="h-5 w-5" />
                {tr(STR.alertsRedFlags, isEnglish)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {results.redFlags.map((flag, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Zap className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    <span className="text-foreground">{flag}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {Array.isArray((results as any).annualSummary) && (results as any).annualSummary.length > 0 && (
          <Card className="bg-card border-border shadow-xl mb-8 opacity-0 animate-slide-up" style={{ animationDelay: "0.95s" }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                {tr(STR.annualSummaryHeading, isEnglish)} {(results as any).annualYear || ""}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border">
                      <th className="py-2 pr-4 font-medium">{tr(STR.month, isEnglish)}</th>
                      <th className="py-2 pr-4 font-medium text-right">{tr(STR.income, isEnglish)}</th>
                      <th className="py-2 pr-4 font-medium text-right">{tr(STR.expenses, isEnglish)}</th>
                      <th className="py-2 font-medium text-right">{tr(STR.net, isEnglish)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(results as any).annualSummary.map((m: any, i: number) => (
                      <tr key={i} className="border-b border-border/40">
                        <td className="py-2 pr-4">{m.month}</td>
                        <td className="py-2 pr-4 text-right">${Number(m.revenue || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                        <td className="py-2 pr-4 text-right">${Number(m.expenses || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                        <td className={`py-2 text-right ${Number(m.net || 0) >= 0 ? "text-primary" : "text-destructive"}`}>${Number(m.net || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                    {(results as any).annualTotals && (
                      <tr className="font-semibold">
                        <td className="py-2 pr-4">{tr(STR.total, isEnglish)}</td>
                        <td className="py-2 pr-4 text-right">${Number((results as any).annualTotals.revenue || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                        <td className="py-2 pr-4 text-right">${Number((results as any).annualTotals.expenses || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                        <td className={`py-2 text-right ${Number((results as any).annualTotals.net || 0) >= 0 ? "text-primary" : "text-destructive"}`}>${Number((results as any).annualTotals.net || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted-foreground text-center pb-8 opacity-0 animate-fade-in" style={{ animationDelay: "1s" }}>
          {tr(STR.footerDisclaimer, isEnglish)}
        </p>
      </div>

      <Dialog open={!!reassignItem} onOpenChange={(open) => { if (!open) setReassignItem(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr(STR.reassignDialogTitle, isEnglish)}</DialogTitle>
            <DialogDescription>{tr(STR.reassignDialogDesc, isEnglish)}</DialogDescription>
          </DialogHeader>

          {reassignItem && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
                <p className="text-sm font-medium text-foreground truncate">{reassignItem.name}</p>
                <div className="flex items-center justify-between mt-1">
                  {reassignItem.category && (
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {reassignItem.category}
                    </span>
                  )}
                  <span className="text-sm font-semibold text-foreground">
                    ${reassignItem.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">{tr(STR.reassignCategoryLabel, isEnglish)}</label>
                <Select value={reassignTarget} onValueChange={setReassignTarget}>
                  <SelectTrigger>
                    <SelectValue placeholder={tr(STR.reassignCategoryLabel, isEnglish)} />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(REASSIGN_TAXONOMY) as TransactionList[]).map((list) => (
                      <SelectGroup key={list}>
                        <SelectLabel>{tr(reassignListLabel(list), isEnglish)}</SelectLabel>
                        {REASSIGN_TAXONOMY[list].map((category) => (
                          <SelectItem key={`${list}::${category}`} value={`${list}::${category}`}>
                            {translateCategory(category, isEnglish)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setReassignItem(null)} disabled={savingReassign}>
              {tr(STR.reassignCancel, isEnglish)}
            </Button>
            <Button onClick={handleConfirmReassign} disabled={!reassignTarget || savingReassign} className="neon-glow">
              {savingReassign ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {savingReassign ? tr(STR.reassignSaving, isEnglish) : tr(STR.reassignSave, isEnglish)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ChatBot />
    </div>
  );
};

export default Results;
