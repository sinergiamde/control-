import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, Loader2, History as HistoryIcon, TrendingUp, TrendingDown, Wallet, Trash2, CalendarCheck, FileSpreadsheet, FileText, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { buildConsolidatedReport } from "@/utils/consolidateReport";
import { generateProfessionalExcel } from "@/utils/generateExcel";
import { generateProfessionalPDF } from "@/utils/generatePDF";
import { normalizePeriod } from "@/utils/normalizePeriod";
import { STR, tr, translateCategory, pickText } from "@/utils/i18n";

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
  const { user, profile, loading: authLoading } = useAuth();
  const { lang } = useLanguage();
  const isEnglish = lang === "en";
  const navigate = useNavigate();
  const { toast } = useToast();
  const [rows, setRows] = useState<AnalysisRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeOption>("all");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [annualSummary, setAnnualSummary] = useState<{ generated_at: string; net_income: number } | null>(null);

  const fetchRows = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("analyses")
      .select("*")
      .eq("user_id", user.id)
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

  const rangeLabel = useMemo(() => {
    if (range === "all") return tr(STR.allYears, isEnglish);
    if (range === "last3") return tr(STR.lastQuarter, isEnglish);
    if (range === "last6") return tr(STR.last6Months, isEnglish);
    if (range === previousYear) return `${tr(STR.previousYearWord, isEnglish)} (${range})`;
    return `${tr(STR.yearWord, isEnglish)} ${range}`;
  }, [range, previousYear, isEnglish]);

  useEffect(() => {
    if (!user || !/^\d{4}$/.test(range)) { setAnnualSummary(null); return; }
    supabase
      .from("annual_summaries")
      .select("generated_at, net_income")
      .eq("user_id", user.id)
      .eq("year", Number(range))
      .maybeSingle()
      .then(({ data }) => setAnnualSummary(data as any));
  }, [user, range]);

  const filtered = useMemo(() => {
    if (range === "all") return rows;
    if (range === "last3" || range === "last6") {
      const months = range === "last3" ? 3 : 6;
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - months);
      return rows.filter((r) => new Date(r.created_at) >= cutoff);
    }
    return rows.filter((r) => getStatementYear(r) === range);
  }, [rows, range]);

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
    navigate("/results", { state: { results: row.full_analysis } });
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
      if (format === "excel") await generateProfessionalExcel(consolidated, isEnglish);
      else generateProfessionalPDF(consolidated, isEnglish);
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
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2">
              <HistoryIcon className="h-5 w-5 text-primary" />
              {tr(STR.summaryLabel, isEnglish)} ({filtered.length} {tr(STR.statementWord, isEnglish)}{filtered.length === 1 ? "" : "s"})
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={range} onValueChange={setRange}>
                <SelectTrigger className="w-48">
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
                </SelectContent>
              </Select>
              <Button
                size="sm" variant="outline"
                disabled={filtered.length === 0 || downloading}
                onClick={() => handleDownload("excel")}
                title={`${tr(STR.downloadExcel, isEnglish)} — ${rangeLabel}`}
              >
                {downloading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-1" />}
                Excel ({rangeLabel})
              </Button>
              <Button
                size="sm" variant="outline"
                disabled={filtered.length === 0 || downloading}
                onClick={() => handleDownload("pdf")}
                title={`${tr(STR.downloadPdf, isEnglish)} — ${rangeLabel}`}
              >
                {downloading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileText className="h-4 w-4 mr-1" />}
                PDF ({rangeLabel})
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {annualSummary && (
              <div className="mb-4 flex items-center gap-2 text-xs rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-primary">
                <CalendarCheck className="h-4 w-4 shrink-0" />
                {tr(STR.annualSummaryPrefix, isEnglish)} {range} {tr(STR.generatedOn, isEnglish)} {new Date(annualSummary.generated_at).toLocaleDateString(isEnglish ? "en-US" : "es-CO")} {tr(STR.readyForTaxes, isEnglish)}
              </div>
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
      </main>
    </div>
  );
};

export default History;
