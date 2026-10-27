import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Building2, Calculator, CalendarRange, Check, Copy, Crown, Eye, EyeOff, Loader2, RefreshCw, Search, ShieldCheck, Trash2,
  User as UserIcon, UserCheck, UserPlus, Users,
} from "lucide-react";
import UserAvatar from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth, type AppRole } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { fetchClientNodes, type ClientNode } from "@/utils/clientTree";
import { STR, tr } from "@/utils/i18n";

interface UserRow {
  user_id: string;
  name: string;
  created_at: string;
  avatar_url?: string | null;
  reviewed_at: string | null;
  trial_ends_at: string | null;
  subscribed: boolean;
  designated_by: string | null;
}

const MIN_PASSWORD = 8;
const ROLES: AppRole[] = ["admin", "accountant", "user", "authorized"];
const PLAN_ACTIVATE = "activate";
const PLAN_DEACTIVATE = "deactivate";
const PLAN_EXTEND = "extend";

const generatePassword = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
};

/** Users & permissions. TaxForYou admins see everyone: role, clients, plan (trial / subscription),
 * and who is still "pending assignment" after signing up. Users and accountants get the same screen
 * scoped to the authorized users they designate. Every action is re-checked server-side. */
const Admin = () => {
  const { t, lang } = useLanguage();
  const isEnglish = lang === "en";
  const { user, isAdmin, canManageClients, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<Map<string, AppRole>>(new Map());
  const [emails, setEmails] = useState<Map<string, string>>(new Map());
  const [clients, setClients] = useState<ClientNode[]>([]);
  const [access, setAccess] = useState<Map<string, Set<string>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [onlyPending, setOnlyPending] = useState(searchParams.get("filter") === "pending");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Clients dialog
  const [clientsFor, setClientsFor] = useState<UserRow | null>(null);
  const [pickedClients, setPickedClients] = useState<Set<string>>(new Set());
  const [clientSearch, setClientSearch] = useState("");
  const [savingClients, setSavingClients] = useState(false);

  // Create-user dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(true);
  const [newRole, setNewRole] = useState<AppRole>("user");
  const [newClients, setNewClients] = useState<Set<string>>(new Set());
  const [newClientName, setNewClientName] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  useEffect(() => { setOnlyPending(searchParams.get("filter") === "pending"); }, [searchParams]);

  const roleLabel = (role: AppRole) =>
    tr(role === "admin" ? STR.roleAdmin : role === "accountant" ? STR.roleAccountant : role === "authorized" ? STR.roleAuthorized : STR.roleUser, isEnglish);
  const roleDesc = (role: AppRole) =>
    tr(role === "admin" ? STR.roleAdminDesc : role === "accountant" ? STR.roleAccountantDesc : role === "authorized" ? STR.roleAuthorizedDesc : STR.roleUserDesc, isEnglish);
  const roleIcon = (role: AppRole) => (role === "admin" ? Crown : role === "accountant" ? Calculator : role === "authorized" ? UserCheck : UserIcon);

  const fetchUsers = async () => {
    setLoading(true);
    const [{ data, error }, { data: roleRows }, nodes, { data: accounts }, { data: accessRows }] = await Promise.all([
      supabase.from("profiles").select("user_id, name, created_at, avatar_url, reviewed_at, trial_ends_at, subscribed, designated_by").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id, role"),
      fetchClientNodes(),
      supabase.rpc("admin_list_users"),
      supabase.from("client_access").select("client_id, user_id"),
    ]);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    const roleMap = new Map<string, AppRole>();
    (roleRows || []).forEach((r) => {
      const current = roleMap.get(r.user_id);
      const next = r.role as AppRole;
      if (!current || ROLES.indexOf(next) < ROLES.indexOf(current)) roleMap.set(r.user_id, next);
    });
    const accessMap = new Map<string, Set<string>>();
    (accessRows || []).forEach((a) => accessMap.set(a.user_id, new Set([...(accessMap.get(a.user_id) || []), a.client_id])));
    setRoles(roleMap);
    setAccess(accessMap);
    setEmails(new Map((accounts || []).map((a) => [a.user_id, a.email])));
    setClients(nodes.sort((a, b) => a.name.localeCompare(b.name)));
    const rows = (data as UserRow[]) || [];
    // A user or accountant only manages the authorized users they designated.
    setUsers(isAdmin ? rows : rows.filter((u) => u.designated_by === user?.id && u.user_id !== user?.id));
    setLoading(false);
  };

  useEffect(() => {
    if (!authLoading && user && canManageClients) fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, canManageClients, isAdmin]);

  const roleOf = (userId: string): AppRole => roles.get(userId) || "user";
  const isPending = (u: UserRow) => !u.reviewed_at && roleOf(u.user_id) !== "admin";
  const clientName = (id: string) => clients.find((c) => c.id === id)?.name || "—";
  const clientsOf = (userId: string) => [...(access.get(userId) || [])].map(clientName).sort((a, b) => a.localeCompare(b));

  const pendingCount = users.filter(isPending).length;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) =>
      (!onlyPending || isPending(u)) &&
      (!q ||
        (u.name || "").toLowerCase().includes(q) ||
        (emails.get(u.user_id) || "").toLowerCase().includes(q) ||
        clientsOf(u.user_id).some((c) => c.toLowerCase().includes(q)))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, emails, access, clients, search, onlyPending, roles]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || !canManageClients) {
    navigate("/analyze");
    return null;
  }

  const fail = (description: string) => toast({ title: "Error", description, variant: "destructive" });
  const markReviewed = (userId: string) =>
    setUsers((prev) => prev.map((x) => (x.user_id === userId ? { ...x, reviewed_at: x.reviewed_at ?? new Date().toISOString() } : x)));

  const planLabel = (u: UserRow) => {
    if (roleOf(u.user_id) === "admin") return { text: "—", tone: "muted" as const };
    if (u.subscribed) return { text: tr(STR.planSubscribed, isEnglish), tone: "good" as const };
    const msLeft = u.trial_ends_at ? new Date(u.trial_ends_at).getTime() - Date.now() : 0;
    if (msLeft > 0) return { text: tr(STR.planTrialLeft, isEnglish).replace("{h}", String(Math.max(1, Math.ceil(msLeft / 3_600_000)))), tone: "trial" as const };
    return { text: tr(STR.planExpired, isEnglish), tone: "bad" as const };
  };

  const handleRoleChange = async (u: UserRow, role: AppRole) => {
    if (role === roleOf(u.user_id)) return;
    setBusyId(u.user_id);
    const { error } = await supabase.rpc("admin_set_user_role", { _user_id: u.user_id, _role: role });
    setBusyId(null);
    if (error) { fail(error.message); return; }
    setRoles((prev) => {
      const next = new Map(prev);
      if (role === "user") next.delete(u.user_id);
      else next.set(u.user_id, role);
      return next;
    });
    markReviewed(u.user_id);
    toast({ title: "✅", description: `${u.name || emails.get(u.user_id)} → ${roleLabel(role)}` });
  };

  const handlePlan = async (u: UserRow, action: string) => {
    const subscribed = action === PLAN_ACTIVATE ? true : action === PLAN_DEACTIVATE ? false : u.subscribed;
    const trialEndsAt = action === PLAN_EXTEND
      ? new Date(Math.max(Date.now(), new Date(u.trial_ends_at || 0).getTime()) + 24 * 3_600_000).toISOString()
      : null;
    setBusyId(u.user_id);
    const { error } = await supabase.rpc("admin_set_user_plan", { _user_id: u.user_id, _subscribed: subscribed, _trial_ends_at: trialEndsAt });
    setBusyId(null);
    if (error) { fail(error.message); return; }
    setUsers((prev) => prev.map((x) => (x.user_id === u.user_id
      ? { ...x, subscribed, trial_ends_at: trialEndsAt ?? x.trial_ends_at, reviewed_at: x.reviewed_at ?? new Date().toISOString() }
      : x)));
    toast({ title: "✅", description: tr(STR.planUpdated, isEnglish) });
  };

  const openClients = (u: UserRow) => {
    setClientsFor(u);
    setPickedClients(new Set(access.get(u.user_id) || []));
    setClientSearch("");
  };

  const toggleIn = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const saveClients = async () => {
    if (!clientsFor) return;
    if (!isAdmin && pickedClients.size === 0) { fail(tr(STR.needOneClient, isEnglish)); return; }
    setSavingClients(true);
    const { error } = await supabase.rpc("set_user_clients", { _user_id: clientsFor.user_id, _client_ids: [...pickedClients] });
    setSavingClients(false);
    if (error) { fail(error.message); return; }
    setAccess((prev) => new Map(prev).set(clientsFor.user_id, new Set(pickedClients)));
    if (isAdmin) markReviewed(clientsFor.user_id);
    setClientsFor(null);
    toast({ title: t("userCompanyUpdated"), className: "border-primary text-primary" });
  };

  // Removes the login itself (admin_delete_user), not just the profile row.
  const handleDelete = async (u: UserRow) => {
    const label = u.name || emails.get(u.user_id) || "—";
    if (!window.confirm(tr(STR.confirmDeleteUser, isEnglish).replace("{name}", label))) return;
    setBusyId(u.user_id);
    const { error } = await supabase.rpc("admin_delete_user", { _user_id: u.user_id });
    setBusyId(null);
    if (error) { fail(error.message); return; }
    setUsers((prev) => prev.filter((x) => x.user_id !== u.user_id));
    toast({ title: t("userDeleted"), className: "border-primary text-primary" });
  };

  const openCreate = () => {
    setNewName("");
    setNewEmail("");
    setNewPassword(generatePassword());
    setShowPassword(true);
    setNewRole(isAdmin ? "user" : "authorized");
    setNewClients(new Set());
    setNewClientName("");
    setCreated(null);
    setCreateOpen(true);
  };

  const needsClients = newRole === "authorized" || !isAdmin;
  const canCreate =
    !!newEmail.trim() &&
    newPassword.length >= MIN_PASSWORD &&
    (!needsClients || newClients.size > 0 || !!newClientName.trim()) &&
    !creating;

  const handleCreate = async () => {
    if (!canCreate) return;
    setCreating(true);
    const clientIds = new Set(newClients);
    if (newRole !== "admin" && newClientName.trim()) {
      const { data: id, error } = await supabase.rpc("create_client", { _name: newClientName.trim() });
      if (error || !id) {
        setCreating(false);
        fail(error && /duplicate|unique|23505/i.test(`${error.message} ${error.code}`) ? t("clientDuplicateError") : error?.message || "—");
        return;
      }
      clientIds.add(id);
      setClients((prev) => [...prev, { id, name: newClientName.trim(), parent_id: null }].sort((a, b) => a.name.localeCompare(b.name)));
      setNewClients(clientIds);
      setNewClientName("");
    }
    const { error } = await supabase.rpc("admin_create_user", {
      _email: newEmail.trim(),
      _password: newPassword,
      _name: newName.trim(),
      _role: newRole,
      _client_ids: newRole === "admin" ? [] : [...clientIds],
    });
    setCreating(false);
    if (error) { fail(error.message); return; }
    setCreated({ email: newEmail.trim().toLowerCase(), password: newPassword });
    fetchUsers();
  };

  const visibleClients = clients.filter((c) => !clientSearch.trim() || c.name.toLowerCase().includes(clientSearch.trim().toLowerCase()));

  const renderClientChecklist = (picked: Set<string>, onToggle: (id: string) => void) => (
    <div className="max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border/50">
      {visibleClients.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground text-center">
          {clients.length === 0 ? tr(STR.noClientsToShare, isEnglish) : t("noClientsYet")}
        </p>
      ) : (
        visibleClients.map((c) => (
          <label key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40">
            <input type="checkbox" checked={picked.has(c.id)} onChange={() => onToggle(c.id)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
            <span className="truncate">{c.name}</span>
          </label>
        ))
      )}
    </div>
  );

  const toneClass = {
    good: "border-primary/40 bg-primary/10 text-primary",
    trial: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    bad: "border-destructive/40 bg-destructive/10 text-destructive",
    muted: "border-border text-muted-foreground",
  };

  return (
    <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-6xl w-full mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center neon-glow">
            {isAdmin ? <ShieldCheck className="h-6 w-6 text-primary" /> : <Users className="h-6 w-6 text-primary" />}
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
              {tr(isAdmin ? STR.usersAndPermissionsNav : STR.authorizedUsersNav, isEnglish)}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isAdmin ? `${users.length} ${t("allUsers").toLowerCase()}` : tr(STR.authorizedUsersDesc, isEnglish)}
            </p>
          </div>
        </div>
        <Button onClick={openCreate} className="neon-glow">
          <UserPlus className="h-4 w-4 mr-1" />
          {tr(isAdmin ? STR.createUserButton : STR.createAuthorizedButton, isEnglish)}
        </Button>
      </div>

      {isAdmin && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {ROLES.map((role) => {
            const Icon = roleIcon(role);
            return (
              <Card key={role} className="bg-card border-border/60">
                <CardContent className="p-4">
                  <p className="font-semibold text-foreground flex items-center gap-2 text-sm">
                    <Icon className="h-4 w-4 text-primary" /> {roleLabel(role)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{roleDesc(role)}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="neon-border bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="flex items-center gap-2 text-foreground text-base mr-2">
                <Users className="h-5 w-5 text-primary" />
                {t("allUsers")}
              </CardTitle>
              {isAdmin && (
                <div className="flex items-center rounded-lg border border-border p-0.5" role="group">
                  <button type="button" onClick={() => setOnlyPending(false)}
                    className={`px-2.5 py-1 text-xs rounded-md ${!onlyPending ? "bg-primary/15 text-primary font-semibold" : "text-muted-foreground"}`}>
                    {tr(STR.filterAllUsers, isEnglish)}
                  </button>
                  <button type="button" onClick={() => setOnlyPending(true)}
                    className={`px-2.5 py-1 text-xs rounded-md ${onlyPending ? "bg-primary/15 text-primary font-semibold" : "text-muted-foreground"}`}>
                    {tr(STR.filterPendingUsers, isEnglish)} ({pendingCount})
                  </button>
                </div>
              )}
            </div>
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={tr(STR.searchUsersPlaceholder, isEnglish)}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-muted border-border text-foreground h-9 text-sm"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          ) : filtered.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{isAdmin ? t("noUsers") : tr(STR.noAuthorizedUsers, isEnglish)}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-3 text-muted-foreground font-medium">{t("name")}</th>
                    {isAdmin && <th className="text-left py-3 px-3 text-muted-foreground font-medium">{tr(STR.roleColumn, isEnglish)}</th>}
                    <th className="text-left py-3 px-3 text-muted-foreground font-medium">{t("userCompanyColumn")}</th>
                    {isAdmin && <th className="text-left py-3 px-3 text-muted-foreground font-medium">{tr(STR.planColumn, isEnglish)}</th>}
                    <th className="text-left py-3 px-3 text-muted-foreground font-medium hidden lg:table-cell">{t("joined")}</th>
                    <th className="text-right py-3 px-3 text-muted-foreground font-medium">{t("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => {
                    const role = roleOf(u.user_id);
                    const isMe = u.user_id === user.id;
                    const busy = busyId === u.user_id;
                    const plan = planLabel(u);
                    const userClients = clientsOf(u.user_id);
                    return (
                      <tr key={u.user_id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <UserAvatar name={u.name} url={u.avatar_url} className="w-9 h-9" />
                            <div className="min-w-0">
                              <p className="font-medium text-foreground">
                                {u.name || "—"}
                                {isMe && <span className="ml-1 text-xs text-muted-foreground">({tr(STR.youWord, isEnglish)})</span>}
                              </p>
                              {emails.get(u.user_id) && <p className="text-xs text-muted-foreground">{emails.get(u.user_id)}</p>}
                              {isAdmin && isPending(u) && (
                                <span className="inline-block mt-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                                  {tr(STR.pendingBadge, isEnglish)}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        {isAdmin && (
                          <td className="py-3 px-3">
                            {isMe ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                                <Crown className="h-3 w-3" /> {roleLabel(role)}
                              </span>
                            ) : (
                              <Select value={role} onValueChange={(v) => handleRoleChange(u, v as AppRole)} disabled={busy}>
                                <SelectTrigger className="h-8 w-44 text-xs">
                                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SelectValue />}
                                </SelectTrigger>
                                <SelectContent>
                                  {ROLES.map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            )}
                          </td>
                        )}
                        <td className="py-3 px-3">
                          {role === "admin" ? (
                            <span className="text-muted-foreground text-xs">{tr(STR.adminSeesAllClients, isEnglish)}</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openClients(u)}
                              className="group flex items-center gap-1.5 text-left text-xs max-w-[220px]"
                              title={tr(STR.editClientsButton, isEnglish)}
                            >
                              <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
                              <span className={`truncate group-hover:text-primary ${userClients.length ? "text-foreground" : "text-muted-foreground"}`}>
                                {userClients.length ? userClients.join(", ") : t("noCompanyOption")}
                              </span>
                            </button>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="py-3 px-3">
                            {role === "admin" ? (
                              <span className="text-muted-foreground text-xs">—</span>
                            ) : (
                              <Select value="" onValueChange={(v) => handlePlan(u, v)} disabled={busy}>
                                <SelectTrigger className={`h-7 w-auto gap-1 rounded-full border px-2 text-[11px] font-semibold ${toneClass[plan.tone]}`}>
                                  <SelectValue placeholder={plan.text} />
                                </SelectTrigger>
                                <SelectContent>
                                  {!u.subscribed && <SelectItem value={PLAN_ACTIVATE}>{tr(STR.planActivate, isEnglish)}</SelectItem>}
                                  {u.subscribed && <SelectItem value={PLAN_DEACTIVATE}>{tr(STR.planDeactivate, isEnglish)}</SelectItem>}
                                  <SelectItem value={PLAN_EXTEND}>{tr(STR.planExtend, isEnglish)}</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          </td>
                        )}
                        <td className="py-3 px-3 text-muted-foreground hidden lg:table-cell">
                          {new Date(u.created_at).toLocaleDateString(isEnglish ? "en-US" : "es-CO")}
                        </td>
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          {isAdmin && (
                            <Button variant="ghost" size="sm"
                              onClick={() => navigate("/history", { state: { userId: u.user_id } })}
                              title={t("viewHistoryWord")}
                              className="text-primary hover:text-primary hover:bg-primary/10">
                              <CalendarRange className="h-4 w-4" />
                            </Button>
                          )}
                          {!isMe && (
                            <Button variant="ghost" size="sm"
                              onClick={() => handleDelete(u)}
                              disabled={busy}
                              title={tr(STR.deleteUserTitle, isEnglish)}
                              className="text-destructive hover:text-destructive hover:bg-destructive/10">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Which clients a person works with */}
      <Dialog open={!!clientsFor} onOpenChange={(open) => { if (!open) setClientsFor(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              {tr(STR.assignClientsTitle, isEnglish).replace("{name}", clientsFor?.name || emails.get(clientsFor?.user_id || "") || "—")}
            </DialogTitle>
            <DialogDescription>{tr(STR.assignClientsDesc, isEnglish)}</DialogDescription>
          </DialogHeader>
          {clients.length > 6 && (
            <Input value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} placeholder={t("searchClientsPlaceholder")} className="h-9 text-sm" />
          )}
          {renderClientChecklist(pickedClients, (id) => setPickedClients((prev) => toggleIn(prev, id)))}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setClientsFor(null)} disabled={savingClients}>{tr(STR.cancelWord, isEnglish)}</Button>
            <Button onClick={saveClients} disabled={savingClients}>
              {savingClients ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
              {tr(STR.saveWord, isEnglish)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              {tr(isAdmin ? STR.createUserButton : STR.createAuthorizedButton, isEnglish)}
            </DialogTitle>
            <DialogDescription>{tr(STR.createUserDesc, isEnglish)}</DialogDescription>
          </DialogHeader>

          {created ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-2">
                <p className="font-semibold text-primary flex items-center gap-2"><Check className="h-4 w-4" /> {tr(STR.userCreatedTitle, isEnglish)}</p>
                <p className="text-sm text-foreground">{t("email")}: <span className="font-mono">{created.email}</span></p>
                <p className="text-sm text-foreground">{tr(STR.newPasswordLabel, isEnglish)}: <span className="font-mono">{created.password}</span></p>
                <Button size="sm" variant="outline"
                  onClick={() => navigator.clipboard?.writeText(`${window.location.origin}\n${created.email}\n${created.password}`)}>
                  <Copy className="h-3.5 w-3.5 mr-1" /> {tr(STR.copyAccessData, isEnglish)}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{tr(STR.userCreatedHint, isEnglish)}</p>
              <DialogFooter>
                <Button onClick={() => setCreateOpen(false)}>{tr(STR.doneWord, isEnglish)}</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground">{t("name")}</label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Luisa Ospina" />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground">{t("email")}</label>
                <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="nombre@correo.com" autoComplete="off" />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground">{tr(STR.initialPasswordLabel, isEnglish)}</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      autoComplete="new-password"
                      className="pr-9 font-mono"
                    />
                    <button type="button" onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="show password">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <Button type="button" variant="outline" size="icon" title={tr(STR.generatePasswordTitle, isEnglish)}
                    onClick={() => { setNewPassword(generatePassword()); setShowPassword(true); }}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
                {newPassword.length > 0 && newPassword.length < MIN_PASSWORD && (
                  <p className="text-xs text-destructive">{tr(STR.passwordTooShort, isEnglish)}</p>
                )}
              </div>
              {isAdmin && (
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground">{tr(STR.roleColumn, isEnglish)}</label>
                  <Select value={newRole} onValueChange={(v) => setNewRole(v as AppRole)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{roleDesc(newRole)}</p>
                </div>
              )}
              {newRole !== "admin" && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground flex items-center gap-1">
                    <Building2 className="h-4 w-4 text-primary" /> {tr(isAdmin ? STR.pickClientsPlaceholder : STR.shareClientsLabel, isEnglish)}
                  </label>
                  {renderClientChecklist(newClients, (id) => setNewClients((prev) => toggleIn(prev, id)))}
                  <Input
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    placeholder={`${tr(STR.newClientOption, isEnglish)} — ${t("clientNamePlaceholder")}`}
                    maxLength={150}
                    className="text-sm"
                  />
                  {needsClients && newClients.size === 0 && !newClientName.trim() && (
                    <p className="text-xs text-muted-foreground">{tr(STR.needOneClient, isEnglish)}</p>
                  )}
                </div>
              )}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>{tr(STR.cancelWord, isEnglish)}</Button>
                <Button onClick={handleCreate} disabled={!canCreate}>
                  {creating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <UserPlus className="h-4 w-4 mr-1" />}
                  {tr(isAdmin ? STR.createUserButton : STR.createAuthorizedButton, isEnglish)}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
};

export default Admin;
