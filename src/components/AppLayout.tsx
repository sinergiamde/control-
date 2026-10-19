import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Building2, ChevronRight, CornerDownRight, KeyRound, LayoutDashboard, LogOut, Menu, Settings as SettingsIcon, ShieldCheck, X,
} from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { FlagIcon } from "@/components/FlagIcon";
import UserAvatar from "@/components/UserAvatar";
import { fetchClientNodes, type ClientNode } from "@/utils/clientTree";
import { STR, tr } from "@/utils/i18n";

/** Pages register a "you'll lose something" message here (e.g. statements picked but not analyzed
 * yet); every sidebar navigation and logout asks for confirmation while one is set. */
const NavGuardContext = createContext<(message: string | undefined) => void>(() => {});

export const useNavGuard = (message: string | undefined) => {
  const setGuard = useContext(NavGuardContext);
  useEffect(() => {
    setGuard(message);
    return () => setGuard(undefined);
  }, [message, setGuard]);
};

const linkClass = (active: boolean) =>
  `w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
    active
      ? "bg-sidebar-primary/15 text-sidebar-primary"
      : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
  }`;

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="px-2.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/35 mb-1.5">{children}</p>
);

/** CTRL+ is TaxForYou's SaaS: the sidebar is its control panel — the firm-wide dashboard, every
 * customer company (expandable to the companies each one manages), and the admin tools. */
