import { useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Eye, EyeOff } from "lucide-react";
import Navbar from "@/components/Navbar";
import { useToast } from "@/hooks/use-toast";

const countriesData = [
  { name: "United States", flag: "🇺🇸", code: "+1" },
  { name: "Colombia", flag: "🇨🇴", code: "+57" },
  { name: "Mexico", flag: "🇲🇽", code: "+52" },
  { name: "Canada", flag: "🇨🇦", code: "+1" },
  { name: "Spain", flag: "🇪🇸", code: "+34" },
  { name: "Argentina", flag: "🇦🇷", code: "+54" },
  { name: "Chile", flag: "🇨🇱", code: "+56" },
  { name: "Peru", flag: "🇵🇪", code: "+51" },
  { name: "Ecuador", flag: "🇪🇨", code: "+593" },
  { name: "Guatemala", flag: "🇬🇹", code: "+502" },
  { name: "Cuba", flag: "🇨🇺", code: "+53" },
  { name: "Bolivia", flag: "🇧🇴", code: "+591" },
  { name: "Dominican Republic", flag: "🇩🇴", code: "+1" },
  { name: "Honduras", flag: "🇭🇳", code: "+504" },
  { name: "Paraguay", flag: "🇵🇾", code: "+595" },
  { name: "El Salvador", flag: "🇸🇻", code: "+503" },
  { name: "Nicaragua", flag: "🇳🇮", code: "+505" },
  { name: "Costa Rica", flag: "🇨🇷", code: "+506" },
  { name: "Panama", flag: "🇵🇦", code: "+507" },
  { name: "Uruguay", flag: "🇺🇾", code: "+598" },
  { name: "Venezuela", flag: "🇻🇪", code: "+58" },
  { name: "United Kingdom", flag: "🇬🇧", code: "+44" },
  { name: "Germany", flag: "🇩🇪", code: "+49" },
  { name: "France", flag: "🇫🇷", code: "+33" },
  { name: "Brazil", flag: "🇧🇷", code: "+55" },
  { name: "Puerto Rico", flag: "🇵🇷", code: "+1" },
  { name: "Other", flag: "🌍", code: "" },
];

