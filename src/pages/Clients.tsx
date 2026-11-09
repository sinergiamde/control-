import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Plus, Pencil, Trash2, Check, X, Building2, Search, Crown, LayoutDashboard, User as UserIcon, Mail, Phone, ChevronRight,
} from "lucide-react";
import { fetchClientNodes, type ClientNode } from "@/utils/clientTree";
import { STR, tr } from "@/utils/i18n";

const isDuplicateError = (message: string) => /duplicate|unique|23505/i.test(message);

interface ClientDetails {
  company: string | null;
  email: string | null;
  phone: string | null;
}
const EMPTY_FORM = { name: "", company: "", email: "", phone: "" };
const NEW_COMPANY = "__new__";
const NO_COMPANY = "__none__";

/** Every client the signed-in person works with (RLS scopes it: TaxForYou admins see all, everyone
 * else the clients they created or were given). Users and accountants add, rename and delete their
 * clients here; authorized users only open the ones shared with them. */
const Clients = () => {
  const { t, lang } = useLanguage();
  const isEnglish = lang === "en";
  const { user, isAdmin, canManageClients, permissions, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [nodes, setNodes] = useState<ClientNode[]>([]);
  const [statementCounts, setStatementCounts] = useState<Map<string, number>>(new Map());
  const [members, setMembers] = useState<Map<string, string[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [details, setDetails] = useState<Map<string, ClientDetails>>(new Map());
  const [creating, setCreating] = useState(false);
  const [companyChoice, setCompanyChoice] = useState<string>(NO_COMPANY);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    const [clientRows, { data: analysisRows }, { data: accessRows }, { data: profileRows }, { data: detailRows }] = await Promise.all([
      fetchClientNodes(),
      supabase.from("analyses").select("client_id"),
      supabase.from("client_access").select("client_id, user_id"),
      supabase.from("profiles").select("user_id, name"),
      // Kept apart from the main list so the page still works on a database without these columns.
      supabase.from("clients").select("id, company, email, phone"),
    ]);
    setDetails(new Map(((detailRows as (ClientDetails & { id: string })[]) || []).map((d) => [d.id, d])));
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

  const companyOf = (id: string) => details.get(id)?.company?.trim() || "";
  const companies = useMemo(
    () => Array.from(new Set(nodes.map((n) => (details.get(n.id)?.company || "").trim()).filter(Boolean))).sort((x, y) => x.localeCompare(y)),
    [nodes, details]
  );

  // Clients grouped by the company they belong to; searching matches the client or its company.
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, ClientNode[]>();
    nodes
      .filter((n) => !q || n.name.toLowerCase().includes(q) || companyOf(n.id).toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((n) => map.set(companyOf(n.id), [...(map.get(companyOf(n.id)) || []), n]));
    // Named companies A–Z first, clients without a company last.
    return Array.from(map.entries()).sort(([x], [y]) => (x === "" ? 1 : y === "" ? -1 : x.localeCompare(y)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, details, search]);
  const shownCount = groups.reduce((sum, [, list]) => sum + list.length, 0);

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

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setCompanyChoice(companies.length > 0 ? NO_COMPANY : NEW_COMPANY);
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    const name = form.name.trim();
    const email = form.email.trim();
    if (!name) { fail(t("clientNameEmptyError")); return; }
    if (email && !/^\S+@\S+\.\S+$/.test(email)) { fail(tr(STR.clientEmailInvalid, isEnglish)); return; }
    if (nodes.some((n) => n.name.trim().toLowerCase() === name.toLowerCase())) { fail(t("clientDuplicateError")); return; }
    const company = companyChoice === NEW_COMPANY ? form.company.trim() : companyChoice === NO_COMPANY ? "" : companyChoice;
    setCreating(true);
    const { data: id, error } = await supabase.rpc("create_client", {
      _name: name, _company: company || null, _email: email || null, _phone: form.phone.trim() || null,
    });
    setCreating(false);
    if (error || !id) {
      // PGRST202 / 42883: the database doesn't have the newer create_client yet.
      const missing = error && /PGRST202|42883|schema cache|could not find the function/i.test(`${error.code} ${error.message}`);
      fail(
        missing ? tr(STR.dbUpdateNeeded, isEnglish)
          : error && isDuplicateError(`${error.message} ${error.code}`) ? t("clientDuplicateError")
          : error?.message || "—"
      );
      return;
    }
    setNodes((prev) => [...prev, { id, name, parent_id: null }]);
    setDetails((prev) => new Map(prev).set(id, { company: company || null, email: email || null, phone: form.phone.trim() || null }));
    setOpenGroups((prev) => new Set(prev).add(company));
    setCreateOpen(false);
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

  const renderClient = (client: ClientNode, i: number) => (
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
                    {details.get(client.id)?.email && (
                      <span className="inline-flex items-center gap-1 ml-1.5">· <Mail className="h-3 w-3" /> {details.get(client.id)?.email}</span>
                    )}
                    {details.get(client.id)?.phone && (
                      <span className="inline-flex items-center gap-1 ml-1.5">· <Phone className="h-3 w-3" /> {details.get(client.id)?.phone}</span>
                    )}
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
                    {permissions.delete && (
                      <Button
                        size="sm" variant="ghost"
                        disabled={deletingId === client.id}
                        onClick={() => handleDelete(client)}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        {deletingId === client.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto w-full">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-6 opacity-0 animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <Building2 className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{t("clientsPageTitle")}</h1>
              <p className="text-sm text-muted-foreground">{t("clientsPageDesc")}</p>
            </div>
          </div>
          {canManageClients && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" />
              {t("addClient")}
            </Button>
          )}
        </div>

        <Card className="neon-border bg-card shadow-2xl opacity-0 animate-slide-up stagger-3">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <CardTitle className="flex items-center gap-2 text-foreground">
                {isAdmin ? <Crown className="h-5 w-5 text-primary" /> : <Building2 className="h-5 w-5 text-primary" />}
                {isAdmin ? "TaxForYou" : t("clientsPageTitle")}
                <span className="text-xs font-normal text-muted-foreground">
                  {isAdmin && `${t("ownerCaption")} · `}{nodes.length} {t("customerCompaniesWord")} · {companies.length} {tr(STR.companiesWord, isEnglish)}
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
            ) : shownCount === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                {!canManageClients && !search.trim() ? tr(STR.noClientsShared, isEnglish) : t("noClientsYet")}
              </p>
            ) : (
              <div className="space-y-2">
                {groups.map(([company, list]) => {
                  const open = openGroups.has(company) || !!search.trim() || groups.length === 1;
                  const statements = list.reduce((sum, c) => sum + (statementCounts.get(c.id) || 0), 0);
                  return (
                    <div key={company || NO_COMPANY} className="rounded-xl border border-border bg-card overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setOpenGroups((prev) => { const next = new Set(prev); if (next.has(company)) next.delete(company); else next.add(company); return next; })}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                      >
                        <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
                        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Building2 className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-foreground truncate">{company || tr(STR.noCompanyGroup, isEnglish)}</p>
                          <p className="text-xs text-muted-foreground">
                            {list.length} {t("customerCompaniesWord")} · {statements} {t("statementsCountLabel")}
                          </p>
                        </div>
                      </button>
                      {open && (
                        <div className="border-t border-border/60 p-2 space-y-1.5 bg-muted/10">
                          {list.map((client, i) => renderClient(client, i))}
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

      <Dialog open={createOpen} onOpenChange={(open) => { if (!creating) setCreateOpen(open); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              {tr(STR.newClientTitle, isEnglish)}
            </DialogTitle>
            <DialogDescription>{tr(STR.newClientDesc, isEnglish)}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => { e.preventDefault(); handleCreate(); }}
          >
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">{tr(STR.clientNameLabel, isEnglish)} *</label>
              <Input maxLength={150} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("clientNamePlaceholder")} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">{tr(STR.clientCompanyLabel, isEnglish)}</label>
              <Select value={companyChoice} onValueChange={setCompanyChoice}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_COMPANY}>{tr(STR.noCompanyGroup, isEnglish)}</SelectItem>
                  {companies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  <SelectItem value={NEW_COMPANY}>{tr(STR.newCompanyOption2, isEnglish)}</SelectItem>
                </SelectContent>
              </Select>
              {companyChoice === NEW_COMPANY && (
                <Input
                  autoFocus maxLength={150} value={form.company}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}
                  placeholder={tr(STR.clientCompanyPlaceholder, isEnglish)} className="mt-2"
                />
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground">{tr(STR.clientEmailLabel, isEnglish)}</label>
                <Input type="email" maxLength={150} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="cliente@correo.com" />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground">{tr(STR.clientPhoneLabel, isEnglish)}</label>
                <Input type="tel" inputMode="tel" maxLength={40} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 305 555 1234" />
              </div>
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>{t("cancelWord")}</Button>
              <Button type="submit" disabled={creating}>
                {creating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                {tr(STR.saveClientButton, isEnglish)}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Clients;
