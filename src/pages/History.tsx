import { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import type { DateRange } from "react-day-picker";
import { Eye, Loader2, History as HistoryIcon, TrendingUp, TrendingDown, Wallet, Trash2, CalendarCheck, FileSpreadsheet, FileText, AlertTriangle, FolderOpen, Download, CalendarRange } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { buildConsolidatedReport } from "@/utils/consolidateReport";
import { generateProfessionalExcel } from "@/utils/generateExcel";
import { generateProfessionalPDF } from "@/utils/generatePDF";
import { saveReportToStorage } from "@/utils/saveReport";
import { normalizePeriod } from "@/utils/normalizePeriod";
import { STR, tr, translateCategory, pickText } from "@/utils/i18n";
import { ClientCombobox, type ClientOption } from "@/components/ClientCombobox";

interface AnalysisRow {
  id: string;
  company: string;
  period: string;
  revenues_total: number;
  cogs_total: number;
  opex_total: number;
  personal_total: number;
  fees_total: number;
  total_spent: number;
  top_category: string;
  original_filename: string;
  created_at: string;
  full_analysis: any;
  client_id: string | null;
  clients: { name: string } | null;
}

interface ReportRow {
  id: string;
  type: "pdf" | "excel";
  period_label: string;
  file_name: string;
  storage_path: string;
  created_at: string;
}

const fmt = (n: number) =>
  `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const toNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.abs(value);
  if (typeof value === "string") {
    const normalized = value.replace(/[^\d.,-]/g, "").replace(/,(?=\d{3}(\D|$))/g, "").replace(/,/g, ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
  }
  return 0;
};

const addCategory = (categories: Record<string, number>, name: string, amount: unknown, isEnglish: boolean) => {
  const cleanName = translateCategory(String(name || "").trim(), isEnglish) || tr(STR.uncategorized, isEnglish);
  const cleanAmount = toNumber(amount);
  if (cleanAmount > 0) categories[cleanName] = (categories[cleanName] || 0) + cleanAmount;
};

const collectCategories = (analysis: any, categories: Record<string, number>, isEnglish: boolean) => {
  const source = analysis?.analysis ?? analysis;

  ["cogs", "opex", "fees", "personal"].forEach((key) => {
    if (Array.isArray(source?.[key])) {
      source[key].forEach((item: any) => addCategory(categories, item?.desc || item?.name || item?.category || key, item?.amt ?? item?.amount, isEnglish));
    }
  });

  if (Array.isArray(source?.sections)) {
    source.sections.forEach((section: any) => {
      if (Array.isArray(section?.items)) {
        section.items.forEach((item: any) => addCategory(categories, item?.name || item?.category || section?.title, item?.amount ?? item?.total, isEnglish));
      }
    });
  }

  if (Array.isArray(source?.categories)) {
    source.categories.forEach((item: any) => addCategory(categories, item?.name || item?.category, item?.amount ?? item?.total, isEnglish));
  }

  if (Array.isArray(source?.expenses_by_category)) {
    source.expenses_by_category.forEach((item: any) => addCategory(categories, item?.category || item?.name, item?.amount ?? item?.total, isEnglish));
  }
};

/** The DB "period" column stores a single, language-neutral value (used for grouping/dedup). For
 * display, prefer the bilingual period_en/period_es the AI writes into full_analysis so the shown
 * text follows the language toggle like the rest of the report; fall back to the raw column for
 * analyses saved before that existed. */
const displayPeriod = (row: AnalysisRow, isEnglish: boolean) => {
  const source = row.full_analysis?.analysis ?? row.full_analysis;
  return pickText(source, "period", isEnglish) || row.period || "";
};

const getStatementYear = (row: AnalysisRow) => {
  const source = row.full_analysis?.analysis ?? row.full_analysis;
  const candidates = [source?.annualYear, source?.year, source?.period, row.period, row.original_filename];
  for (const candidate of candidates) {
    const match = String(candidate || "").match(/20\d{2}|19\d{2}/);
    if (match) return match[0];
  }
  return new Date(row.created_at).getFullYear().toString();
};

type RangeOption = "all" | "last3" | "last6" | string;

const History = () => {
  const { user, session, profile, loading: authLoading } = useAuth();
  const { lang } = useLanguage();
  const isEnglish = lang === "en";
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [rows, setRows] = useState<AnalysisRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeOption>("all");
  const [customRange, setCustomRange] = useState<DateRange | undefined>(undefined);
  const [customRangeOpen, setCustomRangeOpen] = useState(false);
  // Arriving from a client's "History" button (Clients page) pre-selects that client here, with
  // the download card + calendar already sitting right at the top ready to use.
  const incomingClientId = (location.state as any)?.clientId as string | undefined;
  const incomingClientName = (location.state as any)?.clientName as string | undefined;
  const [clientFilter, setClientFilter] = useState<ClientOption | null>(
    incomingClientId && incomingClientName ? { id: incomingClientId, name: incomingClientName } : null
  );
  const [deleting, setDeleting] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [annualSummary, setAnnualSummary] = useState<{ generated_at: string; net_income: number } | null>(null);
  const [generatingAnnual, setGeneratingAnnual] = useState(false);
  const [savedReports, setSavedReports] = useState<ReportRow[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [openingReportId, setOpeningReportId] = useState<string | null>(null);

  const fetchRows = async () => {
    if (!user) return;
    // Shared history: every logged-in user sees every statement (see RLS on `analyses`), not just
    // the ones they personally uploaded — that's what keeps Cristian and Juan Fernando looking at
    // the same client history instead of two different lists.
    const { data } = await supabase
      .from("analyses")
      .select("*, clients(name)")
      .order("created_at", { ascending: false });
    setRows((data as AnalysisRow[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate("/"); return; }
    fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, navigate]);

  const previousYear = (new Date().getFullYear() - 1).toString();

  const years = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => s.add(getStatementYear(r)));
    return Array.from(s).sort().reverse();
  }, [rows]);

  const fmtDate = (d: Date) => d.toLocaleDateString(isEnglish ? "en-US" : "es-CO", { year: "numeric", month: "short", day: "numeric" });

  const rangeLabel = useMemo(() => {
    if (range === "all") return tr(STR.allYears, isEnglish);
    if (range === "last3") return tr(STR.lastQuarter, isEnglish);
    if (range === "last6") return tr(STR.last6Months, isEnglish);
    if (range === "custom") {
      if (customRange?.from && customRange?.to) return `${fmtDate(customRange.from)} – ${fmtDate(customRange.to)}`;
      return tr(STR.customRangeLabel, isEnglish);
    }
    if (range === previousYear) return `${tr(STR.previousYearWord, isEnglish)} (${range})`;
    return `${tr(STR.yearWord, isEnglish)} ${range}`;
  }, [range, previousYear, isEnglish, customRange]);

  const fetchAnnualSummary = async () => {
    if (!user || !/^\d{4}$/.test(range)) { setAnnualSummary(null); return; }
    // Shared: show whichever teammate's summary for this year is newest, not only one generated by
    // the currently logged-in user — same "everyone sees the same history" rule as the statements.
    const { data } = await supabase
      .from("annual_summaries")
      .select("generated_at, net_income")
      .eq("year", Number(range))
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setAnnualSummary(data as any);
  };

  useEffect(() => {
    fetchAnnualSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, range]);

  /** Lists previously generated PDF/Excel files (see saveReportToStorage) so they can be reopened
   * later instead of only living as a one-time browser download — answers "¿a quién se le va a
   * guardar el PDF?": saved shared, filterable by client just like the statements above. */
  const fetchSavedReports = async () => {
    if (!user) return;
    setLoadingReports(true);
    let query = supabase
      .from("reports")
      .select("id, type, period_label, file_name, storage_path, created_at")
      .order("created_at", { ascending: false })
      .limit(30);
    if (clientFilter) query = query.eq("client_id", clientFilter.id);
    const { data } = await query;
    setSavedReports((data as ReportRow[]) || []);
    setLoadingReports(false);
  };

  useEffect(() => {
    fetchSavedReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, clientFilter]);

  const handleOpenSavedReport = async (report: ReportRow) => {
    setOpeningReportId(report.id);
    const { data, error } = await supabase.storage.from("reports").createSignedUrl(report.storage_path, 60);
    setOpeningReportId(null);
    if (error || !data?.signedUrl) {
      toast({ title: "Error", description: error?.message || tr(STR.couldNotGenerateFile, isEnglish), variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const handleGenerateAnnual = async () => {
    if (!/^\d{4}$/.test(range)) return;
    setGeneratingAnnual(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/annual-summary`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ year: Number(range) }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || tr(STR.couldNotGenerateAnnualSummary, isEnglish));
      await fetchAnnualSummary();
      toast({ title: "✅", description: tr(STR.annualSummaryGenerated, isEnglish) });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : tr(STR.couldNotGenerateAnnualSummary, isEnglish),
        variant: "destructive",
      });
    } finally {
      setGeneratingAnnual(false);
    }
  };

  const filtered = useMemo(() => {
    let result = rows;
    if (clientFilter) result = result.filter((r) => r.client_id === clientFilter.id);

    if (range === "all") return result;
    if (range === "last3" || range === "last6") {
      const months = range === "last3" ? 3 : 6;
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - months);
      return result.filter((r) => new Date(r.created_at) >= cutoff);
    }
    if (range === "custom") {
      if (!customRange?.from) return result;
      const start = new Date(customRange.from);
      start.setHours(0, 0, 0, 0);
      const end = customRange.to ? new Date(customRange.to) : new Date(customRange.from);
      end.setHours(23, 59, 59, 999);
      return result.filter((r) => {
        const created = new Date(r.created_at);
        return created >= start && created <= end;
      });
    }
    return result.filter((r) => getStatementYear(r) === range);
  }, [rows, range, clientFilter, customRange]);

  const duplicatePeriodIds = useMemo(() => {
    const groups: Record<string, AnalysisRow[]> = {};
    rows.forEach((r) => {
      const key = normalizePeriod(r.period || "");
      if (!key) return;
      (groups[key] = groups[key] || []).push(r);
    });
    const duplicateGroups = Object.values(groups).filter((g) => g.length > 1);
    const ids = new Set<string>();
    duplicateGroups.forEach((g) => g.forEach((r) => ids.add(r.id)));
    return { ids, groups: duplicateGroups };
  }, [rows]);

  const totals = useMemo(() => {
    const t = { revenues: 0, cogs: 0, opex: 0, personal: 0, fees: 0, spent: 0 };
    const categories: Record<string, number> = {};
    filtered.forEach((r) => {
      t.revenues += Number(r.revenues_total || 0);
      t.cogs += Number(r.cogs_total || 0);
      t.opex += Number(r.opex_total || 0);
      t.personal += Number(r.personal_total || 0);
      t.fees += Number(r.fees_total || 0);
      t.spent += Number(r.total_spent || 0);

      collectCategories(r.full_analysis, categories, isEnglish);
    });
    // Fallback: if no detailed categories, use the 4 buckets
    if (Object.keys(categories).length === 0) {
      if (t.cogs > 0) categories[tr(STR.cogsFallback, isEnglish)] = t.cogs;
      if (t.opex > 0) categories[tr(STR.opexFallback, isEnglish)] = t.opex;
      if (t.personal > 0) categories[tr(STR.personalFallback, isEnglish)] = t.personal;
      if (t.fees > 0) categories[tr(STR.feesFallback, isEnglish)] = t.fees;
    }
    const sorted = Object.entries(categories).sort((a, b) => b[1] - a[1]);
    return { ...t, net: t.revenues - t.spent, categories: sorted };
  }, [filtered, isEnglish]);

  const viewDetail = (row: AnalysisRow) => {
    navigate("/results", { state: { results: row.full_analysis, analysisId: row.id, clientId: row.client_id } });
  };

  const handleDownload = async (format: "excel" | "pdf") => {
    if (filtered.length === 0) return;
    setDownloading(true);
    try {
      const isEnglish = lang === "en";
      const consolidated = buildConsolidatedReport(
        filtered.map((r) => r.full_analysis),
        profile?.name || "",
        isEnglish
      );
      if (format === "excel") {
        const { blob, fileName } = await generateProfessionalExcel(consolidated, isEnglish);
        await saveReportToStorage({ blob, fileName, type: "excel", clientId: clientFilter?.id ?? null, periodLabel: rangeLabel });
      } else {
        const { blob, fileName } = generateProfessionalPDF(consolidated, isEnglish);
        await saveReportToStorage({ blob, fileName, type: "pdf", clientId: clientFilter?.id ?? null, periodLabel: rangeLabel });
      }
      fetchSavedReports();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : tr(STR.couldNotGenerateFile, isEnglish),
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  };

  const handleDelete = async (row: AnalysisRow) => {
    if (!window.confirm(tr(STR.confirmDeleteStatement, isEnglish))) return;
    setDeleting(row.id);
    const { error } = await supabase.from("analyses").delete().eq("id", row.id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: tr(STR.statementDeletedTitle, isEnglish), description: `${row.original_filename || row.period} ${tr(STR.wasDeletedSuffix, isEnglish)}` });
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    }
    setDeleting(null);
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl space-y-6">
        <Card className="neon-border">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5 text-primary" />
              {tr(STR.downloadReportTitle, isEnglish)}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{tr(STR.downloadReportDesc, isEnglish)}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">{tr(STR.clientLabel, isEnglish)}</label>
                <ClientCombobox
                  value={clientFilter?.id ?? null}
                  onChange={setClientFilter}
                  placeholder={tr(STR.clientFilterAllLabel, isEnglish)}
                  searchPlaceholder={tr(STR.clientSearchPlaceholder, isEnglish)}
                  emptyLabel={tr(STR.clientEmptyLabel, isEnglish)}
                  createLabel={(q) => `${tr(STR.clientCreatePrefix, isEnglish)} "${q}"`}
                  allowClear
                  clearLabel={tr(STR.clientFilterAllLabel, isEnglish)}
                  className="w-full"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">{tr(STR.whichMonthLabel, isEnglish)}</label>
                <div className="flex items-center gap-2 flex-wrap">
                  <Select
                    value={range}
                    onValueChange={(v) => { setRange(v); if (v === "custom") setCustomRangeOpen(true); }}
                  >
                    <SelectTrigger className="flex-1 min-w-[140px]">
                      <SelectValue placeholder={tr(STR.periodWord, isEnglish)} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{tr(STR.allYears, isEnglish)}</SelectItem>
                      <SelectItem value="last3">{tr(STR.lastQuarter, isEnglish)}</SelectItem>
                      <SelectItem value="last6">{tr(STR.last6Months, isEnglish)}</SelectItem>
                      {!years.includes(previousYear) && (
                        <SelectItem value={previousYear}>{tr(STR.previousYearWord, isEnglish)} ({previousYear})</SelectItem>
                      )}
                      {years.map((y) => (
                        <SelectItem key={y} value={y}>
                          {y === previousYear ? `${tr(STR.previousYearWord, isEnglish)} (${y})` : `${tr(STR.yearWord, isEnglish)} ${y}`}
                        </SelectItem>
                      ))}
                      <SelectItem value="custom">{tr(STR.customRangeLabel, isEnglish)}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Popover open={customRangeOpen} onOpenChange={setCustomRangeOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => { setRange("custom"); setCustomRangeOpen(true); }}
                        className="font-normal shrink-0"
                        title={tr(STR.pickDateRange, isEnglish)}
                      >
                        <CalendarRange className="h-4 w-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="range"
                        selected={customRange}
                        onSelect={(v) => { setCustomRange(v); setRange("custom"); }}
                        numberOfMonths={2}
                        defaultMonth={customRange?.from}
                      />
                      <div className="flex justify-end p-2 border-t border-border">
                        <Button size="sm" onClick={() => setCustomRangeOpen(false)} disabled={!customRange?.from || !customRange?.to}>
                          {tr(STR.applyWord, isEnglish)}
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap pt-1">
              <Button
                disabled={filtered.length === 0 || downloading}
                onClick={() => handleDownload("pdf")}
                className="neon-glow"
              >
                {downloading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileText className="h-4 w-4 mr-1" />}
                {tr(STR.downloadPdf, isEnglish)} — {rangeLabel}
              </Button>
              <Button
                variant="outline"
                disabled={filtered.length === 0 || downloading}
                onClick={() => handleDownload("excel")}
              >
                {downloading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-1" />}
                {tr(STR.downloadExcel, isEnglish)} — {rangeLabel}
              </Button>
              {filtered.length === 0 && (
                <span className="text-xs text-muted-foreground">{tr(STR.noAnalysesPeriod, isEnglish)}</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2">
              <HistoryIcon className="h-5 w-5 text-primary" />
              {tr(STR.summaryLabel, isEnglish)} ({filtered.length} {tr(STR.statementWord, isEnglish)}{filtered.length === 1 ? "" : "s"})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/^\d{4}$/.test(range) && (
              annualSummary ? (
                <div className="mb-4 flex items-center justify-between gap-2 text-xs rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-primary">
                  <span className="flex items-center gap-2">
                    <CalendarCheck className="h-4 w-4 shrink-0" />
                    {tr(STR.annualSummaryPrefix, isEnglish)} {range} {tr(STR.generatedOn, isEnglish)} {new Date(annualSummary.generated_at).toLocaleDateString(isEnglish ? "en-US" : "es-CO")} {tr(STR.readyForTaxes, isEnglish)}
                  </span>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-primary" disabled={generatingAnnual} onClick={handleGenerateAnnual}>
                    {generatingAnnual ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : tr(STR.regenerateAnnualSummary, isEnglish)}
                  </Button>
                </div>
              ) : (
                <div className="mb-4 flex items-center justify-between gap-2 text-xs rounded-lg border border-border bg-muted/40 px-3 py-2 text-muted-foreground">
                  <span className="flex items-center gap-2">
                    <CalendarCheck className="h-4 w-4 shrink-0" />
                    {tr(STR.noAnnualSummaryYet, isEnglish)}
                  </span>
                  <Button size="sm" variant="outline" className="shrink-0" disabled={generatingAnnual} onClick={handleGenerateAnnual}>
                    {generatingAnnual ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <CalendarCheck className="h-3.5 w-3.5 mr-1" />}
                    {generatingAnnual ? tr(STR.generatingAnnualSummary, isEnglish) : tr(STR.generateAnnualSummary, isEnglish)}
                  </Button>
                </div>
              )
            )}
            {filtered.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                {tr(STR.noAnalysesPeriod, isEnglish)}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="rounded-lg border p-4 bg-card">
                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                      <TrendingUp className="h-4 w-4 text-primary" /> {tr(STR.totalIncome, isEnglish)}
                    </div>
                    <div className="text-2xl font-bold mt-1 text-primary">{fmt(totals.revenues)}</div>
                  </div>
                  <div className="rounded-lg border p-4 bg-card">
                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                      <TrendingDown className="h-4 w-4 text-destructive" /> {tr(STR.totalExpensesLabel, isEnglish)}
                    </div>
                    <div className="text-2xl font-bold mt-1 text-destructive">{fmt(totals.spent)}</div>
                  </div>
                  <div className="rounded-lg border p-4 bg-card">
                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                      <Wallet className="h-4 w-4" /> {tr(STR.net, isEnglish)}
                    </div>
                    <div className={`text-2xl font-bold mt-1 ${totals.net >= 0 ? "text-primary" : "text-destructive"}`}>
                      {fmt(totals.net)}
                    </div>
                  </div>
                </div>

                <h3 className="font-semibold mb-2">{tr(STR.whatWasExpenseFor, isEnglish)}</h3>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tr(STR.category, isEnglish)}</TableHead>
                        <TableHead className="text-right">{tr(STR.amount, isEnglish)}</TableHead>
                        <TableHead className="text-right">{tr(STR.pctOfExpense, isEnglish)}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {totals.categories.map(([name, amt]) => (
                        <TableRow key={name}>
                          <TableCell className="font-medium">{name}</TableCell>
                          <TableCell className="text-right">{fmt(amt)}</TableCell>
                          <TableCell className="text-right">
                            {totals.spent > 0 ? ((amt / totals.spent) * 100).toFixed(1) : "0.0"}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {duplicatePeriodIds.groups.length > 0 && (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="p-4">
              <div className="flex items-start gap-2 text-sm">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-destructive">
                    {tr(STR.youHave, isEnglish)} {duplicatePeriodIds.groups.length} {tr(STR.periodsWithMultipleSuffix, isEnglish)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {tr(STR.reviewRowsMarked, isEnglish)}
                  </p>
                  {duplicatePeriodIds.groups.map((g, i) => (
                    <p key={i} className="text-xs text-foreground">
                      • {displayPeriod(g[0], isEnglish) || "—"}: {g.map((r) => r.original_filename || r.company || r.id.slice(0, 6)).join(", ")}
                    </p>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{tr(STR.statementsForPeriod, isEnglish)}</CardTitle>
          </CardHeader>
          <CardContent>
            {filtered.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">{tr(STR.noStatements, isEnglish)}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr(STR.date, isEnglish)}</TableHead>
                      <TableHead>{tr(STR.clientColumnLabel, isEnglish)}</TableHead>
                      <TableHead>{tr(STR.fileWord, isEnglish)}</TableHead>
                      <TableHead>{tr(STR.periodWord, isEnglish)}</TableHead>
                      <TableHead className="text-right">{tr(STR.income, isEnglish)}</TableHead>
                      <TableHead className="text-right">{tr(STR.expenses, isEnglish)}</TableHead>
                      <TableHead>{tr(STR.topCategory, isEnglish)}</TableHead>
                      <TableHead className="text-center">{tr(STR.actionWord, isEnglish)}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((row) => (
                      <TableRow key={row.id} className={duplicatePeriodIds.ids.has(row.id) ? "bg-destructive/10" : ""}>
                        <TableCell>
                          {new Date(row.created_at).toLocaleDateString(isEnglish ? "en-US" : "es-CO", {
                            year: "numeric", month: "short", day: "numeric",
                          })}
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-[140px] truncate">
                          {row.clients?.name || tr(STR.noClientLabel, isEnglish)}
                        </TableCell>
                        <TableCell className="font-medium max-w-[200px] truncate">
                          {row.original_filename || row.company || "—"}
                        </TableCell>
                        <TableCell>
                          {duplicatePeriodIds.ids.has(row.id) && (
                            <AlertTriangle className="h-3.5 w-3.5 text-destructive inline mr-1" />
                          )}
                          {displayPeriod(row, isEnglish) || "—"}
                        </TableCell>
                        <TableCell className="text-right text-primary">{fmt(row.revenues_total)}</TableCell>
                        <TableCell className="text-right text-destructive">{fmt(row.total_spent)}</TableCell>
                        <TableCell className="text-muted-foreground">{row.top_category || "—"}</TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button size="sm" variant="outline" onClick={() => viewDetail(row)}>
                              <Eye className="h-4 w-4 mr-1" /> {tr(STR.viewWord, isEnglish)}
                            </Button>
                            <Button
                              size="sm" variant="ghost"
                              disabled={deleting === row.id}
                              onClick={() => handleDelete(row)}
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                              {deleting === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5 text-primary" />
              {tr(STR.savedReportsTitle, isEnglish)}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{tr(STR.savedReportsDesc, isEnglish)}</p>
          </CardHeader>
          <CardContent>
            {loadingReports ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : savedReports.length === 0 ? (
              <p className="text-muted-foreground text-center py-6 text-sm">{tr(STR.noSavedReports, isEnglish)}</p>
            ) : (
              <div className="divide-y divide-border/40">
                {savedReports.map((report) => (
                  <div key={report.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      {report.type === "pdf" ? (
                        <FileText className="h-4 w-4 text-destructive shrink-0" />
                      ) : (
                        <FileSpreadsheet className="h-4 w-4 text-primary shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm text-foreground truncate">{report.file_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {report.period_label ? `${report.period_label} • ` : ""}
                          {new Date(report.created_at).toLocaleDateString(isEnglish ? "en-US" : "es-CO", {
                            year: "numeric", month: "short", day: "numeric",
                          })}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm" variant="outline"
                      disabled={openingReportId === report.id}
                      onClick={() => handleOpenSavedReport(report)}
                      className="shrink-0"
                    >
                      {openingReportId === report.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5 mr-1" />
                      )}
                      {tr(STR.openWord, isEnglish)}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default History;
