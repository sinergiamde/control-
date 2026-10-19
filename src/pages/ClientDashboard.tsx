import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, ArrowLeft, BarChart3, Building2, ChevronRight, CornerDownRight, Crown, Download, Eye,
  FileSpreadsheet, FileText, Loader2, PieChart as PieChartIcon, Trash2, TrendingDown, TrendingUp, Upload, Wallet,
} from "lucide-react";
import { useNavGuard } from "@/components/AppLayout";
import ChatBot from "@/components/ChatBot";
import PeriodPicker, { fmtMonth, selectionLabel, selectionToInterval, type PeriodSelection } from "@/components/PeriodPicker";
import StatementUploader, { type UploadOutcome } from "@/components/StatementUploader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { fetchClientNodes, type ClientNode } from "@/utils/clientTree";
import { buildConsolidatedReport } from "@/utils/consolidateReport";
import { generateProfessionalExcel } from "@/utils/generateExcel";
import { generateProfessionalPDF } from "@/utils/generatePDF";
import { pickText, STR, tr } from "@/utils/i18n";
import { saveReportToStorage } from "@/utils/saveReport";
import {
  expenseCategories, filterStatement, monthKey, monthlySeries, totalsOf, type FilteredStatement, type StatementRow,
} from "@/utils/statementPeriod";

const EXPENSE_COLORS = ["hsl(38, 90%, 55%)", "hsl(210, 60%, 50%)", "hsl(0, 70%, 55%)", "hsl(280, 60%, 55%)"];
const CHART_GREEN = "hsl(96, 100%, 50%)";
const CHART_RED = "hsl(0, 70%, 55%)";
const chartTooltipStyle = {
  backgroundColor: "hsl(0 0% 10%)",
  border: "1px solid hsl(0 0% 18%)",
  borderRadius: 8,
  color: "#fff",
  fontSize: 12,
};

