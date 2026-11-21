import { useEffect, useState } from "react";
import { Building2, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { INDUSTRIES, OTHER_INDUSTRY, type ClientProfile } from "@/utils/clientProfile";

type Bilingual = { en: string; es: string };

const TXT = {
  newTitle: { en: "Add client", es: "Agregar cliente" },
  editTitle: { en: "Client profile", es: "Perfil del cliente" },
  desc: { en: "A client is a business: save it with the company's name. Every field is required.", es: "Un cliente es una empresa: guárdalo con el nombre de la empresa. Todos los campos son obligatorios." },
  name: { en: "Company name", es: "Nombre de la empresa" },
  namePh: { en: "e.g. RAMAS DRYWALL INC", es: "ej. RAMAS DRYWALL INC" },
  nameHelp: { en: "This is how the client shows everywhere in the app.", es: "Así se verá el cliente en toda la app." },
  owner: { en: "Owner or contact name", es: "Nombre del dueño o contacto" },
  ownerPh: { en: "e.g. Juan Ramas", es: "ej. Juan Ramas" },
  industry: { en: "Industry", es: "Industria" },
  industryPick: { en: "Pick the industry", es: "Elige la industria" },
  industryOther: { en: "Other (specify)", es: "Otra (especificar)" },
  industryOtherPh: { en: "Which industry? (required)", es: "¿Cuál industria? (obligatorio)" },
  description: { en: "Description of the product or service", es: "Descripción del producto o servicio" },
  descriptionPh: { en: "e.g. Drywall installation and finishing for new homes", es: "ej. Instalación y acabado de drywall en casas nuevas" },
  email: { en: "Email", es: "Correo" },
  phone: { en: "Phone", es: "Teléfono" },
  cogs: { en: "Does the business have cost of sales (COGS)?", es: "¿La empresa tiene costo de ventas (COGS)?" },
  cogsYes: { en: "Yes — materials, subcontractors, goods sold…", es: "Sí — materiales, subcontratistas, mercancía…" },
  cogsNo: { en: "No — its costs are operating expenses", es: "No — sus costos son gastos operativos" },
  cogsHelp: { en: "Pick No for service businesses without inventory or direct costs (e.g. one owner, no employees). Its P&L then shows those costs under Operating Expenses.", es: "Elige No si es un negocio de servicios sin inventario ni costos directos (ej. un solo dueño, sin empleados). Su estado de resultados mostrará esos costos en Gastos operativos." },
  group: { en: "Group or parent company (optional)", es: "Grupo o empresa matriz (opcional)" },
  groupNone: { en: "No group", es: "Sin grupo" },
  groupNew: { en: "+ New group…", es: "+ Nuevo grupo…" },
  groupPh: { en: "Group name", es: "Nombre del grupo" },
  groupHelp: { en: "Only to group several companies of the same owner.", es: "Solo para agrupar varias empresas del mismo dueño." },
  required: { en: "Required", es: "Obligatorio" },
  emailInvalid: { en: "Invalid email", es: "Correo no válido" },
  duplicate: { en: "There is already a client with this name", es: "Ya existe un cliente con este nombre" },
  cancel: { en: "Cancel", es: "Cancelar" },
  save: { en: "Save client", es: "Guardar cliente" },
  notSaved: { en: "It was not saved: you don't have permission to edit this client.", es: "No se guardó: no tienes permiso para modificar este cliente." },
};

const NEW_GROUP = "__new__";
const NO_GROUP = "__none__";

interface ClientFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The client being edited; absent to create one. */
  client?: ClientProfile | null;
  /** Existing groups, to pick from. */
  groups?: string[];
  /** Names already used by other clients (a client name must be unique). */
  takenNames?: string[];
  /** Company name to start a new client with (e.g. what was typed in a search box). */
  initialName?: string;
  onSaved: (client: ClientProfile) => void;
}

