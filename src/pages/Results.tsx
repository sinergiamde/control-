import { useState, useEffect, useRef } from "react";
import ChatBot from "@/components/ChatBot";
import { useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DollarSign, TrendingUp, Receipt, ArrowLeft, Download, ChevronDown,
  ChevronUp, AlertTriangle, BarChart3, PieChart, Wallet, CreditCard,
  Building2, UtensilsCrossed, Car, ShoppingBag, Zap, Target, FileSpreadsheet, FileText
} from "lucide-react";
import Navbar from "@/components/Navbar";
import { generateProfessionalExcel } from "@/utils/generateExcel";
import { generateProfessionalPDF } from "@/utils/generatePDF";

interface LineItem {
  name: string;
  amount: number;
  percentage: number;
  detail?: string;
}

interface Section {
  title: string;
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
  ebitda: number;
  totalPersonal: number;
  netIncome: number;
  sections: Section[];
  kpis: KPI[];
  redFlags?: string[];
}

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

const CollapsibleSection = ({ section, index }: { section: Section; index: number }) => {
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
                  {item.detail && <p className="text-xs text-muted-foreground truncate mt-0.5">{item.detail}</p>}
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="text-xs text-muted-foreground w-12 text-right">{item.percentage.toFixed(1)}%</span>
                  <span className="text-sm font-semibold text-foreground w-24 text-right">
                    ${item.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </span>
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

const normalizeAnalysisItems = (items: any[] = [], totalRevenue: number): LineItem[] =>
  items.map((item) => {
    const amount = toNumber(item?.amt ?? item?.amount);
    const detailParts = [item?.date, item?.detail].filter(Boolean);

    return {
      name: item?.desc || item?.name || "Unknown",
      amount,
      percentage: toPercent(amount, totalRevenue),
      detail: detailParts.length > 0 ? detailParts.join(" • ") : undefined,
    };
  });

const formatCurrencyText = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatPercentText = (value: number, total: number) => `${toPercent(value, total).toFixed(1)}%`;

const transformAPIResponse = (raw: any): ResultsData => {
  const source = raw?.analysis ?? raw;

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
      period: source.period || "",
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
    const revenues = Array.isArray(source?.revenues) ? source.revenues : [];
    const cogs = Array.isArray(source?.cogs) ? source.cogs : [];
    const operatingExpenses = [
      ...(Array.isArray(source?.opex) ? source.opex : []),
      ...(Array.isArray(source?.fees) ? source.fees : []),
    ];
    const personal = Array.isArray(source?.personal) ? source.personal : [];

    const totalRevenue = sumAnalysisItems(revenues);
    const totalCOGS = sumAnalysisItems(cogs);
    const totalOpex = sumAnalysisItems(operatingExpenses);
    const totalPersonal = sumAnalysisItems(personal);
    const grossProfit = totalRevenue - totalCOGS;
    const ebitda = grossProfit - totalOpex;
    const netIncome = ebitda - totalPersonal;

    const sections: Section[] = [
      {
        title: "Revenue",
        icon: DollarSign,
        items: normalizeAnalysisItems(revenues, totalRevenue),
        total: totalRevenue,
        totalLabel: "Total Revenue",
        color: sectionColors[0],
      },
      {
        title: "COGS",
        icon: Building2,
        items: normalizeAnalysisItems(cogs, totalRevenue),
        total: totalCOGS,
        totalLabel: "Total COGS",
        color: sectionColors[1],
      },
      {
        title: "Operating Expenses & Fees",
        icon: CreditCard,
        items: normalizeAnalysisItems(operatingExpenses, totalRevenue),
        total: totalOpex,
        totalLabel: "Total OpEx",
        color: sectionColors[2],
      },
      {
        title: "Personal / Non-Deductible",
        icon: ShoppingBag,
        items: normalizeAnalysisItems(personal, totalRevenue),
        total: totalPersonal,
        totalLabel: "Total Personal",
        color: sectionColors[3],
      },
    ].filter((section) => section.items.length > 0 || section.total !== 0);

    const insights = Array.isArray(source?.insights) ? source.insights : [];

    return {
      companyName: source.company || source.companyName || source.company_name || "",
      period: source.period || "",
      totalRevenue,
      totalCOGS,
      grossProfit,
      totalOpex,
      ebitda,
      totalPersonal,
      netIncome,
      sections,
      kpis: [
        {
          label: "Revenue",
          value: formatCurrencyText(totalRevenue),
          description: insights[0] || "Total revenue detected from the uploaded statement.",
          color: sectionColors[0],
        },
        {
          label: "Gross Margin",
          value: formatPercentText(grossProfit, totalRevenue),
          description: insights[1] || "Gross profit as a percentage of revenue.",
          color: sectionColors[1],
        },
        {
          label: "EBITDA Margin",
          value: formatPercentText(ebitda, totalRevenue),
          description: insights[2] || "Operating profitability after expenses and fees.",
          color: sectionColors[2],
        },
        {
          label: "Net Margin",
          value: formatPercentText(netIncome, totalRevenue),
          description: insights[3] || "Net income after personal or non-deductible expenses.",
          color: sectionColors[3],
        },
      ],
      redFlags: source.alerts || source.redFlags || source.red_flags || [],
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
    period: source?.period || "",
    totalRevenue: totalSpent,
    totalCOGS: 0,
    grossProfit: totalSpent,
    totalOpex: totalSpent,
    ebitda: 0,
    totalPersonal: 0,
    netIncome: 0,
    sections: [{
      title: "Expense Breakdown",
      icon: Receipt,
      color: sectionColors[0],
      total: totalSpent,
      totalLabel: "Total",
      items,
    }],
    kpis: [],
    redFlags: source?.red_flags || source?.redFlags || source?.alerts || [],
  };
};

const Results = () => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const rawResults = (location.state as any)?.results;

  if (!user) {
    navigate("/");
    return null;
  }

  if (!rawResults) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center p-8">
          <Card className="neon-border bg-card max-w-md w-full">
            <CardContent className="p-8 text-center">
              <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
              <h2 className="text-xl font-bold text-foreground mb-2">No hay datos para mostrar</h2>
              <p className="text-muted-foreground text-sm mb-6">
                Sube un documento desde el Dashboard para generar tu reporte P&L.
              </p>
              <Button onClick={() => navigate("/dashboard")} className="neon-glow">
                <ArrowLeft className="h-4 w-4 mr-2" />
                {t("backToDashboard")}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const results: ResultsData = transformAPIResponse(rawResults);

  const handleDownloadExcel = () => {
    generateProfessionalExcel(results);
  };

  const handleDownloadPDF = () => {
    generateProfessionalPDF(results);
  };

  const summaryCards = [
    { label: t("totalSpent"), value: results.totalRevenue, icon: DollarSign, color: "hsl(96, 100%, 50%)", sub: "Revenue" },
    { label: "COGS", value: results.totalCOGS, icon: Building2, color: "hsl(38, 90%, 55%)", sub: `${((results.totalCOGS / results.totalRevenue) * 100).toFixed(1)}%` },
    { label: "Gross Profit", value: results.grossProfit, icon: TrendingUp, color: "hsl(96, 100%, 50%)", sub: `${((results.grossProfit / results.totalRevenue) * 100).toFixed(1)}%` },
    { label: "EBITDA", value: results.ebitda, icon: BarChart3, color: "hsl(210, 60%, 50%)", sub: `${((results.ebitda / results.totalRevenue) * 100).toFixed(1)}%` },
    { label: "Net Income", value: results.netIncome, icon: Wallet, color: "hsl(142, 76%, 36%)", sub: `${((results.netIncome / results.totalRevenue) * 100).toFixed(1)}%` },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <div className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto w-full">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 opacity-0 animate-fade-in">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
              Profit & Loss
            </h1>
            {results.companyName && (
              <p className="text-primary text-sm font-medium mt-1 neon-text">{results.companyName}</p>
            )}
            {results.period && (
              <p className="text-muted-foreground text-xs mt-0.5">{results.period}</p>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => navigate("/dashboard")}
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
              Flujo Financiero
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { label: "Revenue", value: results.totalRevenue, pct: 100, color: "hsl(96, 100%, 50%)" },
                { label: "COGS", value: results.totalCOGS, pct: (results.totalCOGS / results.totalRevenue) * 100, color: "hsl(38, 90%, 55%)" },
                { label: "Gross Profit", value: results.grossProfit, pct: (results.grossProfit / results.totalRevenue) * 100, color: "hsl(96, 100%, 50%)" },
                { label: "OpEx", value: results.totalOpex, pct: (results.totalOpex / results.totalRevenue) * 100, color: "hsl(210, 60%, 50%)" },
                { label: "EBITDA", value: results.ebitda, pct: (results.ebitda / results.totalRevenue) * 100, color: "hsl(142, 76%, 36%)" },
                { label: "Personal", value: results.totalPersonal, pct: (results.totalPersonal / results.totalRevenue) * 100, color: "hsl(0, 70%, 55%)" },
                { label: "Net Income", value: results.netIncome, pct: (results.netIncome / results.totalRevenue) * 100, color: "hsl(142, 76%, 36%)" },
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
            Desglose Detallado
          </h2>
          {results.sections.map((section, i) => (
            <CollapsibleSection key={section.title} section={section} index={i} />
          ))}
        </div>

        <Card className="neon-border bg-card shadow-xl mb-8 opacity-0 animate-slide-up" style={{ animationDelay: "0.7s" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-foreground flex items-center gap-2 text-base">
              <Target className="h-5 w-5 text-primary" />
              Indicadores Clave (KPIs)
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
                Alertas y Red Flags
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
                Resumen Anual {(results as any).annualYear || ""}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border">
                      <th className="py-2 pr-4 font-medium">Mes</th>
                      <th className="py-2 pr-4 font-medium text-right">Ingresos</th>
                      <th className="py-2 pr-4 font-medium text-right">Gastos</th>
                      <th className="py-2 font-medium text-right">Neto</th>
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
                        <td className="py-2 pr-4">Total</td>
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
          P&L basado en movimientos bancarios — no incluye CxC/CxP pendientes. Preparar estados formales con CPA para fines IRS.
        </p>
      </div>
      <ChatBot />
    </div>
  );
};

export default Results;
