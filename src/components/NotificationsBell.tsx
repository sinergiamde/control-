import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { STR, tr } from "@/utils/i18n";

interface NotificationRow {
  id: string;
  kind: string;
  data: Record<string, any>;
  read_at: string | null;
  created_at: string;
}

const ROLE_LABEL: Record<string, keyof typeof STR> = {
  admin: "roleAdmin",
  accountant: "roleAccountant",
  user: "roleUser",
  authorized: "roleAuthorized",
};

/** In-app alerts: new sign-ups and subscription requests for TaxForYou's admins; role, client
 * access and subscription changes for everyone else. Rendered in the reader's language. */
const NotificationsBell = ({ refreshKey, onNavigate }: { refreshKey: string; onNavigate: (to: string) => void }) => {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const isEnglish = lang === "en";
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("notifications")
      .select("id, kind, data, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(30);
    setItems((data as NotificationRow[]) || []);
  }, [user]);

  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => {
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const unread = items.filter((n) => !n.read_at);

  const markRead = async (ids: string[]) => {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, read_at: n.read_at ?? now } : n)));
    await supabase.from("notifications").update({ read_at: now }).in("id", ids);
  };

  const text = (n: NotificationRow) => {
    const d = n.data || {};
    switch (n.kind) {
      case "new_signup":
        return tr(STR.notifNewSignup, isEnglish).replace("{name}", d.name || "—").replace("{email}", d.email || "—");
      case "subscription_request":
        return tr(STR.notifSubscriptionRequest, isEnglish).replace("{name}", d.name || "—").replace("{email}", d.email || "—");
      case "role_assigned":
        return tr(STR.notifRoleAssigned, isEnglish).replace("{role}", tr(STR[ROLE_LABEL[d.role] ?? "roleUser"], isEnglish));
      case "clients_assigned":
        return tr(STR.notifClientsAssigned, isEnglish).replace("{clients}", (Array.isArray(d.clients) ? d.clients : []).join(", "));
      case "subscription_activated":
        return tr(STR.notifSubscriptionActivated, isEnglish);
      default:
        return n.kind;
    }
  };

  const target = (n: NotificationRow) =>
    n.kind === "new_signup" ? "/admin?filter=pending" : n.kind === "subscription_request" ? "/admin" : n.kind === "clients_assigned" ? "/clients" : null;

  const handleClick = (n: NotificationRow) => {
    markRead([n.id]);
    const to = target(n);
    if (to) {
      setOpen(false);
      onNavigate(to);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative p-1.5 rounded-md text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
          aria-label={tr(STR.notificationsTitle, isEnglish)}
          title={tr(STR.notificationsTitle, isEnglish)}
        >
          <Bell className="h-4 w-4" />
          {unread.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-destructive text-[10px] font-bold leading-4 text-white text-center">
              {unread.length > 9 ? "9+" : unread.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <p className="text-sm font-semibold">{tr(STR.notificationsTitle, isEnglish)}</p>
          {unread.length > 0 && (
            <button type="button" onClick={() => markRead(unread.map((n) => n.id))} className="text-xs text-primary hover:underline flex items-center gap-1">
              <CheckCheck className="h-3.5 w-3.5" /> {tr(STR.markAllRead, isEnglish)}
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{tr(STR.noNotifications, isEnglish)}</p>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => handleClick(n)}
                className={`w-full text-left px-3 py-2.5 border-b border-border/50 last:border-0 hover:bg-muted/50 transition-colors ${n.read_at ? "" : "bg-primary/5"}`}
              >
                <p className={`text-sm ${n.read_at ? "text-muted-foreground" : "text-foreground font-medium"}`}>{text(n)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {new Date(n.created_at).toLocaleString(isEnglish ? "en-US" : "es-CO", { dateStyle: "medium", timeStyle: "short" })}
                </p>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationsBell;