/** Create or edit a client with its full profile. Nothing is saved until every field is filled. */
const ClientFormDialog = ({ open, onOpenChange, client, groups = [], takenNames = [], initialName = "", onSaved }: ClientFormDialogProps) => {
  const { lang } = useLanguage();
  const isEnglish = lang === "en";
  const L = (b: Bilingual) => (isEnglish ? b.en : b.es);

  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [industry, setIndustry] = useState("");
  const [industryOther, setIndustryOther] = useState("");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [hasCogs, setHasCogs] = useState("yes");
  const [group, setGroup] = useState(NO_GROUP);
  const [newGroup, setNewGroup] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState("");

  useEffect(() => {
    if (!open) return;
    const preset = client?.industry && INDUSTRIES.some((i) => i.value === client.industry);
    setName(client?.name ?? initialName);
    setOwner(client?.owner_name ?? "");
    setIndustry(client?.industry ? (preset ? client.industry : OTHER_INDUSTRY) : "");
    setIndustryOther(client?.industry && !preset ? client.industry : "");
    setDescription(client?.description ?? "");
    setEmail(client?.email ?? "");
    setPhone(client?.phone ?? "");
    setHasCogs(client?.has_cogs === false ? "no" : "yes");
    setGroup(client?.company ? client.company : NO_GROUP);
    setNewGroup("");
    setTouched(false);
    setServerError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client]);

  const trimmedName = name.trim();
  const errors = {
    name: !trimmedName ? L(TXT.required) : takenNames.some((n) => n.trim().toLowerCase() === trimmedName.toLowerCase()) ? L(TXT.duplicate) : "",
    owner: owner.trim() ? "" : L(TXT.required),
    industry: !industry ? L(TXT.required) : industry === OTHER_INDUSTRY && !industryOther.trim() ? L(TXT.required) : "",
    description: description.trim() ? "" : L(TXT.required),
    email: !email.trim() ? L(TXT.required) : /^\S+@\S+\.\S+$/.test(email.trim()) ? "" : L(TXT.emailInvalid),
    phone: phone.trim() ? "" : L(TXT.required),
    group: group === NEW_GROUP && !newGroup.trim() ? L(TXT.required) : "",
  };
  const hasErrors = Object.values(errors).some(Boolean);
  const show = (key: keyof typeof errors) => (touched && errors[key] ? errors[key] : "");
  const red = (key: keyof typeof errors) => (show(key) ? "border-destructive" : "");

  const save = async () => {
    setTouched(true);
    setServerError("");
    if (hasErrors) return;
    const profile = {
      name: trimmedName,
      owner_name: owner.trim(),
      industry: industry === OTHER_INDUSTRY ? industryOther.trim() : industry,
      description: description.trim(),
      email: email.trim(),
      phone: phone.trim(),
      company: group === NEW_GROUP ? newGroup.trim() : group === NO_GROUP ? null : group,
      has_cogs: hasCogs === "yes",
    };
    setSaving(true);
    if (client) {
      const { data, error } = await supabase.from("clients").update(profile).eq("id", client.id).select("id");
      setSaving(false);
      if (error || !data?.length) {
        setServerError(error && /duplicate|unique|23505/i.test(`${error.message} ${error.code}`) ? L(TXT.duplicate) : error?.message || L(TXT.notSaved));
        return;
      }
      onSaved({ id: client.id, ...profile });
    } else {
      const { data: id, error } = await supabase.rpc("create_client", {
        _name: profile.name, _company: profile.company, _email: profile.email, _phone: profile.phone,
        _owner: profile.owner_name, _industry: profile.industry, _description: profile.description, _has_cogs: profile.has_cogs,
      });
      setSaving(false);
      if (error || !id) {
        setServerError(error && /duplicate|unique|23505/i.test(`${error.message} ${error.code}`) ? L(TXT.duplicate) : error?.message || "—");
        return;
      }
      onSaved({ id: id as string, ...profile });
    }
    onOpenChange(false);
  };

  const field = (label: string, key: keyof typeof errors, input: React.ReactNode, help?: string) => (
    <div className="space-y-1">
      <label className="text-sm font-medium text-foreground">{label} *</label>
      {input}
      {show(key) ? <p className="text-xs text-destructive">{show(key)}</p> : help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            {L(client ? TXT.editTitle : TXT.newTitle)}
          </DialogTitle>
          <DialogDescription>{L(TXT.desc)}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
          {field(L(TXT.name), "name",
            <Input autoFocus maxLength={150} value={name} onChange={(e) => setName(e.target.value)} placeholder={L(TXT.namePh)} className={red("name")} />,
            L(TXT.nameHelp))}
          {field(L(TXT.owner), "owner",
            <Input maxLength={150} value={owner} onChange={(e) => setOwner(e.target.value)} placeholder={L(TXT.ownerPh)} className={red("owner")} />)}
          {field(L(TXT.industry), "industry",
            <div className="space-y-2">
              <Select value={industry} onValueChange={(v) => { setIndustry(v); if (v !== OTHER_INDUSTRY) setIndustryOther(""); }}>
                <SelectTrigger className={red("industry")}><SelectValue placeholder={L(TXT.industryPick)} /></SelectTrigger>
                <SelectContent>
                  {INDUSTRIES.map((i) => <SelectItem key={i.value} value={i.value}>{L(i.label)}</SelectItem>)}
                  <SelectItem value={OTHER_INDUSTRY}>{L(TXT.industryOther)}</SelectItem>
                </SelectContent>
              </Select>
              {industry === OTHER_INDUSTRY && (
                <Input autoFocus maxLength={150} value={industryOther} onChange={(e) => setIndustryOther(e.target.value)} placeholder={L(TXT.industryOtherPh)} className={red("industry")} />
              )}
            </div>)}
          {field(L(TXT.description), "description",
            <Textarea maxLength={1000} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={L(TXT.descriptionPh)} className={red("description")} />)}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {field(L(TXT.email), "email",
              <Input type="email" maxLength={150} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@correo.com" className={red("email")} />)}
            {field(L(TXT.phone), "phone",
              <Input type="tel" inputMode="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 305 555 1234" className={red("phone")} />)}
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">{L(TXT.cogs)} *</label>
            <Select value={hasCogs} onValueChange={setHasCogs}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">{L(TXT.cogsYes)}</SelectItem>
                <SelectItem value="no">{L(TXT.cogsNo)}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{L(TXT.cogsHelp)}</p>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">{L(TXT.group)}</label>
            <Select value={group} onValueChange={setGroup}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_GROUP}>{L(TXT.groupNone)}</SelectItem>
                {[...new Set([...groups, ...(client?.company ? [client.company] : [])])].map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                <SelectItem value={NEW_GROUP}>{L(TXT.groupNew)}</SelectItem>
              </SelectContent>
            </Select>
            {group === NEW_GROUP && (
              <Input autoFocus maxLength={150} value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder={L(TXT.groupPh)} className={`mt-2 ${red("group")}`} />
            )}
            <p className="text-xs text-muted-foreground">{L(TXT.groupHelp)}</p>
          </div>
          {serverError && <p className="text-sm text-destructive">{serverError}</p>}
          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>{L(TXT.cancel)}</Button>
            <Button type="submit" disabled={saving || (touched && hasErrors)}>
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
              {L(TXT.save)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ClientFormDialog;
