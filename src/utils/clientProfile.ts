import { supabase } from "@/integrations/supabase/client";

type Bilingual = { en: string; es: string };

/** A client is a business: `name` is the company's name (how it shows everywhere in the app). */
export interface ClientProfile {
  id: string;
  name: string;
  owner_name: string | null;
  industry: string | null;
  description: string | null;
  email: string | null;
  phone: string | null;
  /** Optional group the client belongs to (e.g. several companies of the same owner). */
  company: string | null;
  /** False for businesses without cost of sales: their COGS-type costs are reported as OpEx. */
  has_cogs: boolean;
}

export const CLIENT_PROFILE_COLUMNS = "id, name, owner_name, industry, description, email, phone, company, has_cogs";

export const fetchClientProfile = async (id: string): Promise<ClientProfile | null> => {
  const { data } = await supabase.from("clients").select(CLIENT_PROFILE_COLUMNS).eq("id", id).maybeSingle();
  return (data as ClientProfile | null) ?? null;
};

/** Preset industries; anything else is stored as the text the person wrote ("Other"). */
export const INDUSTRIES: { value: string; label: Bilingual }[] = [
  { value: "construction", label: { en: "Construction / drywall / remodeling", es: "Construcción / drywall / remodelación" } },
  { value: "trucking", label: { en: "Transportation / trucking / logistics", es: "Transporte / trucking / logística" } },
  { value: "cleaning", label: { en: "Cleaning services", es: "Servicios de limpieza" } },
  { value: "retail", label: { en: "Retail / resale", es: "Comercio / reventa" } },
  { value: "food", label: { en: "Restaurant / food", es: "Restaurante / comida" } },
  { value: "professional", label: { en: "Professional services", es: "Servicios profesionales" } },
  { value: "health", label: { en: "Health / beauty", es: "Salud / belleza" } },
  { value: "realestate", label: { en: "Real estate", es: "Bienes raíces" } },
  { value: "technology", label: { en: "Technology", es: "Tecnología" } },
];
export const OTHER_INDUSTRY = "other";

export const industryLabel = (value: string | null | undefined, isEnglish: boolean) => {
  if (!value) return "";
  const preset = INDUSTRIES.find((i) => i.value === value);
  return preset ? (isEnglish ? preset.label.en : preset.label.es) : value;
};
