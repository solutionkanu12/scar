"use client";

import {
  createClient,
  type AuthChangeEvent,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ScarSession = Pick<Session, "access_token" | "user">;

export interface ScarAuthClient {
  getSession(): Promise<{ data: { session: ScarSession | null } }>;
  onAuthStateChange(
    listener: (event: AuthChangeEvent, session: ScarSession | null) => void,
  ): { data: { subscription: { unsubscribe(): void } } };
  signInWithPassword(input: {
    email: string;
    password: string;
  }): Promise<{ error: { message: string } | null }>;
  signUp(input: {
    email: string;
    password: string;
  }): Promise<{ data: { session: ScarSession | null }; error: { message: string } | null }>;
  signOut(): Promise<{ error: { message: string } | null }>;
}

type AuthStatus = "loading" | "signed-out" | "signed-in" | "configuration-error";

interface ScarAuthContextValue {
  client: ScarAuthClient | null;
  error: string | null;
  session: ScarSession | null;
  status: AuthStatus;
  signIn(email: string, password: string): Promise<string | null>;
  signUp(email: string, password: string): Promise<"signed-in" | "confirm-email" | string>;
  signOut(): Promise<void>;
  expire(): Promise<void>;
}

const ScarAuthContext = createContext<ScarAuthContextValue | null>(null);

let browserClient: SupabaseClient | null = null;

function getBrowserClient(): ScarAuthClient {
  const url = process.env.NEXT_PUBLIC_SCAR_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SCAR_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SCAR sign-in is not configured. Set only NEXT_PUBLIC_SCAR_SUPABASE_URL and NEXT_PUBLIC_SCAR_SUPABASE_PUBLISHABLE_KEY in the browser environment.",
    );
  }
  browserClient ??= createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return {
    getSession: () => browserClient!.auth.getSession(),
    onAuthStateChange: (listener) => browserClient!.auth.onAuthStateChange(listener),
    signInWithPassword: (input) => browserClient!.auth.signInWithPassword(input),
    signUp: (input) => browserClient!.auth.signUp(input),
    signOut: () => browserClient!.auth.signOut(),
  };
}

export function ScarAuthProvider({
  children,
  client: injectedClient,
}: {
  children: ReactNode;
  client?: ScarAuthClient;
}) {
  const [session, setSession] = useState<ScarSession | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const resolved = useMemo((): { client: ScarAuthClient | null; configurationError: string | null } => {
    try {
      return { client: injectedClient ?? getBrowserClient(), configurationError: null };
    } catch (cause) {
      return {
        client: null,
        configurationError: cause instanceof Error ? cause.message : "SCAR sign-in is unavailable.",
      };
    }
  }, [injectedClient]);
  const client = resolved.client;

  useEffect(() => {
    if (!client) {
      setError(resolved.configurationError);
      setStatus("configuration-error");
      return;
    }
    let active = true;
    const subscription = client.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setStatus(nextSession ? "signed-in" : "signed-out");
      setError(null);
    }).data.subscription;
    void client.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setStatus(data.session ? "signed-in" : "signed-out");
    }).catch(() => {
      if (!active) return;
      setSession(null);
      setStatus("signed-out");
      setError("The saved session could not be restored. Please sign in again.");
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [client, resolved.configurationError]);

  const value = useMemo<ScarAuthContextValue>(() => ({
    client,
    error,
    session,
    status,
    async signIn(email, password) {
      if (!client) return error ?? "SCAR sign-in is unavailable.";
      const result = await client.signInWithPassword({ email, password });
      return result.error?.message ?? null;
    },
    async signUp(email, password) {
      if (!client) return error ?? "SCAR sign-in is unavailable.";
      const result = await client.signUp({ email, password });
      if (result.error) return result.error.message;
      return result.data.session ? "signed-in" : "confirm-email";
    },
    async signOut() {
      if (client) await client.signOut();
      setSession(null);
      setStatus("signed-out");
    },
    async expire() {
      // API expiry must immediately remove authenticated UI authority. The
      // Supabase client also clears its persisted browser session when possible.
      if (client) await client.signOut();
      setSession(null);
      setStatus("signed-out");
    },
  }), [client, error, session, status]);

  return <ScarAuthContext.Provider value={value}>{children}</ScarAuthContext.Provider>;
}

export function useScarAuth(): ScarAuthContextValue {
  const value = useContext(ScarAuthContext);
  if (!value) throw new Error("useScarAuth must be rendered inside ScarAuthProvider.");
  return value;
}
