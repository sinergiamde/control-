import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, FileText, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { ClientOption } from "@/components/ClientCombobox";
import ClientChoice, { NEW_CLIENT, initialClientChoice, resolveClientChoice } from "@/components/ClientChoice";
import { UploadLockedCard, useTrialStatus } from "@/components/SubscribePrompt";
import { STR, tr } from "@/utils/i18n";
import { normalizeAnalysisTransactions } from "@/utils/reportTypes";

const ANALYZE_API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-statement`;
const ACCEPTED_EXTENSIONS = [".pdf", ".csv", ".xlsx", ".xls"];

const fileToBase64 = (file: File, couldNotReadMsg: string) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(reader.error || new Error(couldNotReadMsg));
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

export interface UploadOutcome {
  saved: number;
  filesCount: number;
  clientId: string;
  lastResult: any;
  lastAnalysisId?: string;
}

interface StatementUploaderProps {
  /** Clients a statement can be filed under here (inside a client's dashboard: just that client). */
  targets: ClientOption[];
  onUploaded: (outcome: UploadOutcome) => void;
  /** Lets the page guard in-app navigation while picked files haven't been analyzed yet. */
  onPendingChange?: (hasPending: boolean) => void;
  /** Home screen: pick any of the person's clients or type a new one right in the flow. */
  allowNewClient?: boolean;
  title?: string;
  onClientCreated?: (client: ClientOption) => void;
}

/** Drop/pick bank statements, analyze them with the AI, and save each one under the chosen
 * client — on the home screen (with "+ New client") and inside each client's dashboard. */
const StatementUploader = ({ targets, onUploaded, onPendingChange, allowNewClient = false, title, onClientCreated }: StatementUploaderProps) => {
  const { t, lang } = useLanguage();
  const isEnglish = lang === "en";
  const { user, session, canManageClients } = useAuth();
  const { toast } = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentFileName, setCurrentFileName] = useState<string>("");
  const [processedCount, setProcessedCount] = useState(0);
  const [targetId, setTargetId] = useState<string>(() => (allowNewClient ? initialClientChoice(targets, true) : targets[0]?.id ?? ""));
  const [newClientName, setNewClientName] = useState("");
  const folderInputRef = useRef<HTMLInputElement>(null);
  const { uploadsLocked } = useTrialStatus();

  useEffect(() => {
    if (targetId === NEW_CLIENT || targets.some((c) => c.id === targetId)) return;
    setTargetId(allowNewClient ? initialClientChoice(targets, true) : targets[0]?.id ?? "");
  }, [targets, targetId, allowNewClient]);

  const addFiles = (newFiles: FileList | File[]) => {
    // A folder pick (webkitdirectory) hands back everything in it -- filter down to statement
    // files so a stray .DS_Store/image/subfolder file doesn't end up queued for analysis.
    const arr = Array.from(newFiles).filter((f) =>
      ACCEPTED_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext))
    );
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

  const analyzeOne = async (file: File, clientId: string) => {
    const fileBase64 = await fileToBase64(file, t("couldNotReadFile"));
    const response = await fetch(ANALYZE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({
        fileBase64,
        mediaType: file.type || "application/octet-stream",
        fileName: file.name,
        lang,
      }),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      console.error("Analyze API error:", response.status, data);
      throw new Error(data?.error || data?.message || t("analyzerCouldNotRead"));
    }
    if (!data) throw new Error(t("analyzerNoResults"));
    if ((data as any).error) throw new Error((data as any).error);

    if (!user) return { data, analysisId: undefined };

    const src: any = getAnalysisSource(data);
    const period = src.period || "";

    // Clean up the AI's raw classification before anything totals it: drops a transaction the
    // AI accidentally put in two categories at once (double-counting real dollars), and moves
    // anything sitting in the wrong section (e.g. "Fuel (work)" landing in opex one month and
    // cogs the next) to its one canonical section, so the same category always rolls up the
    // same way regardless of which statement it came from.
    const { notesEn, notesEs } = normalizeAnalysisTransactions(src);
    if (notesEn.length > 0) {
      const legacyAlerts = Array.isArray(src.alerts) ? src.alerts : [];
      src.alerts_en = [...(Array.isArray(src.alerts_en) ? src.alerts_en : legacyAlerts), ...notesEn];
      src.alerts_es = [...(Array.isArray(src.alerts_es) ? src.alerts_es : legacyAlerts), ...notesEs];
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

    const { data: inserted, error: dbError } = await supabase
      .from("analyses")
      .insert({
        user_id: user.id,
        client_id: clientId,
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
      })
      .select("id")
      .single();
    if (dbError) {
      console.error("Insert error:", dbError);
      throw new Error(dbError.message);
    }
    return { data, analysisId: inserted?.id as string | undefined };
  };

  const handleAnalyze = async () => {
    if (files.length === 0 || !user) return;
    const resolved = await resolveClientChoice(targetId, newClientName, {
      empty: t("clientNameEmptyError"),
      duplicate: t("clientDuplicateError"),
    });
    if ("error" in resolved) {
      toast({ title: "Error", description: resolved.error, variant: "destructive" });
      return;
    }
    const clientId = resolved.client.id;
    if (resolved.created) {
      setTargetId(clientId);
      setNewClientName("");
      onClientCreated?.(resolved.client);
    }
    setLoading(true);
    setUploadProgress(0);
    setProcessedCount(0);

    let lastResult: any = null;
    let lastAnalysisId: string | undefined;
    const errors: string[] = [];
    let saved = 0;

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setCurrentFileName(f.name);
      try {
        const outcome = await analyzeOne(f, clientId);
        lastResult = outcome.data;
        lastAnalysisId = outcome.analysisId;
        saved++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error analyzing ${f.name}:`, msg);
        errors.push(`${f.name}: ${msg}`);
      }
      setProcessedCount(i + 1);
      setUploadProgress(((i + 1) / files.length) * 100);
    }

    setLoading(false);

    if (errors.length > 0) {
      toast({
        title: `⚠️ ${errors.length} ${t("errorWord")}`,
        description: errors.join(" | "),
        variant: "destructive",
      });
    }

    if (saved > 0) {
      toast({ title: "✅", description: `${saved} ${t("analysesSavedWord")}` });
      const filesCount = files.length;
      setFiles([]); // nothing left pending -- clears the navigation guard too
      onUploaded({ saved, filesCount, clientId, lastResult, lastAnalysisId });
    }
  };

  // Files picked here live only in this component's state -- leaving the page drops them, which
  // reads as "the file I uploaded disappeared." Guard real page unloads here; the page passes the
  // same flag to the navbar to guard in-app navigation.
  const hasPendingFiles = files.length > 0 || loading;
  useEffect(() => {
    onPendingChange?.(hasPendingFiles);
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasPendingFiles) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasPendingFiles, onPendingChange]);

  if (uploadsLocked) return <UploadLockedCard />;

  const clientReady = targetId === NEW_CLIENT ? !!newClientName.trim() : !!targetId;

  return (
    <Card className="neon-border bg-card shadow-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Upload className="h-5 w-5 text-primary" />
          {title ?? `${tr(STR.uploadForCompany, isEnglish)} ${targets.find((c) => c.id === targetId)?.name ?? ""}`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {!allowNewClient && targets.length > 1 && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">{tr(STR.whichCompanyLabel, isEnglish)}</label>
            <Select value={targetId} onValueChange={setTargetId} disabled={loading}>
              <SelectTrigger className="w-full sm:w-80">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {targets.map((c, i) => (
                  <SelectItem key={c.id} value={c.id}>{i === 0 ? c.name : `↳ ${c.name}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={`relative border-2 border-dashed rounded-xl p-8 sm:p-10 text-center transition-all duration-300 cursor-pointer ${
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
          {/* Separate hidden input for picking a whole folder at once (webkitdirectory isn't a
              typed React DOM prop, so it's spread in as a plain attribute) -- kept outside the
              dropzone's own input so the two file pickers don't fight over the same click. */}
          <input
            ref={folderInputRef}
            type="file"
            multiple
            onChange={handleFileChange}
            className="hidden"
            {...({ webkitdirectory: "true", directory: "true" } as any)}
          />
          {files.length > 0 ? (
            <div className="flex flex-col items-center gap-3 animate-scale-in">
              <div className="w-14 h-14 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center animate-pulse-glow">
                <FileText className="h-7 w-7 text-primary" />
              </div>
              <p className="font-semibold text-foreground">
                {files.length} {t("fileWord")}{files.length === 1 ? "" : "s"} {t("readyWord")}{files.length === 1 ? "" : "s"}
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
              <p className="text-xs text-primary mt-1">{t("clickOrDragAddMore")}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-xl bg-muted border border-border flex items-center justify-center">
                <Upload className="h-7 w-7 text-muted-foreground" />
              </div>
              <div>
                <p className="font-semibold text-foreground">{t("dragDrop")}</p>
                <p className="text-sm text-muted-foreground">{t("orClick")} {t("selectMultiple")}</p>
              </div>
              <p className="text-xs text-muted-foreground mt-2">{t("supportedFormats")}</p>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => folderInputRef.current?.click()}
          className="text-xs text-primary hover:underline -mt-3 block mx-auto"
        >
          {tr(STR.orSelectFolder, isEnglish)}
        </button>

        {allowNewClient && (
          <ClientChoice
            clients={targets}
            value={targetId}
            onChange={setTargetId}
            newName={newClientName}
            onNewNameChange={setNewClientName}
            label={tr(STR.whichClientLabel, isEnglish)}
            allowNew={canManageClients}
            disabled={loading}
          />
        )}

        {loading && (
          <div className="space-y-2 animate-fade-in">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{t("analyzingWord")} {processedCount}/{files.length}: {currentFileName}</span>
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
          disabled={files.length === 0 || loading || !clientReady}
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
  );
};

export default StatementUploader;
