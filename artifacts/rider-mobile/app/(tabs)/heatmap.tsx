/**
 * Heatmap screen — Live Demand Zones
 *
 * Shows pre-computed demand-score zones from the API server.
 * Zones are 500 m × 500 m cells scored 0-100 from:
 *   waiting orders, new orders, historical patterns, restaurant density.
 * The server refreshes every 2 min; the app polls to match.
 */
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

// ─── Constants ───────────────────────────────────────────────────────────────

const API_BASE =
  process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : (process.env.EXPO_PUBLIC_API_URL ?? "https://dastakbites.com");

const POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes — matches server recalc
const CELL_LAT = 0.0045;
const CELL_LNG = 0.0053;

// ─── Types ───────────────────────────────────────────────────────────────────

interface HeatmapZone {
  zoneId: string;
  lat: number;
  lng: number;
  score: number;
  color: string;
  label: string;
  waitingOrders: number;
  newOrders: number;
  historicalAvg: number;
  restaurantCount: number;
  city: string;
}

interface RestaurantHotspot {
  name: string;
  lat: number;
  lng: number;
  city: string;
  weeklyOrders: number;
  waitingOrders: number;
  recentOrders: number;
  score: number;
  color: string;
  label: string;
}

interface HeatmapSnapshot {
  zones: HeatmapZone[];
  restaurants: RestaurantHotspot[];
  updatedAt: string;
  cities: string[];
  riderCity: string | null;
}

// ─── Map HTML builder ─────────────────────────────────────────────────────────

