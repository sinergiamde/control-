import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Building2, CornerDownRight, Crown, FileText, Loader2, Search, TrendingDown, TrendingUp } from "lucide-react";
import UserAvatar from "@/components/UserAvatar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { fetchClientNodes, type ClientNode } from "@/utils/clientTree";
import { STR, tr } from "@/utils/i18n";

interface StatementSummary {
  id: string;
  client_id: string | null;
  created_at: string;
  original_filename: string;
  revenues_total: number;
  total_spent: number;
}

interface CompanyUser {
  user_id: string;
  name: string;
  avatar_url: string | null;
  client_id: string | null;
}

type SortKey = "recent" | "name" | "statements";

const fmtShort = (n: number) => `$${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** TaxForYou's starting point: one card per customer company — logo, how many statements, the
 * latest one analyzed, totals — so you pick which company to review and open its own dashboard,
 * instead of seeing every company's numbers mixed together. */
const GeneralDashboard = () => {
  const { lang } = useLanguage();
  const isEnglish = lang === "en";
  const { user, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [nodes, setNodes] = useState<ClientNode[]>([]);
  const [statements, setStatements] = useState<StatementSummary[]>([]);
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");

  useEffect(() => {
    if (authLoading || !user) return;
    (async () => {
      setLoading(true);
      const [allNodes, { data }, { data: profiles }] = await Promise.all([
        fetchClientNodes(),
        // Stored per-statement totals are enough for the cards — no need to pull every full analysis.
        supabase.from("analyses").select("id, client_id, created_at, original_filename, revenues_total, total_spent"),
        isAdmin
          ? supabase.from("profiles").select("user_id, name, avatar_url, client_id")
          : Promise.resolve({ data: [] as CompanyUser[] }),
      ]);
      setNodes(allNodes);
      setStatements((data as StatementSummary[]) || []);
      setUsers((profiles as CompanyUser[]) || []);
      setLoading(false);
    })();
  }, [authLoading, user, isAdmin]);

  const companies = useMemo(() => {
    const roots = nodes.filter((n) => !n.parent_id || !nodes.some((p) => p.id === n.parent_id));
    return roots.map((root) => {
      const subs = nodes.filter((n) => n.parent_id === root.id).sort((a, b) => a.name.localeCompare(b.name));
      const ids = new Set([root.id, ...subs.map((s) => s.id)]);
      const mine = statements.filter((s) => s.client_id && ids.has(s.client_id));
      const latest = mine.reduce<StatementSummary | null>((acc, s) => (!acc || s.created_at > acc.created_at ? s : acc), null);
      const members = users.filter((u) => u.client_id === root.id);
      return {
        root,
        subs,
        count: mine.length,
        income: mine.reduce((sum, s) => sum + Number(s.revenues_total || 0), 0),
        expenses: mine.reduce((sum, s) => sum + Number(s.total_spent || 0), 0),
        latest,
        members,
        // A company user's photo doubles as the company logo when they uploaded one.
        logo: members.find((m) => m.avatar_url)?.avatar_url || null,
      };
    });
  }, [nodes, statements, users]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = companies.filter(
      (c) => !q || c.root.name.toLowerCase().includes(q) || c.subs.some((s) => s.name.toLowerCase().includes(q))
    );
    return filtered.sort((a, b) => {
      if (sort === "name") return a.root.name.localeCompare(b.root.name);
      if (sort === "statements") return b.count - a.count || a.root.name.localeCompare(b.root.name);
      return (b.latest?.created_at || "").localeCompare(a.latest?.created_at || "") || a.root.name.localeCompare(b.root.name);
    });
  }, [companies, search, sort]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(isEnglish ? "en-US" : "es-CO", { year: "numeric", month: "short", day: "numeric" });

  return (
    <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-7xl w-full mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center neon-glow">
          <Crown className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{tr(STR.pickCompanyTitle, isEnglish)}</h1>
          <p className="text-sm text-muted-foreground">
            {tr(STR.pickCompanyDesc, isEnglish)} · {companies.length} {tr(STR.companiesWord, isEnglish)} · {statements.length} {tr(STR.statementWord, isEnglish)}s
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={tr(STR.searchClientsShort, isEnglish)}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-muted border-border"
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder={tr(STR.sortLabel, isEnglish)} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">{tr(STR.sortRecent, isEnglish)}</SelectItem>
            <SelectItem value="name">{tr(STR.sortName, isEnglish)}</SelectItem>
            <SelectItem value="statements">{tr(STR.sortStatements, isEnglish)}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {visible.length === 0 ? (
        <Card className="bg-card border-border/50">
          <CardContent className="p-10 text-center">
            <Building2 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground">{tr(STR.noClientsYetLabel, isEnglish)}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map((c) => (
            <Card
              key={c.root.id}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/clients/${c.root.id}`)}
              onKeyDown={(e) => { if (e.key === "Enter") navigate(`/clients/${c.root.id}`); }}
              className="neon-border bg-card cursor-pointer group hover-lift transition-all hover:border-primary/60"
            >
              <CardContent className="p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <UserAvatar name={c.root.name} url={c.logo} className="w-14 h-14 rounded-xl text-xl" />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-lg text-foreground truncate group-hover:text-primary transition-colors">{c.root.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.subs.length} {tr(STR.subCompaniesWord, isEnglish)}
                    </p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-muted/40 px-2.5 py-2">
                    <p className="text-[10px] uppercase text-muted-foreground flex items-center gap-1"><FileText className="h-3 w-3" />{tr(STR.kpiStatementsWord, isEnglish)}</p>
                    <p className="font-bold text-foreground">{c.count}</p>
                  </div>
                  <div className="rounded-lg bg-muted/40 px-2.5 py-2">
                    <p className="text-[10px] uppercase text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" />{tr(STR.income, isEnglish)}</p>
                    <p className="font-bold text-primary text-sm">{fmtShort(c.income)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/40 px-2.5 py-2">
                    <p className="text-[10px] uppercase text-muted-foreground flex items-center gap-1"><TrendingDown className="h-3 w-3" />{tr(STR.expenses, isEnglish)}</p>
                    <p className="font-bold text-destructive text-sm">{fmtShort(c.expenses)}</p>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground border-t border-border/40 pt-3 min-h-[2.5rem]">
                  {c.latest ? (
                    <>
                      <span className="text-foreground/80">{tr(STR.lastStatementLabel, isEnglish)}:</span>{" "}
                      <span className="text-foreground">{c.latest.original_filename || "—"}</span>
                      <br />
                      {tr(STR.uploadedOnWord, isEnglish)} {fmtDate(c.latest.created_at)}
                    </>
                  ) : (
                    tr(STR.noActivityYet, isEnglish)
                  )}
                </div>

                {(c.subs.length > 0 || c.members.length > 0) && (
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex flex-wrap gap-1.5">
                      {c.subs.slice(0, 4).map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={(e) => { e.stopPropagation(); navigate(`/clients/${s.id}`); }}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-primary hover:border-primary/50"
                        >
                          <CornerDownRight className="h-3 w-3" /> {s.name}
                        </button>
                      ))}
                      {c.subs.length > 4 && <span className="text-[11px] text-muted-foreground">+{c.subs.length - 4}</span>}
                    </div>
                    {c.members.length > 0 && (
                      <div className="flex -space-x-2">
                        {c.members.slice(0, 4).map((m) => (
                          <UserAvatar key={m.user_id} name={m.name} url={m.avatar_url} className="w-7 h-7 border-2 border-card text-[10px]" />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
};

export default GeneralDashboard;
