import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Loader2, Lock, Search } from "lucide-react";
import UserAvatar from "@/components/UserAvatar";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth, type AppRole } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { STR, tr } from "@/utils/i18n";

interface Row {
  user_id: string;
  name: string;
  avatar_url: string | null;
}

type PermKey = "analyze" | "receipts" | "clients" | "delete" | "designate" | "admin";

/** What each role can do by default. An admin can switch any single permission on or off for one
 * person (stored as an override); the database enforces the result, not just this screen. */
const PERMISSIONS: Record<PermKey, Record<AppRole, boolean>> = {
  analyze:   { admin: true, accountant: true, user: true, authorized: true },
  receipts:  { admin: true, accountant: true, user: true, authorized: true },
  clients:   { admin: true, accountant: true, user: true, authorized: false },
  delete:    { admin: true, accountant: true, user: true, authorized: false },
  designate: { admin: true, accountant: true, user: true, authorized: false },
  admin:     { admin: true, accountant: false, user: false, authorized: false },
};
const PERM_ORDER: PermKey[] = ["analyze", "receipts", "clients", "delete", "designate", "admin"];
const PERM_LABEL: Record<PermKey, keyof typeof STR> = {
  analyze: "permAnalyze", receipts: "permReceipts", clients: "permClients",
  delete: "permDelete", designate: "permDesignate", admin: "permAdmin",
};
const ROLES: AppRole[] = ["admin", "accountant", "user", "authorized"];

const Box = ({ on, locked, busy, changed, onToggle, title }: {
  on: boolean; locked?: boolean; busy?: boolean; changed?: boolean; onToggle?: () => void; title?: string;
}) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={on}
    disabled={locked || busy}
    onClick={onToggle}
    title={title}
    className={`inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors ${
      locked
        ? "border-border bg-muted/60 text-muted-foreground/50 cursor-not-allowed"
        : on
        ? "border-primary bg-primary text-primary-foreground hover:brightness-110"
        : "border-border bg-card hover:border-primary/60"
    } ${changed ? "ring-2 ring-primary/30 ring-offset-1 ring-offset-card" : ""}`}
  >
    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : on && <Check className="h-4 w-4" strokeWidth={3} />}
  </button>
);

