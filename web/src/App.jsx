import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./apex.css";

import { supabase } from "./supabaseClient";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";

// ✅ Premium chart (Radar)
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Tooltip,
} from "recharts";

/**
 * API base:
 * - لو شغال لوكال: حط VITE_API_BASE=http://localhost:3001
 * - لو نفس الدومين (Render Serve static + API نفس السيرفيس): سيبه فاضي
 */
const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

function apiUrl(p) {
  if (!API_BASE) return p;
  return `${API_BASE}${p.startsWith("/") ? "" : "/"}${p}`;
}

const DEFAULT_PREFS = {
  method: "espresso",
  strength: "balanced",
  flavor_direction: "chocolate_nuts",
  acidity: "medium",
  time: "morning",
  milk: "black",
};

const METHOD_OPTIONS = [
  { v: "espresso", label: "Espresso" },
  { v: "v60", label: "V60" },
  { v: "filter", label: "Filter" },
  { v: "turkish", label: "Turkish" },
];

const STRENGTH_OPTIONS = [
  { v: "soft", label: "Soft" },
  { v: "balanced", label: "Balanced" },
  { v: "strong", label: "Strong" },
];

const FLAVOR_OPTIONS = [
  { v: "chocolate_nuts", label: "Chocolate + Nuts" },
  { v: "caramel_cocoa", label: "Caramel + Cocoa" },
  { v: "floral_citrus", label: "Floral + Citrus" },
  { v: "earthy_dark", label: "Earthy + Dark chocolate" },
];

const ACIDITY_OPTIONS = [
  { v: "low", label: "Low" },
  { v: "medium", label: "Medium" },
  { v: "high", label: "High" },
];

const TIME_OPTIONS = [
  { v: "morning", label: "Morning" },
  { v: "afternoon", label: "Afternoon" },
  { v: "night", label: "Night" },
];

const MILK_OPTIONS = [
  { v: "black", label: "Black" },
  { v: "with_milk", label: "With milk" },
];

function safeText(v) {
  if (v == null) return "";
  return String(v);
}

function makeId(prefix = "id") {
  return (
    prefix +
    "_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 8)
  );
}

function cartTotal(items) {
  return items.reduce((s, it) => s + Number(it.price || 0), 0);
}

function prettyStatus(s) {
  switch (s) {
    case "new":
      return "NEW";
    case "in_progress":
      return "IN PROGRESS";
    case "delivering":
      return "DELIVERING";
    case "delivered":
      return "DELIVERED";
    case "cancelled":
      return "CANCELLED";
    default:
      return safeText(s).toUpperCase();
  }
}

function statusClass(s) {
  switch (s) {
    case "new":
      return "apexStatusNew";
    case "in_progress":
      return "apexStatusProgress";
    case "delivering":
      return "apexStatusDelivering";
    case "delivered":
      return "apexStatusDelivered";
    case "cancelled":
      return "apexStatusCancelled";
    default:
      return "";
  }
}

/* =========================
   Premium Blend Chart (Radar)
   ========================= */
function BlendPremiumRadar({ blend }) {
  const chart = blend?.chart;
  if (!chart?.axes?.length || !chart?.series?.length) return null;

  const [sBlend, sTarget] = chart.series;

  const data = chart.axes.map((ax, i) => ({
    axis: ax.label,
    blend: Number(sBlend?.values?.[i] ?? 0),
    target: Number(sTarget?.values?.[i] ?? 0),
  }));

  const score = (() => {
    const diffs = data.map((d) => Math.abs(d.blend - d.target));
    const avg = diffs.reduce((a, b) => a + b, 0) / Math.max(1, diffs.length);
    const s = Math.max(0, Math.min(100, Math.round(100 - avg * 10)));
    return s;
  })();

  return (
    <div className="apexBlendChartWrap">
      <div className="apexBlendChartTop">
        <div>
          <div className="apexBlendChartTitle">Your Blend Profile</div>
          <div className="apexBlendChartSub">
            Measured from your recipe components (data-bound).
          </div>
        </div>

        <div
          className="apexBlendScorePill"
          title="How close your blend is to your target profile"
        >
          <div className="apexBlendScoreNum">{score}</div>
          <div className="apexBlendScoreTxt">Match</div>
        </div>
      </div>

      <div className="apexBlendChartFrame">
        <ResponsiveContainer width="100%" height={320}>
          <RadarChart data={data} outerRadius="72%">
            <PolarGrid />
            <PolarAngleAxis
              dataKey="axis"
              tick={{ fill: "rgba(255,255,255,0.82)", fontSize: 12 }}
            />
            <PolarRadiusAxis
              angle={30}
              domain={[0, 10]}
              tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }}
              axisLine={false}
            />

            <Radar
              name="Your Target"
              dataKey="target"
              stroke="rgba(255,255,255,0.55)"
              fill="rgba(255,255,255,0.10)"
              fillOpacity={1}
            />

            <Radar
              name="Your Blend"
              dataKey="blend"
              stroke="rgba(255,215,120,0.95)"
              fill="rgba(255,215,120,0.20)"
              fillOpacity={1}
            />

            <Tooltip
              contentStyle={{
                background: "rgba(10,10,10,0.92)",
                border: "1px solid rgba(255,255,255,0.14)",
                borderRadius: 12,
                boxShadow: "0 18px 44px rgba(0,0,0,0.45)",
                color: "rgba(255,255,255,0.92)",
              }}
              labelStyle={{
                color: "rgba(255,255,255,0.75)",
                fontWeight: 800,
              }}
              itemStyle={{
                color: "rgba(255,255,255,0.92)",
                fontWeight: 800,
              }}
            />
          </RadarChart>
        </ResponsiveContainer>

        <div className="apexBlendChartLegend">
          <div className="apexLegendItem">
            <span className="apexLegendDot apexLegendDotGold" /> Your Blend
          </div>
          <div className="apexLegendItem">
            <span className="apexLegendDot apexLegendDotWhite" /> Your Target
          </div>
        </div>
      </div>

      <div className="apexBlendChartMiniGrid">
        {data.map((d) => {
          const delta = Math.round((d.blend - d.target) * 10) / 10;
          const sign = delta > 0 ? "+" : "";
          return (
            <div key={d.axis} className="apexMiniStat">
              <div className="apexMiniStatK">{d.axis}</div>
              <div className="apexMiniStatV">
                <span className="apexMiniStatBlend">{d.blend.toFixed(1)}</span>
                <span className="apexMiniStatSep">/</span>
                <span className="apexMiniStatTarget">{d.target.toFixed(1)}</span>
              </div>
              <div
                className={`apexMiniStatD ${
                  delta === 0 ? "isZero" : delta > 0 ? "isUp" : "isDown"
                }`}
              >
                Δ {sign}
                {delta.toFixed(1)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* =========================
   Tiny Production UX helpers
   ========================= */

function Stepper({ step, onJump, stickyEnabled = true, topOffset = 12 }) {
  const steps = [
    { k: 1, t: "Preferences" },
    { k: 2, t: "Review" },
    { k: 3, t: "Checkout" },
    { k: 4, t: "Done" },
  ];

  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 12px",
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(255,255,255,0.04)",
        marginTop: 12,
        position: stickyEnabled ? "sticky" : "static",
        top: stickyEnabled ? topOffset : undefined,
        zIndex: stickyEnabled ? 30 : undefined,
        backdropFilter: stickyEnabled ? "blur(10px)" : undefined,
        boxShadow: stickyEnabled ? "0 12px 32px rgba(0,0,0,0.28)" : undefined,
      }}
    >
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {steps.map((s) => {
          const isOn = s.k <= step;
          const isActive = s.k === step;
          return (
            <button
              key={s.k}
              type="button"
              onClick={() => onJump?.(s.k)}
              style={{
                cursor: "pointer",
                borderRadius: 999,
                padding: "8px 12px",
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: 0.4,
                border: "1px solid rgba(255,255,255,0.14)",
                background: isActive
                  ? "rgba(255,255,255,0.20)"
                  : isOn
                  ? "rgba(255,255,255,0.10)"
                  : "rgba(255,255,255,0.05)",
                opacity: isOn ? 1 : 0.55,
                color: "rgba(255,255,255,0.90)",
              }}
              title={`Go to: ${s.t}`}
            >
              {s.k}. {s.t}
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 700 }}>
        Tip: Generate your blend, review it, then checkout.
      </div>
    </div>
  );
}

function OrderTimeline({ status }) {
  const map = {
    new: 1,
    in_progress: 2,
    delivering: 3,
    delivered: 4,
    cancelled: 0,
  };
  const step = map[status] ?? 1;

  const items = [
    { k: 1, t: "NEW" },
    { k: 2, t: "IN PROGRESS" },
    { k: 3, t: "DELIVERING" },
    { k: 4, t: "DELIVERED" },
  ];

  if (status === "cancelled") {
    return (
      <div style={{ marginTop: 10, fontSize: 12, fontWeight: 900, opacity: 0.85 }}>
        Order cancelled.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
      {items.map((it) => {
        const on = it.k <= step;
        return (
          <div
            key={it.k}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              opacity: on ? 1 : 0.45,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.20)",
                background: on
                  ? "rgba(255,255,255,0.70)"
                  : "rgba(255,255,255,0.20)",
              }}
            />
            <div
              style={{
                width: 18,
                height: 2,
                background: on
                  ? "rgba(255,255,255,0.45)"
                  : "rgba(255,255,255,0.12)",
              }}
            />
            <div style={{ fontSize: 12, fontWeight: 800 }}>{it.t}</div>
          </div>
        );
      })}
    </div>
  );
}

/* =========================
   Google Maps (Luxury Picker)
   ========================= */

// Put this in web/.env:
// VITE_GOOGLE_MAPS_API_KEY=YOUR_KEY
const GMAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";

/** Load Google Maps JS API (no external npm deps) */
function loadGoogleMapsOnce() {
  if (!GMAPS_KEY)
    return Promise.reject(new Error("Missing VITE_GOOGLE_MAPS_API_KEY"));
  if (typeof window === "undefined") return Promise.reject(new Error("No window"));
  if (window.google?.maps) return Promise.resolve(window.google);

  if (window.__apex_gmaps_promise) return window.__apex_gmaps_promise;

  window.__apex_gmaps_promise = new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-apex-gmaps='1']");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.google));
      existing.addEventListener("error", () =>
        reject(new Error("Failed to load Google Maps"))
      );
      return;
    }

    const s = document.createElement("script");
    s.src =
      "https://maps.googleapis.com/maps/api/js?key=" +
      encodeURIComponent(GMAPS_KEY) +
      "&libraries=places";
    s.async = true;
    s.defer = true;
    s.setAttribute("data-apex-gmaps", "1");
    s.onload = () => resolve(window.google);
    s.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(s);
  });

  return window.__apex_gmaps_promise;
}