const AppLayout = () => {
  const { lang, setLang, t } = useLanguage();
  const isEnglish = lang === "en";
  const { user, profile, isAdmin, logout, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [nodes, setNodes] = useState<ClientNode[]>([]);
  const [clientsOpen, setClientsOpen] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [mobileOpen, setMobileOpen] = useState(false);
  const guardRef = useRef<string | undefined>(undefined);
  const setGuard = useCallback((message: string | undefined) => { guardRef.current = message; }, []);

  // Reload on every route change so a company created/renamed/deleted elsewhere shows up here.
  useEffect(() => {
    if (!user) return;
    fetchClientNodes().then(setNodes);
  }, [user, location.pathname]);

  useEffect(() => {
    if (!loading && !user) navigate("/");
  }, [loading, user, navigate]);

  const roots = useMemo(() => nodes.filter((n) => !n.parent_id).sort((a, b) => a.name.localeCompare(b.name)), [nodes]);
  const childrenOf = (id: string) => nodes.filter((n) => n.parent_id === id).sort((a, b) => a.name.localeCompare(b.name));
  const activeClientId = location.pathname.match(/^\/clients\/([^/]+)/)?.[1];

  // Keep the open company's parent expanded so the current page is always visible in the tree.
  useEffect(() => {
    const active = nodes.find((n) => n.id === activeClientId);
    if (active?.parent_id) setExpanded((prev) => new Set(prev).add(active.parent_id!));
  }, [activeClientId, nodes]);

  const go = (to: string) => {
    if (guardRef.current && !window.confirm(guardRef.current)) return;
    setMobileOpen(false);
    navigate(to);
  };

  const handleLogout = async () => {
    if (guardRef.current && !window.confirm(guardRef.current)) return;
    await logout();
    navigate("/");
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const displayName = profile?.name || user?.email?.split("@")[0] || t("userFallback");

  const sidebar = (
    <aside className="w-64 h-full bg-sidebar border-r border-sidebar-border flex flex-col">
      <div className="h-16 flex items-center justify-between gap-2 px-4 border-b border-sidebar-border shrink-0">
        <button type="button" onClick={() => go("/dashboard")} className="flex items-baseline gap-2">
          <span className="text-xl font-black tracking-tight text-sidebar-primary neon-text">CTRL+</span>
          <span className="text-xs font-light text-sidebar-foreground/60">
            by <span className="text-sidebar-primary/80 font-medium">TaxForYou</span>
          </span>
        </button>
        <button type="button" onClick={() => setMobileOpen(false)} className="md:hidden text-sidebar-foreground/60" aria-label="close">
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        <div className="space-y-1">
          <SectionLabel>TaxForYou</SectionLabel>
          <button type="button" onClick={() => go("/dashboard")} className={linkClass(location.pathname === "/dashboard")}>
            <LayoutDashboard className="h-4 w-4 shrink-0" />
            <span className="truncate">{tr(STR.generalDashboardNav, isEnglish)}</span>
          </button>

          <div className="flex items-center">
            <button type="button" onClick={() => go("/clients")} className={linkClass(location.pathname === "/clients")}>
              <Building2 className="h-4 w-4 shrink-0" />
              <span className="truncate flex-1 text-left">{t("clientsNav")}</span>
              <span className="text-[10px] text-sidebar-foreground/40">{roots.length}</span>
            </button>
            <button
              type="button"
              onClick={() => setClientsOpen((v) => !v)}
              className="p-2 text-sidebar-foreground/50 hover:text-sidebar-foreground"
              aria-label="toggle clients"
            >
              <ChevronRight className={`h-4 w-4 transition-transform ${clientsOpen ? "rotate-90" : ""}`} />
            </button>
          </div>

          {clientsOpen && (
            <div className="ml-3 pl-2 border-l border-sidebar-border space-y-0.5">
              {roots.length === 0 && (
                <p className="px-2 py-1 text-xs text-sidebar-foreground/40">{t("noClientsYet")}</p>
              )}
              {roots.map((root) => {
                const kids = childrenOf(root.id);
                const isOpen = expanded.has(root.id);
                return (
                  <div key={root.id}>
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => go(`/clients/${root.id}`)}
                        className={`flex-1 min-w-0 text-left px-2 py-1.5 rounded-md text-xs truncate transition-colors ${
                          activeClientId === root.id
                            ? "bg-sidebar-primary/15 text-sidebar-primary font-semibold"
                            : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                        }`}
                        title={root.name}
                      >
                        {root.name}
                      </button>
                      {kids.length > 0 && (
                        <button
                          type="button"
                          onClick={() => toggle(root.id)}
                          className="p-1 text-sidebar-foreground/40 hover:text-sidebar-foreground"
                          aria-label="toggle sub-companies"
                        >
                          <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                        </button>
                      )}
                    </div>
                    {isOpen &&
                      kids.map((kid) => (
                        <button
                          key={kid.id}
                          type="button"
                          onClick={() => go(`/clients/${kid.id}`)}
                          className={`w-full flex items-center gap-1 pl-4 pr-2 py-1 rounded-md text-xs truncate transition-colors ${
                            activeClientId === kid.id
                              ? "bg-sidebar-primary/15 text-sidebar-primary font-semibold"
                              : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                          }`}
                          title={kid.name}
                        >
                          <CornerDownRight className="h-3 w-3 shrink-0" />
                          <span className="truncate">{kid.name}</span>
                        </button>
                      ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {isAdmin && (
          <div className="space-y-1">
            <SectionLabel>{tr(STR.adminSectionLabel, isEnglish)}</SectionLabel>
            <button type="button" onClick={() => go("/admin")} className={linkClass(location.pathname === "/admin")}>
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span className="truncate">{tr(STR.usersAndPermissionsNav, isEnglish)}</span>
            </button>
            <button type="button" onClick={() => go("/passwords")} className={linkClass(location.pathname === "/passwords")}>
              <KeyRound className="h-4 w-4 shrink-0" />
              <span className="truncate">{tr(STR.passwordsNav, isEnglish)}</span>
            </button>
          </div>
        )}

        <div className="space-y-1">
          <SectionLabel>{tr(STR.myAccountSection, isEnglish)}</SectionLabel>
          <button type="button" onClick={() => go("/settings")} className={linkClass(location.pathname === "/settings")}>
            <SettingsIcon className="h-4 w-4 shrink-0" />
            <span className="truncate">{tr(STR.settingsNav, isEnglish)}</span>
          </button>
        </div>
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
          <button
            type="button"
            onClick={() => go("/settings")}
            className="flex items-center gap-2 min-w-0 flex-1 text-left rounded-md hover:bg-sidebar-accent p-1 -m-1"
            title={tr(STR.settingsNav, isEnglish)}
          >
            <UserAvatar name={displayName} url={profile?.avatar_url} className="w-9 h-9" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-sidebar-foreground/80 truncate">{displayName}</p>
              <p className="text-[10px] text-sidebar-primary/80">{isAdmin ? "Admin · TaxForYou" : tr(STR.settingsNav, isEnglish)}</p>
            </div>
          </button>
          <button
            type="button" onClick={handleLogout} title={t("logout")}
            className="text-sidebar-foreground/50 hover:text-destructive transition-colors shrink-0"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <NavGuardContext.Provider value={setGuard}>
      <div className="min-h-screen flex bg-background">
        <div className="hidden md:block h-screen sticky top-0 shrink-0">{sidebar}</div>

        {mobileOpen && (
          <div className="md:hidden fixed inset-0 z-50 flex">
            <div className="h-full">{sidebar}</div>
            <button type="button" className="flex-1 bg-black/60" onClick={() => setMobileOpen(false)} aria-label="close menu" />
          </div>
        )}

        <div className="flex-1 min-w-0 flex flex-col">
          <div className="md:hidden h-14 flex items-center gap-3 px-4 border-b border-border sticky top-0 z-40 bg-background/90 backdrop-blur">
            <button type="button" onClick={() => setMobileOpen(true)} aria-label="menu">
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-lg font-black tracking-tight text-primary neon-text">CTRL+</span>
          </div>
          <Outlet />
        </div>
      </div>
    </NavGuardContext.Provider>
  );
};

export default AppLayout;
