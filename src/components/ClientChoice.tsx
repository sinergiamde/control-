import { useState } from "react";
import { Building2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import ClientFormDialog from "@/components/ClientFormDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ClientOption } from "@/components/ClientCombobox";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { STR, tr } from "@/utils/i18n";

/** Select value meaning "create a client with the name typed below". */
export const NEW_CLIENT = "__new__";

/** What the picker should start on: the only client when there's one, otherwise nothing so the person
 * picks (or creates, through the full client form) deliberately. */
export const initialClientChoice = (clients: ClientOption[], _allowNew: boolean) =>
  clients.length === 1 ? clients[0].id : "";

/** Turns the picker's state into a client id, creating the client first when "new" was chosen. */
export const resolveClientChoice = async (
  value: string,
  newName: string,
  messages: { empty: string; duplicate: string }
): Promise<{ client: ClientOption; created: boolean } | { error: string }> => {
  if (value !== NEW_CLIENT) return value ? { client: { id: value, name: "" }, created: false } : { error: messages.empty };
  const name = newName.trim();
  if (!name) return { error: messages.empty };
  const { data, error } = await supabase.rpc("create_client", { _name: name });
  if (error || !data) {
    return { error: error && /duplicate|unique|23505/i.test(`${error.message} ${error.code}`) ? messages.duplicate : error?.message || "—" };
  }
  return { client: { id: data, name }, created: true };
};

interface ClientChoiceProps {
  clients: ClientOption[];
  value: string;
  onChange: (value: string) => void;
  /** Kept for older callers; new clients are created through the client form. */
  newName?: string;
  onNewNameChange?: (name: string) => void;
  /** A client was just created from the form (it is then selected). */
  onClientCreated?: (client: ClientOption) => void;
  label: string;
  /** Users and accountants can add a client right here; authorized users only pick shared ones. */
  allowNew: boolean;
  disabled?: boolean;
}

/** "Which client is this for?" — a picker of the person's clients with "+ New client" inside it.
 * A new client is created with the full client form (company name, owner, industry, description,
 * email and phone), never with a bare name, so every client is complete from the start. */
const ClientChoice = ({ clients, value, onChange, label, allowNew, disabled, onClientCreated }: ClientChoiceProps) => {
  const { lang } = useLanguage();
  const isEnglish = lang === "en";
  const [formOpen, setFormOpen] = useState(false);

  if (clients.length === 0 && !allowNew) {
    return <p className="text-sm text-muted-foreground rounded-md border border-border bg-muted/40 px-3 py-2">{tr(STR.noClientsShared, isEnglish)}</p>;
  }

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
        <Building2 className="h-4 w-4 text-primary" />
        {clients.length === 0 ? tr(STR.newClientNameLabel, isEnglish) : label}
      </label>
      {clients.length === 0 ? (
        <Button type="button" variant="outline" onClick={() => setFormOpen(true)} disabled={disabled} className="gap-1.5">
          <Plus className="h-4 w-4" />
          {tr(STR.newClientOption, isEnglish)}
        </Button>
      ) : (
        <Select
          value={value}
          onValueChange={(v) => (v === NEW_CLIENT ? setFormOpen(true) : onChange(v))}
          disabled={disabled}
        >
          <SelectTrigger className="w-full sm:w-80">
            <SelectValue placeholder={tr(STR.clientPickerPlaceholder, isEnglish)} />
          </SelectTrigger>
          <SelectContent>
            {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            {allowNew && <SelectItem value={NEW_CLIENT} className="font-semibold text-primary">{tr(STR.newClientOption, isEnglish)}</SelectItem>}
          </SelectContent>
        </Select>
      )}
      {!value && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {isEnglish ? "Pick the client, or create a new one, to continue." : "Elige el cliente, o crea uno nuevo, para poder continuar."}
        </p>
      )}
      <ClientFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        takenNames={clients.map((c) => c.name)}
        onSaved={(profile) => {
          onClientCreated?.({ id: profile.id, name: profile.name });
          onChange(profile.id);
        }}
      />
    </div>
  );
};

export default ClientChoice;
