import { useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { STR, tr } from "@/utils/i18n";
import { DollarSign, TrendingDown, Building2, FileText, BarChart3, PieChart as PieChartIcon } from "lucide-react";

interface OverviewData {
  totalRevenue: number;
  totalExpenses: number;
  clientsCount: number;
  statementsCount: number;
  byClient: { name: string; value: number }[];
  expenseMix: { name: string; value: number }[];
}

const EXPENSE_COLORS = ["hsl(38, 90%, 55%)", "hsl(210, 60%, 50%)", "hsl(0, 70%, 55%)", "hsl(280, 60%, 55%)"];
const CHART_GREEN = "hsl(96, 100%, 50%)";

const toNumber = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const fmt = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const chartTooltipStyle = {
  backgroundColor: "hsl(0 0% 10%)",
  border: "1px solid hsl(0 0% 18%)",
  borderRadius: 8,
  color: "#fff",
  fontSize: 12,
};

/** The KPI-cards-and-charts overview that sits above the upload flow on Dashboard — the "make it
 * look like an analytics dashboard" part of the redesign. Built from real analyses/clients data
 * (no mock numbers); shows a friendly empty state until at least one statement is analyzed. */
const DashboardAnalytics = ({ isEnglish, noClientLabel }: { isEnglish: boolean; noClientLabel: string }) => {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const [{ data: clients }, { data: analyses }] = await Promise.all([
        supabase.from("clients").select("id, name"),
        supabase.from("analyses").select("client_id, revenues_total, cogs_total, opex_total, personal_total, fees_total, total_spent"),
      ]);

      const clientNameById = new Map((clients || []).map((c: any) => [c.id, c.name]));
      const revenueByClient = new Map<string, number>();
      let totalRevenue = 0;
      let cogs = 0, opex = 0, personal = 0, fees = 0, totalExpenses = 0;

      (analyses || []).forEach((a: any) => {
        totalRevenue += toNumber(a.revenues_total);
        cogs += toNumber(a.cogs_total);
        opex += toNumber(a.opex_total);
        personal += toNumber(a.personal_total);
        fees += toNumber(a.fees_total);
        totalExpenses += toNumber(a.total_spent);

        const key = a.client_id || "__none__";
        revenueByClient.set(key, (revenueByClient.get(key) || 0) + toNumber(a.revenues_total));
      });

      const byClient = Array.from(revenueByClient.entries())
        .map(([id, value]) => ({ name: id === "__none__" ? noClientLabel : (clientNameById.get(id) || "?"), value }))
        .filter((row) => row.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 6);

      const expenseMix = [
        { name: "COGS", value: cogs },
        { name: "OpEx", value: opex },
        { name: "Personal", value: personal },
        { name: "Fees", value: fees },
      ].filter((row) => row.value > 0);

      setData({
        totalRevenue,
        totalExpenses,
        clientsCount: (clients || []).length,
        statementsCount: (analyses || []).length,
        byClient,
        expenseMix,
      });
      setLoading(false);
    };
    load();
  }, [noClientLabel]);

  const kpis = useMemo(() => ([
    { label: tr(STR.kpiTotalRevenue, isEnglish), value: fmt(data?.totalRevenue || 0), icon: DollarSign, color: "hsl(96, 100%, 50%)" },
    { label: tr(STR.kpiTotalExpenses, isEnglish), value: fmt(data?.totalExpenses || 0), icon: TrendingDown, color: "hsl(0, 70%, 55%)" },
    { label: tr(STR.kpiActiveClients, isEnglish), value: String(data?.clientsCount || 0), icon: Building2, color: "hsl(210, 60%, 50%)" },
    { label: tr(STR.kpiStatementsAnalyzed, isEnglish), value: String(data?.statementsCount || 0), icon: FileText, color: "hsl(38, 90%, 55%)" },
  ]), [data, isEnglish]);

  if (loading) {
    return <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl bg-card border border-border/50 animate-pulse" />)}
    </div>;
  }

  const hasData = (data?.statementsCount || 0) > 0;

  return (
    <div className="mb-8 space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="neon-border bg-card shadow-lg hover-lift">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <kpi.icon className="h-4 w-4" style={{ color: kpi.color }} />
                <span className="text-[11px] text-muted-foreground font-medium leading-tight">{kpi.label}</span>
              </div>
              <p className="text-lg sm:text-xl font-bold text-foreground">{kpi.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {!hasData ? (
        <Card className="bg-card border-border/50">
          <CardContent className="p-8 text-center">
            <BarChart3 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="font-medium text-foreground">{tr(STR.noAnalyticsYetTitle, isEnglish)}</p>
            <p className="text-sm text-muted-foreground mt-1">{tr(STR.noAnalyticsYetDesc, isEnglish)}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="neon-border bg-card shadow-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                {tr(STR.revenueByClientTitle, isEnglish)}
              </CardTitle>
              <p className="text-xs text-muted-foreground">{tr(STR.revenueByClientDesc, isEnglish)}</p>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.byClient} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 18%)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "hsl(0 0% 60%)", fontSize: 11 }} axisLine={{ stroke: "hsl(0 0% 18%)" }} tickLine={false} />
                  <YAxis tick={{ fill: "hsl(0 0% 60%)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmt(v)} width={56} />
                  <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => fmt(v)} cursor={{ fill: "hsl(0 0% 100% / 0.04)" }} />
                  <Bar dataKey="value" fill={CHART_GREEN} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="neon-border bg-card shadow-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <PieChartIcon className="h-4 w-4 text-primary" />
                {tr(STR.expenseMixTitle, isEnglish)}
              </CardTitle>
              <p className="text-xs text-muted-foreground">{tr(STR.expenseMixDesc, isEnglish)}</p>
            </CardHeader>
            <CardContent className="h-64 flex items-center gap-2">
              <div className="flex-1 h-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data?.expenseMix} dataKey="value" nameKey="name"
                      innerRadius={55} outerRadius={85} paddingAngle={2}
                    >
                      {(data?.expenseMix || []).map((entry, i) => (
                        <Cell key={entry.name} fill={EXPENSE_COLORS[i % EXPENSE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => fmt(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5 shrink-0 pr-2">
                {(data?.expenseMix || []).map((entry, i) => (
                  <div key={entry.name} className="flex items-center gap-1.5 text-xs">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: EXPENSE_COLORS[i % EXPENSE_COLORS.length] }} />
                    <span className="text-muted-foreground">{entry.name}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default DashboardAnalytics;
