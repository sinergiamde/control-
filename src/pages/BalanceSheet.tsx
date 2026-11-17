import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, CheckCircle2, Info, Landmark, Loader2, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { STR, tr } from "@/utils/i18n";
import { endOfDay, filterStatement, statementRange, type FilteredStatement, type StatementRow } from "@/utils/statementPeriod";
import { longDate } from "@/utils/balanceDates";

type Bilingual = { en: string; es: string };

/** Lines people type (they are not in a bank statement). Keys are what is stored in balance_sheets.items. */
const ASSET_LINES: { key: string; label: Bilingual }[] = [
  { key: "receivables", label: { en: "Accounts Receivable", es: "Cuentas por cobrar" } },
  { key: "inventory", label: { en: "Inventory", es: "Inventario" } },
  { key: "equipment", label: { en: "Equipment", es: "Equipos" } },
  { key: "buildings", label: { en: "Buildings", es: "Edificios" } },
  { key: "otherAssets", label: { en: "Other assets", es: "Otros activos" } },
];
const LIABILITY_LINES: { key: string; label: Bilingual }[] = [
  { key: "payables", label: { en: "Accounts Payable", es: "Cuentas por pagar" } },
  { key: "loans", label: { en: "Loans", es: "Préstamos" } },
  { key: "creditCards", label: { en: "Credit Cards Payable", es: "Tarjetas de crédito por pagar" } },
  { key: "taxes", label: { en: "Taxes Payable", es: "Impuestos por pagar" } },
  { key: "otherLiabilities", label: { en: "Other liabilities", es: "Otros pasivos" } },
];

const LISTS = ["revenues", "cogs", "opex", "fees", "personal"] as const;
const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const printed = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) && n > -999999990 ? n : null);
const amountOf = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseIso = (s: string | null) => {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};

interface ClientOption {
  id: string;
  name: string;
}

interface CashLine {
  label: string;
  amount: number;
  date: Date;
}