function buildHtml(zones: HeatmapZone[], restaurants: RestaurantHotspot[]): string {
  const count = zones.length;
  // Use restaurant coords for centering if zones are empty
  const allLats = [
    ...zones.map((z) => z.lat),
    ...restaurants.map((r) => r.lat),
  ];
  const allLngs = [
    ...zones.map((z) => z.lng),
    ...restaurants.map((r) => r.lng),
  ];
  const meanLat = allLats.length ? allLats.reduce((s, v) => s + v, 0) / allLats.length : 32.08;
  const meanLng = allLngs.length ? allLngs.reduce((s, v) => s + v, 0) / allLngs.length : 72.68;

  // Adaptive zoom
  const zoom = count > 100 ? 13 : count > 30 ? 12 : 11;

  const zonesJson = JSON.stringify(
    zones.map((z) => ({
      lat: z.lat, lng: z.lng, score: z.score, color: z.color,
      label: z.label, waiting: z.waitingOrders, newOrders: z.newOrders,
      hist: z.historicalAvg, restaurants: z.restaurantCount,
    }))
  );

  const restsJson = JSON.stringify(
    restaurants.map((r) => ({
      name: r.name, lat: r.lat, lng: r.lng,
      score: r.score, color: r.color, label: r.label,
      weekly: r.weeklyOrders, waiting: r.waitingOrders, recent: r.recentOrders,
    }))
  );

  return /* html */`<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:100%; height:100%; overflow:hidden; }
  #map { position:absolute; inset:0; }

  /* Legend */
  #legend {
    position:absolute; bottom:16px; left:12px; z-index:1000;
    background:rgba(255,255,255,0.94); backdrop-filter:blur(8px);
    border-radius:12px; padding:10px 12px;
    box-shadow:0 2px 12px rgba(0,0,0,0.12);
    display:flex; flex-direction:column; gap:5px; min-width:140px;
  }
  #legend-title {
    font-family:-apple-system,sans-serif; font-size:10px; font-weight:700;
    letter-spacing:0.08em; text-transform:uppercase; color:#6b7280; margin-bottom:2px;
  }
  .leg-row { display:flex; align-items:center; gap:7px; }
  .leg-dot { width:10px; height:10px; border-radius:3px; flex-shrink:0; }
  .leg-lbl {
    font-family:-apple-system,sans-serif; font-size:10px;
    font-weight:600; color:#374151;
  }

  /* Map style toggle */
  #toggle {
    position:absolute; bottom:16px; right:12px; z-index:1000;
    background:rgba(255,255,255,0.94); backdrop-filter:blur(8px);
    border-radius:12px; padding:4px; display:flex; gap:4px;
    box-shadow:0 2px 12px rgba(0,0,0,0.12);
  }
  .tbtn {
    font-family:-apple-system,sans-serif; font-size:11px; font-weight:700;
    padding:6px 10px; border-radius:8px; border:none; cursor:pointer;
    background:transparent; color:#374151; transition:all 0.15s;
  }
  .tbtn.active { background:#DB143C; color:#fff; }

  /* Zoom controls */
  .leaflet-control-zoom {
    border:none !important; box-shadow:0 2px 12px rgba(0,0,0,0.12) !important;
    border-radius:10px !important; overflow:hidden;
  }
  .leaflet-control-zoom a {
    border-radius:0 !important; border:none !important;
    font-size:16px !important; line-height:30px !important;
    width:30px !important; height:30px !important;
    background:#fff !important; color:#374151 !important;
  }

  /* Empty state */
  #empty {
    position:absolute; inset:0; z-index:2000;
    display:${count === 0 ? "flex" : "none"};
    flex-direction:column; align-items:center; justify-content:center; gap:8px;
    background:rgba(255,255,255,0.8); pointer-events:none;
  }
  #empty-icon { font-size:40px; }
  #empty-title { font-family:-apple-system,sans-serif; font-size:16px; font-weight:700; color:#374151; }
  #empty-sub {
    font-family:-apple-system,sans-serif; font-size:12px; color:#6b7280;
    text-align:center; padding:0 32px; line-height:1.5;
  }
</style>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
</head>
<body>
<div id="map"></div>

<div id="legend">
  <div id="legend-title">Demand level</div>
  <div class="leg-row"><div class="leg-dot" style="background:#dc2626"></div><div class="leg-lbl">Hotspot (81-100)</div></div>
  <div class="leg-row"><div class="leg-dot" style="background:#f97316"></div><div class="leg-lbl">Very Busy (61-80)</div></div>
  <div class="leg-row"><div class="leg-dot" style="background:#eab308"></div><div class="leg-lbl">Busy (41-60)</div></div>
  <div class="leg-row"><div class="leg-dot" style="background:#84cc16"></div><div class="leg-lbl">Moderate (21-40)</div></div>
  <div class="leg-row"><div class="leg-dot" style="background:#22c55e"></div><div class="leg-lbl">Low (0-20)</div></div>
</div>

<div id="toggle">
  <button class="tbtn active" id="btn-carto"  onclick="setLayer('carto')">Map</button>
  <button class="tbtn"        id="btn-google" onclick="setLayer('google')">Google</button>
  <button class="tbtn"        id="btn-sat"    onclick="setLayer('sat')">Satellite</button>
</div>

<div id="empty">
  <div id="empty-icon">🟢</div>
  <div id="empty-title">All Quiet Right Now</div>
  <div id="empty-sub">No active demand zones detected. Check back soon — zones appear when orders come in.</div>
</div>

<script>
var map = L.map('map', { zoomControl:true, attributionControl:false, preferCanvas:true })
  .setView([${meanLat}, ${meanLng}], ${zoom});

var layers = {
  carto:  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',        { maxZoom:19, subdomains:'abcd' }),
  google: L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',                 { maxZoom:20, subdomains:'0123' }),
  sat:    L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',                 { maxZoom:20, subdomains:'0123' }),
};
var curLayer = 'carto';
layers.carto.addTo(map);

function setLayer(name) {
  if (name === curLayer) return;
  map.removeLayer(layers[curLayer]);
  layers[name].addTo(map);
  curLayer = name;
  ['carto','google','sat'].forEach(function(k){
    document.getElementById('btn-'+k).className='tbtn'+(k===name?' active':'');
  });
}

var HALF_LAT = ${CELL_LAT / 2};
var HALF_LNG = ${CELL_LNG / 2};
var zones = ${zonesJson};
var rests = ${restsJson};
var allBounds = [];

// ── Zone rectangles (background demand context) ──
zones.forEach(function(z) {
  var sw = [z.lat - HALF_LAT, z.lng - HALF_LNG];
  var ne = [z.lat + HALF_LAT, z.lng + HALF_LNG];
  allBounds.push(sw); allBounds.push(ne);

  var rect = L.rectangle([sw, ne], {
    color: z.color, weight: 1, opacity: 0.5,
    fillColor: z.color, fillOpacity: 0.22,
  });

  var popupHtml =
    '<div style="font-family:-apple-system,sans-serif;min-width:160px">' +
    '<div style="font-size:14px;font-weight:700;color:'+z.color+';margin-bottom:5px">Area: '+z.label+' ('+z.score+'/100)</div>' +
    '<div style="font-size:12px;color:#374151;line-height:1.8">' +
    '🕐 Waiting: <b>'+z.waiting+'</b> &nbsp;🆕 New: <b>'+z.newOrders+'</b><br>' +
    '📈 Hist avg: <b>'+z.hist+'</b> &nbsp;🍽️ Outlets: <b>'+z.restaurants+'</b>' +
    '</div></div>';

  rect.bindPopup(popupHtml, { maxWidth: 220 });
  rect.addTo(map);
});

// ── Restaurant markers (main feature) ──
// Radius scales with score; pulsing ring for outlets with waiting orders.
var maxScore = rests.length ? rests[0].score : 1;
rests.forEach(function(r) {
  var radius = 10 + Math.round((r.score / Math.max(maxScore, 1)) * 18);
  allBounds.push([r.lat, r.lng]);

  // Outer pulse ring for restaurants with active waiting orders
  if (r.waiting > 0) {
    L.circleMarker([r.lat, r.lng], {
      radius: radius + 7,
      color: r.color, weight: 2, opacity: 0.35,
      fillColor: r.color, fillOpacity: 0.08,
      interactive: false,
    }).addTo(map);
  }

  var marker = L.circleMarker([r.lat, r.lng], {
    radius: radius,
    color: r.color, weight: 2.5, opacity: 0.95,
    fillColor: r.color, fillOpacity: 0.82,
  });

  var badge = r.waiting > 0
    ? '<span style="background:#fff;color:'+r.color+';font-weight:800;font-size:11px;padding:1px 6px;border-radius:8px;margin-left:6px">'+r.waiting+' waiting</span>'
    : '';

  var popupHtml =
    '<div style="font-family:-apple-system,sans-serif;min-width:180px">' +
    '<div style="font-size:14px;font-weight:800;color:'+r.color+';margin-bottom:6px">🍽️ '+r.name+badge+'</div>' +
    '<div style="font-size:12px;color:#374151;line-height:2">' +
    '🕐 Waiting for rider: <b style="color:'+(r.waiting>0?'#dc2626':'#22c55e')+'">'+r.waiting+'</b><br>' +
    '🆕 New (15 min): <b>'+r.recent+'</b><br>' +
    '📅 Last 7 days: <b>'+r.weekly+'</b> orders<br>' +
    '📊 Demand score: <b>'+r.score+'/100</b>' +
    '</div></div>';

  marker.bindPopup(popupHtml, { maxWidth: 240 });
  marker.addTo(map);
});

if (allBounds.length > 0) {
  try {
    map.fitBounds(allBounds, { padding:[40,40], maxZoom:14, animate:false });
  } catch(e) {}
}
</script>
</body>
</html>`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `Updated ${h}:${m}`;
}

