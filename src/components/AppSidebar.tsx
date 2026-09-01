import { ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { FlagIcon } from "@/components/FlagIcon";
import {
  LayoutDashboard, Building2, History as HistoryIcon, ShieldCheck, LogOut,
} from "lucide-react";

interface NavItem {
  to: string;
  icon: React.ElementType;
  label: string;
}

const SidebarLink = ({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
      active
        ? "bg-sidebar-primary/15 text-sidebar-primary"
        : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
    }`}
  >
    <item.icon className="h-4 w-4 shrink-0" />
    <span className="truncate">{item.label}</span>
  </button>
);

/** Left sidebar shell, styled after the Bond CRM reference the client shared (persistent nav,
 * grouped sections, user chip at the bottom) but built with CTRL+'s own neon-green/black tokens
 * (--sidebar-*, already defined in index.css/tailwind.config from the original scaffold) instead
 * of cloning Bond's colors. Scoped to Dashboard for now — History/Clients/Results keep the
 * existing top Navbar until this direction is confirmed, then it's a small lift to extend. */
const AppSidebar = ({ children }: { children: ReactNode }) => {
  const { lang, setLang, t } = useLanguage();
  const { user, profile, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  const displayName = profile?.name || user?.email?.split("@")[0] || t("userFallback");

  const workspaceItems: NavItem[] = [
    { to: "/dashboard", icon: LayoutDashboard, label: t("dashboard") },
  ];
  const recordItems: NavItem[] = [
    { to: "/clients", icon: Building2, label: t("clientsNav") },
    { to: "/history", icon: HistoryIcon, label: t("viewHistoryWord") },
  ];

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-60 shrink-0 h-screen sticky top-0 bg-sidebar border-r border-sidebar-border flex flex-col">
        <div className="h-16 flex items-center gap-2 px-4 border-b border-sidebar-border shrink-0">
          <span className="text-xl font-black tracking-tight text-sidebar-primary neon-text">CTRL+</span>
          <span className="text-xs font-light text-sidebar-foreground/60 hidden sm:inline">
            by <span className="text-sidebar-primary/80 font-medium">TaxForYou</span>
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          <div className="space-y-1">
            <p className="px-2.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/35 mb-1.5">
              Workspace
            </p>
            {workspaceItems.map((item) => (
              <SidebarLink key={item.to} item={item} active={location.pathname === item.to} onClick={() => navigate(item.to)} />
            ))}
          </div>

          <div className="space-y-1">
            <p className="px-2.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/35 mb-1.5">
              Records
            </p>
            {recordItems.map((item) => (
              <SidebarLink key={item.to} item={item} active={location.pathname === item.to} onClick={() => navigate(item.to)} />
            ))}
          </div>

          {isAdmin && (
            <div className="space-y-1">
              <p className="px-2.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/35 mb-1.5">
                Admin
              </p>
              <SidebarLink
                item={{ to: "/admin", icon: ShieldCheck, label: t("adminPanel") }}
                active={location.pathname === "/admin"}
                onClick={() => navigate("/admin")}
              />
            </div>
          )}
        </nav>

        <div className="p-3 border-t border-sidebar-border shrink-0 space-y-3">
          <div className="flex items-center rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-0.5 w-full" role="group" aria-label="Language / Idioma">
            <button
              type="button" onClick={() => setLang("en")} aria-pressed={lang === "en"} title="English"
              className={`flex-1 flex items-center justify-center gap-1 text-xs font-medium px-2 py-1 rounded-md transition-all ${
                lang === "en" ? "bg-sidebar-primary/15 text-sidebar-primary" : "text-sidebar-foreground/60 hover:text-sidebar-foreground"
              }`}
            >
              <FlagIcon country="us" className="w-3.5 h-2.5 rounded-[1px] shrink-0" /> EN
            </button>
            <button
              type="button" onClick={() => setLang("es")} aria-pressed={lang === "es"} title="Español"
              className={`flex-1 flex items-center justify-center gap-1 text-xs font-medium px-2 py-1 rounded-md transition-all ${
                lang === "es" ? "bg-sidebar-primary/15 text-sidebar-primary" : "text-sidebar-foreground/60 hover:text-sidebar-foreground"
              }`}
            >
              <FlagIcon country="es" className="w-3.5 h-2.5 rounded-[1px] shrink-0" /> ES
            </button>
          </div>

          <div className="flex items-center gap-2 px-1">
            <div className="w-7 h-7 rounded-full bg-sidebar-primary/15 border border-sidebar-primary/30 flex items-center justify-center text-[11px] font-bold text-sidebar-primary shrink-0">
              {displayName[0]?.toUpperCase() || "?"}
            </div>
            <span className="text-xs text-sidebar-foreground/80 truncate flex-1">{displayName}</span>
            <button
              type="button" onClick={handleLogout} title={t("logout")}
              className="text-sidebar-foreground/50 hover:text-destructive transition-colors shrink-0"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
};

export default AppSidebar;