/** Roles & permissions matrix: one row per person, one column per capability. */
const Permissions = () => {
  const { lang } = useLanguage();
  const isEnglish = lang === "en";
  const { user, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [roles, setRoles] = useState<Map<string, AppRole>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [busyBox, setBusyBox] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !isAdmin) { navigate("/analyze"); return; }
    (async () => {
      const [{ data: profiles }, { data: roleRows }, { data: overrideRows }] = await Promise.all([
        supabase.from("profiles").select("user_id, name, avatar_url").order("name"),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("user_permissions").select("user_id, permission, granted"),
      ]);
      setOverrides(new Map((overrideRows || []).map((o) => [`${o.user_id}:${o.permission}`, o.granted])));
      const map = new Map<string, AppRole>();
      (roleRows || []).forEach((r) => {
        const next = r.role as AppRole;
        const cur = map.get(r.user_id);
        if (!cur || ROLES.indexOf(next) < ROLES.indexOf(cur)) map.set(r.user_id, next);
      });
      setRoles(map);
      setRows((profiles as Row[]) || []);
      setLoading(false);
    })();
  }, [authLoading, user, isAdmin, navigate]);

  const roleOf = (id: string): AppRole => roles.get(id) || "user";
  const effective = (id: string, k: PermKey) => overrides.get(`${id}:${k}`) ?? PERMISSIONS[k][roleOf(id)];

  const togglePermission = async (row: Row, k: PermKey) => {
    const key = `${row.user_id}:${k}`;
    const next = !effective(row.user_id, k);
    setBusyBox(key);
    const { error } = await supabase.rpc("admin_set_permission", { _user_id: row.user_id, _perm: k, _granted: next });
    setBusyBox(null);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setOverrides((prev) => {
      const map = new Map(prev);
      // Matching the role's default means no override is stored.
      if (next === PERMISSIONS[k][roleOf(row.user_id)]) map.delete(key);
      else map.set(key, next);
      return map;
    });
    toast({ title: "✅", description: `${row.name || "—"} · ${tr(STR[PERM_LABEL[k]], isEnglish)}: ${next ? "✔" : "✖"}` });
  };
  const roleLabel = (r: AppRole) =>
    tr(r === "admin" ? STR.roleAdmin : r === "accountant" ? STR.roleAccountant : r === "authorized" ? STR.roleAuthorized : STR.roleUser, isEnglish);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => !q || (r.name || "").toLowerCase().includes(q));
  }, [rows, search]);

  const changeRole = async (row: Row, role: AppRole) => {
    if (role === roleOf(row.user_id)) return;
    setBusyId(row.user_id);
    const { error } = await supabase.rpc("admin_set_user_role", { _user_id: row.user_id, _role: role });
    setBusyId(null);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setRoles((prev) => {
      const next = new Map(prev);
      if (role === "user") next.delete(row.user_id);
      else next.set(row.user_id, role);
      return next;
    });
    // A role change starts again from that role's defaults.
    setOverrides((prev) => new Map([...prev].filter(([key]) => !key.startsWith(`${row.user_id}:`))));
    toast({ title: "✅", description: `${row.name || "—"} → ${roleLabel(role)}` });
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-6xl w-full mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate("/admin")} className="h-9 w-9 rounded-lg border border-border bg-card flex items-center justify-center hover:bg-muted" aria-label="back">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
            <Lock className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{tr(STR.hubRolesTitle, isEnglish)}</h1>
            <p className="text-sm text-muted-foreground">{tr(STR.permissionsPageDesc, isEnglish)}</p>
          </div>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr(STR.searchPeoplePlaceholder, isEnglish)} className="pl-9 h-9 text-sm" />
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-[0_1px_2px_hsl(0_0%_0%/0.06)]">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-5 py-3 min-w-[220px]">{tr(STR.personColumn, isEnglish)}</th>
                {PERM_ORDER.map((k) => (
                  <th key={k} className="px-3 py-3 text-center min-w-[110px] font-semibold leading-tight">{tr(STR[PERM_LABEL[k]], isEnglish)}</th>
                ))}
                <th className="text-left px-5 py-3 min-w-[190px]">{tr(STR.roleColumn, isEnglish)}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const role = roleOf(r.user_id);
                const isMe = r.user_id === user?.id;
                return (
                  <tr key={r.user_id} className="border-b border-border/60 last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <UserAvatar name={r.name} url={r.avatar_url} className="w-9 h-9" />
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground truncate">
                            {r.name || "—"}{isMe && <span className="ml-1 text-xs font-normal text-muted-foreground">({tr(STR.youWord, isEnglish)})</span>}
                          </p>
                          <p className="text-xs text-muted-foreground">{roleLabel(role)}</p>
                        </div>
                      </div>
                    </td>
                    {role === "admin" ? (
                      <td colSpan={PERM_ORDER.length} className="px-3 py-3.5 text-center text-muted-foreground">
                        {tr(STR.adminHasAll, isEnglish)}
                      </td>
                    ) : (
                      PERM_ORDER.map((k) => (
                        <td key={k} className="px-3 py-3.5 text-center">
                          <Box
                            on={effective(r.user_id, k)}
                            locked={k === "admin"}
                            busy={busyBox === `${r.user_id}:${k}`}
                            changed={overrides.has(`${r.user_id}:${k}`)}
                            onToggle={() => togglePermission(r, k)}
                            title={k === "admin" ? tr(STR.permAdminLocked, isEnglish) : undefined}
                          />
                        </td>
                      ))
                    )}
                    <td className="px-5 py-3.5">
                      {isMe ? (
                        <span className="text-xs text-muted-foreground">{roleLabel(role)}</span>
                      ) : (
                        <Select value={role} onValueChange={(v) => changeRole(r, v as AppRole)} disabled={busyId === r.user_id}>
                          <SelectTrigger className="h-8 w-44 text-xs">
                            {busyId === r.user_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SelectValue />}
                          </SelectTrigger>
                          <SelectContent>
                            {ROLES.map((x) => <SelectItem key={x} value={x}>{roleLabel(x)}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{tr(STR.permissionsFootnote, isEnglish)}</p>
    </main>
  );
};

export default Permissions;