const BalanceSheet = () => {
  const { lang } = useLanguage();
  const isEnglish = lang === "en";
  const L = (b: Bilingual) => (isEnglish ? b.en : b.es);
  const { user, isAdmin, canManageClients } = useAuth();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();

  const [clients, setClients] = useState<ClientOption[] | null>(null);
  const [rows, setRows] = useState<StatementRow[] | null>(null);
  const [savedAsOf, setSavedAsOf] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [savedValues, setSavedValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);

  // The client and date live in the address (?client=…&date=YYYY-MM-DD) so a reload keeps them.
  const clientId = params.get("client");
  const asOf = parseIso(params.get("date"));
  const setChoice = (client: string, date: Date | null) => {
    const next: Record<string, string> = { client };
    if (date) next.date = isoDay(date);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (!user) return;
    supabase
      .from("clients")
      .select("id, name")
      .order("name")
      .then(({ data }) => setClients((data as ClientOption[]) || []));
  }, [user]);

  useEffect(() => {
    if (clients && clients.length > 0 && !clientId) setChoice(clients[0].id, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, clientId]);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setRows(null);
    supabase
      .from("analyses")
      .select("id, user_id, client_id, period, original_filename, created_at, full_analysis")
      .eq("client_id", clientId)
      .then(({ data }) => {
        if (!cancelled) setRows((data as StatementRow[]) || []);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  // Last day of each statement: the dates a balance sheet can be read for exactly (marked in the calendar).
  const statementEnds = useMemo(
    () => (rows || []).map((row) => statementRange(row).to).sort((a, b) => a.getTime() - b.getTime()),
    [rows]
  );

  // No date chosen yet: the end of the client's latest statement (or today if it has none).
  useEffect(() => {
    if (!clientId || rows === null || asOf) return;
    const last = statementEnds[statementEnds.length - 1];
    setChoice(clientId, last ? new Date(last.getFullYear(), last.getMonth(), last.getDate()) : new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, rows, asOf, statementEnds]);

  // The typed values: the ones saved for this date, or else the latest saved before it.
  useEffect(() => {
    if (!clientId || !asOf) return;
    let cancelled = false;
    supabase
      .from("balance_sheets")
      .select("as_of, items")
      .eq("client_id", clientId)
      .lte("as_of", isoDay(asOf))
      .order("as_of", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (cancelled) return;
        const row = data?.[0] as { as_of: string; items: Record<string, unknown> } | undefined;
        const loaded: Record<string, string> = {};
        for (const line of [...ASSET_LINES, ...LIABILITY_LINES]) {
          const v = row?.items?.[line.key];
          loaded[line.key] = v === undefined || v === null || amountOf(v) === 0 ? "" : String(amountOf(v));
        }
        setValues(loaded);
        setSavedValues(row?.as_of === isoDay(asOf) ? loaded : {});
        setSavedAsOf(row?.as_of ?? null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, asOf?.getTime()]);

  // Cash: per bank account, the closing balance of its latest statement that ends on or before the date.
  const cashLines = useMemo<CashLine[]>(() => {
    if (!rows || !asOf) return [];
    const byAccount = new Map<string, CashLine>();
    for (const row of rows) {
      const src = row.full_analysis?.analysis ?? row.full_analysis;
      const range = statementRange(row);
      if (range.to > endOfDay(asOf)) continue;
      const balance = printed(src?.accountInfo?.endingBalance) ?? (src?.bankSummary?.found ? printed(src.bankSummary.endingBalance) : null);
      if (balance === null) continue;
      const info = src?.accountInfo || {};
      const key = `${info.bankName || ""}|${info.accountNumberLast4 || ""}`;
      const label = [info.bankName || tr(STR.bsBankAccount, isEnglish), info.accountNumberLast4 ? `•••• ${info.accountNumberLast4}` : ""].filter(Boolean).join(" ");
      const end = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate());
      const prev = byAccount.get(key);
      if (!prev || end > prev.date) byAccount.set(key, { label, amount: balance, date: end });
    }
    return [...byAccount.values()];
  }, [rows, asOf, isEnglish]);

  // Result of the year up to the date (income minus every expense in the statements), part of equity.
  const yearResult = useMemo(() => {
    if (!rows || !asOf) return 0;
    const interval = { from: new Date(asOf.getFullYear(), 0, 1), to: endOfDay(asOf) };
    let total = 0;
    for (const f of rows.map((row) => filterStatement(row, interval)).filter((x): x is FilteredStatement => !!x)) {
      const src = f.data?.analysis ?? f.data;
      for (const list of LISTS) {
        const sum = (Array.isArray(src?.[list]) ? src[list] : []).reduce((s: number, it: any) => s + Math.abs(amountOf(it?.amt ?? it?.amount)), 0);
        total += list === "revenues" ? sum : -sum;
      }
    }
    return Math.round(total * 100) / 100;
  }, [rows, asOf]);

  const cashTotal = cashLines.reduce((s, c) => s + c.amount, 0);
  const typed = (key: string) => amountOf(values[key]);
  const totalAssets = cashTotal + ASSET_LINES.reduce((s, l) => s + typed(l.key), 0);
  const totalLiabilities = LIABILITY_LINES.reduce((s, l) => s + typed(l.key), 0);
  const totalEquity = totalAssets - totalLiabilities;
  const otherEquity = totalEquity - yearResult;
  const debtRatio = totalAssets > 0 ? (totalLiabilities / totalAssets) * 100 : null;

  const canEdit = isAdmin || canManageClients;
  const dirty = [...ASSET_LINES, ...LIABILITY_LINES].some((l) => (values[l.key] || "") !== (savedValues[l.key] || ""));

  const save = async () => {
    if (!clientId || !asOf) return;
    setSaving(true);
    const items: Record<string, number> = {};
    for (const line of [...ASSET_LINES, ...LIABILITY_LINES]) items[line.key] = typed(line.key);
    const { data, error } = await supabase
      .from("balance_sheets")
      .upsert(
        { client_id: clientId, as_of: isoDay(asOf), items, updated_by: user?.id ?? null, updated_at: new Date().toISOString() },
        { onConflict: "client_id,as_of" }
      )
      .select("id");
    setSaving(false);
    if (error || !data?.length) {
      toast({ title: "Error", description: error?.message || tr(STR.bsNotSaved, isEnglish), variant: "destructive" });
      return;
    }
    setSavedValues(values);
    setSavedAsOf(isoDay(asOf));
    toast({ title: "✅", description: tr(STR.bsSaved, isEnglish) });
  };

  if (clients === null || (clientId && (rows === null || !asOf))) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-muted-foreground gap-2 text-sm">
        <Loader2 className="h-5 w-5 animate-spin" />
        {tr(STR.bsLoading, isEnglish)}
      </div>
    );
  }

  if (clients.length === 0 || !clientId || !asOf) {
    return (
      <div className="p-8 max-w-xl mx-auto text-center text-sm text-muted-foreground">{tr(STR.bsNoClients, isEnglish)}</div>
    );
  }

  const lineInput = (key: string) => (
    <Input
      inputMode="decimal"
      value={values[key] ?? ""}
      placeholder="0.00"
      disabled={!canEdit}
      onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value.replace(/[^\d.,-]/g, "").replace(/,/g, "") }))}
      className="h-9 w-36 text-right tabular-nums"
    />
  );

  const row = (label: string, sub: string | null, right: React.ReactNode, key?: string) => (
    <div key={key ?? label} className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm text-foreground">{label}</p>
        {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      </div>
      {right}
    </div>
  );

  const totalRow = (label: string, amount: number) => (
    <div className="flex items-center justify-between border-t border-border pt-3 mt-1 font-semibold">
      <span>{label}</span>
      <span className="tabular-nums">{money(amount)}</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto w-full space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{tr(STR.bsTitle, isEnglish)}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {tr(STR.bsAsOf, isEnglish)} <span className="font-semibold text-foreground">{longDate(asOf, isEnglish)}</span>
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Select value={clientId} onValueChange={(id) => setChoice(id, null)}>
                <SelectTrigger className="h-9 w-56 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="h-9 gap-2">
                    <CalendarDays className="h-4 w-4" />
                    {longDate(asOf, isEnglish)}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={asOf}
                    defaultMonth={asOf}
                    onSelect={(d) => {
                      if (!d) return;
                      setChoice(clientId, d);
                      setDateOpen(false);
                    }}
                    captionLayout="dropdown-buttons"
                    fromYear={new Date().getFullYear() - 10}
                    toYear={new Date().getFullYear() + 1}
                    modifiers={{ statementEnd: statementEnds }}
                    modifiersClassNames={{ statementEnd: "underline decoration-primary decoration-2 underline-offset-4 font-semibold" }}
                  />
                  <p className="px-3 pb-3 text-[11px] text-muted-foreground max-w-[18rem]">{tr(STR.bsCalendarHint, isEnglish)}</p>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <Button onClick={save} disabled={!canEdit || saving || !dirty} className="gap-2 self-start sm:self-auto">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {dirty ? tr(STR.bsSave, isEnglish) : tr(STR.bsSavedShort, isEnglish)}
          </Button>
        </div>

        {savedAsOf && savedAsOf !== isoDay(asOf) && (
          <div className="flex items-start gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs text-sky-700 dark:text-sky-300">
            <Info className="h-4 w-4 shrink-0" />
            <span>
              {tr(STR.bsCarriedFrom, isEnglish).replace("{date}", longDate(parseIso(savedAsOf)!, isEnglish))}
            </span>
          </div>
        )}

        {/* The formula, with this balance's numbers. */}
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-center">
          <div>
            <p className="text-xs text-muted-foreground">{tr(STR.bsAssets, isEnglish)}</p>
            <p className="text-xl font-bold tabular-nums">{money(totalAssets)}</p>
          </div>
          <span className="text-xl text-muted-foreground">=</span>
          <div>
            <p className="text-xs text-muted-foreground">{tr(STR.bsLiabilities, isEnglish)}</p>
            <p className="text-xl font-bold tabular-nums text-destructive">{money(totalLiabilities)}</p>
          </div>
          <span className="text-xl text-muted-foreground">+</span>
          <div>
            <p className="text-xs text-muted-foreground">{tr(STR.bsEquity, isEnglish)}</p>
            <p className={`text-xl font-bold tabular-nums ${totalEquity >= 0 ? "text-primary" : "text-destructive"}`}>{money(totalEquity)}</p>
          </div>
          <CheckCircle2 className="h-5 w-5 text-primary" />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="neon-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{tr(STR.bsAssets, isEnglish)} <span className="text-xs font-normal text-muted-foreground">({tr(STR.bsAssetsHint, isEnglish)})</span></CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border/50">
              {cashLines.length === 0
                ? row(tr(STR.bsCash, isEnglish), tr(STR.bsNoCash, isEnglish), <span className="text-sm text-muted-foreground tabular-nums">{money(0)}</span>)
                : cashLines.map((c) =>
                    row(
                      `${tr(STR.bsCash, isEnglish)} — ${c.label}`,
                      `${tr(STR.bsFromStatement, isEnglish)} ${longDate(c.date, isEnglish)}`,
                      <span className="text-sm font-semibold tabular-nums flex items-center gap-1"><Landmark className="h-3.5 w-3.5 text-muted-foreground" />{money(c.amount)}</span>,
                      c.label
                    )
                  )}
              {ASSET_LINES.map((l) => row(L(l.label), isEnglish ? null : l.label.en, lineInput(l.key), l.key))}
              {totalRow(tr(STR.bsTotalAssets, isEnglish), totalAssets)}
            </CardContent>
          </Card>

          <Card className="neon-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{tr(STR.bsLiabilities, isEnglish)} <span className="text-xs font-normal text-muted-foreground">({tr(STR.bsLiabilitiesHint, isEnglish)})</span></CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border/50">
              {LIABILITY_LINES.map((l) => row(L(l.label), isEnglish ? null : l.label.en, lineInput(l.key), l.key))}
              {totalRow(tr(STR.bsTotalLiabilities, isEnglish), totalLiabilities)}
            </CardContent>
          </Card>

          <Card className="neon-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{tr(STR.bsEquity, isEnglish)} <span className="text-xs font-normal text-muted-foreground">({tr(STR.bsEquityHint, isEnglish)})</span></CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border/50">
              {row(
                tr(STR.bsYearResult, isEnglish).replace("{year}", String(asOf.getFullYear())),
                tr(STR.bsYearResultSub, isEnglish),
                <span className={`text-sm font-semibold tabular-nums ${yearResult >= 0 ? "text-primary" : "text-destructive"}`}>{money(yearResult)}</span>
              )}
              {row(
                tr(STR.bsOtherEquity, isEnglish),
                tr(STR.bsOtherEquitySub, isEnglish),
                <span className="text-sm font-semibold tabular-nums">{money(otherEquity)}</span>
              )}
              {totalRow(tr(STR.bsTotalEquity, isEnglish), totalEquity)}
              {debtRatio !== null && (
                <p className="pt-3 text-xs text-muted-foreground">
                  {tr(STR.bsDebtRatio, isEnglish)}: <span className="font-semibold text-foreground">{debtRatio.toFixed(1)}%</span>
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
          {tr(STR.bsFootnote, isEnglish)}
        </p>
      </div>
    </div>
  );
};

export default BalanceSheet;
