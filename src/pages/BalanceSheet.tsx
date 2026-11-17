import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, CheckCircle2, ChevronRight, Info, Landmark, Loader2, Plus, Save, Trash2 } from "lucide-react";
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

/** Lines people fill in (they are not in a bank statement), each itemized: one row per thing owned or
 * owed, with what it is (who owes, which lender, what kind of equipment…), the amount and, for money
 * owed either way, when it is due. Keys are what is stored in balance_sheets.items. */
interface LineDef {
  key: string;
  label: Bilingual;
  /** What the description of each row must say. */
  what: Bilingual;
  add: Bilingual;
  /** Rows carry a due date. */
  due?: boolean;
}
const ASSET_LINES: LineDef[] = [
  { key: "receivables", label: { en: "Accounts Receivable", es: "Cuentas por cobrar" }, what: { en: "Who owes you? (customer)", es: "¿Quién te debe? (cliente)" }, add: { en: "Add who owes you", es: "Agregar quién te debe" }, due: true },
  { key: "inventory", label: { en: "Inventory", es: "Inventario" }, what: { en: "Type of inventory (e.g. drywall, materials, goods)", es: "Tipo de inventario (ej. drywall, materiales, mercancía)" }, add: { en: "Add inventory", es: "Agregar inventario" } },
  { key: "equipment", label: { en: "Equipment", es: "Equipos" }, what: { en: "Type of equipment (e.g. truck, tools, computer)", es: "Tipo de equipo (ej. camioneta, herramientas, computador)" }, add: { en: "Add equipment", es: "Agregar equipo" } },
  { key: "buildings", label: { en: "Buildings", es: "Edificios" }, what: { en: "Which building? (address or description)", es: "¿Qué edificio? (dirección o descripción)" }, add: { en: "Add building", es: "Agregar edificio" } },
  { key: "otherAssets", label: { en: "Other assets", es: "Otros activos" }, what: { en: "What is the asset?", es: "¿Qué activo es?" }, add: { en: "Add asset", es: "Agregar activo" } },
];
const LIABILITY_LINES: LineDef[] = [
  { key: "payables", label: { en: "Accounts Payable", es: "Cuentas por pagar" }, what: { en: "Who do you owe? (vendor)", es: "¿A quién le debes? (proveedor)" }, add: { en: "Add who you owe", es: "Agregar a quién le debes" }, due: true },
  { key: "loans", label: { en: "Loans", es: "Préstamos" }, what: { en: "Who lent it? (bank or lender)", es: "¿Quién te prestó? (banco o entidad)" }, add: { en: "Add loan", es: "Agregar préstamo" }, due: true },
  { key: "creditCards", label: { en: "Credit Cards Payable", es: "Tarjetas de crédito por pagar" }, what: { en: "Which card? (bank and last 4 digits)", es: "¿Qué tarjeta? (banco y últimos 4 dígitos)" }, add: { en: "Add card", es: "Agregar tarjeta" }, due: true },
  { key: "taxes", label: { en: "Taxes Payable", es: "Impuestos por pagar" }, what: { en: "Which tax? (e.g. IRS, sales tax)", es: "¿Qué impuesto? (ej. IRS, sales tax)" }, add: { en: "Add tax", es: "Agregar impuesto" }, due: true },
  { key: "otherLiabilities", label: { en: "Other liabilities", es: "Otros pasivos" }, what: { en: "What is the debt and who is it owed to?", es: "¿Qué deuda es y a quién se le debe?" }, add: { en: "Add liability", es: "Agregar pasivo" }, due: true },
];
const ALL_LINES = [...ASSET_LINES, ...LIABILITY_LINES];

interface DetailRow {
  id: string;
  label: string;
  amount: string;
  date: string;
}
let rowSeq = 0;
const newRow = (): DetailRow => ({ id: `r${++rowSeq}`, label: "", amount: "", date: "" });

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

