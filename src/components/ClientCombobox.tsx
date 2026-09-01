import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export interface ClientOption {
  id: string;
  name: string;
}

interface ClientComboboxProps {
  /** Selected client's id, or null for "no client chosen". */
  value: string | null;
  onChange: (client: ClientOption | null) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  /** Label for the "create new client" row, given the exact text the user typed. */
  createLabel: (query: string) => string;
  /** Show a "clear selection" row (used for the History filter, not the Dashboard picker). */
  allowClear?: boolean;
  clearLabel?: string;
  className?: string;
}

/** Type-to-search client picker, shared between Dashboard (assign a statement to a client) and
 * History (filter by client) — clients are a firm-wide shared list (see `clients` table), so
 * whatever gets created here is immediately visible to every logged-in user, not just this one. */
export const ClientCombobox = ({
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  createLabel,
  allowClear = false,
  clearLabel = "",
  className,
}: ClientComboboxProps) => {
  const [open, setOpen] = useState(false);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");

  const loadClients = async () => {
    const { data } = await supabase.from("clients").select("id, name").order("name", { ascending: true });
    setClients((data as ClientOption[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    loadClients();
  }, []);

  const selected = clients.find((c) => c.id === value) || null;
  const trimmedQuery = query.trim();
  const filteredClients = trimmedQuery
    ? clients.filter((c) => c.name.toLowerCase().includes(trimmedQuery.toLowerCase()))
    : clients;
  const exactMatch = clients.find((c) => c.name.toLowerCase() === trimmedQuery.toLowerCase());

  const select = (client: ClientOption | null) => {
    onChange(client);
    setOpen(false);
    setQuery("");
  };

  const handleCreate = async () => {
    if (!trimmedQuery || creating) return;
    if (exactMatch) { select(exactMatch); return; }

    setCreating(true);
    const { data, error } = await supabase.from("clients").insert({ name: trimmedQuery }).select("id, name").single();
    setCreating(false);

    if (error) {
      // Someone else may have created the same name a moment ago (case-insensitive unique index) —
      // recover by re-checking instead of showing an error for what is really a duplicate-safe retry.
      const { data: fresh } = await supabase.from("clients").select("id, name").order("name", { ascending: true });
      const list = (fresh as ClientOption[]) || [];
      setClients(list);
      const match = list.find((c) => c.name.toLowerCase() === trimmedQuery.toLowerCase());
      if (match) select(match);
      return;
    }

    if (data) {
      const created = data as ClientOption;
      setClients((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      select(created);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between font-normal", className)}
        >
          <span className="truncate">{selected ? selected.name : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={searchPlaceholder} value={query} onValueChange={setQuery} />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : (
              <>
                <CommandEmpty>{emptyLabel}</CommandEmpty>
                <CommandGroup>
                  {allowClear && (
                    <CommandItem onSelect={() => select(null)}>
                      <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                      {clearLabel}
                    </CommandItem>
                  )}
                  {filteredClients.map((c) => (
                    <CommandItem key={c.id} onSelect={() => select(c)}>
                      <Check className={cn("mr-2 h-4 w-4", value === c.id ? "opacity-100" : "opacity-0")} />
                      {c.name}
                    </CommandItem>
                  ))}
                  {trimmedQuery && !exactMatch && (
                    <CommandItem onSelect={handleCreate} disabled={creating} className="text-primary">
                      {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                      {createLabel(trimmedQuery)}
                    </CommandItem>
                  )}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
