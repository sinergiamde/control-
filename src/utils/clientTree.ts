import { supabase } from "@/integrations/supabase/client";

/** A row of `clients`. parent_id null = a TaxForYou customer company ("Pepito Pérez");
 * parent_id set = a sub-company that customer manages. Exactly two levels (enforced in the DB). */
export interface ClientNode {
  id: string;
  name: string;
  parent_id: string | null;
}

/** Every company the current user is allowed to see (RLS scopes it: admins get all, a company
 * user gets their own company + its sub-companies). */
export const fetchClientNodes = async (): Promise<ClientNode[]> => {
  const { data } = await supabase.from("clients").select("id, name, parent_id").order("name", { ascending: true });
  return (data as ClientNode[]) || [];
};

/** Parents first, each immediately followed by its own sub-companies, both alphabetical. A
 * sub-company whose parent isn't visible to this user is listed on its own at the top level. */
export const sortAsTree = <T extends ClientNode>(nodes: T[]): T[] => {
  const ids = new Set(nodes.map((n) => n.id));
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  const roots = nodes.filter((n) => !n.parent_id || !ids.has(n.parent_id)).sort(byName);
  return roots.flatMap((root) => [root, ...nodes.filter((n) => n.parent_id === root.id).sort(byName)]);
};

/** "Pepito Pérez › Sub-empresa A" for a sub-company, just the name for a top-level company. */
export const clientPathLabel = (node: ClientNode, nodes: ClientNode[]): string => {
  if (!node.parent_id) return node.name;
  const parent = nodes.find((n) => n.id === node.parent_id);
  return parent ? `${parent.name} › ${node.name}` : node.name;
};

/** A company plus all of its sub-companies — filtering by "Pepito Pérez" must also include the
 * statements filed under each company Pepito Pérez manages. */
export const clientWithSubIds = (clientId: string, nodes: ClientNode[]): Set<string> =>
  new Set([clientId, ...nodes.filter((n) => n.parent_id === clientId).map((n) => n.id)]);