/** Saved items -> editable rows. Older saves stored one plain number per line. */
const toRows = (value: unknown): DetailRow[] => {
  if (Array.isArray(value)) {
    return value.map((it: any) => ({
      ...newRow(),
      label: String(it?.label ?? ""),
      amount: amountOf(it?.amount) ? String(amountOf(it.amount)) : "",
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(it?.date ?? "")) ? String(it.date) : "",
    }));
  }
  const n = amountOf(value);
  return n ? [{ ...newRow(), amount: String(n) }] : [];
};

/** Editable rows -> what is saved (empty rows dropped). */
const toItems = (details: Record<string, DetailRow[]>) => {
  const items: Record<string, { label: string; amount: number; date?: string }[]> = {};
  for (const line of ALL_LINES) {
    items[line.key] = (details[line.key] || [])
      .filter((r) => r.label.trim() || amountOf(r.amount) !== 0)
      .map((r) => ({ label: r.label.trim(), amount: amountOf(r.amount), ...(line.due && r.date ? { date: r.date } : {}) }));
  }
  return items;
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
  const [details, setDetails] = useState<Record<string, DetailRow[]>>({});
  // What is saved for this exact date, to tell whether there are unsaved changes.
  const [savedSnapshot, setSavedSnapshot] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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
        const loaded: Record<string, DetailRow[]> = {};
        for (const line of ALL_LINES) loaded[line.key] = toRows(row?.items?.[line.key]);
        setDetails(loaded);
        setSavedSnapshot(row?.as_of === isoDay(asOf) ? JSON.stringify(toItems(loaded)) : "");
        setSavedAsOf(row?.as_of ?? null);
        // Lines that already have detail open, so it is visible at a glance.
        setExpanded(new Set(ALL_LINES.filter((l) => loaded[l.key].length > 0).map((l) => l.key)));
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
  const typed = (key: string) => (details[key] || []).reduce((s, r) => s + amountOf(r.amount), 0);
  const totalAssets = cashTotal + ASSET_LINES.reduce((s, l) => s + typed(l.key), 0);
  const totalLiabilities = LIABILITY_LINES.reduce((s, l) => s + typed(l.key), 0);
  const totalEquity = totalAssets - totalLiabilities;
  const otherEquity = totalEquity - yearResult;
  const debtRatio = totalAssets > 0 ? (totalLiabilities / totalAssets) * 100 : null;

  const canEdit = isAdmin || canManageClients;
  const currentSnapshot = JSON.stringify(toItems(details));
  const hasAnyDetail = ALL_LINES.some((l) => (details[l.key] || []).some((r) => r.label.trim() || amountOf(r.amount) !== 0));
  const dirty = savedSnapshot ? currentSnapshot !== savedSnapshot : hasAnyDetail;

  const save = async () => {
    if (!clientId || !asOf) return;
    setSaving(true);
    const items = toItems(details);
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
    setSavedSnapshot(JSON.stringify(items));
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

  const updateRow = (key: string, id: string, patch: Partial<DetailRow>) =>
    setDetails((d) => ({ ...d, [key]: (d[key] || []).map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const addRow = (key: string) => {
    setDetails((d) => ({ ...d, [key]: [...(d[key] || []), newRow()] }));
    setExpanded((e) => new Set(e).add(key));
  };
  const removeRow = (key: string, id: string) =>
    setDetails((d) => ({ ...d, [key]: (d[key] || []).filter((r) => r.id !== id) }));
  const toggle = (key: string) =>
    setExpanded((e) => {
      const next = new Set(e);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // One line of the balance: click it to see and fill its detail (one row per item).
  const detailLine = (line: LineDef) => {
    const rows = details[line.key] || [];
    const open = expanded.has(line.key);
    const count = rows.filter((r) => r.label.trim() || amountOf(r.amount) !== 0).length;
    return (
      <div key={line.key} className="py-2">
        <button type="button" onClick={() => toggle(line.key)} className="w-full flex items-center justify-between gap-3 text-left">
          <span className="min-w-0 flex items-start gap-1.5">
            <ChevronRight className={`h-4 w-4 mt-0.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
            <span>
              <span className="block text-sm text-foreground">
                {L(line.label)}
                {count > 0 && <span className="ml-1 text-xs text-muted-foreground">({count})</span>}
              </span>
              {!isEnglish && <span className="block text-[11px] text-muted-foreground">{line.label.en}</span>}
            </span>
          </span>
          <span className="text-sm font-semibold tabular-nums">{money(typed(line.key))}</span>
        </button>
        {open && (
          <div className="mt-2 ml-5 space-y-2">
            {rows.length > 0 && (
              <div className="hidden sm:flex gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                <span className="flex-1">{tr(STR.bsDetailWhat, isEnglish)}</span>
                {line.due && <span className="w-36">{tr(STR.bsDetailDue, isEnglish)}</span>}
                <span className="w-28 text-right">{tr(STR.bsDetailAmount, isEnglish)}</span>
                <span className="w-8" />
              </div>
            )}
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                <Input
                  value={r.label}
                  placeholder={L(line.what)}
                  disabled={!canEdit}
                  onChange={(e) => updateRow(line.key, r.id, { label: e.target.value })}
                  className="h-8 flex-1 min-w-[12rem] text-xs"
                />
                {line.due && (
                  <Input
                    type="date"
                    value={r.date}
                    title={tr(STR.bsDetailDue, isEnglish)}
                    disabled={!canEdit}
                    onChange={(e) => updateRow(line.key, r.id, { date: e.target.value })}
                    className="h-8 w-36 text-xs"
                  />
                )}
                <Input
                  inputMode="decimal"
                  value={r.amount}
                  placeholder="0.00"
                  disabled={!canEdit}
                  onChange={(e) => updateRow(line.key, r.id, { amount: e.target.value.replace(/[^\d.-]/g, "") })}
                  className="h-8 w-28 text-right text-xs tabular-nums"
                />
                {canEdit && (
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeRow(line.key, r.id)} aria-label={tr(STR.bsDetailRemove, isEnglish)}>
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                )}
              </div>
            ))}
            {canEdit && (
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => addRow(line.key)}>
                <Plus className="h-3.5 w-3.5" />
                {L(line.add)}
              </Button>
            )}
            {!canEdit && rows.length === 0 && <p className="text-xs text-muted-foreground">{tr(STR.bsNoDetail, isEnglish)}</p>}
          </div>
        )}
      </div>
    );
  };

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
            {dirty || !savedSnapshot ? tr(STR.bsSave, isEnglish) : tr(STR.bsSavedShort, isEnglish)}
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

        <div className="flex justify-end -mb-3">
          <Button
            type="button" variant="ghost" size="sm" className="text-xs"
            onClick={() => setExpanded(expanded.size === ALL_LINES.length ? new Set() : new Set(ALL_LINES.map((l) => l.key)))}
          >
            {expanded.size === ALL_LINES.length ? tr(STR.bsCollapseAll, isEnglish) : tr(STR.bsExpandAll, isEnglish)}
          </Button>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
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
              {ASSET_LINES.map(detailLine)}
              {totalRow(tr(STR.bsTotalAssets, isEnglish), totalAssets)}
            </CardContent>
          </Card>

          <Card className="neon-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{tr(STR.bsLiabilities, isEnglish)} <span className="text-xs font-normal text-muted-foreground">({tr(STR.bsLiabilitiesHint, isEnglish)})</span></CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border/50">
              {LIABILITY_LINES.map(detailLine)}
              {totalRow(tr(STR.bsTotalLiabilities, isEnglish), totalLiabilities)}
            </CardContent>
          </Card>

          <Card className="neon-border bg-card lg:col-span-2">
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
