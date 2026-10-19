import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Plus, Pencil, Trash2, Check, X, Building2, Search, CalendarRange,
  ChevronRight, CornerDownRight, Crown, LayoutDashboard, User as UserIcon,
} from "lucide-react";
import { fetchClientNodes, type ClientNode } from "@/utils/clientTree";
import { STR, tr } from "@/utils/i18n";

interface CompanyUser {
  user_id: string;
  name: string;
  client_id: string | null;
}

const TOP_LEVEL = "__top__";

/** TaxForYou → customer companies ("Pepito Pérez") → the sub-companies each one manages.
 * Admins see and organize the whole tree; a company user sees only their own company and can add
 * sub-companies to it (RLS enforces the same scoping server-side). */
const Clients = () => {
  const { t, lang } = useLanguage();
  const isEnglish = lang === "en";
  const { user, profile, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [nodes, setNodes] = useState<ClientNode[]>([]);
  const [statementCounts, setStatementCounts] = useState<Map<string, number>>(new Map());
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState("");
  const [newSubNames, setNewSubNames] = useState<Record<string, string>>({});
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    const [clientRows, { data: analysisRows }, { data: profileRows }] = await Promise.all([
      fetchClientNodes(),
      supabase.from("analyses").select("client_id"),
      isAdmin
        ? supabase.from("profiles").select("user_id, name, client_id")
        : Promise.resolve({ data: [] as CompanyUser[] }),
    ]);
    const counts = new Map<string, number>();
    (analysisRows || []).forEach((r: { client_id: string | null }) => {
      if (r.client_id) counts.set(r.client_id, (counts.get(r.client_id) || 0) + 1);
    });
    setNodes(clientRows);
    setStatementCounts(counts);
    setUsers((profileRows as CompanyUser[]) || []);
    // A company user only has their one company — open it straight away.
    const roots = clientRows.filter((c) => !c.parent_id);
    if (roots.length === 1) setExpanded(new Set([roots[0].id]));
    setLoading(false);
  };

  useEffect(() => {
    if (!authLoading && user) fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, isAdmin]);

  // Hooks must all run before the early returns below (see the note that used to live here:
  // a hook declared after an early return crashes the page on a fresh load of /clients).
  const tree = useMemo(() => {
    const q = search.trim().toLowerCase();
    const ids = new Set(nodes.map((n) => n.id));
    const roots = nodes
      .filter((n) => !n.parent_id || !ids.has(n.parent_id))
      .sort((a, b) => a.name.localeCompare(b.name));
    return roots
      .map((root) => {
        const children = nodes.filter((n) => n.parent_id === root.id).sort((a, b) => a.name.localeCompare(b.name));
        const rootMatches = !q || root.name.toLowerCase().includes(q);
        const shownChildren = rootMatches ? children : children.filter((c) => c.name.toLowerCase().includes(q));
        return { root, children, shownChildren, visible: rootMatches || shownChildren.length > 0 };
      })
      .filter((g) => g.visible);
  }, [nodes, search]);

  const topLevel = useMemo(() => nodes.filter((n) => !n.parent_id).sort((a, b) => a.name.localeCompare(b.name)), [nodes]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    navigate("/");
    return null;
  }

  const isDuplicateError = (message: string) => /duplicate key|unique/i.test(message);
  const hasNoCompany = !isAdmin && !profile?.client_id;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleCreate = async (parentId: string | null) => {
    const name = (parentId ? newSubNames[parentId] || "" : newName).trim();
    if (!name) {
      toast({ title: "Error", description: t("clientNameEmptyError"), variant: "destructive" });
      return;
    }
    setCreatingFor(parentId ?? TOP_LEVEL);
    const { data, error } = await supabase
      .from("clients")
      .insert({ name, parent_id: parentId })
      .select("id, name, parent_id")
      .single();
    setCreatingFor(null);
    if (error) {
      toast({
        title: "Error",
        description: isDuplicateError(error.message) ? t("clientDuplicateError") : error.message,
        variant: "destructive",
      });
      return;
    }
    setNodes((prev) => [...prev, data as ClientNode]);
    if (parentId) {
      setNewSubNames((prev) => ({ ...prev, [parentId]: "" }));
      setExpanded((prev) => new Set(prev).add(parentId));
    } else {
      setNewName("");
    }
    toast({ title: "✅", description: t("clientCreated") });
  };

  const startEdit = (client: ClientNode) => {
    setEditingId(client.id);
    setEditingName(client.name);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingName("");
  };

  const handleSaveEdit = async (id: string) => {
    const name = editingName.trim();
    if (!name) {
      toast({ title: "Error", description: t("clientNameEmptyError"), variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.from("clients").update({ name }).eq("id", id).select("id");
    setSaving(false);
    if (error || !data?.length) {
      toast({
        title: "Error",
        description: error && isDuplicateError(error.message) ? t("clientDuplicateError") : error?.message || "—",
        variant: "destructive",
      });
      return;
    }
    setNodes((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
    toast({ title: "✅", description: t("clientRenamed") });
    cancelEdit();
  };

  const handleMove = async (client: ClientNode, target: string) => {
    const parentId = target === TOP_LEVEL ? null : target;
    if ((client.parent_id ?? null) === parentId) return;
    setMovingId(client.id);
    const { error } = await supabase.from("clients").update({ parent_id: parentId }).eq("id", client.id);
    setMovingId(null);
    if (error) {
      toast({
        title: "Error",
        description: isDuplicateError(error.message) ? t("clientDuplicateError") : error.message,
        variant: "destructive",
      });
      return;
    }
    setNodes((prev) => prev.map((c) => (c.id === client.id ? { ...c, parent_id: parentId } : c)));
    if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
    toast({ title: "✅", description: t("companyMoved") });
  };

  /** Deletes the company together with its sub-companies, statements and saved reports (TaxForYou
   * cleaning out a client it no longer serves). The report files go first through the Storage API —
   * storage can't be cleaned from SQL — then admin_delete_client removes every row in one transaction. */
  const handleDelete = async (client: ClientNode) => {
    const ids = [client.id, ...nodes.filter((n) => n.parent_id === client.id).map((n) => n.id)];
    const statements = ids.reduce((sum, id) => sum + (statementCounts.get(id) || 0), 0);
    const message = tr(STR.confirmDeleteCompany, isEnglish)
      .replace("{name}", client.name)
      .replace("{subs}", String(ids.length - 1))
      .replace("{statements}", String(statements));
    if (!window.confirm(message)) return;

    setDeletingId(client.id);
    const { data: reportRows } = await supabase.from("reports").select("storage_path").in("client_id", ids);
    const paths = (reportRows || []).map((r) => r.storage_path).filter(Boolean);
    if (paths.length > 0) await supabase.storage.from("reports").remove(paths);

    const { data, error } = await supabase.rpc("admin_delete_client", { _client_id: client.id });
    setDeletingId(null);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    const removed = new Set(ids);
    setNodes((prev) => prev.filter((c) => !removed.has(c.id)));
    const deletedStatements = (data as { statements?: number } | null)?.statements ?? statements;
    toast({ title: "✅", description: tr(STR.companyDeletedSummary, isEnglish).replace("{statements}", String(deletedStatements)) });
  };

  const openDashboard = (client: ClientNode) => navigate(`/clients/${client.id}`);

  /** Rename / move / delete controls shared by company and sub-company rows. */
  const renderRowActions = (client: ClientNode, hasChildren: boolean) => {
    // A company user can rename the sub-companies under their company, not their company itself.
    const canRename = isAdmin || !!client.parent_id;
    return (
      <div className="flex items-center gap-1 shrink-0">
        <Button
          size="sm" variant="outline"
          onClick={() => openDashboard(client)}
          className="text-primary hover:text-primary hover:bg-primary/10"
        >
          <LayoutDashboard className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">{tr(STR.openCompany, isEnglish)}</span>
        </Button>
        {isAdmin && !hasChildren && (
          <Select value={client.parent_id ?? TOP_LEVEL} onValueChange={(v) => handleMove(client, v)}>
            <SelectTrigger
              className="h-9 w-9 sm:w-auto px-2 text-xs text-muted-foreground"
              title={t("moveToLabel")}
              disabled={movingId === client.id}
            >
              {movingId === client.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span className="hidden sm:inline"><SelectValue placeholder={t("moveToLabel")}>{t("moveToLabel")}</SelectValue></span>
              )}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TOP_LEVEL}>{t("topLevelOption")}</SelectItem>
              {topLevel
                .filter((c) => c.id !== client.id)
                .map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}
        {canRename && (
          <Button size="sm" variant="ghost" onClick={() => startEdit(client)}
            className="text-muted-foreground hover:text-primary hover:bg-primary/10">
            <Pencil className="h-4 w-4" />
          </Button>
        )}
        {isAdmin && (
          <Button
            size="sm" variant="ghost"
            disabled={deletingId === client.id}
            onClick={() => handleDelete(client)}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            {deletingId === client.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </Button>
        )}
      </div>
    );
  };

  const renderEditRow = (id: string) => (
    <>
      <Input
        value={editingName}
        onChange={(e) => setEditingName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") handleSaveEdit(id); if (e.key === "Escape") cancelEdit(); }}
        autoFocus
        className="bg-muted border-border text-foreground h-9"
      />
      <div className="flex items-center gap-1 shrink-0">
        <Button size="sm" variant="ghost" disabled={saving} onClick={() => handleSaveEdit(id)}
          className="text-primary hover:text-primary hover:bg-primary/10">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </Button>
        <Button size="sm" variant="ghost" disabled={saving} onClick={cancelEdit} className="text-muted-foreground">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto w-full">
        <div className="flex items-center gap-3 mb-6 opacity-0 animate-fade-in">
          <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center neon-glow">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{t("clientsPageTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("clientsPageDesc")}</p>
          </div>
        </div>

        {hasNoCompany && (
          <Card className="border-destructive/50 bg-destructive/5 mb-6">
            <CardContent className="p-4 text-sm text-destructive font-medium">
              {tr(STR.noCompanyAssigned, isEnglish)}
            </CardContent>
          </Card>
        )}

        {isAdmin && (
          <Card className="neon-border bg-card shadow-2xl mb-6 opacity-0 animate-scale-in stagger-2">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  placeholder={t("clientNamePlaceholder")}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) handleCreate(null); }}
                  className="bg-muted border-border text-foreground"
                />
                {/* Disabled while empty instead of only validating on click — a click that produces
                    nothing but an error toast reads like the button is broken. */}
                <Button onClick={() => handleCreate(null)} disabled={creatingFor === TOP_LEVEL || !newName.trim()} className="neon-glow shrink-0">
                  {creatingFor === TOP_LEVEL ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                  {t("addClient")}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="neon-border bg-card shadow-2xl opacity-0 animate-slide-up stagger-3">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              {isAdmin ? (
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <Crown className="h-5 w-5 text-primary" />
                  TaxForYou
                  <span className="text-xs font-normal text-muted-foreground">
                    {t("ownerCaption")} · {topLevel.length} {t("customerCompaniesWord")}
                  </span>
                </CardTitle>
              ) : (
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <Building2 className="h-5 w-5 text-primary" />
                  {t("clientsPageTitle")}
                </CardTitle>
              )}
              <div className="relative w-full max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("searchClientsPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 bg-muted border-border text-foreground h-9 text-sm"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : tree.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">{t("noClientsYet")}</p>
            ) : (
              <div className="space-y-2">
                {tree.map(({ root, children, shownChildren }, i) => {
                  const isOpen = expanded.has(root.id) || !!search.trim();
                  const totalStatements = [root, ...children].reduce((sum, c) => sum + (statementCounts.get(c.id) || 0), 0);
                  const companyUsers = users.filter((u) => u.client_id === root.id);
                  return (
                    <div
                      key={root.id}
                      className="rounded-lg border border-border/60 bg-muted/20 opacity-0 animate-fade-in"
                      style={{ animationDelay: `${0.03 * i}s` }}
                    >
                      <div className="flex items-center justify-between gap-3 p-3">
                        {editingId === root.id ? (
                          renderEditRow(root.id)
                        ) : (
                          <>
                            <div className="flex items-center gap-2 min-w-0">
                              <button type="button" onClick={() => toggle(root.id)} className="p-1 -m-1 rounded hover:bg-muted" aria-label="expand">
                                <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
                              </button>
                              <button type="button" onClick={() => openDashboard(root)} className="flex items-center gap-2 min-w-0 text-left group">
                              <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                                {root.name[0]?.toUpperCase() || "?"}
                              </div>
                              <div className="min-w-0">
                                <p className="font-semibold text-foreground truncate group-hover:text-primary">{root.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {children.length} {t("subCompaniesWord")} · {totalStatements} {t("statementsCountLabel")}
                                  {isAdmin && ` · ${companyUsers.length} ${t("usersWord")}`}
                                </p>
                              </div>
                              </button>
                            </div>
                            {renderRowActions(root, children.length > 0)}
                          </>
                        )}
                      </div>

                      {isOpen && (
                        <div className="border-t border-border/40 px-3 pb-3 pt-2 space-y-1">
                          {shownChildren.length === 0 && !search.trim() && (
                            <p className="text-xs text-muted-foreground pl-8 py-1">{t("noSubCompanies")}</p>
                          )}
                          {shownChildren.map((child) => (
                            <div key={child.id} className="flex items-center justify-between gap-3 py-1.5 pl-6">
                              {editingId === child.id ? (
                                renderEditRow(child.id)
                              ) : (
                                <>
                                  <button type="button" onClick={() => openDashboard(child)} className="flex items-center gap-2 min-w-0 text-left group">
                                    <CornerDownRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                                    <span className="font-medium text-foreground truncate group-hover:text-primary">{child.name}</span>
                                    <span className="text-xs text-muted-foreground shrink-0">
                                      ({statementCounts.get(child.id) || 0} {t("statementsCountLabel")})
                                    </span>
                                  </button>
                                  {renderRowActions(child, false)}
                                </>
                              )}
                            </div>
                          ))}

                          <div className="flex gap-2 pl-6 pt-1">
                            <Input
                              placeholder={`${t("subCompanyPlaceholder")} ${root.name}`}
                              value={newSubNames[root.id] || ""}
                              onChange={(e) => setNewSubNames((prev) => ({ ...prev, [root.id]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter" && (newSubNames[root.id] || "").trim()) handleCreate(root.id); }}
                              className="bg-muted border-border text-foreground h-9 text-sm"
                            />
                            <Button
                              size="sm" variant="outline"
                              onClick={() => handleCreate(root.id)}
                              disabled={creatingFor === root.id || !(newSubNames[root.id] || "").trim()}
                              className="shrink-0 h-9"
                            >
                              {creatingFor === root.id ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                              {t("addSubCompany")}
                            </Button>
                          </div>

                          {isAdmin && companyUsers.length > 0 && (
                            <div className="pl-6 pt-3">
                              <p className="text-xs font-medium text-muted-foreground mb-1.5">{t("companyUsersLabel")}</p>
                              <div className="flex flex-wrap gap-2">
                                {companyUsers.map((u) => (
                                  <Button
                                    key={u.user_id}
                                    size="sm" variant="outline"
                                    className="h-7 text-xs"
                                    onClick={() => navigate("/history", { state: { userId: u.user_id } })}
                                    title={t("viewHistoryWord")}
                                  >
                                    <UserIcon className="h-3.5 w-3.5 mr-1" />
                                    {u.name || "—"}
                                    <CalendarRange className="h-3.5 w-3.5 ml-1.5 text-primary" />
                                  </Button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Clients;