const fmt = (n: number) =>
  `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtShort = (n: number) => `$${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** One company's own dashboard — what TaxForYou sees first when it opens a client: totals, monthly
 * trend and expense breakdown for any period (all / year / month / exact date range), the
 * statements behind those numbers (open or delete them right here), and the upload box. */
const ClientDashboard = () => {
  const { clientId = "" } = useParams();
  const { lang } = useLanguage();
  const isEnglish = lang === "en";
  const { user, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { theme } = useTheme();
  const gridColor = theme === "light" ? "hsl(0 0% 88%)" : "hsl(0 0% 18%)";
  const axisColor = theme === "light" ? "hsl(0 0% 40%)" : "hsl(0 0% 60%)";
  const barGreen = theme === "light" ? "hsl(100, 70%, 40%)" : CHART_GREEN;

  const [nodes, setNodes] = useState<ClientNode[]>([]);
  const [rows, setRows] = useState<StatementRow[]>([]);
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<PeriodSelection>({ kind: "all" });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState<"pdf" | "excel" | null>(null);
  const [hasPendingFiles, setHasPendingFiles] = useState(false);
  const uploaderRef = useRef<HTMLDivElement>(null);
  // Picked-but-not-analyzed statements would vanish on navigation — the sidebar asks first.
  useNavGuard(hasPendingFiles ? tr(STR.confirmLeaveWithFiles, isEnglish) : undefined);

  const client = nodes.find((n) => n.id === clientId) || null;
  const parent = client?.parent_id ? nodes.find((n) => n.id === client.parent_id) || null : null;
  const subCompanies = useMemo(
    () => nodes.filter((n) => n.parent_id === clientId).sort((a, b) => a.name.localeCompare(b.name)),
    [nodes, clientId]
  );
  const scopeIds = useMemo(() => [clientId, ...subCompanies.map((s) => s.id)], [clientId, subCompanies]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const allNodes = await fetchClientNodes();
    setNodes(allNodes);
    const ids = [clientId, ...allNodes.filter((n) => n.parent_id === clientId).map((n) => n.id)];
    // RLS scopes this further: an admin gets every statement of the company, a company user only
    // the ones they uploaded themselves.
    const [{ data }, { data: profiles }] = await Promise.all([
      supabase
        .from("analyses")
        .select("id, user_id, client_id, period, original_filename, created_at, full_analysis")
        .in("client_id", ids)
        .order("created_at", { ascending: false }),
      isAdmin ? supabase.from("profiles").select("user_id, name") : Promise.resolve({ data: [] as { user_id: string; name: string }[] }),
    ]);
    setRows((data as StatementRow[]) || []);
    setUserNames(new Map((profiles || []).map((p) => [p.user_id, p.name || "—"])));
    setSelectedIds(new Set());
    setLoading(false);
  }, [clientId, isAdmin]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate("/"); return; }
    fetchAll();
  }, [authLoading, user, navigate, fetchAll]);

  // Everything inside the chosen period, transaction by transaction (so a custom Mar 15 – Apr 10
  // range counts exactly those days, not whole statements).
  const all = useMemo(
    () => rows.map((r) => filterStatement(r, null)).filter((s): s is FilteredStatement => !!s),
    [rows]
  );
  const interval = useMemo(() => selectionToInterval(selection), [selection]);
  const inPeriod = useMemo(
    () => (interval ? rows.map((r) => filterStatement(r, interval)).filter((s): s is FilteredStatement => !!s) : all),
    [rows, interval, all]
  );
  const txns = useMemo(() => inPeriod.flatMap((s) => s.txns), [inPeriod]);
  const totals = useMemo(() => totalsOf(txns), [txns]);
  const monthly = useMemo(
    () =>
      monthlySeries(txns).map((m) => {
        const [y, mo] = m.key.split("-").map(Number);
        const label = new Date(y, mo - 1, 1).toLocaleDateString(isEnglish ? "en-US" : "es-CO", { month: "short", year: "2-digit" });
        return { ...m, label };
      }),
    [txns, isEnglish]
  );
  const categories = useMemo(() => expenseCategories(txns, isEnglish).slice(0, 10), [txns, isEnglish]);
  const expenseMix = useMemo(
    () =>
      [
        { name: tr(STR.cogsShort, isEnglish), value: totals.cogs },
        { name: tr(STR.opexShort, isEnglish), value: totals.opex },
        { name: tr(STR.feesShort, isEnglish), value: totals.fees },
        { name: tr(STR.personalShort, isEnglish), value: totals.personal },
      ].filter((r) => r.value > 0),
    [totals, isEnglish]
  );
  const monthsWithData = useMemo(
    () => Array.from(new Set(all.flatMap((s) => s.txns.map((t) => monthKey(t.date))))),
    [all]
  );
  const daysWithData = useMemo(() => {
    const seen = new Map<string, Date>();
    all.forEach((s) => s.txns.forEach((t) => seen.set(t.date.toDateString(), t.date)));
    return Array.from(seen.values());
  }, [all]);

  // Statements in the period, newest statement period first.
  const statements = useMemo(
    () => [...inPeriod].sort((a, b) => b.range.from.getTime() - a.range.from.getTime()),
    [inPeriod]
  );

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="flex-1 flex items-center justify-center p-8">
          <Card className="neon-border bg-card max-w-md w-full">
            <CardContent className="p-8 text-center space-y-4">
              <AlertTriangle className="h-10 w-10 text-destructive mx-auto" />
              <p className="text-foreground">{tr(STR.companyNotFound, isEnglish)}</p>
              <Button onClick={() => navigate("/clients")}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                {tr(STR.backToCompanies, isEnglish)}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const nodeName = (id: string | null) => nodes.find((n) => n.id === id)?.name || "—";
  const statementPeriodLabel = (s: FilteredStatement) => {
    const src = s.row.full_analysis?.analysis ?? s.row.full_analysis;
    return pickText(src, "period", isEnglish) || s.row.period || fmtMonth(s.range.from.getFullYear(), s.range.from.getMonth(), isEnglish);
  };

  const openStatement = (s: FilteredStatement) =>
    navigate("/results", { state: { results: s.row.full_analysis, analysisId: s.row.id, clientId: s.row.client_id } });

  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = statements.length > 0 && statements.every((s) => selectedIds.has(s.row.id));
  const toggleAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(statements.map((s) => s.row.id)));

  const deleteStatements = async (ids: string[]) => {
    if (ids.length === 0) return;
    const message = ids.length === 1
      ? tr(STR.confirmDeleteStatement, isEnglish)
      : tr(STR.confirmDeleteSelected, isEnglish).replace("{n}", String(ids.length));
    if (!window.confirm(message)) return;
    setDeleting(true);
    const { data, error } = await supabase.from("analyses").delete().in("id", ids).select("id");
    setDeleting(false);
    const deleted = new Set((data || []).map((r) => r.id));
    if (error || deleted.size === 0) {
      toast({ title: "Error", description: error?.message || tr(STR.deleteNotAllowed, isEnglish), variant: "destructive" });
      return;
    }
    setRows((prev) => prev.filter((r) => !deleted.has(r.id)));
    setSelectedIds((prev) => new Set([...prev].filter((id) => !deleted.has(id))));
    toast({
      title: "✅",
      description: `${deleted.size} ${tr(STR.statementsDeletedSuffix, isEnglish)}${deleted.size < ids.length ? ` — ${tr(STR.deleteNotAllowed, isEnglish)}` : ""}`,
    });
  };

  const handleDownload = async (format: "pdf" | "excel") => {
    if (inPeriod.length === 0) return;
    setDownloading(format);
    try {
      const consolidated = buildConsolidatedReport(inPeriod.map((s) => s.data), client.name, isEnglish);
      const periodLabel = selectionLabel(selection, isEnglish);
      if (format === "excel") {
        const { blob, fileName } = await generateProfessionalExcel(consolidated, isEnglish);
        await saveReportToStorage({ blob, fileName, type: "excel", clientId: client.id, periodLabel });
      } else {
        const { blob, fileName } = generateProfessionalPDF(consolidated, isEnglish);
        await saveReportToStorage({ blob, fileName, type: "pdf", clientId: client.id, periodLabel });
      }
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : tr(STR.couldNotGenerateFile, isEnglish),
        variant: "destructive",
      });
    } finally {
      setDownloading(null);
    }
  };

  const handleUploaded = (outcome: UploadOutcome) => {
    // One statement → show it straight away; several → stay here with the refreshed dashboard.
    if (outcome.saved === 1 && outcome.filesCount === 1 && outcome.lastResult) {
      navigate("/results", { state: { results: outcome.lastResult, analysisId: outcome.lastAnalysisId, clientId: outcome.clientId } });
    } else {
      fetchAll();
    }
  };

  const hasData = all.length > 0;
  const kpis = [
    { label: tr(STR.totalIncome, isEnglish), value: fmt(totals.revenue), icon: TrendingUp, className: "text-primary" },
    { label: tr(STR.totalExpensesLabel, isEnglish), value: fmt(totals.expenses), icon: TrendingDown, className: "text-destructive" },
    { label: tr(STR.net, isEnglish), value: fmt(totals.net), icon: Wallet, className: totals.net >= 0 ? "text-primary" : "text-destructive" },
    { label: tr(STR.kpiStatementsWord, isEnglish), value: String(inPeriod.length), icon: FileText, className: "text-foreground" },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="flex-1 container mx-auto px-4 py-6 max-w-6xl space-y-6">
        {/* Breadcrumb: TaxForYou › customer company › sub-company */}
        <nav className="flex items-center gap-1.5 text-sm text-muted-foreground flex-wrap">
          <button type="button" onClick={() => navigate("/clients")} className="inline-flex items-center gap-1 hover:text-primary">
            <Crown className="h-3.5 w-3.5" /> TaxForYou
          </button>
          {parent && (
            <>
              <ChevronRight className="h-3.5 w-3.5" />
              <button type="button" onClick={() => navigate(`/clients/${parent.id}`)} className="hover:text-primary">
                {parent.name}
              </button>
            </>
          )}
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="text-foreground font-medium">{client.name}</span>
        </nav>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center neon-glow">
              <Building2 className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{client.name}</h1>
              <p className="text-sm text-muted-foreground">
                {all.length} {tr(STR.statementWord, isEnglish)}{all.length === 1 ? "" : "s"}
                {subCompanies.length > 0 && ` · ${subCompanies.length} ${tr(STR.subCompaniesWord, isEnglish)}`}
              </p>
            </div>
          </div>
          <Button onClick={() => uploaderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} className="neon-glow">
            <Upload className="h-4 w-4 mr-1" />
            {tr(STR.uploadStatementButton, isEnglish)}
          </Button>
        </div>

        {subCompanies.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {subCompanies.map((s) => (
              <Button key={s.id} size="sm" variant="outline" className="h-8 text-xs" onClick={() => navigate(`/clients/${s.id}`)}>
                <CornerDownRight className="h-3.5 w-3.5 mr-1" />
                {s.name}
              </Button>
            ))}
          </div>
        )}

        {!isAdmin && <p className="text-xs text-muted-foreground -mt-2">{tr(STR.myHistoryNote, isEnglish)}</p>}

        {/* Period + downloads */}
        <Card className="neon-border">
          <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
            <PeriodPicker
              value={selection}
              onChange={(v) => { setSelection(v); setSelectedIds(new Set()); }}
              monthsWithData={monthsWithData}
              daysWithData={daysWithData}
              isEnglish={isEnglish}
            />
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={inPeriod.length === 0 || !!downloading} onClick={() => handleDownload("pdf")}>
                {downloading === "pdf" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileText className="h-4 w-4 mr-1" />}
                PDF
              </Button>
              <Button size="sm" variant="outline" disabled={inPeriod.length === 0 || !!downloading} onClick={() => handleDownload("excel")}>
                {downloading === "excel" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-1" />}
                Excel
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map((kpi) => (
            <Card key={kpi.label} className="neon-border bg-card shadow-lg">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1.5 text-muted-foreground">
                  <kpi.icon className={`h-4 w-4 ${kpi.className}`} />
                  <span className="text-xs font-medium">{kpi.label}</span>
                </div>
                <p className={`text-xl sm:text-2xl font-bold ${kpi.className}`}>{kpi.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {!hasData ? (
          <Card className="bg-card border-border/50">
            <CardContent className="p-8 text-center">
              <BarChart3 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="font-medium text-foreground">{tr(STR.noStatementsForCompany, isEnglish)}</p>
            </CardContent>
          </Card>
        ) : inPeriod.length === 0 ? (
          <Card className="bg-card border-border/50">
            <CardContent className="p-8 text-center text-muted-foreground">{tr(STR.noAnalysesPeriod, isEnglish)}</CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="neon-border bg-card shadow-lg lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-primary" />
                    {tr(STR.incomeVsExpensesByMonth, isEnglish)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: axisColor, fontSize: 11 }} axisLine={{ stroke: gridColor }} tickLine={false} />
                      <YAxis tick={{ fill: axisColor, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtShort(v)} width={64} />
                      <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => fmt(v)} cursor={{ fill: "hsl(0 0% 100% / 0.04)" }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="income" name={tr(STR.income, isEnglish)} fill={barGreen} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="expenses" name={tr(STR.expenses, isEnglish)} fill={CHART_RED} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="neon-border bg-card shadow-lg">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <PieChartIcon className="h-4 w-4 text-primary" />
                    {tr(STR.expenseBreakdownTitle, isEnglish)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="h-72 flex flex-col">
                  <div className="flex-1 min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={expenseMix} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                          {expenseMix.map((entry, i) => (
                            <Cell key={entry.name} fill={EXPENSE_COLORS[i % EXPENSE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => fmt(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 pt-2">
                    {expenseMix.map((entry, i) => (
                      <div key={entry.name} className="flex items-center gap-1.5 text-xs">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: EXPENSE_COLORS[i % EXPENSE_COLORS.length] }} />
                        <span className="text-muted-foreground truncate">{entry.name}</span>
                        <span className="ml-auto text-foreground">{fmtShort(entry.value)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="neon-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{tr(STR.topExpenseCategoriesTitle, isEnglish)}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {categories.map(([name, amount]) => {
                    const pct = totals.expenses > 0 ? (amount / totals.expenses) * 100 : 0;
                    return (
                      <div key={name} className="space-y-1">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-foreground truncate">{name}</span>
                          <span className="text-muted-foreground shrink-0">{fmt(amount)} · {pct.toFixed(1)}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {/* Statements behind the numbers */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              {tr(STR.statementsOfCompany, isEnglish)} — {selectionLabel(selection, isEnglish)}
            </CardTitle>
            {selectedIds.size > 0 && (
              <Button
                size="sm" variant="destructive"
                disabled={deleting}
                onClick={() => deleteStatements([...selectedIds])}
              >
                {deleting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
                {tr(STR.deleteSelected, isEnglish)} ({selectedIds.size})
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {statements.length === 0 ? (
              <p className="text-muted-foreground text-center py-6">{tr(STR.noStatements, isEnglish)}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">
                        <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 accent-[hsl(var(--primary))]" aria-label="select all" />
                      </TableHead>
                      <TableHead>{tr(STR.periodWord, isEnglish)}</TableHead>
                      <TableHead>{tr(STR.fileWord, isEnglish)}</TableHead>
                      {subCompanies.length > 0 && <TableHead>{tr(STR.companyColumnLabel, isEnglish)}</TableHead>}
                      {isAdmin && <TableHead>{tr(STR.uploadedByColumn, isEnglish)}</TableHead>}
                      <TableHead className="text-right">{tr(STR.income, isEnglish)}</TableHead>
                      <TableHead className="text-right">{tr(STR.expenses, isEnglish)}</TableHead>
                      <TableHead className="text-center">{tr(STR.actionWord, isEnglish)}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {statements.map((s) => {
                      const t = totalsOf(s.txns);
                      return (
                        <TableRow
                          key={s.row.id}
                          className={`cursor-pointer ${selectedIds.has(s.row.id) ? "bg-primary/5" : ""}`}
                          onClick={() => openStatement(s)}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(s.row.id)}
                              onChange={() => toggleSelected(s.row.id)}
                              className="h-4 w-4 accent-[hsl(var(--primary))]"
                            />
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {statementPeriodLabel(s)}
                            {s.partial && (
                              <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                                {tr(STR.partialWord, isEnglish)}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="font-medium max-w-[220px] truncate">{s.row.original_filename || "—"}</TableCell>
                          {subCompanies.length > 0 && (
                            <TableCell className="text-muted-foreground max-w-[160px] truncate">{nodeName(s.row.client_id)}</TableCell>
                          )}
                          {isAdmin && (
                            <TableCell className="text-muted-foreground max-w-[140px] truncate">{userNames.get(s.row.user_id) || "—"}</TableCell>
                          )}
                          <TableCell className="text-right text-primary">{fmt(t.revenue)}</TableCell>
                          <TableCell className="text-right text-destructive">{fmt(t.expenses)}</TableCell>
                          <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-1">
                              <Button size="sm" variant="outline" onClick={() => openStatement(s)}>
                                <Eye className="h-4 w-4 mr-1" /> {tr(STR.viewWord, isEnglish)}
                              </Button>
                              <Button
                                size="sm" variant="ghost"
                                disabled={deleting}
                                onClick={() => deleteStatements([s.row.id])}
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <div ref={uploaderRef} className="scroll-mt-20">
          <StatementUploader
            targets={[client, ...subCompanies].map((c) => ({ id: c.id, name: c.name }))}
            onUploaded={handleUploaded}
            onPendingChange={setHasPendingFiles}
          />
        </div>

        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => navigate("/history", { state: { clientId: client.id, clientName: client.name } })}>
            <Download className="h-4 w-4 mr-1" />
            {tr(STR.savedReportsTitle, isEnglish)}
          </Button>
        </div>
      </main>
      <ChatBot />
    </div>
  );
};

export default ClientDashboard;
