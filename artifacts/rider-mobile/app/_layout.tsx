import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/inter";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  setAuthTokenGetter,
  setBaseUrl,
} from "@workspace/api-client-react";
import * as Sentry from "@sentry/react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef } from "react";

// Initialise Sentry as early as possible — before any component renders.
// In production the DSN comes from the EAS env var; in dev it falls back
// to the Replit shared env var set via EXPO_PUBLIC_SENTRY_DSN.
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.EXPO_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.2,       // 20 % of sessions for performance tracing
  debug: false,
});
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Loading } from "@/components/ui";
import { AuthProvider, TOKEN_KEY, useAuth } from "@/lib/auth";
// Side-effect import — registers the background location task with TaskManager
// before any screen mounts. Must stay at module level.
import "@/lib/locationTask";
import * as Notifications from "expo-notifications";
import {
  initOneSignal,
  oneSignalLogin,
  oneSignalLogout,
} from "@/lib/onesignal";
import {
  ensureNotificationHandler,
  requestNotificationPermission,
} from "@/lib/useChatUnread";

// Configure the notification handler so alerts fire while the app is
// foregrounded. Must be called before any component tries to schedule one.
ensureNotificationHandler();

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// Point the generated API client at the shared backend (served at /api via the
// reverse proxy) and supply the rider's bearer token on every request.
// On Replit, EXPO_PUBLIC_DOMAIN is injected by the dev script.
// Locally, fall back to EXPO_PUBLIC_API_URL (set in .env.local) or the
// default local API server port.  Android emulator needs 10.0.2.2 instead
// of localhost — set EXPO_PUBLIC_API_URL=http://10.0.2.2:3000 in that case.
setBaseUrl(
  process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000"),
);
setAuthTokenGetter(async () => {
  try {
    return await AsyncStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
});

// Keep every screen in sync with the live MongoDB: poll on an interval and
// refetch on reconnect. Per-query intervals still override these defaults.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 15_000,
      refetchOnReconnect: true,
      staleTime: 5_000,
    },
  },
});

/**
 * Decode the rider's MongoDB _id from the bearer token.
 * Token format: <header_b64url>.<riderId_b64url>.<sig_b64url>
 */
function riderIdFromToken(token: string): string | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return atob(padded) || null;
  } catch {
    return null;
  }
}

function RootLayoutNav() {
  const { token, isReady } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // Initialise OneSignal once — pass a stable navigation callback.
  // initOneSignal is idempotent so calling it in a useEffect is safe.
  useEffect(() => {
    initOneSignal((orderId, customerName, orderNum) => {
      const params = new URLSearchParams();
      if (customerName) params.set("customerName", customerName);
      if (orderNum) params.set("orderNum", orderNum);
      const qs = params.toString();
      router.push(`/chat/${orderId}${qs ? `?${qs}` : ""}` as any);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Associate / disassociate the device with the rider's OneSignal profile.
  useEffect(() => {
    if (token) {
      requestNotificationPermission().catch(() => {});
      const riderId = riderIdFromToken(token);
      if (riderId) oneSignalLogin(riderId);
    } else {
      oneSignalLogout();
    }
  }, [!!token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigate to chat when the rider taps a LOCAL push notification
  // (scheduled via expo-notifications in the tab layout's onNewMessage).
  // OneSignal remote-push taps are handled by initOneSignal's click listener.
  const responseListener = useRef<Notifications.EventSubscription | null>(null);
  useEffect(() => {
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as
          | Record<string, unknown>
          | undefined;
        const orderId = data?.orderId as string | undefined;
        const customerName = data?.customerName as string | undefined;
        const orderNum = data?.orderNum as string | undefined;
        if (orderId) {
          const params = new URLSearchParams();
          if (customerName) params.set("customerName", customerName);
          if (orderNum) params.set("orderNum", orderNum);
          const qs = params.toString();
          router.push(`/chat/${orderId}${qs ? `?${qs}` : ""}` as any);
        }
      });
    return () => {
      responseListener.current?.remove();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isReady) return;
    const inAuth = segments[0] === "login";
    if (!token && !inAuth) {
      router.replace("/login");
    } else if (token && inAuth) {
      router.replace("/(tabs)");
    }
  }, [token, isReady, segments, router]);

  if (!isReady) return <Loading />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="login" />
    </Stack>
  );
}

function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <GestureHandlerRootView>
              <KeyboardProvider>
                <RootLayoutNav />
              </KeyboardProvider>
            </GestureHandlerRootView>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

// Wrap with Sentry so unhandled errors and native crashes are captured.
export default Sentry.wrap(RootLayout);
