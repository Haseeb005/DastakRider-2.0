import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";
import { ScreenHeader } from "@/components/ui";

const API_BASE =
  process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : (process.env.EXPO_PUBLIC_API_URL ?? "https://dastakbites.com");

const PERIODS: { label: string; days: number; today?: boolean }[] = [
  { label: "Today", days: 0, today: true },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];

function buildHtml(points: { lat: number; lng: number }[]): string {
  // Centre on mean coordinate
  const meanLat =
    points.reduce((s, p) => s + p.lat, 0) / (points.length || 1);
  const meanLng =
    points.reduce((s, p) => s + p.lng, 0) / (points.length || 1);

  const data = JSON.stringify(points.map((p) => [p.lat, p.lng, 1]));

  return /* html */ `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body, #map { width:100%; height:100%; }
</style>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js"></script>
</head>
<body>
<div id="map"></div>
<script>
  var map = L.map('map', { zoomControl: true, attributionControl: false })
    .setView([${meanLat}, ${meanLng}], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);

  var points = ${data};

  if (points.length > 0) {
    L.heatLayer(points, {
      radius: 22,
      blur: 18,
      maxZoom: 16,
      gradient: {
        0.0: '#3B82F6',
        0.3: '#8B5CF6',
        0.6: '#F59E0B',
        0.85: '#EF4444',
        1.0: '#DB143C'
      }
    }).addTo(map);
  }
</script>
</body>
</html>`;
}

export default function HeatmapScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const [selectedDays, setSelectedDays] = useState(30);
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const webRef = useRef<WebView>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    setHtml(null);

    const period = PERIODS.find((p) => p.days === selectedDays);
    const query = period?.today ? "today=true" : `days=${selectedDays}`;
    fetch(`${API_BASE}/api/rider/heatmap?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Server error ${r.status}`);
        return r.json();
      })
      .then((body: { points: { lat: number; lng: number }[]; total: number }) => {
        setTotal(body.total);
        setHtml(buildHtml(body.points));
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message ?? "Failed to load heatmap");
        setLoading(false);
      });
  }, [token, selectedDays]);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader
        title="Order Heatmap"
        subtitle={
          loading
            ? "Loading…"
            : error
              ? "Could not load data"
              : `${total.toLocaleString()} deliveries`
        }
      />

      {/* Period selector */}
      <View
        style={{
          flexDirection: "row",
          gap: 8,
          paddingHorizontal: 20,
          paddingVertical: 12,
        }}
      >
        {PERIODS.map((p) => {
          const active = p.days === selectedDays;
          return (
            <Pressable
              key={p.days}
              onPress={() => setSelectedDays(p.days)}
              style={{
                flex: 1,
                paddingVertical: 8,
                borderRadius: 20,
                alignItems: "center",
                backgroundColor: active ? "#DB143C" : c.muted,
              }}
            >
              <Text
                style={{
                  fontFamily: active ? "Inter_700Bold" : "Inter_500Medium",
                  fontSize: 13,
                  color: active ? "#fff" : c.mutedForeground,
                }}
              >
                {p.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Map / states */}
      <View style={{ flex: 1, marginHorizontal: 16, marginBottom: insets.bottom + 80, borderRadius: 16, overflow: "hidden" }}>
        {loading && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#DB143C" />
            <Text style={[styles.msg, { color: c.mutedForeground, marginTop: 12 }]}>
              Building heatmap…
            </Text>
          </View>
        )}

        {error && !loading && (
          <View style={styles.center}>
            <Text style={[styles.msg, { color: c.mutedForeground }]}>{error}</Text>
            <Pressable
              onPress={() => setSelectedDays((d) => d)}
              style={{ marginTop: 16, paddingHorizontal: 24, paddingVertical: 10, backgroundColor: "#DB143C", borderRadius: 20 }}
            >
              <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 }}>Retry</Text>
            </Pressable>
          </View>
        )}

        {html && !loading && !error && (
          <WebView
            ref={webRef}
            source={{ html }}
            style={{ flex: 1, borderRadius: 16 }}
            javaScriptEnabled
            domStorageEnabled
            originWhitelist={["*"]}
            scrollEnabled={false}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  msg: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    textAlign: "center",
  },
});