/**
 * value shape:
 * {
 *   lat: number|null,
 *   lng: number|null,
 *   address: string,
 *   maps_url: string|null,
 *   place_id: string|null,
 *   mode: "current"|"custom"
 * }
 */
function GoogleMapsPicker({ value, onChange }) {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const geocoderRef = useRef(null);

  const inputRef = useRef(null);
  const autoRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // UI mode
  const [mode, setMode] = useState(value?.mode || "current"); // current | custom
  const modeRef = useRef(value?.mode || "current"); // ✅ always up-to-date for listeners

  // keep modeRef synced
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // if parent value.mode changes (rare)
  useEffect(() => {
    if (value?.mode && value.mode !== mode) setMode(value.mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.mode]);

  const defaultCenter = useMemo(() => {
    const fallback = { lat: 30.0444, lng: 31.2357 }; // Cairo default
    if (value?.lat && value?.lng)
      return { lat: Number(value.lat), lng: Number(value.lng) };
    return fallback;
  }, [value?.lat, value?.lng]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setErr("");
        await loadGoogleMapsOnce();
        if (!alive) return;
        setReady(true);
      } catch (e) {
        if (!alive) return;
        setErr(String(e?.message || e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  function buildMapsUrl(lat, lng) {
    return `https://www.google.com/maps?q=${encodeURIComponent(
      Number(lat)
    )},${encodeURIComponent(Number(lng))}`;
  }

  // ✅ main setter: always writes back {lat,lng,address,maps_url,place_id,mode}
  function setPoint(lat, lng, opts = {}) {
    const marker = markerRef.current;
    const map = mapRef.current;
    const geocoder = geocoderRef.current;

    const pos = { lat: Number(lat), lng: Number(lng) };
    const mapsUrl = buildMapsUrl(pos.lat, pos.lng);
    const nextMode = opts.newMode || modeRef.current;

    // marker + map
    if (marker) {
      marker.setVisible(true);
      marker.setPosition(pos);
      // draggable only in custom
      marker.setDraggable(nextMode === "custom");
    }
    if (map) {
      map.panTo(pos);
      if (map.getZoom() < 15) map.setZoom(15);
    }

    // if address provided (autocomplete), use it directly
    if (opts.address) {
      onChange?.({
        ...(value || {}),
        lat: pos.lat,
        lng: pos.lng,
        address: String(opts.address || ""),
        maps_url: mapsUrl,
        place_id: opts.place_id ? String(opts.place_id) : null,
        mode: nextMode,
      });
      return;
    }

    // reverse geocode to fill detected address
    if (opts.preferReverse && geocoder) {
      setBusy(true);

      geocoder.geocode({ location: pos }, (results, status) => {
        if (status !== "OK") {
          console.warn("Geocoder status:", status, results);
        }

        const addr =
          status === "OK" && results && results.length
            ? results[0].formatted_address
            : "";

        const pid =
          status === "OK" && results && results.length
            ? results[0].place_id || null
            : null;

        if (status === "REQUEST_DENIED") {
          setErr(
            "Google reverse geocode denied. غالبًا لازم تفعّل Geocoding API أو تصلّح Restrict للـ Key (HTTP referrers/APIs)."
          );
        } else {
          setErr("");
        }

        onChange?.({
          ...(value || {}),
          lat: pos.lat,
          lng: pos.lng,
          address: String(addr || (value?.address || "")),
          maps_url: mapsUrl,
          place_id: pid ? String(pid) : value?.place_id || null,
          mode: nextMode,
        });

        setBusy(false);
      });

      return;
    }

    // fallback
    onChange?.({
      ...(value || {}),
      lat: pos.lat,
      lng: pos.lng,
      address: value?.address || "",
      maps_url: mapsUrl,
      place_id: value?.place_id || null,
      mode: nextMode,
    });
  }

  // init map ONCE (✅ listeners read modeRef.current)
  useEffect(() => {
    if (!ready) return;
    if (!mapDivRef.current) return;
    if (mapRef.current) return;

    const g = window.google;

    const map = new g.maps.Map(mapDivRef.current, {
      center: defaultCenter,
      zoom: 15,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
    });

    mapRef.current = map;
    geocoderRef.current = new g.maps.Geocoder();

    const marker = new g.maps.Marker({
      map,
      position: defaultCenter,
      draggable: modeRef.current === "custom",
    });
    markerRef.current = marker;

    if (!(value?.lat && value?.lng)) {
      marker.setVisible(false);
    }

    // click to set pin (only if custom)
    map.addListener("click", (e) => {
      if (modeRef.current !== "custom") return;
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      setPoint(lat, lng, { preferReverse: true, newMode: "custom" });
    });

    marker.addListener("dragend", () => {
      if (modeRef.current !== "custom") return;
      const pos = marker.getPosition();
      if (!pos) return;
      setPoint(pos.lat(), pos.lng(), { preferReverse: true, newMode: "custom" });
    });

    // Autocomplete
    if (inputRef.current) {
      autoRef.current = new g.maps.places.Autocomplete(inputRef.current, {
        fields: ["geometry", "formatted_address", "place_id", "name"],
        types: ["geocode"],
      });

      autoRef.current.addListener("place_changed", () => {
        const place = autoRef.current.getPlace();
        const loc = place?.geometry?.location;
        if (!loc) return;

        const lat = loc.lat();
        const lng = loc.lng();
        const addr = place.formatted_address || place.name || "";
        const pid = place.place_id || null;

        setMode("custom");
        modeRef.current = "custom";

        setPoint(lat, lng, {
          address: addr,
          place_id: pid,
          preferReverse: false,
          newMode: "custom",
        });
      });
    }

    return () => {
      try {
        mapRef.current = null;
        markerRef.current = null;
        geocoderRef.current = null;
        autoRef.current = null;
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // when mode changes: update marker draggable immediately
  useEffect(() => {
    const marker = markerRef.current;
    if (marker) marker.setDraggable(mode === "custom");
    onChange?.({ ...(value || {}), mode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // update map when external value changes
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;

    if (value?.lat && value?.lng) {
      const lat = Number(value.lat);
      const lng = Number(value.lng);
      const pos = { lat, lng };
      marker.setVisible(true);
      marker.setPosition(pos);
      map.panTo(pos);
    }
  }, [value?.lat, value?.lng]);

  function useMyLocation() {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported in this browser.");
      return;
    }

    setErr("");
    setBusy(true);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMode("current");
        modeRef.current = "current";

        setPoint(pos.coords.latitude, pos.coords.longitude, {
          preferReverse: true,
          newMode: "current",
        });
      },
      (e) => {
        setBusy(false);
        alert("Could not get location: " + (e?.message || "Unknown error"));
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }

  function deliverToAnotherLocation() {
    setErr("");
    setMode("custom");
    modeRef.current = "custom";
  }

  function openGoogleMapsAtPin() {
    if (!value?.lat || !value?.lng) return;
    window.open(buildMapsUrl(value.lat, value.lng), "_blank");
  }

  if (!GMAPS_KEY) {
    return (
      <div className="apexError">
        Missing <b>VITE_GOOGLE_MAPS_API_KEY</b> in your web/.env
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {err ? <div className="apexError">{err}</div> : null}

      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <button
          className="apexPillBtn apexPillBtnGold"
          type="button"
          onClick={useMyLocation}
          disabled={busy}
        >
          {busy && mode === "current" ? "Detecting..." : "My current location"}
        </button>

        <button
          className="apexPillBtn"
          type="button"
          onClick={deliverToAnotherLocation}
          disabled={busy}
        >
          Deliver to another location
        </button>

        <button
          className="apexPillBtn"
          type="button"
          onClick={openGoogleMapsAtPin}
          disabled={!value?.lat || !value?.lng}
        >
          Open in Google Maps
        </button>

        <div className="apexTinyNote" style={{ opacity: 0.85 }}>
          {mode === "custom"
            ? "ابحث أو اضغط على الخريطة لتحط Pin (وتقدر تسحبه)"
            : "هيجيب عنوانك من جوجل تلقائيًا"}
        </div>
      </div>

      <div className="apexField">
        <div className="apexLabel">Search on Google Maps</div>
        <input
          ref={inputRef}
          className="apexInput"
          placeholder="Type your address / area..."
          defaultValue=""
          disabled={!ready || busy}
        />
      </div>

      <div
        ref={mapDivRef}
        style={{
          height: 320,
          borderRadius: 16,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.10)",
          background: "rgba(255,255,255,0.04)",
        }}
      />

      <div className="apexField">
        <div className="apexLabel">Detected address (editable)</div>
        <input
          className="apexInput"
          placeholder="Detected address (auto from Google) — you can edit"
          value={value?.address || ""}
          onChange={(e) => onChange?.({ ...(value || {}), address: e.target.value })}
        />
      </div>

      {value?.lat && value?.lng ? (
        <div className="apexTinyNote" style={{ opacity: 0.75 }}>
          lat: {Number(value.lat).toFixed(6)} | lng: {Number(value.lng).toFixed(6)}
        </div>
      ) : (
        <div className="apexTinyNote" style={{ opacity: 0.75 }}>
          No location selected yet.
        </div>
      )}
    </div>
  );
}

/**
 * صفحة callback بسيطة (بدون Router) عشان OAuth
 * Supabase هيرجعك على: /auth/callback (path) أو /#/auth/callback (hash)
 */
function AuthCallbackInline() {
  const [msg, setMsg] = useState("Signing you in…");

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const url = window.location.href;

        if (url.includes("code=")) {
          const { error } = await supabase.auth.exchangeCodeForSession(url);
          if (error) throw error;
        }

        const { data } = await supabase.auth.getSession();
        if (!alive) return;

        if (data?.session) setMsg("Signed in ✅ Redirecting…");
        else setMsg("No session found. Redirecting…");
      } catch (e) {
        console.warn("callback exception:", e);
        if (alive) setMsg(`Login error: ${e?.message || e}`);
      } finally {
        setTimeout(() => {
          window.location.href = "/#/";
        }, 1000);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="apexApp apexThemeDaily" style={{ minHeight: "100vh" }}>
      <div style={{ padding: 24, color: "#fff" }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>{msg}</div>
        <div style={{ opacity: 0.75, marginTop: 8 }}>Please wait a moment.</div>
      </div>
    </div>
  );
}

function QuickNav({
  onBuilder,
  onCheckout,
  onSaved,
  onOrders,
  onTop,
  hasSaved,
  hasOrders,
  cartCount,
  compact = false,
  hidden = false,
}) {
  const [open, setOpen] = useState(!compact);

  useEffect(() => {
    setOpen(!compact);
  }, [compact]);

  if (hidden) return null;

  const items = [
    { key: "builder", label: "Blend Builder", onClick: onBuilder, hint: "1" },
    {
      key: "checkout",
      label: cartCount ? `Checkout (${cartCount})` : "Checkout",
      onClick: onCheckout,
      hint: "2",
    },
    hasSaved
      ? { key: "saved", label: "Saved blends", onClick: onSaved, hint: "3" }
      : null,
    hasOrders
      ? { key: "orders", label: "My orders", onClick: onOrders, hint: "4" }
      : null,
  ].filter(Boolean);

  if (compact && !open) {
    return (
      <div
        style={{
          position: "fixed",
          right: 14,
          bottom: 14,
          zIndex: 35,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <button
          type="button"
          className="apexPillBtn apexPillBtnGold"
          onClick={() => setOpen(true)}
          style={{
            padding: "12px 14px",
            borderRadius: 999,
            boxShadow: "0 14px 36px rgba(0,0,0,0.35)",
          }}
        >
          Menu &amp; Checkout
        </button>
        <button
          type="button"
          className="apexPillBtn"
          onClick={onCheckout}
          style={{ borderRadius: 999 }}
        >
          Checkout {cartCount ? `(${cartCount})` : ""}
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        right: 14,
        bottom: 14,
        display: "grid",
        gap: 8,
        padding: "12px 14px",
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(12,12,12,0.82)",
        boxShadow: "0 14px 36px rgba(0,0,0,0.35)",
        zIndex: 35,
        width: compact ? 220 : 240,
        maxWidth: compact ? "90vw" : "calc(100% - 20px)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 900, flex: "1 1 auto" }}>
          Quick navigation
        </div>
        {compact ? (
          <button
            type="button"
            className="apexModalClose"
            onClick={() => setOpen(false)}
            title="Hide navigation"
          >
            ✕
          </button>
        ) : null}
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            className="apexPillBtn"
            onClick={it.onClick}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              width: "100%",
              padding: "10px 12px",
            }}
          >
            <span>{it.label}</span>
            {it.hint ? (
              <span
                style={{
                  fontSize: 11,
                  opacity: 0.75,
                  padding: "2px 8px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.15)",
                }}
              >
                {it.hint}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="apexPillBtn apexPillBtnGold"
        onClick={onTop}
        style={{ width: "100%", padding: "10px 12px" }}
      >
        Back to top
      </button>
    </div>
  );
}

function AppShell() {
  const path = typeof window !== "undefined" ? window.location.pathname : "";
  const isCallbackPath = path === "/auth/callback";

  const isCallbackHash =
    typeof window !== "undefined" &&
    (window.location.hash.startsWith("#/auth/callback") ||
      window.location.hash.startsWith("#auth/callback"));

  if (isCallbackPath || isCallbackHash) return <AuthCallbackInline />;
  return <MainApp />;
}

function MainApp() {
  // Auth
  const [session, setSession] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);

  // Stepper
  const [step, setStep] = useState(1); // 1 prefs, 2 review, 3 checkout, 4 done
  const [isCompact, setIsCompact] = useState(false);

  // Admin (orders)
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminOrders, setAdminOrders] = useState([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminErr, setAdminErr] = useState("");
  const [adminQ, setAdminQ] = useState("");
  const [adminStatusFilter, setAdminStatusFilter] = useState("all");
  const [adminSelected, setAdminSelected] = useState(null);
  const [adminUpdatingId, setAdminUpdatingId] = useState(null);

  // ✅ Admin (stock/origins)
  const [adminOrigins, setAdminOrigins] = useState([]);
  const [adminOriginsLoading, setAdminOriginsLoading] = useState(false);
  const [adminOriginsErr, setAdminOriginsErr] = useState("");

  const [newOrigin, setNewOrigin] = useState({
    code: "",
    name: "",
    stock_g: 0,
    cost_per_g: 0,
    notesCsv: "",
    acidity: 5,
    body: 5,
    sweetness: 5,
    bitterness: 5,
    aroma: 5,
    fruitiness: 5,
    chocolate: 5,
    nutty: 5,
  });

  const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Blend builder
  const [line, setLine] = useState("daily"); // daily|premium
  const [sizeG, setSizeG] = useState(250);
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);

  const [loadingBlend, setLoadingBlend] = useState(false);
  const [blend, setBlend] = useState(null);
  const [blendErr, setBlendErr] = useState("");

  // Save blends
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [savedBlends, setSavedBlends] = useState([]);
  const [loadingSaved, setLoadingSaved] = useState(false);

  // Cart
  const [cart, setCart] = useState([]);

  // Checkout
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [placingOrder, setPlacingOrder] = useState(false);

  // Location (Google Maps pin)
  const [location, setLocation] = useState({
    lat: null,
    lng: null,
    address: "",
    maps_url: null,
    place_id: null,
    mode: "current",
  });

  // Orders (client view)
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [ordersErr, setOrdersErr] = useState("");

  const user = session?.user || null;
  const isAdmin = !!user?.email && (ADMIN_EMAILS.length ? ADMIN_EMAILS.includes(user.email) : false);

  const builderRef = useRef(null);
  const checkoutRef = useRef(null);
  const savedRef = useRef(null);
  const ordersRef = useRef(null);

  const headline = useMemo(() => {
    return {
      titleA: "Purebred Power.",
      titleB: "Pure Arabica.",
      subtitle:
        "AI-crafted blends based on your taste and routine. Your coffee. Your signature.",
      micro: "Your blend. Your identity. Crafted by AI, roasted by APEX.",
    };
  }, []);

  // Load auth session
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) console.warn("getSession error:", error);
      setSession(data.session || null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s || null);
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  // When user logs in, load saved blends + orders
  useEffect(() => {
    if (!user?.id) {
      setSavedBlends([]);
      setOrders([]);
      return;
    }
    loadSavedBlends();
    loadMyOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateCompact = () => setIsCompact(window.innerWidth < 720);
    updateCompact();
    window.addEventListener("resize", updateCompact);
    return () => window.removeEventListener("resize", updateCompact);
  }, []);

  const scrollOpts = useMemo(() => ({ behavior: "smooth", block: "start" }), []);

  const scrollToBuilder = useCallback(() => {
    builderRef.current?.scrollIntoView?.(scrollOpts);
  }, [scrollOpts]);

  const scrollToCheckout = useCallback(() => {
    checkoutRef.current?.scrollIntoView?.(scrollOpts);
  }, [scrollOpts]);

  const scrollToSaved = useCallback(() => {
    savedRef.current?.scrollIntoView?.(scrollOpts);
  }, [scrollOpts]);

  const scrollToOrders = useCallback(() => {
    ordersRef.current?.scrollIntoView?.(scrollOpts);
  }, [scrollOpts]);

  const scrollToTop = useCallback(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  function jumpToStep(k) {
    setStep(k);
    if (k === 1 || k === 2) scrollToBuilder();
    if (k === 3) scrollToCheckout();
    if (k === 4) scrollToOrders();
  }

  useEffect(() => {
    function handleShortcut(e) {
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      if (authOpen || adminOpen) return;
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      const isTyping =
        ["input", "textarea", "select", "option"].includes(tag) ||
        document.activeElement?.isContentEditable;
      if (isTyping) return;

      if (e.key === "1") {
        e.preventDefault();
        setStep(1);
        scrollToBuilder();
      }
      if (e.key === "2") {
        e.preventDefault();
        setStep(3);
        scrollToCheckout();
      }
      if (e.key === "3" && user) {
        e.preventDefault();
        scrollToSaved();
      }
      if (e.key === "4" && user) {
        e.preventDefault();
        setStep(4);
        scrollToOrders();
      }
      if (e.key?.toLowerCase?.() === "t") {
        e.preventDefault();
        scrollToTop();
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [
    scrollToBuilder,
    scrollToCheckout,
    scrollToOrders,
    scrollToSaved,
    scrollToTop,
    user,
    authOpen,
    adminOpen,
  ]);

  async function getAccessToken() {
    const { data, error } = await supabase.auth.getSession();
    if (error) console.log("getSession error:", error);

    const token = data?.session?.access_token || null;
    return token;
  }

  // =========================
  // ✅ Admin Stock APIs
  // =========================
  async function adminLoadOrigins() {
    setAdminOriginsErr("");
    setAdminOriginsLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not logged in");

      const res = await fetch(apiUrl("/api/admin/origins?include_inactive=1"), {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to load origins");
      setAdminOrigins(data.origins || []);
    } catch (e) {
      setAdminOriginsErr(String(e?.message || e));
    } finally {
      setAdminOriginsLoading(false);
    }
  }

  async function adminUpdateOrigin(code, patch) {
    try {
      const token = await getAccessToken();
      const res = await fetch(
        apiUrl(`/api/admin/origins/${encodeURIComponent(code)}`),
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(patch),
        }
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Update failed");

      setAdminOrigins((prev) =>
        prev.map((o) => (o.code === code ? data.origin : o))
      );
    } catch (e) {
      alert(String(e?.message || e));
    }
  }

  async function adminAddOrigin() {
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not logged in");

      const notes = String(newOrigin.notesCsv || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

      const payload = {
        ...newOrigin,
        code: newOrigin.code.trim(),
        name: newOrigin.name.trim() || newOrigin.code.trim(),
        stock_g: parseInt(newOrigin.stock_g || 0, 10),
        cost_per_g: Number(newOrigin.cost_per_g || 0),
        notes,
      };
      delete payload.notesCsv;

      const res = await fetch(apiUrl("/api/admin/origins"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Insert failed");

      setAdminOrigins((prev) => [data.origin, ...prev]);
      setNewOrigin((p) => ({
        ...p,
        code: "",
        name: "",
        stock_g: 0,
        cost_per_g: 0,
        notesCsv: "",
      }));
    } catch (e) {
      alert(String(e?.message || e));
    }
  }

  async function adminDeactivateOrigin(code) {
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not logged in");

      const res = await fetch(
        apiUrl(`/api/admin/origins/${encodeURIComponent(code)}`),
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Delete failed");

      setAdminOrigins((prev) =>
        prev.map((o) =>
          o.code === code ? { ...o, is_active: false, stock_g: 0 } : o
        )
      );
    } catch (e) {
      alert(String(e?.message || e));
    }
  }

  // =========================
  // Blend
  // =========================
  async function fetchBlend() {
    setBlendErr("");
    setSaveMsg("");
    setLoadingBlend(true);
    setBlend(null);

    try {
      const payload = {
        size_g: sizeG,
        line,
        preferences: {
          method: prefs.method,
          strength: prefs.strength,
          flavor_direction: prefs.flavor_direction,
          acidity: prefs.acidity,
          time: prefs.time,
          milk: prefs.milk,
        },
      };

      const res = await fetch(apiUrl("/api/recommend"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to generate blend");

      setBlend(data);
      setStep(2);
      setTimeout(
        () =>
          builderRef.current?.scrollIntoView?.({
            behavior: "smooth",
            block: "start",
          }),
        150
      );
    } catch (e) {
      setBlendErr(String(e?.message || e));
    } finally {
      setLoadingBlend(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setAuthOpen(false);
  }

  async function loadSavedBlends() {
    if (!user) return;
    setLoadingSaved(true);

    try {
      const { data, error } = await supabase
        .from("saved_blends")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30);

      if (error) throw error;
      setSavedBlends(data || []);
    } catch (e) {
      console.error("loadSavedBlends:", e);
    } finally {
      setLoadingSaved(false);
    }
  }

  async function saveCurrentBlend() {
    setSaveMsg("");

    if (!user) {
      setSaveMsg("Login required to save blends.");
      setAuthOpen(true);
      return;
    }
    if (!blend || !Array.isArray(blend.recipe)) return;

    setSaving(true);
    try {
      const row = {
        user_id: user.id,
        line,
        size_g: sizeG,
        preferences: prefs,
        blend_name: String(blend.blend_name_suggestion || "APEX Custom Blend"),
        why: String(blend.why || ""),
        recipe: blend.recipe,
        price: Number(blend.price || 0),
        pricing: blend.pricing ?? null,
      };

      const { error } = await supabase.from("saved_blends").insert([row]);
      if (error) throw error;

      setSaveMsg("Saved ✅");
      await loadSavedBlends();
    } catch (e) {
      setSaveMsg(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  function addBlendToCartFromGenerated() {
    if (!blend) return;

    const item = {
      id: makeId("cart"),
      title: String(blend.blend_name_suggestion || "APEX Custom Blend"),
      line: String(line || "daily"),
      size_g: Number(sizeG || 250),
      price: Number(blend.price || 0),
      recipe: Array.isArray(blend.recipe) ? blend.recipe : [],
      pricing: blend.pricing ?? null,
      why: blend.why ?? null,
      chart: blend.chart ?? null,
    };

    setCart((prev) => [item, ...prev]);
    setStep(3);
    setTimeout(
      () =>
        checkoutRef.current?.scrollIntoView?.({
          behavior: "smooth",
          block: "start",
        }),
      150
    );
  }

  function addSavedBlendToCart(b) {
    if (!b) return;

    const item = {
      id: makeId("cart"),
      title: String(b.blend_name || "APEX Saved Blend"),
      line: String(b.line || "daily"),
      size_g: Number(b.size_g || 250),
      price: Number(b.price || 0),
      recipe: Array.isArray(b.recipe) ? b.recipe : [],
    };

    setCart((prev) => [item, ...prev]);
    setStep(3);
    setTimeout(
      () =>
        checkoutRef.current?.scrollIntoView?.({
          behavior: "smooth",
          block: "start",
        }),
      150
    );
  }

  function removeCartItem(id) {
    setCart((prev) => prev.filter((x) => x.id !== id));
  }

  function clearCart() {
    setCart([]);
  }

  async function placeOrder() {
    if (placingOrder) return;
    if (!user) {
      setAuthOpen(true);
      alert("Login required to place orders.");
      return;
    }
    if (cart.length === 0) {
      alert("Your cart is empty. Add a blend first.");
      return;
    }

    if (!customerName.trim() || !customerPhone.trim() || !customerAddress.trim()) {
      alert("Please fill name, phone, address.");
      return;
    }

    if (!location?.lat || !location?.lng) {
      alert("Please pick delivery location on the map.");
      return;
    }

    try {
      setPlacingOrder(true);
      const orderTotal = cartTotal(cart);

      const fallbackMapsUrl =
        location?.lat && location?.lng
          ? `https://www.google.com/maps?q=${encodeURIComponent(
              Number(location.lat)
            )},${encodeURIComponent(Number(location.lng))}`
          : null;

      const preferencesSnapshot = {
        line,
        size_g: sizeG,
        method: prefs?.method,
        strength: prefs?.strength,
        flavor_direction: prefs?.flavor_direction,
        acidity: prefs?.acidity,
        time: prefs?.time,
        milk: prefs?.milk,
      };

      const locationSnapshot = {
        lat: Number(location.lat),
        lng: Number(location.lng),
        address: location.address || "",
        maps_url: location.maps_url || fallbackMapsUrl,
        place_id: location.place_id || null,
        mode: location.mode || null,
        source: location.source || "google_maps",
        captured_at: new Date().toISOString(),
      };

      const locationMode = location?.mode === "current" ? "current" : "custom";

      const { data: orderRow, error: orderErr } = await supabase
        .from("orders")
        .insert([
          {
            user_id: user.id,
            status: "new",
            payment: "COD",
            customer_name: customerName.trim(),
            customer_phone: customerPhone.trim(),
            customer_address: customerAddress.trim(),
            customer_notes: customerNotes.trim(),
            currency: "EGP",
            total: orderTotal,
            preferences: preferencesSnapshot,
            location_mode: locationMode,
            location_lat: Number(location.lat),
            location_lng: Number(location.lng),
            location_address: location.address ? String(location.address) : null,
            location_maps_url: location.maps_url
              ? String(location.maps_url)
              : fallbackMapsUrl,
            location_place_id: location.place_id
              ? String(location.place_id)
              : null,
            location_snapshot: locationSnapshot,
          },
        ])
        .select("id")
        .single();

      if (orderErr) throw orderErr;

      const orderId = orderRow.id;

      const items = cart.map((it) => ({
        order_id: orderId,
        title: it.title,
        line: it.line,
        size_g: it.size_g,
        price: Number(it.price || 0),
        recipe: it.recipe || [],
        meta: {
          cart_item_id: it.id,
          created_from: "cart",
          pricing: it.pricing ?? null,
          why: it.why ?? null,
          notes: it.notes ?? null,
          chart: it.chart ?? null,
        },
      }));

      const { error: itemsErr } = await supabase.from("order_items").insert(items);
      if (itemsErr) throw itemsErr;

      alert("Order placed ✅");

      clearCart();
      await loadMyOrders();

      setStep(4);
      setTimeout(
        () =>
          ordersRef.current?.scrollIntoView?.({
            behavior: "smooth",
            block: "start",
          }),
        150
      );
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setPlacingOrder(false);
    }
  }

  async function loadMyOrders() {
    if (!user) return;

    setOrdersErr("");
    setLoadingOrders(true);
    try {
      const { data: ords, error: ordErr } = await supabase
        .from("orders")
        .select(
          "id, created_at, updated_at, status, payment, customer_name, customer_phone, customer_address, customer_notes, currency, total, location_lat, location_lng, location_address, location_maps_url, location_place_id"
        )
        .order("created_at", { ascending: false })
        .limit(20);

      if (ordErr) throw ordErr;

      const orderIds = (ords || []).map((o) => o.id);
      let itemsByOrder = {};

      if (orderIds.length) {
        const { data: items, error: itemsErr } = await supabase
          .from("order_items")
          .select("id, order_id, title, line, size_g, price, recipe, meta, created_at")
          .in("order_id", orderIds);

        if (itemsErr) throw itemsErr;

        itemsByOrder = (items || []).reduce((acc, it) => {
          acc[it.order_id] = acc[it.order_id] || [];
          acc[it.order_id].push(it);
          return acc;
        }, {});
      }

      const merged = (ords || []).map((o) => ({
        ...o,
        items: itemsByOrder[o.id] || [],
      }));

      setOrders(merged);
    } catch (e) {
      setOrdersErr(String(e?.message || e));
    } finally {
      setLoadingOrders(false);
    }
  }

  async function adminLoadOrders() {
    setAdminErr("");
    setAdminLoading(true);

    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not logged in (no access_token)");

      const res = await fetch(apiUrl("/api/admin/orders?limit=200"), {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const ct = res.headers.get("content-type") || "";
      const body = ct.includes("application/json")
        ? await res.json().catch(() => ({}))
        : await res.text();

      if (!res.ok) {
        const msg =
          typeof body === "string" ? body.slice(0, 200) : body?.error || "Failed";
        throw new Error(msg);
      }

      setAdminOrders(body.orders || []);
    } catch (e) {
      setAdminErr(String(e?.message || e));
    } finally {
      setAdminLoading(false);
    }
  }

  async function adminSetStatus(orderId, nextStatus) {
    setAdminUpdatingId(orderId);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not logged in");

      const res = await fetch(apiUrl(`/api/admin/orders/${orderId}/status`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: nextStatus }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to update status");

      const updated = data.order;

      setAdminOrders((prev) =>
        prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o))
      );

      if (adminSelected?.id === updated.id) {
        setAdminSelected((s) => (s ? { ...s, ...updated } : s));
      }
    } catch (e) {
      alert(String(e?.message || e));
    } finally {
      setAdminUpdatingId(null);
    }
  }

  const adminFiltered = useMemo(() => {
    const q = adminQ.trim().toLowerCase();
    return adminOrders.filter((o) => {
      const matchStatus =
        adminStatusFilter === "all"
          ? true
          : String(o.status) === adminStatusFilter;
      if (!q) return matchStatus;

      const hay = [
        o.id,
        o.customer_name,
        o.customer_phone,
        o.customer_address,
        o.customer_notes,
        o.payment,
        o.currency,
        o.location_address,
        o.location_maps_url,
        o.user_id,
      ]
        .map((x) => (x == null ? "" : String(x)))
        .join(" ")
        .toLowerCase();

      return matchStatus && hay.includes(q);
    });
  }, [adminOrders, adminQ, adminStatusFilter]);

  const themeClass = line === "premium" ? "apexThemePremium" : "apexThemeDaily";
  const redirectTo =
    typeof window !== "undefined"
      ? `${window.location.origin}/auth/callback`
      : "/auth/callback";
  const hasRequiredDetails =
    customerName.trim() && customerPhone.trim() && customerAddress.trim();
  const hasLocation = !!(location?.lat && location?.lng);
  const canPlaceOrder =
    cart.length > 0 && hasRequiredDetails && hasLocation && !placingOrder;
  const quickNavHidden = authOpen || adminOpen;

  const sensoryKeys = useMemo(
    () => ["acidity", "body", "sweetness", "bitterness", "aroma", "fruitiness", "chocolate", "nutty"],
    []
  );

  const sensoryLabels = useMemo(
    () => ({
      acidity: "Acidity (1-10)",
      body: "Body (1-10)",
      sweetness: "Sweetness (1-10)",
      bitterness: "Bitterness (1-10)",
      aroma: "Aroma (1-10)",
      fruitiness: "Fruitiness (1-10)",
      chocolate: "Chocolate (1-10)",
      nutty: "Nutty (1-10)",
    }),
    []
  );

  return (
    <div className={`apexApp ${themeClass}`}>
      {/* ===== Top bar ===== */}
      <header className="apexTopbar">
        <div className="apexBrand">
          <div className="apexLogo">APEX</div>
          <div className="apexTag">PURE ARABICA</div>
        </div>

        <div className="apexTopActions">
          <button
            className="apexPillBtn"
            type="button"
            onClick={() => {
              if (!user) {
                setAuthOpen(true);
                return;
              }
              if (!isAdmin) {
                alert("Admin only.");
                return;
              }
              setAdminOpen(true);
              adminLoadOrders();
              adminLoadOrigins(); // ✅ load stock too
            }}
            title={isAdmin ? "Admin panel" : "Admins only"}
          >
            Admin
          </button>

          <button
            className="apexPillBtn"
            type="button"
            onClick={() => window.open(apiUrl("/health"), "_blank")}
          >
            Backend
          </button>

          <button
            className="apexPillBtn apexPillBtnGold"
            type="button"
            onClick={() => setAuthOpen(true)}
          >
            {user ? "Account" : "Login"}
          </button>
        </div>
      </header>

      <div className="apexSubline">{headline.micro}</div>

      <Stepper
        step={step}
        onJump={jumpToStep}
        stickyEnabled={!isCompact}
        topOffset={isCompact ? 0 : 72}
      />

      {/* ===== Hero ===== */}
      <section className="apexHero">
        <div className="apexHeroCard">
          <div className="apexHeroText">
            <div className="apexHeroTitle">
              <span className="apexGold">{headline.titleA}</span>{" "}
              <span>{headline.titleB}</span>
            </div>

            <div className="apexHeroSubtitle">{headline.subtitle}</div>

            <div className="apexHeroPills">
              <span className="apexPill">Exact grams</span>
              <span className="apexPill">Fresh roast</span>
              <span className="apexPill">COD</span>
            </div>
          </div>

          <div className="apexHeroHorse" aria-hidden="true" />
        </div>
      </section>

      {/* ===== Main grid ===== */}
      <main className="apexGrid">
        {/* ===== Blend Builder ===== */}
        <section className="apexCard" ref={builderRef}>
          <div className="apexCardHead">
            <div>
              <div className="apexCardTitle">Blend Builder</div>
              <div className="apexCardSub">
                Generate the best blend for your identity
              </div>
            </div>

            <button
              className="apexBtnGold"
              type="button"
              onClick={fetchBlend}
              disabled={loadingBlend}
            >
              {loadingBlend ? "Generating..." : "Generate Blend"}
            </button>
          </div>

          <div className="apexCardDivider" />

          <div className="apexBadges">
            <span className="apexBadge">Accurate grams</span>
            <span className="apexBadge">Stock aware</span>
            <span className="apexBadge">Pricing included</span>
            <span className="apexBadge">Daily / Premium</span>
          </div>

          <div className="apexFormGrid">
            <div className="apexField">
              <div className="apexLabel">Line</div>
              <div className="apexSeg">
                <button
                  type="button"
                  className={`apexSegBtn ${line === "daily" ? "isActive" : ""}`}
                  onClick={() => setLine("daily")}
                >
                  Daily (optimum)
                </button>
                <button
                  type="button"
                  className={`apexSegBtn ${line === "premium" ? "isActive" : ""}`}
                  onClick={() => setLine("premium")}
                >
                  Premium (best taste)
                </button>
              </div>
            </div>

            <div className="apexField">
              <div className="apexLabel">Size</div>
              <select
                className="apexSelect"
                value={sizeG}
                onChange={(e) => setSizeG(parseInt(e.target.value, 10))}
              >
                <option value={250}>250g</option>
                <option value={500}>500g</option>
                <option value={1000}>1kg</option>
              </select>
            </div>

            <div className="apexField">
              <div className="apexLabel">Brew method</div>
              <select
                className="apexSelect"
                value={prefs.method}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, method: e.target.value }))
                }
              >
                {METHOD_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="apexField">
              <div className="apexLabel">Strength</div>
              <select
                className="apexSelect"
                value={prefs.strength}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, strength: e.target.value }))
                }
              >
                {STRENGTH_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="apexField">
              <div className="apexLabel">Flavor direction</div>
              <select
                className="apexSelect"
                value={prefs.flavor_direction}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, flavor_direction: e.target.value }))
                }
              >
                {FLAVOR_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="apexField">
              <div className="apexLabel">Acidity</div>
              <select
                className="apexSelect"
                value={prefs.acidity}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, acidity: e.target.value }))
                }
              >
                {ACIDITY_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="apexField">
              <div className="apexLabel">Time</div>
              <select
                className="apexSelect"
                value={prefs.time}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, time: e.target.value }))
                }
              >
                {TIME_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="apexField">
              <div className="apexLabel">Milk</div>
              <select
                className="apexSelect"
                value={prefs.milk}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, milk: e.target.value }))
                }
              >
                {MILK_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="apexHint">Craft a blend that feels like you.</div>

          {blendErr ? <div className="apexError">{blendErr}</div> : null}

          {blend ? (
            <div className="apexResult">
              <div className="apexResultTop">
                <div>
                  <div className="apexBlendName">
                    {safeText(blend.blend_name_suggestion)}
                  </div>
                  <div className="apexBlendWhy">{safeText(blend.why)}</div>
                </div>

                <div className="apexPriceBox">
                  <div className="apexPriceLabel">Price</div>
                  <div className="apexPrice">{Number(blend.price || 0)} EGP</div>
                </div>
              </div>

              <div className="apexRecipeTitle">Recipe ({sizeG}g)</div>

              <div className="apexRecipeGrid">
                {blend.recipe.map((r, idx) => (
                  <div className="apexRecipeRow" key={`${r.origin_code}-${idx}`}>
                    <div className="apexRecipeOrigin">
                      <div className="apexRecipeName">
                        {safeText(r.origin_name)}
                      </div>
                      <div className="apexRecipeCode">
                        {safeText(r.origin_code)}
                      </div>
                    </div>
                    <div className="apexRecipeGrams">{Number(r.grams)}g</div>
                  </div>
                ))}
              </div>

              {/* ✅ Premium Radar Chart */}
              <BlendPremiumRadar blend={blend} />

              <div className="apexResultActions">
                <button
                  className="apexBtnGold"
                  type="button"
                  onClick={saveCurrentBlend}
                  disabled={!blend || saving}
                >
                  {saving ? "Saving..." : "Save Blend"}
                </button>

                <button
                  className="apexPillBtn apexPillBtnGold"
                  type="button"
                  onClick={addBlendToCartFromGenerated}
                  disabled={!blend || loadingBlend}
                >
                  Add Blend to Cart
                </button>

                <div className="apexSaveMeta">
                  {saveMsg
                    ? saveMsg
                    : user
                    ? `Logged in: ${user.email || user.id}`
                    : "Login to save your blends."}
                </div>
              </div>
            </div>
          ) : null}
        </section>

        {/* ===== Cart & Checkout ===== */}
        <section className="apexCard" ref={checkoutRef}>
          <div className="apexCardHead">
            <div>
              <div className="apexCardTitle">
                Cart & Checkout{" "}
                <span className="apexCountBadge">{cart.length}</span>
              </div>
              <div className="apexCardSub">Cash on delivery MVP</div>
            </div>
            <span className="apexChip">COD</span>
          </div>

          <div className="apexCardDivider" />

          <div className="apexCartBlock">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div className="apexCartTitle">Cart</div>
              <button
                className="apexPillBtn"
                type="button"
                onClick={clearCart}
                disabled={cart.length === 0}
              >
                Clear
              </button>
            </div>

            {cart.length === 0 ? (
              <div className="apexCartEmpty">
                Your cart is empty. Generate a blend, then tap “Add Blend to Cart”.
              </div>
            ) : (
              <div className="apexRecipeGrid" style={{ marginTop: 10 }}>
                {cart.map((it) => (
                  <div className="apexRecipeRow" key={it.id}>
                    <div className="apexRecipeOrigin">
                      <div className="apexRecipeName">{it.title}</div>
                      <div className="apexRecipeCode">
                        {String(it.line).toUpperCase()} • {Number(it.size_g)}g
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <div className="apexRecipeGrams">{Number(it.price)} EGP</div>
                      <button
                        className="apexModalClose"
                        type="button"
                        onClick={() => removeCartItem(it.id)}
                        title="Remove"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="apexTotalBox">
              <div className="apexTotalLabel">Total</div>
              <div className="apexTotalValue">{cartTotal(cart)} EGP</div>
            </div>

            <div className="apexCartTitle" style={{ marginTop: 14 }}>
              Delivery details
            </div>

            <div className="apexCheckoutGrid">
              <input
                className="apexInput"
                placeholder="Customer name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
              <input
                className="apexInput"
                placeholder="01xxxxxxxxx"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
              <input
                className="apexInput"
                placeholder="City, street, building..."
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
              />
              <textarea
                className="apexTextarea"
                placeholder="Optional notes"
                value={customerNotes}
                onChange={(e) => setCustomerNotes(e.target.value)}
              />
            </div>

            <div className="apexCartTitle" style={{ marginTop: 14 }}>
              Delivery location (Google Maps){" "}
              <span style={{ opacity: 0.8 }}>(required)</span>
            </div>

            <GoogleMapsPicker value={location} onChange={setLocation} />

            <button
              className="apexBtnGold"
              type="button"
              style={{ marginTop: 12 }}
              onClick={placeOrder}
              disabled={!canPlaceOrder}
            >
              {placingOrder ? "Placing order…" : "Place Order (Cash on Delivery)"}
            </button>

            {!hasRequiredDetails || !hasLocation ? (
              <div className="apexTinyNote" style={{ marginTop: 6, opacity: 0.8 }}>
                Fill name, phone, address and drop a pin to enable checkout.
              </div>
            ) : null}

            <div className="apexTinyNote" style={{ marginTop: 10 }}>
              Orders are saved with full details + items + recipe + Google location pin.
            </div>
          </div>
        </section>
      </main>

      {/* ===== Saved blends ===== */}
      {user ? (
        <section className="apexSaved" ref={savedRef}>
          <div className="apexSavedHead">
            <div className="apexSavedTitle">My Saved Blends</div>
            <button className="apexPillBtn" type="button" onClick={loadSavedBlends}>
              {loadingSaved ? "Loading..." : "Refresh"}
            </button>
          </div>

          {savedBlends.length === 0 ? (
            <div className="apexSavedEmpty">No saved blends yet.</div>
          ) : (
            <div className="apexSavedGrid">
              {savedBlends.map((b) => (
                <div className="apexSavedCard" key={b.id}>
                  <div className="apexSavedName">{safeText(b.blend_name)}</div>
                  <div className="apexSavedMeta">
                    {safeText(b.line).toUpperCase()} • {Number(b.size_g)}g •{" "}
                    {Number(b.price)} EGP
                  </div>
                  <div className="apexSavedWhen">
                    {b.created_at ? new Date(b.created_at).toLocaleString() : ""}
                  </div>

                  <button
                    className="apexPillBtn apexPillBtnGold"
                    type="button"
                    style={{ marginTop: 10, width: "100%" }}
                    onClick={() => addSavedBlendToCart(b)}
                  >
                    Add to Cart
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {/* ===== My Orders ===== */}
      {user ? (
        <section className="apexSaved" ref={ordersRef}>
          <div className="apexSavedHead">
            <div className="apexSavedTitle">My Orders</div>
            <button className="apexPillBtn" type="button" onClick={loadMyOrders}>
              {loadingOrders ? "Loading..." : "Refresh"}
            </button>
          </div>

          {ordersErr ? <div className="apexError">{ordersErr}</div> : null}

          {orders.length === 0 ? (
            <div className="apexSavedEmpty">No orders yet.</div>
          ) : (
            <div className="apexSavedGrid">
              {orders.map((o) => (
                <div className="apexSavedCard" key={o.id}>
                  <div className="apexSavedName">
                    Order #{String(o.id).slice(0, 8).toUpperCase()}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                      marginTop: 6,
                    }}
                  >
                    <span
                      className={`apexSavedMeta ${statusClass(o.status)}`}
                      style={{
                        display: "inline-flex",
                        borderRadius: 999,
                        padding: "6px 10px",
                        fontWeight: 900,
                        letterSpacing: 0.6,
                      }}
                    >
                      {prettyStatus(o.status)}
                    </span>

                    <div className="apexTinyNote" style={{ opacity: 0.85 }}>
                      {safeText(o.payment)} • {Number(o.total)}{" "}
                      {safeText(o.currency || "EGP")}
                    </div>
                  </div>

                  <OrderTimeline status={o.status} />

                  <div className="apexSavedWhen" style={{ marginTop: 8 }}>
                    {o.created_at ? new Date(o.created_at).toLocaleString() : ""}
                    {o.updated_at ? (
                      <div style={{ opacity: 0.75, fontSize: 12 }}>
                        Updated: {new Date(o.updated_at).toLocaleString()}
                      </div>
                    ) : null}
                  </div>

                  <div className="apexTinyNote" style={{ marginTop: 8 }}>
                    <b>Name:</b> {safeText(o.customer_name)} <br />
                    <b>Phone:</b> {safeText(o.customer_phone)} <br />
                    <b>Address:</b> {safeText(o.customer_address)} <br />
                    {o.customer_notes ? (
                      <>
                        <b>Notes:</b> {safeText(o.customer_notes)} <br />
                      </>
                    ) : null}

                    {o.location_lat && o.location_lng ? (
                      <>
                        <b>Location:</b> {safeText(o.location_address || "Pinned")} <br />
                        <span style={{ opacity: 0.8 }}>
                          lat: {Number(o.location_lat).toFixed(6)} | lng:{" "}
                          {Number(o.location_lng).toFixed(6)}
                        </span>
                        <br />
                        {o.location_maps_url ? (
                          <>
                            <a href={o.location_maps_url} target="_blank" rel="noreferrer">
                              Open in Google Maps
                            </a>
                            <br />
                          </>
                        ) : null}
                      </>
                    ) : null}
                  </div>

                  <div className="apexRecipeTitle" style={{ marginTop: 10 }}>
                    Items
                  </div>

                  {o.items?.length ? (
                    <div className="apexRecipeGrid" style={{ marginTop: 8 }}>
                      {o.items.map((it) => (
                        <div className="apexRecipeRow" key={it.id}>
                          <div className="apexRecipeOrigin">
                            <div className="apexRecipeName">{safeText(it.title)}</div>
                            <div className="apexRecipeCode">
                              {safeText(it.line).toUpperCase()} • {Number(it.size_g)}g
                            </div>

                            {Array.isArray(it.recipe) && it.recipe.length ? (
                              <div className="apexTinyNote" style={{ marginTop: 6 }}>
                                {it.recipe.map((r, idx) => (
                                  <div key={idx}>
                                    {safeText(r.origin_name || r.origin_code)}:{" "}
                                    {Number(r.grams)}g
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>

                          <div className="apexRecipeGrams">{Number(it.price)} EGP</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="apexSavedEmpty">No items found.</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <QuickNav
        onBuilder={scrollToBuilder}
        onCheckout={scrollToCheckout}
        onSaved={user ? scrollToSaved : undefined}
        onOrders={user ? scrollToOrders : undefined}
        onTop={scrollToTop}
        hasSaved={!!user}
        hasOrders={!!user}
        cartCount={cart.length}
        compact={isCompact}
        hidden={quickNavHidden}
      />

      {/* ===== Admin Modal (Admin Panel) ===== */}
      {adminOpen ? (
        <div className="apexModalOverlay" onMouseDown={() => setAdminOpen(false)}>
          <div
            className="apexModalCard"
            onMouseDown={(e) => e.stopPropagation()}
            style={{ width: "min(980px, 100%)" }}
          >
            <div className="apexModalTop">
              <div className="apexModalTitle">Admin Panel</div>
              <button className="apexModalClose" type="button" onClick={() => setAdminOpen(false)}>
                ✕
              </button>
            </div>

            {!isAdmin ? <div className="apexError">Admin only.</div> : null}
            {adminErr ? <div className="apexError">{adminErr}</div> : null}

            {/* ===== Admin Orders ===== */}
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <input
                  className="apexInput"
                  placeholder="Search name / phone / address / order id…"
                  value={adminQ}
                  onChange={(e) => setAdminQ(e.target.value)}
                  disabled={!isAdmin}
                />

                <select
                  className="apexSelect"
                  value={adminStatusFilter}
                  onChange={(e) => setAdminStatusFilter(e.target.value)}
                  disabled={!isAdmin}
                >
                  <option value="all">All statuses</option>
                  <option value="new">New</option>
                  <option value="in_progress">In progress</option>
                  <option value="delivering">Delivering</option>
                  <option value="delivered">Delivered</option>
                  <option value="cancelled">Cancelled</option>
                </select>

                <button
                  className="apexPillBtn"
                  type="button"
                  onClick={adminLoadOrders}
                  disabled={!isAdmin}
                >
                  {adminLoading ? "Loading..." : "Refresh Orders"}
                </button>

                <button
                  className="apexPillBtn apexPillBtnGold"
                  type="button"
                  onClick={adminLoadOrigins}
                  disabled={!isAdmin}
                >
                  {adminOriginsLoading ? "Loading..." : "Refresh Stock"}
                </button>
              </div>

              <div className="apexTinyNote">
                Showing {adminFiltered.length} / {adminOrders.length} orders
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                {adminFiltered.map((o) => (
                  <div key={o.id} className="apexRecipeRow" style={{ alignItems: "flex-start" }}>
                    <div style={{ flex: "1 1 auto" }}>
                      <div style={{ fontWeight: 900 }}>
                        Order #{String(o.id).slice(0, 8).toUpperCase()} • {Number(o.total || 0)}{" "}
                        {safeText(o.currency || "EGP")}
                      </div>
                      <div className="apexTinyNote" style={{ marginTop: 6 }}>
                        <b>{safeText(o.customer_name)}</b> • {safeText(o.customer_phone)} <br />
                        {safeText(o.customer_address)}
                        <br />
                        {o.created_at ? new Date(o.created_at).toLocaleString() : ""}
                        {o.updated_at ? (
                          <div style={{ opacity: 0.75 }}>
                            Updated: {new Date(o.updated_at).toLocaleString()}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
                      <div className={`apexSavedMeta ${statusClass(o.status)}`} style={{ fontWeight: 950 }}>
                        {prettyStatus(o.status)}
                      </div>

                      <select
                        className="apexSelect"
                        value={o.status || "new"}
                        onChange={(e) => adminSetStatus(o.id, e.target.value)}
                        disabled={!isAdmin || adminUpdatingId === o.id}
                      >
                        <option value="new">new</option>
                        <option value="in_progress">in_progress</option>
                        <option value="delivering">delivering</option>
                        <option value="delivered">delivered</option>
                        <option value="cancelled">cancelled</option>
                      </select>

                      <button
                        className="apexPillBtn apexPillBtnGold"
                        type="button"
                        onClick={() => setAdminSelected(o)}
                        disabled={!isAdmin}
                      >
                        View
                      </button>
                    </div>
                  </div>
                ))}

                {adminLoading ? <div className="apexTinyNote">Loading…</div> : null}
                {!adminLoading && adminFiltered.length === 0 ? (
                  <div className="apexSavedEmpty">No matching orders.</div>
                ) : null}
              </div>
            </div>

            {/* ===== Stock Manager ===== */}
            <div className="apexCardDivider" style={{ margin: "14px 0" }} />

            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 950 }}>Stock Manager</div>
              <div className="apexTinyNote" style={{ opacity: 0.85 }}>
                Edit stock / cost, enable/disable, and add new origins.
              </div>
            </div>

            {adminOriginsErr ? <div className="apexError">{adminOriginsErr}</div> : null}

            {/* Add new origin ... form fields above */}

<div
  style={{
    position: "sticky",
    bottom: 10,
    zIndex: 50,
    paddingTop: 10,
    background: "linear-gradient(to top, rgba(12,12,12,0.95), rgba(12,12,12,0))",
  }}
>
  <button
    className="apexBtnGold"
    type="button"
    onClick={adminAddOrigin}
    disabled={!isAdmin}
    style={{ width: "100%" }}
  >
    Insert Origin
  </button>

  <div className="apexTinyNote" style={{ marginTop: 6, opacity: 0.8 }}>
    Insert بيضيف Origin جديد في DB بالـ code + stock + cost + sensory.
  </div>
</div>


                <div className="apexField">
                  <div className="apexLabel">Display name</div>
                  <input
                    className="apexInput"
                    placeholder="e.g. Ethiopia Sidamo"
                    value={newOrigin.name}
                    onChange={(e) => setNewOrigin((p) => ({ ...p, name: e.target.value }))}
                    disabled={!isAdmin}
                  />
                </div>

                <div className="apexField">
                  <div className="apexLabel">Stock (grams)</div>
                  <input
                    className="apexInput"
                    type="number"
                    placeholder="stock_g"
                    value={Number(newOrigin.stock_g || 0)}
                    onChange={(e) =>
                      setNewOrigin((p) => ({
                        ...p,
                        stock_g: parseInt(e.target.value || "0", 10),
                      }))
                    }
                    disabled={!isAdmin}
                  />
                </div>

                <div className="apexField">
                  <div className="apexLabel">Cost per gram</div>
                  <input
                    className="apexInput"
                    type="number"
                    step="0.01"
                    placeholder="cost_per_g"
                    value={Number(newOrigin.cost_per_g || 0)}
                    onChange={(e) =>
                      setNewOrigin((p) => ({
                        ...p,
                        cost_per_g: Number(e.target.value || "0"),
                      }))
                    }
                    disabled={!isAdmin}
                  />
                </div>
              </div>

              <div className="apexField">
                <div className="apexLabel">Notes (CSV)</div>
                <input
                  className="apexInput"
                  placeholder='Example: chocolate,nuts,floral'
                  value={newOrigin.notesCsv}
                  onChange={(e) => setNewOrigin((p) => ({ ...p, notesCsv: e.target.value }))}
                  disabled={!isAdmin}
                />
              </div>

              <div className="apexTinyNote" style={{ opacity: 0.85 }}>
                Sensory scores are 1..10 (used by AI for matching, not “fake tasting claims”).
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                {sensoryKeys.map((k) => (
                  <div key={k} className="apexField">
                    <div className="apexLabel">{sensoryLabels[k]}</div>
                    <input
                      className="apexInput"
                      type="number"
                      min="1"
                      max="10"
                      step="1"
                      placeholder={k}
                      value={Number(newOrigin[k] ?? 5)}
                      onChange={(e) =>
                        setNewOrigin((p) => ({ ...p, [k]: parseInt(e.target.value || "5", 10) }))
                      }
                      disabled={!isAdmin}
                    />
                  </div>
                ))}
              </div>

              <button className="apexBtnGold" type="button" onClick={adminAddOrigin} disabled={!isAdmin}>
                Add Origin
              </button>
            </div>

            {/* List origins */}
            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              {adminOrigins.length === 0 ? (
                <div className="apexSavedEmpty">
                  {adminOriginsLoading ? "Loading stock…" : "No origins loaded yet. Tap Refresh Stock."}
                </div>
              ) : null}

              {adminOrigins.map((o) => (
                <div
                  key={o.code}
                  className="apexRecipeRow"
                  style={{ alignItems: "center" }}
                >
                  <div style={{ flex: "1 1 auto" }}>
                    <div style={{ fontWeight: 950 }}>
                      {o.name}{" "}
                      <span style={{ opacity: 0.7, fontWeight: 800 }}>
                        ({o.code})
                      </span>
                    </div>
                    <div className="apexTinyNote">
                      Active: <b>{o.is_active ? "YES" : "NO"}</b> • Notes:{" "}
                      {Array.isArray(o.notes) ? o.notes.join(", ") : ""}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-end",
                      flexWrap: "wrap",
                      justifyContent: "flex-end",
                    }}
                  >
                    <div className="apexField" style={{ margin: 0, width: 140 }}>
                      <div className="apexLabel">Stock (g)</div>
                      <input
                        className="apexInput"
                        type="number"
                        value={Number(o.stock_g || 0)}
                        onChange={(e) =>
                          setAdminOrigins((prev) =>
                            prev.map((x) =>
                              x.code === o.code
                                ? { ...x, stock_g: parseInt(e.target.value || "0", 10) }
                                : x
                            )
                          )
                        }
                        onBlur={() =>
                          adminUpdateOrigin(o.code, { stock_g: Number(o.stock_g || 0) })
                        }
                        disabled={!isAdmin}
                      />
                    </div>

                    <div className="apexField" style={{ margin: 0, width: 140 }}>
                      <div className="apexLabel">Cost / g</div>
                      <input
                        className="apexInput"
                        type="number"
                        step="0.01"
                        value={Number(o.cost_per_g || 0)}
                        onChange={(e) =>
                          setAdminOrigins((prev) =>
                            prev.map((x) =>
                              x.code === o.code
                                ? { ...x, cost_per_g: Number(e.target.value || "0") }
                                : x
                            )
                          )
                        }
                        onBlur={() =>
                          adminUpdateOrigin(o.code, { cost_per_g: Number(o.cost_per_g || 0) })
                        }
                        disabled={!isAdmin}
                      />
                    </div>

                    <button
                      className="apexPillBtn"
                      type="button"
                      onClick={() => adminUpdateOrigin(o.code, { is_active: !o.is_active })}
                      disabled={!isAdmin}
                      title="Toggle active"
                      style={{ height: 42 }}
                    >
                      {o.is_active ? "Disable" : "Enable"}
                    </button>

                    <button
                      className="apexPillBtn"
                      type="button"
                      onClick={() => adminDeactivateOrigin(o.code)}
                      disabled={!isAdmin}
                      title="Soft delete (is_active=false, stock=0)"
                      style={{ height: 42 }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* ===== Order details modal ===== */}
            {adminSelected ? (
              <div
                className="apexModalOverlay"
                onMouseDown={() => setAdminSelected(null)}
                style={{ background: "rgba(0,0,0,.55)" }}
              >
                <div
                  className="apexModalCard"
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{ width: "min(920px, 100%)" }}
                >
                  <div className="apexModalTop">
                    <div className="apexModalTitle">
                      Order #{String(adminSelected.id).slice(0, 8).toUpperCase()}
                    </div>
                    <button className="apexModalClose" type="button" onClick={() => setAdminSelected(null)}>
                      ✕
                    </button>
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <div className={`apexSavedMeta ${statusClass(adminSelected.status)}`} style={{ fontWeight: 950 }}>
                      {prettyStatus(adminSelected.status)}
                    </div>

                    <select
                      className="apexSelect"
                      value={adminSelected.status || "new"}
                      onChange={(e) => adminSetStatus(adminSelected.id, e.target.value)}
                      disabled={!isAdmin || adminUpdatingId === adminSelected.id}
                      style={{ maxWidth: 220 }}
                    >
                      <option value="new">new</option>
                      <option value="in_progress">in_progress</option>
                      <option value="delivering">delivering</option>
                      <option value="delivered">delivered</option>
                      <option value="cancelled">cancelled</option>
                    </select>

                    <div className="apexTinyNote">
                      Total:{" "}
                      <b>
                        {Number(adminSelected.total || 0)} {safeText(adminSelected.currency || "EGP")}
                      </b>
                    </div>
                  </div>

                  <div className="apexCardDivider" style={{ margin: "12px 0" }} />

                  <div className="apexTinyNote" style={{ lineHeight: 1.6 }}>
                    <b>Customer:</b> {safeText(adminSelected.customer_name)} <br />
                    <b>Phone:</b> {safeText(adminSelected.customer_phone)} <br />
                    <b>Address:</b> {safeText(adminSelected.customer_address)} <br />
                    {adminSelected.customer_notes ? (
                      <>
                        <b>Notes:</b> {safeText(adminSelected.customer_notes)} <br />
                      </>
                    ) : null}
                    <b>Payment:</b> {safeText(adminSelected.payment)} <br />
                    <b>Created:</b>{" "}
                    {adminSelected.created_at ? new Date(adminSelected.created_at).toLocaleString() : ""}
                    <br />
                    {adminSelected.updated_at ? (
                      <>
                        <b>Updated:</b> {new Date(adminSelected.updated_at).toLocaleString()} <br />
                      </>
                    ) : null}
                  </div>

                  {adminSelected.location_lat && adminSelected.location_lng ? (
                    <div className="apexResult" style={{ margin: "12px 0 0" }}>
                      <div style={{ fontWeight: 900, marginBottom: 6 }}>Location</div>
                      <div className="apexTinyNote">
                        {safeText(adminSelected.location_address || "Pinned")}
                        <br />
                        lat: {Number(adminSelected.location_lat).toFixed(6)} | lng:{" "}
                        {Number(adminSelected.location_lng).toFixed(6)}
                        <br />
                        {adminSelected.location_maps_url ? (
                          <a href={adminSelected.location_maps_url} target="_blank" rel="noreferrer">
                            Open in Google Maps
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <div className="apexRecipeTitle" style={{ marginTop: 14 }}>
                    Items
                  </div>
                  {adminSelected.items?.length ? (
                    <div className="apexRecipeGrid" style={{ marginTop: 8 }}>
                      {adminSelected.items.map((it) => (
                        <div className="apexRecipeRow" key={it.id}>
                          <div className="apexRecipeOrigin">
                            <div className="apexRecipeName">{safeText(it.title)}</div>
                            <div className="apexRecipeCode">
                              {safeText(it.line).toUpperCase()} • {Number(it.size_g)}g
                            </div>
                            {Array.isArray(it.recipe) && it.recipe.length ? (
                              <div className="apexTinyNote" style={{ marginTop: 6 }}>
                                {it.recipe.map((r, idx) => (
                                  <div key={idx}>
                                    {safeText(r.origin_name || r.origin_code)}: {Number(r.grams)}g
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          <div className="apexRecipeGrams">{Number(it.price)} EGP</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="apexSavedEmpty">No items.</div>
                  )}

                  {adminSelected.location_snapshot || adminSelected.preferences ? (
                    <div className="apexResult" style={{ marginTop: 14 }}>
                      <div style={{ fontWeight: 900, marginBottom: 6 }}>Raw Snapshots</div>
                      <pre
                        style={{
                          margin: 0,
                          whiteSpace: "pre-wrap",
                          fontSize: 12,
                          color: "rgba(255,255,255,.78)",
                        }}
                      >
                        {JSON.stringify(
                          {
                            preferences: adminSelected.preferences ?? null,
                            location_snapshot: adminSelected.location_snapshot ?? null,
                          },
                          null,
                          2
                        )}
                      </pre>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ===== Auth Modal ===== */}
      {authOpen ? (
        <div className="apexModalOverlay" onMouseDown={() => setAuthOpen(false)}>
          <div className="apexModalCard" onMouseDown={(e) => e.stopPropagation()}>
            <div className="apexModalTop">
              <div className="apexModalTitle">{user ? "Account" : "Login"}</div>
              <button className="apexModalClose" type="button" onClick={() => setAuthOpen(false)}>
                ✕
              </button>
            </div>

            {user ? (
              <div className="apexAccountBox">
                <div className="apexAccountLine">
                  Signed in as: <b>{user.email || user.id}</b>
                </div>
                <button className="apexBtnGold" type="button" onClick={signOut}>
                  Sign out
                </button>
              </div>
            ) : (
              <Auth
                supabaseClient={supabase}
                appearance={{ theme: ThemeSupa }}
                providers={["google"]}
                redirectTo={redirectTo}
                theme="dark"
              />
            )}

            <div className="apexTinyNote" style={{ marginTop: 10 }}>
              Email + Google works. Phone OTP needs an SMS provider.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  return <AppShell />;
}
