import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Plus, Pencil, Trash2, Check, X, Building2, Search, Crown, LayoutDashboard, User as UserIcon,
} from "lucide-react";
import { fetchClientNodes, type ClientNode } from "@/utils/clientTree";
import { STR, tr } from "@/utils/i18n";

const isDuplicateError = (message: string) => /duplicate|unique|23505/i.test(message);

/** Every client the signed-in person works with (RLS scopes it: TaxForYou admins see all, everyone
 * else the clients they created or were given). Users and accountants add, rename and delete their
 * clients here; authorized users only open the ones shared with them. */
const Clients = () => {
  const { t, lang } = useLanguage();
  const isEnglish = lang === "en";
  const { user, isAdmin, canManageClients, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [nodes, setNodes] = useState<ClientNode[]>([]);
  const [statementCounts, setStatementCounts] = useState<Map<string, number>>(new Map());
  const [members, setMembers] = useState<Map<string, string[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    const [clientRows, { data: analysisRows }, { data: accessRows }, { data: profileRows }] = await Promise.all([
      fetchClientNodes(),
      supabase.from("analyses").select("client_id"),
      supabase.from("client_access").select("client_id, user_id"),
      supabase.from("profiles").select("user_id, name"),
    ]);
    const counts = new Map<string, number>();
    (analysisRows || []).forEach((r: { client_id: string | null }) => {
      if (r.client_id) counts.set(r.client_id, (counts.get(r.client_id) || 0) + 1);
    });
    // Who works with each client — only the names this person may see (admins: everyone).
    const names = new Map((profileRows || []).map((p) => [p.user_id, p.name || ""]));
    const byClient = new Map<string, string[]>();
    (accessRows || []).forEach((a) => {
      if (a.user_id === user?.id) return;
      const name = names.get(a.user_id);
      if (name) byClient.set(a.client_id, [...(byClient.get(a.client_id) || []), name]);
    });
    setNodes(clientRows);
    setStatementCounts(counts);
    setMembers(byClient);
    setLoading(false);
  };

  useEffect(() => {
    if (!authLoading && user) fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return nodes
      .filter((n) => !q || n.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [nodes, search]);

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

  const fail = (description: string) => toast({ title: "Error", description, variant: "destructive" });

  // Always clickable: an empty name or a duplicate gets a clear message instead of a dead button.
  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) { fail(t("clientNameEmptyError")); return; }
    if (nodes.some((n) => n.name.trim().toLowerCase() === name.toLowerCase())) { fail(t("clientDuplicateError")); return; }
    setCreating(true);
    const { data: id, error } = await supabase.rpc("create_client", { _name: name });
    setCreating(false);
    if (error || !id) {
      fail(error && isDuplicateError(`${error.message} ${error.code}`) ? t("clientDuplicateError") : error?.message || "—");
      return;
    }
    setNodes((prev) => [...prev, { id, name, parent_id: null }]);
    setNewName("");
    toast({ title: "✅", description: `${t("clientCreated")} — ${name}` });
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
    if (!name) { fail(t("clientNameEmptyError")); return; }
    setSaving(true);
    const { data, error } = await supabase.from("clients").update({ name }).eq("id", id).select("id");
    setSaving(false);
    if (error || !data?.length) {
      fail(error && isDuplicateError(`${error.message} ${error.code}`) ? t("clientDuplicateError") : error?.message || "—");
      return;
    }
    setNodes((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
    toast({ title: "✅", description: t("clientRenamed") });
    cancelEdit();
  };

  /** Deletes the client with its statements, receipts and saved reports. Files go first through the
   * Storage API (storage can't be cleaned from SQL), then admin_delete_client removes every row. */
  const handleDelete = async (client: ClientNode) => {
    const ids = [client.id, ...nodes.filter((n) => n.parent_id === client.id).map((n) => n.id)];
    const statements = ids.reduce((sum, id) => sum + (statementCounts.get(id) || 0), 0);
    const message = tr(STR.confirmDeleteCompany, isEnglish)
      .replace("{name}", client.name)
      .replace("{subs}", String(ids.length - 1))
      .replace("{statements}", String(statements));
    if (!window.confirm(message)) return;

    setDeletingId(client.id);
    const [{ data: reportRows }, { data: receiptRows }] = await Promise.all([
      supabase.from("reports").select("storage_path").in("client_id", ids),
      supabase.from("receipts").select("storage_path").in("client_id", ids),
    ]);
    const reportPaths = (reportRows || []).map((r) => r.storage_path).filter(Boolean);
    const receiptPaths = (receiptRows || []).map((r) => r.storage_path).filter(Boolean);
    if (reportPaths.length > 0) await supabase.storage.from("reports").remove(reportPaths);
    if (receiptPaths.length > 0) await supabase.storage.from("receipts").remove(receiptPaths);

    const { data, error } = await supabase.rpc("admin_delete_client", { _client_id: client.id });
    setDeletingId(null);
    if (error) { fail(error.message); return; }
    const removed = new Set(ids);
    setNodes((prev) => prev.filter((c) => !removed.has(c.id)));
    const deletedStatements = (data as { statements?: number } | null)?.statements ?? statements;
    toast({ title: "✅", description: tr(STR.companyDeletedSummary, isEnglish).replace("{statements}", String(deletedStatements)) });
  };

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

        {canManageClients && (
          <Card className="neon-border bg-card shadow-2xl mb-6 opacity-0 animate-scale-in stagger-2">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  placeholder={t("clientNamePlaceholder")}
                  value={newName}
                  maxLength={150}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
                  className="bg-muted border-border text-foreground"
                />
                <Button onClick={handleCreate} disabled={creating} className="neon-glow shrink-0">
                  {creating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                  {t("addClient")}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="neon-border bg-card shadow-2xl opacity-0 animate-slide-up stagger-3">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <CardTitle className="flex items-center gap-2 text-foreground">
                {isAdmin ? <Crown className="h-5 w-5 text-primary" /> : <Building2 className="h-5 w-5 text-primary" />}
                {isAdmin ? "TaxForYou" : t("clientsPageTitle")}
                <span className="text-xs font-normal text-muted-foreground">
                  {isAdmin && `${t("ownerCaption")} · `}{nodes.length} {t("customerCompaniesWord")}
                </span>
              </CardTitle>
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
            ) : shown.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                {!canManageClients && !search.trim() ? tr(STR.noClientsShared, isEnglish) : t("noClientsYet")}
              </p>
            ) : (
              <div className="space-y-2">
                {shown.map((client, i) => (
                  <div
                    key={client.id}
                    className="rounded-lg border border-border/60 bg-muted/20 opacity-0 animate-fade-in"
                    style={{ animationDelay: `${0.03 * i}s` }}
                  >
                    <div className="flex items-center justify-between gap-3 p-3">
                      {editingId === client.id ? (
                        <>
                          <Input
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleSaveEdit(client.id); if (e.key === "Escape") cancelEdit(); }}
                            autoFocus
                            maxLength={150}
                            className="bg-muted border-border text-foreground h-9"
                          />
                          <div className="flex items-center gap-1 shrink-0">
                            <Button size="sm" variant="ghost" disabled={saving} onClick={() => handleSaveEdit(client.id)}
                              className="text-primary hover:text-primary hover:bg-primary/10">
                              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            </Button>
                            <Button size="sm" variant="ghost" disabled={saving} onClick={cancelEdit} className="text-muted-foreground">
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={() => navigate(`/clients/${client.id}`)} className="flex items-center gap-2 min-w-0 text-left group">
                            <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                              {client.name[0]?.toUpperCase() || "?"}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-foreground truncate group-hover:text-primary">{client.name}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {statementCounts.get(client.id) || 0} {t("statementsCountLabel")}
                                {(members.get(client.id) || []).length > 0 && (
                                  <span className="inline-flex items-center gap-1 ml-1.5">
                                    · <UserIcon className="h-3 w-3" /> {(members.get(client.id) || []).join(", ")}
                                  </span>
                                )}
                              </p>
                            </div>
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              size="sm" variant="outline"
                              onClick={() => navigate(`/clients/${client.id}`)}
                              className="text-primary hover:text-primary hover:bg-primary/10"
                            >
                              <LayoutDashboard className="h-4 w-4 sm:mr-1" />
                              <span className="hidden sm:inline">{tr(STR.openCompany, isEnglish)}</span>
                            </Button>
                            {canManageClients && (
                              <>
                                <Button size="sm" variant="ghost" onClick={() => startEdit(client)}
                                  className="text-muted-foreground hover:text-primary hover:bg-primary/10">
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm" variant="ghost"
                                  disabled={deletingId === client.id}
                                  onClick={() => handleDelete(client)}
                                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                >
                                  {deletingId === client.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                </Button>
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Clients;