const Login = () => {
  const { t } = useLanguage();
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isRegister, setIsRegister] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({
    name: "", email: "", phone: "", country: "", password: "", confirmPassword: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.email) errs.email = t("email") + " is required";
    else if (!/\S+@\S+\.\S+/.test(form.email)) errs.email = "Invalid email";
    if (!form.password || form.password.length < 6) errs.password = "Min 6 characters";
    if (isRegister) {
      if (!form.name.trim()) errs.name = t("name") + " is required";
      if (!form.phone.trim()) errs.phone = t("phone") + " is required";
      if (!form.country) errs.country = t("country") + " is required";
      if (form.password !== form.confirmPassword) errs.confirmPassword = "Passwords don't match";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);

    if (isRegister) {
      const { error } = await register(form.email, form.password, {
        name: form.name,
        phone: form.phone,
        country: form.country,
      });
      if (error) {
        toast({ title: "Error", description: error, variant: "destructive" });
      } else {
        toast({
          title: t("checkEmail"),
          description: t("confirmEmailSent"),
          className: "border-primary text-primary",
        });
        setIsRegister(false);
      }
    } else {
      const { error } = await login(form.email, form.password);
      if (error) {
        toast({ title: "Error", description: error, variant: "destructive" });
      } else {
        navigate("/dashboard");
      }
    }
    setSubmitting(false);
  };

  const renderError = (field: string) =>
    errors[field] ? <p className="text-destructive text-xs mt-1 animate-fade-in">{errors[field]}</p> : null;

  const inputClass = "bg-muted border-border text-foreground placeholder:text-muted-foreground focus:border-primary transition-all duration-200";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md neon-border bg-card shadow-2xl opacity-0 animate-scale-in">
          <CardHeader className="text-center space-y-2 pb-2">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center mb-2 animate-pulse-glow">
              <span className="text-2xl font-black text-primary">C+</span>
            </div>
            <CardTitle className="text-2xl font-bold text-foreground">
              {isRegister ? t("register") : t("login")}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {isRegister ? t("createAccount") : t("welcomeBack")}
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {isRegister && (
                <div className="space-y-2 animate-fade-in">
                  <Label htmlFor="name" className="text-muted-foreground text-sm">{t("name")}</Label>
                  <Input id="name" value={form.name}
                    onChange={(e) => { setForm({ ...form, name: e.target.value }); setErrors((p) => ({ ...p, name: "" })); }}
                    className={inputClass} placeholder="Juan Pérez" />
                  {renderError("name")}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email" className="text-muted-foreground text-sm">{t("email")}</Label>
                <Input id="email" type="email" value={form.email}
                  onChange={(e) => { setForm({ ...form, email: e.target.value }); setErrors((p) => ({ ...p, email: "" })); }}
                  className={inputClass} placeholder="email@example.com" />
                {renderError("email")}
              </div>

              {isRegister && (
              <div className="animate-fade-in space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="country" className="text-muted-foreground text-sm">{t("country")}</Label>
                    <Select onValueChange={(v) => {
                      const selected = countriesData.find(c => c.name === v);
                      setForm({ ...form, country: v, phone: selected?.code ? selected.code + " " : form.phone });
                      setErrors((p) => ({ ...p, country: "" }));
                    }}>
                      <SelectTrigger className="bg-muted border-border text-foreground">
                        <SelectValue placeholder={t("selectCountry")} />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border max-h-60">
                        {countriesData.map((c) => (
                          <SelectItem key={c.name} value={c.name}>
                            <span className="flex items-center gap-2">
                              <span className="text-lg">{c.flag}</span>
                              <span>{c.name}</span>
                              {c.code && <span className="text-muted-foreground text-xs">({c.code})</span>}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {renderError("country")}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone" className="text-muted-foreground text-sm">{t("phone")}</Label>
                    <div className="relative flex items-center">
                      {form.country && (
                        <span className="absolute left-3 text-lg pointer-events-none">
                          {countriesData.find(c => c.name === form.country)?.flag}
                        </span>
                      )}
                      <Input id="phone" type="tel" value={form.phone}
                        onChange={(e) => { setForm({ ...form, phone: e.target.value }); setErrors((p) => ({ ...p, phone: "" })); }}
                        className={`${inputClass} ${form.country ? 'pl-10' : ''}`}
                        placeholder="+1 (555) 123-4567" />
                    </div>
                    {renderError("phone")}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="password" className="text-muted-foreground text-sm">{t("password")}</Label>
                <div className="relative">
                  <Input id="password" type={showPassword ? "text" : "password"} value={form.password}
                    onChange={(e) => { setForm({ ...form, password: e.target.value }); setErrors((p) => ({ ...p, password: "" })); }}
                    className={`${inputClass} pr-10`} placeholder="••••••••" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {renderError("password")}
              </div>

              {isRegister && (
                <div className="space-y-2 animate-fade-in">
                  <Label htmlFor="confirmPassword" className="text-muted-foreground text-sm">{t("confirmPassword")}</Label>
                  <Input id="confirmPassword" type="password" value={form.confirmPassword}
                    onChange={(e) => { setForm({ ...form, confirmPassword: e.target.value }); setErrors((p) => ({ ...p, confirmPassword: "" })); }}
                    className={inputClass} placeholder="••••••••" />
                  {renderError("confirmPassword")}
                </div>
              )}

              <Button type="submit" disabled={submitting}
                className="w-full h-12 text-base font-bold neon-glow neon-glow-hover transition-all duration-300 hover:scale-[1.02]">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {isRegister ? t("register") : t("login")}
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                {isRegister ? t("hasAccount") : t("noAccount")}{" "}
                <button type="button"
                  onClick={() => { setIsRegister(!isRegister); setErrors({}); }}
                  className="text-primary font-semibold hover:underline transition-all duration-200 hover:brightness-125">
                  {isRegister ? t("login") : t("register")}
                </button>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Login;
