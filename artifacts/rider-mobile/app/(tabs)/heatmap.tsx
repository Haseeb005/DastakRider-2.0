import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/components/Icon";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";

const API_BASE =
  process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : (process.env.EXPO_PUBLIC_API_URL ?? "https://dastakbites.com");

type Period = { label: string; sublabel: string; days: number; today?: boolean };

const PERIODS: Period[] = [
  { label: "Today",  sublabel: "Live",    days: 0,  today: true },
  { label: "7d",     sublabel: "Week",    days: 7 },
  { label: "30d",    sublabel: "Month",   days: 30 },
  { label: "90d",    sublabel: "3 Months",days: 90 },
];

// ─── Map HTML builder ────────────────────────────────────────────────────────
function buildHtml(
  points: { lat: number; lng: number }[],
  isDark: boolean,
): string {
  const count = points.length;
  const meanLat = count ? points.reduce((s, p) => s + p.lat, 0) / count : 30;
  const meanLng = count ? points.reduce((s, p) => s + p.lng, 0) / count : 70;

  // Determine zoom: zoom out a bit if sparse data
  const zoom = count > 200 ? 13 : count > 50 ? 12 : 11;

  // CartoDB Positron — clean minimal white basemap (default)
  const tileUrlCarto = isDark
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
  // Google Maps road tiles (no API key needed in Leaflet)
  const tileUrlGoogle = "https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}";

  const data = JSON.stringify(points.map((p) => [p.lat, p.lng, 1]));
  const hasData = count > 0;

  const bgColor      = isDark ? "#1a1a2e"                  : "#f0f0f0";
  const legendBg     = isDark ? "rgba(20,20,30,0.85)"      : "rgba(255,255,255,0.92)";
  const legendSubText= isDark ? "#9ca3af"                  : "#6b7280";
  const emptyColor   = isDark ? "#e5e7eb"                  : "#374151";
  const toggleBg     = isDark ? "rgba(20,20,30,0.88)"      : "rgba(255,255,255,0.92)";
  const toggleColor  = isDark ? "#e5e7eb"                  : "#374151";
  const toggleActive = "#DB143C";

  return /* html */ `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:100%; height:100%; background:${bgColor}; overflow:hidden; }
  #map { position:absolute; inset:0; }

  /* Legend — bottom left */
  #legend {
    position:absolute; bottom:16px; left:12px; z-index:1000;
    background:${legendBg}; backdrop-filter:blur(8px);
    border-radius:12px; padding:10px 14px;
    display:${hasData ? "flex" : "none"};
    flex-direction:column; gap:6px;
    box-shadow:0 2px 12px rgba(0,0,0,0.12); min-width:130px;
  }
  #legend-title {
    font-family:-apple-system,sans-serif; font-size:10px; font-weight:700;
    letter-spacing:0.08em; text-transform:uppercase; color:${legendSubText}; margin-bottom:2px;
  }
  #legend-bar { height:8px; border-radius:4px; background:linear-gradient(to right,#22c55e,#eab308,#f97316,#dc2626); }
  #legend-labels {
    display:flex; justify-content:space-between;
    font-family:-apple-system,sans-serif; font-size:9px; font-weight:600; color:${legendSubText};
  }

  /* Map style toggle — bottom right */
  #toggle {
    position:absolute; bottom:16px; right:12px; z-index:1000;
    background:${toggleBg}; backdrop-filter:blur(8px);
    border-radius:12px; padding:4px;
    display:flex; gap:4px;
    box-shadow:0 2px 12px rgba(0,0,0,0.12);
  }
  .toggle-btn {
    font-family:-apple-system,sans-serif; font-size:11px; font-weight:700;
    padding:6px 12px; border-radius:8px; border:none; cursor:pointer;
    background:transparent; color:${toggleColor}; transition:all 0.15s;
  }
  .toggle-btn.active { background:${toggleActive}; color:#fff; }

  /* Zoom controls */
  .leaflet-control-zoom {
    border:none !important; box-shadow:0 2px 12px rgba(0,0,0,0.12) !important;
    border-radius:10px !important; overflow:hidden;
  }
  .leaflet-control-zoom a {
    border-radius:0 !important; border:none !important;
    font-size:16px !important; line-height:30px !important; width:30px !important; height:30px !important;
    ${isDark ? "background:#1f2937 !important;color:#f9fafb !important;" : "background:#fff !important;color:#374151 !important;"}
  }
  .leaflet-control-zoom a:hover {
    ${isDark ? "background:#374151 !important;" : "background:#f3f4f6 !important;"}
  }

  /* Empty state */
  #empty {
    position:absolute; inset:0; z-index:2000;
    display:${hasData ? "none" : "flex"};
    flex-direction:column; align-items:center; justify-content:center; gap:8px;
    pointer-events:none;
  }
  #empty-icon { font-size:36px; }
  #empty-text { font-family:-apple-system,sans-serif; font-size:15px; font-weight:700; color:${emptyColor}; }
  #empty-sub {
    font-family:-apple-system,sans-serif; font-size:12px;
    color:${legendSubText}; text-align:center; padding:0 32px;
  }
</style>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js"></script>
</head>
<body>
<div id="map"></div>

${!hasData ? `
<div id="empty">
  <div id="empty-icon">📍</div>
  <div id="empty-text">No deliveries yet</div>
  <div id="empty-sub">No completed orders for this period. Try a longer time range.</div>
</div>` : ""}

<div id="legend">
  <div id="legend-title">Demand level</div>
  <div id="legend-bar"></div>
  <div id="legend-labels"><span>Low</span><span>High</span></div>
</div>

<div id="toggle">
  <button class="toggle-btn active" id="btn-carto" onclick="setLayer('carto')">Map</button>
  <button class="toggle-btn"        id="btn-google" onclick="setLayer('google')">Google</button>
  <button class="toggle-btn"        id="btn-sat"    onclick="setLayer('sat')">Satellite</button>
</div>

<script>
  var map = L.map('map', {
    zoomControl: true, attributionControl: false, preferCanvas: true,
  }).setView([${meanLat}, ${meanLng}], ${zoom});

  var layers = {
    carto:  L.tileLayer('${tileUrlCarto}',  { maxZoom:19, subdomains:'abcd' }),
    google: L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { maxZoom:20, subdomains:'0123' }),
    sat:    L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom:20, subdomains:'0123' }),
  };
  var currentLayer = 'carto';
  layers.carto.addTo(map);

  function setLayer(name) {
    if (name === currentLayer) return;
    map.removeLayer(layers[currentLayer]);
    layers[name].addTo(map);
    currentLayer = name;
    ['carto','google','sat'].forEach(function(k){
      document.getElementById('btn-'+k).className = 'toggle-btn' + (k===name?' active':'');
    });
  }

  var pts = ${data};

  if (pts.length > 0) {
    L.heatLayer(pts, {
      radius: 28, blur: 22, maxZoom: 17, max: 1.0,
      gradient: {
        0.00: '#22c55e',
        0.35: '#eab308',
        0.60: '#f97316',
        0.80: '#ef4444',
        1.00: '#dc2626',
      },
    }).addTo(map);

    try {
      var lats = pts.map(function(p){ return p[0]; });
      var lngs = pts.map(function(p){ return p[1]; });
      map.fitBounds(
        L.latLngBounds([Math.min.apply(null,lats),Math.min.apply(null,lngs)],
                       [Math.max.apply(null,lats),Math.max.apply(null,lngs)]),
        { padding:[32,32], maxZoom:14 }
      );
    } catch(e) {}
  }
</script>
</body>
</html>`;
}

