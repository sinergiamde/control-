import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, CornerDownRight, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { fetchClientNodes, sortAsTree, clientPathLabel, type ClientNode } from "@/utils/clientTree";

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
  /** Offer the "create new" row at all (off for filters — creating a company from a filter is odd). */
  allowCreate?: boolean;
  /** Where a newly typed company gets created: under this parent company, or top-level when null. */
  createParentId?: string | null;
  className?: string;
}

/** Type-to-search company picker, shared between Dashboard (assign a statement to a company) and
 * History (filter by company). Shows the hierarchy — each customer company followed by the
 * sub-companies it manages — scoped by RLS to what the logged-in user may see. */
export const ClientCombobox = ({
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  createLabel,
  allowClear = false,
  clearLabel = "",
  allowCreate = true,
  createParentId = null,
  className,
}: ClientComboboxProps) => {
  const [open, setOpen] = useState(false);
  const [clients, setClients] = useState<ClientNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");

  const loadClients = async () => {
    setClients(sortAsTree(await fetchClientNodes()));
    setLoading(false);
  };

  useEffect(() => {
    loadClients();
  }, []);

  const selected = clients.find((c) => c.id === value) || null;
  const trimmedQuery = query.trim();
  // Searching "Pepito" also lists every sub-company under Pepito Pérez, not just the parent row.
  const filteredClients = trimmedQuery
    ? clients.filter((c) => clientPathLabel(c, clients).toLowerCase().includes(trimmedQuery.toLowerCase()))
    : clients;
  // Names are unique per parent, so "already exists" only means a sibling with the same name.
  const exactMatch = clients.find(
    (c) => (c.parent_id ?? null) === createParentId && c.name.toLowerCase() === trimmedQuery.toLowerCase()
  );

  const select = (client: ClientNode | null) => {
    onChange(client ? { id: client.id, name: client.name } : null);
    setOpen(false);
    setQuery("");
  };

  const handleCreate = async () => {
    if (!trimmedQuery || creating) return;
    if (exactMatch) { select(exactMatch); return; }

    setCreating(true);
    const { data, error } = await supabase
      .from("clients")
      .insert({ name: trimmedQuery, parent_id: createParentId })
      .select("id, name, parent_id")
      .single();
    setCreating(false);

    if (error) {
      // Someone else may have created the same name a moment ago (case-insensitive unique index) —
      // recover by re-checking instead of showing an error for what is really a duplicate-safe retry.
      const list = sortAsTree(await fetchClientNodes());
      setClients(list);
      const match = list.find(
        (c) => (c.parent_id ?? null) === createParentId && c.name.toLowerCase() === trimmedQuery.toLowerCase()
      );
      if (match) select(match);
      return;
    }

    if (data) {
      const created = data as ClientNode;
      setClients((prev) => sortAsTree([...prev, created]));
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
          <span className="truncate">{selected ? clientPathLabel(selected, clients) : placeholder}</span>
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
                  {filteredClients.map((c) => {
                    const isSub = !!c.parent_id && clients.some((p) => p.id === c.parent_id);
                    return (
                      <CommandItem key={c.id} onSelect={() => select(c)} className={isSub ? "pl-6" : "font-medium"}>
                        <Check className={cn("mr-2 h-4 w-4 shrink-0", value === c.id ? "opacity-100" : "opacity-0")} />
                        {isSub && <CornerDownRight className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                        <span className="truncate">{c.name}</span>
                      </CommandItem>
                    );
                  })}
                  {allowCreate && trimmedQuery && !exactMatch && (
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
