import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { LogOut, ShieldCheck, LayoutDashboard, History, Building2 } from "lucide-react";
import { FlagIcon } from "@/components/FlagIcon";
import { useNavigate, useLocation } from "react-router-dom";

const Navbar = () => {
  const { lang, setLang, t } = useLanguage();
  const { user, profile, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  const displayName = profile?.name || user?.email?.split("@")[0];
  const isOnAdmin = location.pathname === "/admin";

  return (
    <nav className="bg-background/80 backdrop-blur-md border-b border-border px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between sticky top-0 z-50">
      <div className="flex items-center gap-2 cursor-pointer group" onClick={() => navigate(user ? "/dashboard" : "/")}>
        <span className="text-2xl font-black tracking-tight text-primary neon-text group-hover:scale-105 transition-transform duration-200">
          CTRL+
        </span>
        <span className="text-sm font-light text-muted-foreground hidden sm:inline">
          by <span className="text-primary/80 font-medium">TaxForYou</span>
        </span>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {/* Two always-visible flag buttons (current language highlighted) instead of a single
            "switch to X" toggle — a toggle that shows the target language's label reads, to a
            non-technical eye, like it's naming the language you're currently in. */}
        <div className="flex items-center rounded-lg border border-border/60 bg-muted/30 p-0.5" role="group" aria-label="Language / Idioma">
          <button
            type="button"
            onClick={() => setLang("en")}
            aria-pressed={lang === "en"}
            title="English"
            className={`flex items-center gap-1 text-sm font-medium px-2 py-1 rounded-md transition-all duration-200 ${
              lang === "en" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <FlagIcon country="us" className="w-4 h-3 rounded-[1px] shrink-0" /> EN
          </button>
          <button
            type="button"
            onClick={() => setLang("es")}
            aria-pressed={lang === "es"}
            title="Español"
            className={`flex items-center gap-1 text-sm font-medium px-2 py-1 rounded-md transition-all duration-200 ${
              lang === "es" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <FlagIcon country="es" className="w-4 h-3 rounded-[1px] shrink-0" /> ES
          </button>
        </div>

        {user && (
          <>
            {displayName && (
              <span className="text-sm text-muted-foreground hidden md:inline px-2 py-1 rounded-lg bg-muted/50 border border-border/50">
                {displayName}
              </span>
            )}

            {isAdmin && (
              <Button
                variant="ghost" size="sm"
                onClick={() => navigate(isOnAdmin ? "/dashboard" : "/admin")}
                className="text-primary hover:text-primary hover:bg-primary/10 hover:scale-105 transition-all duration-200"
              >
                {isOnAdmin ? (
                  <>
                    <LayoutDashboard className="h-4 w-4 mr-1" />
                    <span className="hidden sm:inline">Dashboard</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4 mr-1" />
                    <span className="hidden sm:inline">Admin</span>
                  </>
                )}
              </Button>
            )}

            <Button
              variant="ghost" size="sm"
              onClick={() => navigate("/clients")}
              className="text-muted-foreground hover:text-primary hover:bg-primary/10 hover:scale-105 transition-all duration-200"
            >
              <Building2 className="h-4 w-4 mr-1" />
              <span className="hidden sm:inline">{t("clientsNav")}</span>
            </Button>

            <Button
              variant="ghost" size="sm"
              onClick={() => navigate("/history")}
              className="text-muted-foreground hover:text-primary hover:bg-primary/10 hover:scale-105 transition-all duration-200"
            >
              <History className="h-4 w-4 mr-1" />
              <span className="hidden sm:inline">Historial</span>
            </Button>

            <Button
              variant="ghost" size="sm"
              onClick={handleLogout}
              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:scale-105 transition-all duration-200"
            >
              <LogOut className="h-4 w-4 mr-1" />
              <span className="hidden sm:inline">{t("logout")}</span>
            </Button>
          </>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
