import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User as SupabaseUser, Session } from "@supabase/supabase-js";

/** admin = TaxForYou · accountant = "Contador" · user = "Usuario" (every new sign-up) ·
 * authorized = "Usuario autorizado", designated by a user or accountant. */
export type AppRole = "admin" | "accountant" | "user" | "authorized";

interface Profile {
  name: string;
  phone: string;
  country: string;
  avatar_url: string | null;
  /** End of the free trial (24 hours after sign-up); null on a database that predates trials. */
  trial_ends_at: string | null;
  /** Marked by a TaxForYou admin once the person pays. */
  subscribed: boolean;
}

interface AuthContextType {
  user: SupabaseUser | null;
  session: Session | null;
  profile: Profile | null;
  role: AppRole;
  /** TaxForYou administrator: sees and manages everything. */
  isAdmin: boolean;
  /** Users and accountants own their clients: create, rename and delete them, and designate
   * authorized users. Authorized users only work inside the clients shared with them. */
  canManageClients: boolean;
  /** Whether uploading statements / receipts is allowed right now (trial or subscription; the
   * database enforces the same rule). */
  canUpload: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ error: string | null }>;
  register: (email: string, password: string, meta: { name: string; phone: string; country: string }) => Promise<{ error: string | null }>;
  logout: () => Promise<void>;
  /** Re-reads the profile after the user edits it (name, photo) so the sidebar updates at once. */
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ROLE_PRIORITY: AppRole[] = ["admin", "accountant", "authorized"];

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole>("user");
  const [canUpload, setCanUpload] = useState(true);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("name, phone, country, avatar_url, trial_ends_at, subscribed")
      .eq("user_id", userId)
      .single();
    if (data) {
      setProfile(data);
    } else if (error) {
      // A database that doesn't have the newer columns yet must not cost the user their whole profile.
      const { data: basic } = await supabase
        .from("profiles")
        .select("name, phone, country")
        .eq("user_id", userId)
        .single();
      if (basic) setProfile({ ...basic, avatar_url: null, trial_ends_at: null, subscribed: false });
    }
    const { data: allowed, error: planError } = await supabase.rpc("can_upload");
    setCanUpload(planError ? true : allowed !== false);
  };

  const checkRole = async (userId: string) => {
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const roles = new Set((data || []).map((r) => r.role as string));
    setRole(ROLE_PRIORITY.find((r) => roles.has(r)) ?? "user");
  };

  const resetAccount = () => {
    setProfile(null);
    setRole("user");
    setCanUpload(true);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        setTimeout(() => {
          fetchProfile(session.user.id);
          checkRole(session.user.id);
        }, 0);
      } else {
        resetAccount();
      }
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
        checkRole(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const register = async (email: string, password: string, meta: { name: string; phone: string; country: string }) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: meta,
        emailRedirectTo: window.location.origin,
      },
    });
    return { error: error?.message ?? null };
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    resetAccount();
  };

  const isAdmin = role === "admin";

  return (
    <AuthContext.Provider
      value={{
        user, session, profile, role, isAdmin,
        canManageClients: role !== "authorized",
        canUpload: isAdmin || canUpload,
        loading, login, register, logout, refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