// ─── Screen ──────────────────────────────────────────────────────────────────
export default function HeatmapScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  const [selectedDays, setSelectedDays] = useState(0); // default: Today
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const webRef = useRef<WebView>(null);

  const activePeriod = PERIODS.find((p) => p.days === selectedDays) ?? PERIODS[0];

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    setHtml(null);
    const query = activePeriod.today ? "today=true" : `days=${selectedDays}`;
    fetch(`${API_BASE}/api/rider/heatmap?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Server error ${r.status}`);
        return r.json();
      })
      .then((body: { points: { lat: number; lng: number }[]; total: number }) => {
        setTotal(body.total);
        setHtml(buildHtml(body.points, false));
        setLoading(false);
      })
      .catch((e: any) => {
        setError(e.message ?? "Failed to load heatmap");
        setLoading(false);
      });
  }, [token, selectedDays, refreshKey]);

  useEffect(() => { load(); }, [load]);

  const handlePeriod = (days: number) => {
    if (days === selectedDays) return;
    setSelectedDays(days);
  };

  return (
    <View style={[s.root, { backgroundColor: c.background }]}>

      {/* ── Header ── */}
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View style={s.headerLeft}>
          <Text style={[s.headerTitle, { color: c.foreground }]}>Order Heatmap</Text>
          <Text style={[s.headerSub, { color: c.mutedForeground }]}>
            High-demand areas in your city
          </Text>
        </View>
        <Pressable
          onPress={() => { setRefreshKey((k) => k + 1); }}
          style={[s.refreshBtn, { backgroundColor: c.muted }]}
          accessibilityLabel="Refresh"
        >
          <Icon name="refresh-cw" size={16} color={loading ? "#DB143C" : c.mutedForeground} />
        </Pressable>
      </View>

      {/* ── Period selector ── */}
      <View style={[s.periodRow, { backgroundColor: c.muted, borderColor: c.border }]}>
        {PERIODS.map((p) => {
          const active = p.days === selectedDays;
          return (
            <Pressable
              key={p.days}
              onPress={() => handlePeriod(p.days)}
              style={[
                s.periodBtn,
                active && { backgroundColor: "#DB143C", shadowColor: "#DB143C", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
              ]}
            >
              <Text style={[s.periodLabel, { color: active ? "#fff" : c.foreground }]}>
                {p.label}
              </Text>
              <Text style={[s.periodSub, { color: active ? "rgba(255,255,255,0.7)" : c.mutedForeground }]}>
                {p.sublabel}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* ── Stat bar ── */}
      <View style={[s.statBar, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={s.statItem}>
          <View style={[s.statDot, { backgroundColor: "#22c55e" }]} />
          <Text style={[s.statNum, { color: c.foreground }]}>
            {loading ? "—" : total.toLocaleString()}
          </Text>
          <Text style={[s.statLabel, { color: c.mutedForeground }]}>
            deliveries
          </Text>
        </View>
        <View style={[s.statDivider, { backgroundColor: c.border }]} />
        <View style={s.statItem}>
          <View style={[s.statDot, { backgroundColor: "#f97316" }]} />
          <Text style={[s.statNum, { color: c.foreground }]}>
            {loading ? "—" : total > 0 ? "Active" : "Quiet"}
          </Text>
          <Text style={[s.statLabel, { color: c.mutedForeground }]}>
            {activePeriod.today ? "right now" : `past ${activePeriod.sublabel.toLowerCase()}`}
          </Text>
        </View>
        <View style={[s.statDivider, { backgroundColor: c.border }]} />
        <View style={s.statItem}>
          <View style={[s.statDot, { backgroundColor: "#dc2626" }]} />
          <Text style={[s.statNum, { color: c.foreground }]}>Red zones</Text>
          <Text style={[s.statLabel, { color: c.mutedForeground }]}>= more orders</Text>
        </View>
      </View>

      {/* ── Map ── */}
      <View style={[s.mapWrap, { borderColor: c.border }]}>
        {/* Loading overlay */}
        {loading && (
          <View style={[s.overlay, { backgroundColor: c.card }]}>
            <ActivityIndicator size="large" color="#DB143C" />
            <Text style={[s.overlayText, { color: c.mutedForeground }]}>
              Building heatmap…
            </Text>
          </View>
        )}

        {/* Error overlay */}
        {error && !loading && (
          <View style={[s.overlay, { backgroundColor: c.card }]}>
            <Icon name="alert-circle" size={36} color={c.mutedForeground} />
            <Text style={[s.overlayText, { color: c.mutedForeground, marginTop: 8 }]}>
              Couldn't load map
            </Text>
            <Pressable onPress={() => setRefreshKey((k) => k + 1)} style={s.retryBtn}>
              <Text style={s.retryBtnText}>Try again</Text>
            </Pressable>
          </View>
        )}

        {/* Map */}
        {html && !loading && !error && (
          <WebView
            ref={webRef}
            source={{ html }}
            style={StyleSheet.absoluteFill}
            javaScriptEnabled
            domStorageEnabled
            originWhitelist={["*"]}
            scrollEnabled={false}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      {/* ── Tip strip ── */}
      <View style={[s.tip, { backgroundColor: c.accent, marginBottom: insets.bottom + 76 }]}>
        <Icon name="zap" size={15} color="#DB143C" />
        <Text style={[s.tipText, { color: "#A30F2C" }]}>
          <Text style={{ fontFamily: "Inter_700Bold" }}>Pro tip: </Text>
          Position yourself in red zones to receive orders faster
        </Text>
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  headerLeft: { gap: 2 },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 22 },
  headerSub:   { fontFamily: "Inter_400Regular", fontSize: 13 },
  refreshBtn: {
    width: 38, height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },

  periodRow: {
    flexDirection: "row",
    marginHorizontal: 16,
    borderRadius: 16,
    padding: 4,
    gap: 4,
    marginBottom: 12,
  },
  periodBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 12,
    alignItems: "center",
    gap: 1,
  },
  periodLabel: { fontFamily: "Inter_700Bold", fontSize: 13 },
  periodSub:   { fontFamily: "Inter_400Regular", fontSize: 10 },

  statBar: {
    flexDirection: "row",
    marginHorizontal: 16,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
  },
  statItem: { flex: 1, alignItems: "center", gap: 3 },
  statDot:  { width: 8, height: 8, borderRadius: 4, marginBottom: 2 },
  statNum:  { fontFamily: "Inter_700Bold", fontSize: 14 },
  statLabel:{ fontFamily: "Inter_400Regular", fontSize: 11, textAlign: "center" },
  statDivider: { width: 1, marginVertical: 4, marginHorizontal: 8 },

  mapWrap: {
    flex: 1,
    marginHorizontal: 16,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    marginBottom: 10,
  },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    zIndex: 10,
  },
  overlayText: { fontFamily: "Inter_500Medium", fontSize: 14 },
  retryBtn: {
    marginTop: 4,
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: "#DB143C",
    borderRadius: 20,
  },
  retryBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#fff" },

  tip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  tipText: { fontFamily: "Inter_400Regular", fontSize: 13, flex: 1, lineHeight: 18 },
});
