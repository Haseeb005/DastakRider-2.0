import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import { Navigation } from "lucide-react";

// Fix Leaflet's default icon URLs broken by bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

/** Crimson motorcycle marker for the rider */
const riderIcon = L.divIcon({
  className: "",
  html: `<div style="
    width:36px;height:36px;border-radius:50%;
    background:#DB143C;border:3px solid #fff;
    box-shadow:0 2px 8px rgba(0,0,0,.35);
    display:flex;align-items:center;justify-content:center;
  ">
    <svg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24'
      fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'>
      <circle cx='5.5' cy='17.5' r='3.5'/><circle cx='18.5' cy='17.5' r='3.5'/>
      <path d='M15 6a1 1 0 0 0 0-2h-1l-5 9H7'/><path d='M14 6h-2.5l-3 5.5'/>
    </svg>
  </div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

/** Blue pin for the customer destination */
const destIcon = L.divIcon({
  className: "",
  html: `<div style="
    width:32px;height:32px;border-radius:50% 50% 50% 0;
    background:#2563eb;border:3px solid #fff;
    box-shadow:0 2px 8px rgba(0,0,0,.3);
    transform:rotate(-45deg);
  "></div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
});

interface Props {
  riderLat: number;
  riderLng: number;
  /** Customer delivery destination (optional) */
  destLat?: number;
  destLng?: number;
  className?: string;
}

export function RiderLiveMap({ riderLat, riderLng, destLat, destLng, className = "" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const riderMarkerRef = useRef<L.Marker | null>(null);
  const destMarkerRef = useRef<L.Marker | null>(null);
  const didFitRef = useRef(false);

  // Initialise map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [riderLat, riderLng],
      zoom: 15,
      zoomControl: true,
      attributionControl: false,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);

    const riderM = L.marker([riderLat, riderLng], { icon: riderIcon, zIndexOffset: 1000 })
      .addTo(map)
      .bindPopup("Rider");
    riderMarkerRef.current = riderM;

    if (destLat !== undefined && destLng !== undefined) {
      const destM = L.marker([destLat, destLng], { icon: destIcon })
        .addTo(map)
        .bindPopup("Delivery address");
      destMarkerRef.current = destM;

      const bounds = L.latLngBounds([[riderLat, riderLng], [destLat, destLng]]);
      map.fitBounds(bounds, { padding: [48, 48] });
      didFitRef.current = true;
    }

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      riderMarkerRef.current = null;
      destMarkerRef.current = null;
      didFitRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Smoothly update rider marker position on each poll
  useEffect(() => {
    const map = mapRef.current;
    const marker = riderMarkerRef.current;
    if (!map || !marker) return;

    const ll = L.latLng(riderLat, riderLng);
    marker.setLatLng(ll);

    // Only auto-pan if the rider is near the edge (don't disrupt user panning)
    const bounds = map.getBounds().pad(-0.2);
    if (!bounds.contains(ll)) {
      map.panTo(ll, { animate: true, duration: 0.8 });
    }
  }, [riderLat, riderLng]);

  return (
    <div className={`relative rounded-xl overflow-hidden border border-gray-200 ${className}`}>
      <div ref={containerRef} style={{ height: 220, width: "100%" }} />
      {/* Live badge */}
      <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-white/90 backdrop-blur-sm rounded-full px-2.5 py-1 shadow-sm pointer-events-none">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-xs font-semibold text-gray-700">Live</span>
      </div>
      {/* Open in maps shortcut */}
      {destLat !== undefined && destLng !== undefined && (
        <a
          href={`https://www.google.com/maps/dir/${riderLat},${riderLng}/${destLat},${destLng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute top-2 right-2 flex items-center gap-1 bg-white/90 backdrop-blur-sm rounded-full px-2.5 py-1 shadow-sm text-xs font-semibold text-blue-600 hover:bg-white"
        >
          <Navigation className="w-3 h-3" /> Navigate
        </a>
      )}
    </div>
  );
}
