import { Building2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ClientOption } from "@/components/ClientCombobox";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { STR, tr } from "@/utils/i18n";

/** Select value meaning "create a client with the name typed below". */
export const NEW_CLIENT = "__new__";

/** What the picker should start on: the only client when there's one, "new" when there are none
 * (and creating is allowed), otherwise nothing so the person picks deliberately. */
export const initialClientChoice = (clients: ClientOption[], allowNew: boolean) =>
  clients.length === 1 ? clients[0].id : clients.length === 0 && allowNew ? NEW_CLIENT : "";

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
  newName: string;
  onNewNameChange: (name: string) => void;
  label: string;
  /** Users and accountants can add a client right here; authorized users only pick shared ones. */
  allowNew: boolean;
  disabled?: boolean;
}

/** "Which client is this for?" — a picker of the person's clients with "+ New client" inside it,
 * or just a name field when they have no client yet, so nobody has to visit Clients first. */
const ClientChoice = ({ clients, value, onChange, newName, onNewNameChange, label, allowNew, disabled }: ClientChoiceProps) => {
  const { t, lang } = useLanguage();
  const isEnglish = lang === "en";

  if (clients.length === 0 && !allowNew) {
    return <p className="text-sm text-muted-foreground rounded-md border border-border bg-muted/40 px-3 py-2">{tr(STR.noClientsShared, isEnglish)}</p>;
  }

  const nameField = (
    <Input
      value={newName}
      onChange={(e) => onNewNameChange(e.target.value)}
      placeholder={t("clientNamePlaceholder")}
      disabled={disabled}
      maxLength={150}
      autoFocus={clients.length > 0}
      className="bg-muted border-border text-foreground"
    />
  );

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
        <Building2 className="h-4 w-4 text-primary" />
        {clients.length === 0 ? tr(STR.newClientNameLabel, isEnglish) : label}
      </label>
      {clients.length === 0 ? (
        <>
          {nameField}
          <p className="text-xs text-muted-foreground">{tr(STR.firstClientHint, isEnglish)}</p>
        </>
      ) : (
        <>
          <Select value={value} onValueChange={onChange} disabled={disabled}>
            <SelectTrigger className="w-full sm:w-80">
              <SelectValue placeholder={tr(STR.clientPickerPlaceholder, isEnglish)} />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              {allowNew && <SelectItem value={NEW_CLIENT}>{tr(STR.newClientOption, isEnglish)}</SelectItem>}
            </SelectContent>
          </Select>
          {value === NEW_CLIENT && <div className="sm:w-80">{nameField}</div>}
        </>
      )}
    </div>
  );
};

export default ClientChoice;
