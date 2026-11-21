import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import {
  ACTIVE_ORDER_IDS_KEY,
  LOCATION_ACK_KEY,
  LOCATION_ERROR_KEY,
  stopBackgroundLocationTask,
} from "./locationTrackingRuntime";

export const TOKEN_KEY = "dastak_rider_token";

type AuthState = {
  token: string | null;
  isReady: boolean;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    (async () => {
      try {
        const t = await AsyncStorage.getItem(TOKEN_KEY);
        setToken(t);
      } catch {
        setToken(null);
      } finally {
        setIsReady(true);
      }
    })();
  }, []);

  const signIn = useCallback(
    async (t: string) => {
      await AsyncStorage.setItem(TOKEN_KEY, t);
      setToken(t);
      await qc.invalidateQueries();
    },
    [qc],
  );

  const signOut = useCallback(async () => {
    try {
      // Remove credentials/order scope before stopping the OS task so it cannot
      // publish another fix while logout is in progress.
      await AsyncStorage.multiRemove([
        TOKEN_KEY,
        ACTIVE_ORDER_IDS_KEY,
        LOCATION_ACK_KEY,
        LOCATION_ERROR_KEY,
      ]).catch(() => {});
      await stopBackgroundLocationTask();
    } finally {
      setToken(null);
      qc.clear();
    }
  }, [qc]);

  return (
    <AuthContext.Provider value={{ token, isReady, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