function scoreColor(score: number): string {
  if (score <= 20) return "#22c55e";
  if (score <= 40) return "#84cc16";
  if (score <= 60) return "#eab308";
  if (score <= 80) return "#f97316";
  return "#dc2626";
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function HeatmapScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  const [snapshot, setSnapshot] = useState<HeatmapSnapshot | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const webRef = useRef<WebView>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!token) return;
      if (!silent) { setLoading(true); setError(null); }
      try {
        const r = await fetch(`${API_BASE}/api/rider/heatmap`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error(`Server error ${r.status}`);
        const body: HeatmapSnapshot = await r.json();
        setSnapshot(body);
        setHtml(buildHtml(body.zones, body.restaurants ?? []));
        setError(null);
      } catch (e: any) {
        if (!silent) setError(e.message ?? "Failed to load heatmap");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [token],
  );

  // Initial load + poll every 2 min
  useEffect(() => {
    setLoading(true);
    load(false);
    pollRef.current = setInterval(() => load(true), POLL_INTERVAL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  // Derived stats
  const zones = snapshot?.zones ?? [];
  const totalWaiting = zones.reduce((s, z) => s + z.waitingOrders, 0);
  const topScore = zones.length ? zones[0].score : 0; // sorted hottest-first by server
  const riderCity = snapshot?.riderCity ?? null;

  return (
    <View style={[s.root, { backgroundColor: c.background }]}>

      {/* ── Header ── */}
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View style={s.headerLeft}>
          <Text style={[s.title, { color: c.foreground }]}>
            {riderCity ? `${riderCity} Demand` : "Live Demand Map"}
          </Text>
          <Text style={[s.subtitle, { color: c.mutedForeground }]}>
            {snapshot ? formatUpdatedAt(snapshot.updatedAt) : "Loading…"} · refreshes every 2 min
          </Text>
        </View>
        <Pressable
          onPress={() => load(false)}
          style={[s.refreshBtn, { backgroundColor: c.muted }]}
          accessibilityLabel="Refresh"
        >
          <Icon name="refresh-cw" size={16} color={loading ? "#DB143C" : c.mutedForeground} />
        </Pressable>
      </View>


      {/* ── Stats bar ── */}
      <View style={[s.statsBar, { backgroundColor: c.card, borderColor: c.border }]}>
        {/* Hottest zone */}
        <View style={s.statItem}>
          <View style={[s.statDot, { backgroundColor: scoreColor(topScore) }]} />
          <Text style={[s.statNum, { color: c.foreground }]}>{loading ? "—" : topScore}</Text>
          <Text style={[s.statLabel, { color: c.mutedForeground }]}>peak score</Text>
        </View>
        <View style={[s.statDiv, { backgroundColor: c.border }]} />
        {/* Waiting orders */}
        <View style={s.statItem}>
          <View style={[s.statDot, { backgroundColor: totalWaiting > 0 ? "#f97316" : "#22c55e" }]} />
          <Text style={[s.statNum, { color: c.foreground }]}>{loading ? "—" : totalWaiting}</Text>
          <Text style={[s.statLabel, { color: c.mutedForeground }]}>waiting orders</Text>
        </View>
        <View style={[s.statDiv, { backgroundColor: c.border }]} />
        {/* Zone count */}
        <View style={s.statItem}>
          <View style={[s.statDot, { backgroundColor: "#3b82f6" }]} />
          <Text style={[s.statNum, { color: c.foreground }]}>{loading ? "—" : zones.length}</Text>
          <Text style={[s.statLabel, { color: c.mutedForeground }]}>active zones</Text>
        </View>
      </View>

      {/* ── Map ── */}
      <View style={[s.mapWrap, { borderColor: c.border }]}>
        {loading && (
          <View style={[s.overlay, { backgroundColor: c.card }]}>
            <ActivityIndicator size="large" color="#DB143C" />
            <Text style={[s.overlayText, { color: c.mutedForeground }]}>
              Calculating demand zones…
            </Text>
          </View>
        )}
        {error && !loading && (
          <View style={[s.overlay, { backgroundColor: c.card }]}>
            <Icon name="alert-circle" size={36} color={c.mutedForeground} />
            <Text style={[s.overlayText, { color: c.mutedForeground, marginTop: 8 }]}>
              Couldn't load zones
            </Text>
            <Pressable onPress={() => load(false)} style={s.retryBtn}>
              <Text style={s.retryText}>Try again</Text>
            </Pressable>
          </View>
        )}
        {html && !loading && !error && (
          <WebView
            ref={webRef}
            source={{ html }}
            style={StyleSheet.absoluteFill}
            javaScriptEnabled
            domStorageEnabled
            originWhitelist={["*"]}
            scrollEnabled={false}
          />
        )}
      </View>

      {/* ── Tip ── */}
      <View style={[s.tip, { backgroundColor: c.accent, marginBottom: insets.bottom + 76 }]}>
        <Icon name="zap" size={15} color="#DB143C" />
        <Text style={[s.tipText, { color: "#A30F2C" }]}>
          <Text style={{ fontFamily: "Inter_700Bold" }}>Pro tip: </Text>
          Head to orange/red zones — those have the most waiting orders right now
        </Text>
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 12,
  },
  headerLeft: { gap: 2, flex: 1, marginRight: 12 },
  title:    { fontFamily: "Inter_700Bold", fontSize: 21 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 12 },
  refreshBtn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: "center", justifyContent: "center",
  },

  statsBar: {
    flexDirection: "row", marginHorizontal: 16, marginBottom: 10,
    borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, borderWidth: 1,
  },
  statItem:  { flex: 1, alignItems: "center", gap: 3 },
  statDot:   { width: 8, height: 8, borderRadius: 4, marginBottom: 1 },
  statNum:   { fontFamily: "Inter_700Bold", fontSize: 15 },
  statLabel: { fontFamily: "Inter_400Regular", fontSize: 11, textAlign: "center" },
  statDiv:   { width: 1, marginVertical: 4, marginHorizontal: 8 },

  mapWrap: {
    flex: 1, marginHorizontal: 16, marginBottom: 10,
    borderRadius: 18, overflow: "hidden", borderWidth: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject, alignItems: "center",
    justifyContent: "center", gap: 10, zIndex: 10,
  },
  overlayText: { fontFamily: "Inter_500Medium", fontSize: 14 },
  retryBtn: {
    marginTop: 4, paddingHorizontal: 24, paddingVertical: 10,
    backgroundColor: "#DB143C", borderRadius: 20,
  },
  retryText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#fff" },

  tip: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  tipText: { fontFamily: "Inter_400Regular", fontSize: 13, flex: 1, lineHeight: 18 },
});
