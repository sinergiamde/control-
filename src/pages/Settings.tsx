import { useEffect, useRef, useState } from "react";
import { Camera, Eye, EyeOff, Globe, KeyRound, Loader2, Mail, Moon, Palette, Save, Settings as SettingsIcon, Sparkles, Sun, Trash2, User as UserIcon } from "lucide-react";
import UserAvatar from "@/components/UserAvatar";
import { FlagIcon } from "@/components/FlagIcon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { STR, tr } from "@/utils/i18n";

const MIN_PASSWORD = 8;
const AVATAR_SIZE = 256;

/** Square-crops and shrinks a picked photo to 256×256 JPEG in the browser, so uploads stay small
 * (a phone photo can be 5+ MB) and every avatar looks the same shape. */
const resizeToSquare = (file: File): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement("canvas");
      canvas.width = AVATAR_SIZE;
      canvas.height = AVATAR_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error("canvas")); return; }
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob"))), "image/jpeg", 0.9);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image")); };
    img.src = url;
  });

/** TaxForYou admins only: where the "Subscribe" button sends people once their trial ends. */
const SubscriptionSettingsCard = () => {
  const { lang } = useLanguage();
  const isEnglish = lang === "en";
  const { toast } = useToast();
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["subscribe_whatsapp", "subscribe_email"])
      .then(({ data }) => {
        setWhatsapp((data || []).find((r) => r.key === "subscribe_whatsapp")?.value || "");
        setEmail((data || []).find((r) => r.key === "subscribe_email")?.value || "");
      });
  }, []);

  const save = async () => {
    setSaving(true);
    const now = new Date().toISOString();
    const { error } = await supabase.from("app_settings").upsert([
      { key: "subscribe_whatsapp", value: whatsapp.replace(/\D/g, ""), updated_at: now },
      { key: "subscribe_email", value: email.trim(), updated_at: now },
    ]);
    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "✅", description: tr(STR.settingsSaved, isEnglish) });
  };

  return (
    <Card className="neon-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          {tr(STR.subscribeSettingsSection, isEnglish)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{tr(STR.subscribeSettingsDesc, isEnglish)}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">{tr(STR.whatsappLabel, isEnglish)}</label>
            <Input inputMode="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="13055551234" className="bg-muted border-border" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">{tr(STR.contactEmailLabel, isEnglish)}</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="info@taxforyou.com" className="bg-muted border-border" />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            {tr(STR.saveWord, isEnglish)}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

/** Every user's own settings: photo (their picture or their business logo), display name, the
 * email they sign in with, language, theme and password. */
const Settings = () => {
  const { lang, setLang } = useLanguage();
  const isEnglish = lang === "en";
  const { user, profile, refreshProfile, isAdmin } = useAuth();
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(profile?.name || "");
  const [savingName, setSavingName] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    setName(profile?.name || "");
  }, [profile?.name]);

  if (!user) return null;

  const fail = (description: string) => toast({ title: "Error", description, variant: "destructive" });

  const handlePhoto = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { fail(tr(STR.photoMustBeImage, isEnglish)); return; }
    setUploading(true);
    try {
      const blob = await resizeToSquare(file);
      const path = `${user.id}/avatar-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg" });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
      const { error: updateError } = await supabase.from("profiles").update({ avatar_url: publicUrl }).eq("user_id", user.id);
      if (updateError) throw updateError;
      // Drop the previous photo so old ones don't pile up in storage.
      const previous = profile?.avatar_url?.split("/avatars/")[1];
      if (previous && previous !== path) await supabase.storage.from("avatars").remove([decodeURIComponent(previous)]);
      await refreshProfile();
      toast({ title: "✅", description: tr(STR.photoUpdated, isEnglish) });
    } catch (err) {
      fail(err instanceof Error ? err.message : tr(STR.photoUploadFailed, isEnglish));
    } finally {
      setUploading(false);
    }
  };

  const handleRemovePhoto = async () => {
    const previous = profile?.avatar_url?.split("/avatars/")[1];
    setUploading(true);
    const { error } = await supabase.from("profiles").update({ avatar_url: null }).eq("user_id", user.id);
    if (!error && previous) await supabase.storage.from("avatars").remove([decodeURIComponent(previous)]);
    setUploading(false);
    if (error) { fail(error.message); return; }
    await refreshProfile();
  };

  const handleSaveName = async () => {
    const trimmed = name.trim();
    if (!trimmed) { fail(tr(STR.nameRequired, isEnglish)); return; }
    setSavingName(true);
    const { error } = await supabase.from("profiles").update({ name: trimmed }).eq("user_id", user.id);
    setSavingName(false);
    if (error) { fail(error.message); return; }
    await refreshProfile();
    toast({ title: "✅", description: tr(STR.nameUpdated, isEnglish) });
  };

  const handleChangeEmail = async () => {
    const email = newEmail.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) { fail(tr(STR.invalidEmail, isEnglish)); return; }
    setSavingEmail(true);
    // Supabase sends a confirmation link; the sign-in email only changes once it's confirmed.
    const { error } = await supabase.auth.updateUser({ email });
    setSavingEmail(false);
    if (error) { fail(error.message); return; }
    setNewEmail("");
    toast({ title: "📧", description: tr(STR.emailChangeSent, isEnglish) });
  };

  const passwordTooShort = newPassword.length > 0 && newPassword.length < MIN_PASSWORD;
  const passwordMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canChangePassword =
    !!currentPassword && newPassword.length >= MIN_PASSWORD && newPassword === confirmPassword && !savingPassword;

  const handleChangePassword = async () => {
    if (!canChangePassword || !user.email) return;
    setSavingPassword(true);
    // Confirm it's really them (a session left open on a shared computer shouldn't be enough).
    const { error: verifyError } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
    if (verifyError) {
      setSavingPassword(false);
      fail(tr(STR.currentPasswordWrong, isEnglish));
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) { fail(error.message); return; }
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    toast({ title: "✅", description: tr(STR.passwordChanged, isEnglish) });
  };

  const langButton = (value: "es" | "en", label: string, country: "es" | "us") => (
    <button
      type="button"
      onClick={() => setLang(value)}
      aria-pressed={lang === value}
      className={`flex-1 flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-all ${
        lang === value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      <FlagIcon country={country} className="w-5 h-3.5 rounded-[1px]" /> {label}
    </button>
  );

  return (
    <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-3xl w-full mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center neon-glow">
          <SettingsIcon className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{tr(STR.settingsNav, isEnglish)}</h1>
          <p className="text-sm text-muted-foreground">{tr(STR.settingsPageDesc, isEnglish)}</p>
        </div>
      </div>

      {/* Profile */}
      <Card className="neon-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <UserIcon className="h-4 w-4 text-primary" />
            {tr(STR.profileSection, isEnglish)}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative">
              <UserAvatar name={profile?.name || user.email} url={profile?.avatar_url} className="w-24 h-24 text-3xl border-2" />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg hover:scale-105 transition-transform"
                aria-label={tr(STR.changePhoto, isEnglish)}
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => { handlePhoto(e.target.files?.[0]); e.target.value = ""; }}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground max-w-xs">{tr(STR.photoHint, isEnglish)}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  <Camera className="h-4 w-4 mr-1" /> {tr(STR.changePhoto, isEnglish)}
                </Button>
                {profile?.avatar_url && (
                  <Button size="sm" variant="ghost" onClick={handleRemovePhoto} disabled={uploading} className="text-destructive hover:text-destructive">
                    <Trash2 className="h-4 w-4 mr-1" /> {tr(STR.removePhoto, isEnglish)}
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">{tr(STR.displayNameLabel, isEnglish)}</label>
            <div className="flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-muted border-border" />
              <Button onClick={handleSaveName} disabled={savingName || name.trim() === (profile?.name || "")} className="shrink-0">
                {savingName ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                {tr(STR.saveWord, isEnglish)}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sign-in email */}
      <Card className="neon-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" />
            {tr(STR.signInEmailSection, isEnglish)}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
            <p className="text-xs text-muted-foreground">{tr(STR.currentEmailLabel, isEnglish)}</p>
            <p className="font-medium text-foreground">{user.email}</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">{tr(STR.newEmailLabel, isEnglish)}</label>
            <div className="flex gap-2">
              <Input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="nombre@empresa.com"
                className="bg-muted border-border"
              />
              <Button variant="outline" onClick={handleChangeEmail} disabled={savingEmail || !newEmail.trim()} className="shrink-0">
                {savingEmail && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                {tr(STR.changeEmailButton, isEnglish)}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{tr(STR.emailChangeHint, isEnglish)}</p>
          </div>
        </CardContent>
      </Card>

      {/* Language */}
      <Card className="neon-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            {tr(STR.languageSection, isEnglish)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            {langButton("es", "Español", "es")}
            {langButton("en", "English", "us")}
          </div>
          <p className="text-xs text-muted-foreground mt-2">{tr(STR.languageHint, isEnglish)}</p>
        </CardContent>
      </Card>

      {/* Theme */}
      <Card className="neon-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Palette className="h-4 w-4 text-primary" />
            {tr(STR.themeSection, isEnglish)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            {([
              { value: "light", icon: Sun, label: tr(STR.themeLight, isEnglish) },
              { value: "dark", icon: Moon, label: tr(STR.themeDark, isEnglish) },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTheme(opt.value)}
                aria-pressed={theme === opt.value}
                className={`flex-1 flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-all ${
                  theme === opt.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <opt.icon className="h-4 w-4" /> {opt.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">{tr(STR.themeHint, isEnglish)}</p>
        </CardContent>
      </Card>

      {/* Password */}
      <Card className="neon-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            {tr(STR.changePasswordButton, isEnglish)}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">{tr(STR.currentPasswordLabel, isEnglish)}</label>
            <Input
              type={showPasswords ? "text" : "password"}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              className="bg-muted border-border"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">{tr(STR.newPasswordLabel, isEnglish)}</label>
              <Input
                type={showPasswords ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                className="bg-muted border-border"
              />
              {passwordTooShort && <p className="text-xs text-destructive">{tr(STR.passwordTooShort, isEnglish)}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">{tr(STR.confirmPasswordLabel, isEnglish)}</label>
              <Input
                type={showPasswords ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                className="bg-muted border-border"
              />
              {passwordMismatch && <p className="text-xs text-destructive">{tr(STR.passwordsDontMatch, isEnglish)}</p>}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => setShowPasswords((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              {showPasswords ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {tr(STR.showPasswords, isEnglish)}
            </button>
            <Button onClick={handleChangePassword} disabled={!canChangePassword}>
              {savingPassword && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {tr(STR.savePasswordButton, isEnglish)}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isAdmin && <SubscriptionSettingsCard />}
    </main>
  );
};

export default Settings;
