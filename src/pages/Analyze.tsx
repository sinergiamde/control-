import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, FileText, Loader2, Sparkles } from "lucide-react";
import { useNavGuard } from "@/components/AppLayout";
import type { ClientOption } from "@/components/ClientCombobox";
import StatementUploader, { type UploadOutcome } from "@/components/StatementUploader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { fetchClientNodes } from "@/utils/clientTree";
import { pickText, STR, tr } from "@/utils/i18n";

interface RecentStatement {
  id: string;
  client_id: string | null;
  period: string | null;
  original_filename: string | null;
  created_at: string;
  full_analysis: any;
}

/** The home screen: what people come to CTRL+ for is analyzing a statement, so it's the first
 * thing they see — drop the PDF, say which client it's for (or name a new one), see the report. */
const Analyze = () => {
  const { lang } = useLanguage();
  const isEnglish = lang === "en";
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [recent, setRecent] = useState<RecentStatement[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasPendingFiles, setHasPendingFiles] = useState(false);
  useNavGuard(hasPendingFiles ? tr(STR.confirmLeaveWithFiles, isEnglish) : undefined);

  const fetchAll = useCallback(async () => {
    const [nodes, { data }] = await Promise.all([
      fetchClientNodes(),
      supabase
        .from("analyses")
        .select("id, client_id, period, original_filename, created_at, full_analysis")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);
    setClients(nodes.map((n) => ({ id: n.id, name: n.name })));
    setRecent((data as RecentStatement[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate("/"); return; }
    fetchAll();
  }, [authLoading, user, navigate, fetchAll]);

  const handleUploaded = (outcome: UploadOutcome) => {
    if (outcome.saved === 1 && outcome.filesCount === 1 && outcome.lastResult) {
      navigate("/results", { state: { results: outcome.lastResult, analysisId: outcome.lastAnalysisId, clientId: outcome.clientId } });
    } else {
      navigate(`/clients/${outcome.clientId}`);
    }
  };

  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.name || "—";

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-4xl w-full mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center neon-glow">
          <Sparkles className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{tr(STR.analyzeTitle, isEnglish)}</h1>
          <p className="text-sm text-muted-foreground">{tr(STR.analyzeDesc, isEnglish)}</p>
        </div>
      </div>

      <StatementUploader
        targets={clients}
        allowNewClient
        title={tr(STR.analyzeTitle, isEnglish)}
        onUploaded={handleUploaded}
        onPendingChange={setHasPendingFiles}
        onClientCreated={(c) => setClients((prev) => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)))}
      />

      {recent.length > 0 && (
        <Card className="bg-card border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              {tr(STR.recentStatementsTitle, isEnglish)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {recent.map((r) => {
              const src = r.full_analysis?.analysis ?? r.full_analysis;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => navigate("/results", { state: { results: r.full_analysis, analysisId: r.id, clientId: r.client_id } })}
                  className="w-full flex items-center justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-muted/50 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{clientName(r.client_id)}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {pickText(src, "period", isEnglish) || r.period || "—"} · {r.original_filename || "—"}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              );
            })}
          </CardContent>
        </Card>
      )}
    </main>
  );
};

export default Analyze;
