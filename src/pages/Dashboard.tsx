import { useState, useCallback } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, FileText, Loader2, CheckCircle2, Sparkles } from "lucide-react";
import Navbar from "@/components/Navbar";
import ChatBot from "@/components/ChatBot";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const ANALYZE_API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-statement`;

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(reader.error || new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });

const toNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.abs(value);
  if (typeof value === "string") {
    const normalized = value.replace(/[^\d.,-]/g, "").replace(/,(?=\d{3}(\D|$))/g, "").replace(/,/g, ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
  }
  return 0;
};

const sumItems = (items: any[] = []) =>
  items.reduce((sum, item) => sum + toNumber(item?.amt ?? item?.amount ?? item?.total), 0);

const getAnalysisSource = (data: any) => data?.analysis ?? data;

const getSections = (source: any) => Array.isArray(source?.sections) ? source.sections : [];

const sectionTotal = (source: any, title: string) =>
  getSections(source).find((section: any) => String(section?.title || "").toLowerCase().includes(title))?.total || 0;

const getFlatExpenseItems = (source: any) => [
  ...(Array.isArray(source?.categories) ? source.categories : []),
  ...(Array.isArray(source?.expenses_by_category) ? source.expenses_by_category : []),
];

const sumFlatExpenseItems = (source: any) => sumItems(getFlatExpenseItems(source));

const sumExpenseSections = (source: any) =>
  getSections(source).reduce((sum: number, section: any) => {
    const title = String(section?.title || "").toLowerCase();
    if (title.includes("revenue") || title.includes("ingreso")) return sum;
    return sum + toNumber(section?.total);
  }, 0);

const getTopCategory = (source: any) => {
  const allItems = [
    ...getSections(source).flatMap((section: any) => Array.isArray(section?.items) ? section.items : []),
    ...getFlatExpenseItems(source),
    ...(Array.isArray(source?.cogs) ? source.cogs : []),
    ...(Array.isArray(source?.opex) ? source.opex : []),
    ...(Array.isArray(source?.fees) ? source.fees : []),
    ...(Array.isArray(source?.personal) ? source.personal : []),
  ];
  const sorted = allItems
    .map((item: any) => ({ name: String(item?.desc || item?.name || item?.category || ""), amount: toNumber(item?.amt ?? item?.amount ?? item?.total) }))
    .filter((item) => item.name && item.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  return String(source?.topCategory || source?.top_category || sorted[0]?.name || "");
};

const Dashboard = () => {
  const { t } = useLanguage();
  const { user, profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentFileName, setCurrentFileName] = useState<string>("");
  const [processedCount, setProcessedCount] = useState(0);

  const addFiles = (newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles);
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => `${f.name}-${f.size}`));
      const unique = arr.filter((f) => !existing.has(`${f.name}-${f.size}`));
      return [...prev, ...unique];
    });
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === "dragenter" || e.type === "dragover");
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) addFiles(e.target.files);
    e.target.value = "";
  };

  // Normaliza period a "YYYY-MM" cuando es posible para comparar duplicados
  const normalizePeriod = (period: string): string => {
    if (!period) return "";
    const s = String(period).toLowerCase().trim();
    const ym = s.match(/(20\d{2})[-/\s.](0?[1-9]|1[0-2])/);
    if (ym) return `${ym[1]}-${ym[2].padStart(2, "0")}`;
    const my = s.match(/(0?[1-9]|1[0-2])[-/\s.](20\d{2})/);
    if (my) return `${my[2]}-${my[1].padStart(2, "0")}`;
    const months: Record<string, string> = {
      enero: "01", ene: "01", january: "01", jan: "01",
      febrero: "02", feb: "02", february: "02",
      marzo: "03", mar: "03", march: "03",
      abril: "04", abr: "04", april: "04", apr: "04",
      mayo: "05", may: "05",
      junio: "06", jun: "06", june: "06",
      julio: "07", jul: "07", july: "07",
      agosto: "08", ago: "08", aug: "08", august: "08",
      septiembre: "09", sep: "09", sept: "09", september: "09",
      octubre: "10", oct: "10", october: "10",
      noviembre: "11", nov: "11", november: "11",
      diciembre: "12", dic: "12", dec: "12", december: "12",
    };
    for (const [name, num] of Object.entries(months)) {
      const re = new RegExp(`${name}[^0-9]*(20\\d{2})`);
      const m = s.match(re);
      if (m) return `${m[1]}-${num}`;
    }
    return s;
  };

  const analyzeOne = async (file: File, existingPeriods: Set<string>, existingFilenames: Set<string>) => {
    const fileBase64 = await fileToBase64(file);
    const response = await fetch(ANALYZE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({
        fileBase64,
        mediaType: file.type || "application/octet-stream",
        fileName: file.name,
      }),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      console.error("Analyze API error:", response.status, data);
      throw new Error(data?.error || data?.message || "El analizador no pudo leer este archivo.");
    }
    if (!data) throw new Error("El analizador no devolvió resultados.");
    if ((data as any).error) throw new Error((data as any).error);

    if (user) {
      const src: any = getAnalysisSource(data);
      const period = src.period || "";
      const normPeriod = normalizePeriod(period);

      // Detección de duplicado por período (mes/año del extracto)
      if (normPeriod && existingPeriods.has(normPeriod)) {
        throw new Error(`Extracto duplicado: ya existe un análisis para el período "${period}". No se guardó para no afectar la contabilidad.`);
      }

      const revenues = Array.isArray(src?.revenues) ? src.revenues : [];
      const cogs = Array.isArray(src?.cogs) ? src.cogs : [];
      const opex = Array.isArray(src?.opex) ? src.opex : [];
      const fees = Array.isArray(src?.fees) ? src.fees : [];
      const personal = Array.isArray(src?.personal) ? src.personal : [];

      const revenuesTotal = toNumber(src?.totalRevenue ?? src?.total_revenue) || sumItems(revenues) || sectionTotal(src, "revenue");
      const cogsTotal = toNumber(src?.totalCOGS ?? src?.total_cogs) || sumItems(cogs) || sectionTotal(src, "cogs") || sectionTotal(src, "cost");
      const opexTotal = toNumber(src?.totalOpex ?? src?.total_opex) || sumItems(opex) || sectionTotal(src, "expense") || sectionTotal(src, "operating");
      const feesTotal = toNumber(src?.totalFees ?? src?.total_fees) || sumItems(fees) || sectionTotal(src, "fee");
      const personalTotal = toNumber(src?.totalPersonal ?? src?.total_personal) || sumItems(personal) || sectionTotal(src, "personal");
      const totalSpent = toNumber(src?.totalSpent ?? src?.total_spent) || cogsTotal + opexTotal + feesTotal + personalTotal || sumFlatExpenseItems(src) || sumExpenseSections(src);

      const insertPayload = {
        user_id: user.id,
        company: src.company || src.companyName || src.company_name || "",
        period,
        revenues_total: revenuesTotal,
        cogs_total: cogsTotal,
        opex_total: opexTotal,
        personal_total: personalTotal,
        fees_total: feesTotal,
        full_analysis: data as any,
        original_filename: file.name,
        total_spent: totalSpent,
        top_category: getTopCategory(src),
      };

      const { error: dbError } = await supabase.from("analyses").insert(insertPayload);
      if (dbError) {
        console.error("Insert error:", dbError);
        throw new Error(dbError.message);
      }

      if (normPeriod) existingPeriods.add(normPeriod);
      existingFilenames.add(file.name.toLowerCase());
    }
    return data;
  };

  const handleAnalyze = async () => {
    if (files.length === 0 || !user) return;
    setLoading(true);
    setUploadProgress(0);
    setProcessedCount(0);

    // Cargar análisis previos para detectar duplicados
    const { data: prior } = await supabase
      .from("analyses")
      .select("period, original_filename")
      .eq("user_id", user.id);

    const existingPeriods = new Set<string>(
      (prior || []).map((r: any) => normalizePeriod(r.period || "")).filter(Boolean)
    );
    const existingFilenames = new Set<string>(
      (prior || []).map((r: any) => String(r.original_filename || "").toLowerCase()).filter(Boolean)
    );

    let lastResult: any = null;
    const errors: string[] = [];
    const duplicates: string[] = [];
    let saved = 0;

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setCurrentFileName(f.name);

      // Duplicado por nombre de archivo (mismo extracto subido otra vez)
      if (existingFilenames.has(f.name.toLowerCase())) {
        duplicates.push(`${f.name} (ya analizado anteriormente)`);
        setProcessedCount(i + 1);
        setUploadProgress(((i + 1) / files.length) * 100);
        continue;
      }

      try {
        lastResult = await analyzeOne(f, existingPeriods, existingFilenames);
        saved++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error analizando ${f.name}:`, msg);
        if (msg.toLowerCase().includes("duplicado")) {
          duplicates.push(`${f.name}: ${msg}`);
        } else {
          errors.push(`${f.name}: ${msg}`);
        }
      }
      setProcessedCount(i + 1);
      setUploadProgress(((i + 1) / files.length) * 100);
    }

    setLoading(false);

    if (duplicates.length > 0) {
      toast({
        title: `⚠️ ${duplicates.length} extracto(s) duplicado(s)`,
        description: `${duplicates.join(" | ")}. Para mantener la contabilidad correcta, los duplicados no se guardaron.`,
        variant: "destructive",
      });
    }

    if (errors.length > 0) {
      toast({
        title: `⚠️ ${errors.length} error(es)`,
        description: errors.join(" | "),
        variant: "destructive",
      });
    }

    if (saved > 0) {
      toast({ title: "✅", description: `${saved} análisis guardado(s)` });
      if (saved === 1 && files.length === 1 && lastResult) {
        navigate("/results", { state: { results: lastResult } });
      } else {
        navigate("/history");
      }
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    navigate("/");
    return null;
  }

  const displayName = profile?.name || user.email?.split("@")[0] || "User";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <div className="flex-1 p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto w-full">
        <div className="mb-8 opacity-0 animate-fade-in">
          <div className="flex items-center gap-4 mb-3">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center animate-pulse-glow">
              <Sparkles className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
                {t("welcome")}, <span className="text-primary neon-text">{displayName}</span>
              </h1>
              <p className="text-muted-foreground mt-0.5">{t("uploadYourStatement")}</p>
            </div>
          </div>
          <div className="section-divider mt-4" />
        </div>

        <div className="grid grid-cols-3 gap-3 mb-6 opacity-0 animate-slide-up stagger-2">
          {[
            { icon: Sparkles, label: "AI Analysis", desc: "Claude Sonnet 5" },
            { icon: FileText, label: "Formats", desc: "PDF, CSV, XLSX" },
            { icon: CheckCircle2, label: "P&L Report", desc: "Professional" },
          ].map((item) => (
            <div key={item.label}
              className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border/50 hover-lift cursor-default">
              <item.icon className="h-5 w-5 text-primary shrink-0" />
              <div>
                <p className="text-xs font-semibold text-foreground">{item.label}</p>
                <p className="text-[10px] text-muted-foreground">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <Card className="neon-border bg-card shadow-2xl opacity-0 animate-scale-in stagger-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-foreground">
              <Upload className="h-5 w-5 text-primary" />
              {t("upload")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={`relative border-2 border-dashed rounded-xl p-8 sm:p-12 text-center transition-all duration-300 cursor-pointer ${
                dragActive
                  ? "border-primary bg-primary/5 neon-glow"
                  : files.length > 0
                  ? "border-primary/40 bg-primary/5"
                  : "border-border hover:border-primary/40 hover:bg-muted/50"
              }`}
            >
              <input
                type="file"
                multiple
                accept=".pdf,.csv,.xlsx,.xls"
                onChange={handleFileChange}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
              {files.length > 0 ? (
                <div className="flex flex-col items-center gap-3 animate-scale-in">
                  <div className="w-16 h-16 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center animate-pulse-glow">
                    <FileText className="h-8 w-8 text-primary" />
                  </div>
                  <p className="font-semibold text-foreground">
                    {files.length} archivo{files.length === 1 ? "" : "s"} listo{files.length === 1 ? "" : "s"}
                  </p>
                  <div className="w-full max-w-md space-y-1.5 text-left">
                    {files.map((f, i) => (
                      <div key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 text-xs bg-background/50 rounded-md px-2 py-1.5 border border-border/40">
                        <span className="truncate flex-1">{f.name}</span>
                        <span className="text-muted-foreground shrink-0">{(f.size / 1024).toFixed(1)} KB</span>
                        {!loading && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); removeFile(i); }}
                            className="text-destructive hover:opacity-70 shrink-0 px-1 relative z-10"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-primary mt-1">+ Click o arrastra para añadir más</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-16 h-16 rounded-xl bg-muted border border-border flex items-center justify-center group-hover:border-primary/30 transition-colors">
                    <Upload className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{t("dragDrop")}</p>
                    <p className="text-sm text-muted-foreground">{t("orClick")} (puedes seleccionar varios)</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">{t("supportedFormats")}</p>
                </div>
              )}
            </div>

            {loading && (
              <div className="space-y-2 animate-fade-in">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Analizando {processedCount}/{files.length}: {currentFileName}</span>
                  <span>{Math.round(uploadProgress)}%</span>
                </div>

                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300 neon-glow"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            <Button
              onClick={handleAnalyze}
              disabled={files.length === 0 || loading}
              className="w-full h-12 text-base font-bold neon-glow neon-glow-hover transition-all duration-300"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {t("analyzing")}
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  {t("analyze")}
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
      <ChatBot />
    </div>
  );
};

export default Dashboard;
