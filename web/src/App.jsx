import React, { useEffect, useMemo, useRef, useState } from "react";
import "./apex.css";

import { supabase } from "./supabaseClient";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";

// ===== Leaflet (Free map) =====
import "leaflet/dist/leaflet.css";
import L from "leaflet";

/**
 * Fix Leaflet marker icons for Vite/React builds
 */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

/**
 * API base:
 * - لو شغال لوكال: حط VITE_API_BASE=http://localhost:3001
 * - لو نفس الدومين (Render Serve static + API نفس السيرفيس): سيبه فاضي
 */
const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

function apiUrl(path) {
  if (!API_BASE) return path;
  return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
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
      return "New";
    case "in_progress":
      return "In Progress";
    case "delivering":
      return "Delivering";
    case "delivered":
      return "Delivered";
    default:
      return safeText(s);
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
    default:
      return "";
  }
}

/**
 * ===== FREE reverse geocode (OpenStreetMap Nominatim) =====
 * (free, but respect rate limits)
 */
async function reverseGeocodeFree(lat, lng) {
  try {
    const url =
      "https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=" +
      encodeURIComponent(lat) +
      "&lon=" +
      encodeURIComponent(lng);

    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const data = await res.json().catch(() => ({}));
    return data?.display_name || "";
  } catch {
    return "";
  }
}

/**
 * ===== LeafletMapPicker (NO react-leaflet) =====
 * value: {lat,lng,address,maps_url}
 */
function LeafletMapPicker({ value, onChange }) {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);

  const initialCenter = useMemo(() => {
    if (value?.lat && value?.lng) return [value.lat, value.lng];
    return [30.0444, 31.2357]; // Cairo default
  }, [value?.lat, value?.lng]);

  useEffect(() => {
    if (!mapDivRef.current) return;
    if (mapRef.current) return;

    const map = L.map(mapDivRef.current, {
      center: initialCenter,
      zoom: 15,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    map.on("click", async (e) => {
      const lat = e.latlng.lat;
      const lng = e.latlng.lng;

      if (!markerRef.current) {
        markerRef.current = L.marker([lat, lng]).addTo(map);
      } else {
        markerRef.current.setLatLng([lat, lng]);
      }

      const addr = await reverseGeocodeFree(lat, lng);
      onChange?.({
        ...(value || {}),
        lat,
        lng,
        address: addr || (value?.address || ""),
      });
    });

    mapRef.current = map;

    return () => {
      try {
        map.off();
        map.remove();
      } catch {}
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (value?.lat && value?.lng) {
      const lat = Number(value.lat);
      const lng = Number(value.lng);
      const ll = [lat, lng];

      if (!markerRef.current) {
        markerRef.current = L.marker(ll).addTo(map);
      } else {
        markerRef.current.setLatLng(ll);
      }

      // move view nicely
      map.setView(ll, Math.max(map.getZoom(), 15), { animate: true });
    }
  }, [value?.lat, value?.lng]);

  async function useMyLocation() {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported in this browser.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        const map = mapRef.current;
        if (map) map.setView([lat, lng], 16, { animate: true });

        const addr = await reverseGeocodeFree(lat, lng);

        onChange?.({
          ...(value || {}),
          lat,
          lng,
          address: addr || (value?.address || ""),
        });
      },
      (err) => {
        alert("Could not get location: " + (err?.message || "Unknown error"));
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  function openGoogleMapsAtPin() {
    if (!value?.lat || !value?.lng) return;
    const url = `https://www.google.com/maps?q=${encodeURIComponent(
      Number(value.lat)
    )},${encodeURIComponent(Number(value.lng))}`;
    window.open(url, "_blank");
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button className="apexPillBtn apexPillBtnGold" type="button" onClick={useMyLocation}>
          Use my current location
        </button>

        <button className="apexPillBtn" type="button" onClick={openGoogleMapsAtPin} disabled={!value?.lat || !value?.lng}>
          Open in Google Maps
        </button>

        <div className="apexTinyNote" style={{ opacity: 0.85 }}>
          أو اضغط على الخريطة لتحط Pin.
        </div>
      </div>

      <div
        ref={mapDivRef}
        style={{
          height: 280,
          borderRadius: 16,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.10)",
        }}
      />

      <input
        className="apexInput"
        placeholder="Detected address (you can edit)"
        value={value?.address || ""}
        onChange={(e) => onChange?.({ ...(value || {}), address: e.target.value })}
      />

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
 * Supabase هيرجعك على: /#/auth/callback
 */
function AuthCallbackInline() {
  const [msg, setMsg] = useState("Signing you in…");

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) console.warn("callback getSession error:", error);
        if (!alive) return;

        if (data?.session) setMsg("Signed in ✅ Redirecting…");
        else setMsg("No session found. Redirecting…");
      } catch (e) {
        console.warn("callback exception:", e);
        if (alive) setMsg("Error during login. Redirecting…");
      } finally {
        setTimeout(() => {
          window.location.hash = "#/";
        }, 400);
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

function AppShell() {
  const isCallback =
    typeof window !== "undefined" &&
    (window.location.hash.startsWith("#/auth/callback") ||
      window.location.hash.startsWith("#auth/callback"));

  if (isCallback) return <AuthCallbackInline />;
  return <MainApp />;
}

function MainApp() {
  // Auth
  const [session, setSession] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);

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

  // Location (map pin)
  const [location, setLocation] = useState({ lat: null, lng: null, address: "" });

  // Orders (client view)
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [ordersErr, setOrdersErr] = useState("");

  const user = session?.user || null;

  const headline = useMemo(() => {
    return {
      titleA: "Purebred Power.",
      titleB: "Pure Arabica.",
      subtitle: "AI-crafted blends based on your taste and routine. Your coffee. Your signature.",
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
    };

    setCart((prev) => [item, ...prev]);
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
  }

  function removeCartItem(id) {
    setCart((prev) => prev.filter((x) => x.id !== id));
  }

  function clearCart() {
    setCart([]);
  }

  async function placeOrder() {
    if (!user) {
      setAuthOpen(true);
      alert("Login required to place orders.");
      return;
    }
    if (cart.length === 0) return;

    if (!customerName.trim() || !customerPhone.trim() || !customerAddress.trim()) {
      alert("Please fill name, phone, address.");
      return;
    }

    // Require map pin
    if (!location?.lat || !location?.lng) {
      alert("Please pick delivery location on the map.");
      return;
    }

    try {
      const orderTotal = cartTotal(cart);

      const mapsUrl =
        location?.lat && location?.lng
          ? `https://www.google.com/maps?q=${encodeURIComponent(Number(location.lat))},${encodeURIComponent(
              Number(location.lng)
            )}`
          : null;

      // 1) create order header
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

            // location
            location_lat: Number(location.lat),
            location_lng: Number(location.lng),
            location_address: location.address ? String(location.address) : null,
            location_maps_url: mapsUrl,
          },
        ])
        .select("id")
        .single();

      if (orderErr) throw orderErr;

      const orderId = orderRow.id;

      // 2) insert items
      const items = cart.map((it) => ({
        order_id: orderId,
        title: it.title,
        line: it.line,
        size_g: it.size_g,
        price: Number(it.price || 0),
        recipe: it.recipe || [],
      }));

      const { error: itemsErr } = await supabase.from("order_items").insert(items);
      if (itemsErr) throw itemsErr;

      alert("Order placed ✅");

      clearCart();
      await loadMyOrders();
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
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
          "id, created_at, status, payment, customer_name, customer_phone, customer_address, customer_notes, currency, total, location_lat, location_lng, location_address, location_maps_url"
        )
        .order("created_at", { ascending: false })
        .limit(20);

      if (ordErr) throw ordErr;

      const orderIds = (ords || []).map((o) => o.id);
      let itemsByOrder = {};

      if (orderIds.length) {
        const { data: items, error: itemsErr } = await supabase
          .from("order_items")
          .select("id, order_id, title, line, size_g, price, recipe")
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

  const themeClass = line === "premium" ? "apexThemePremium" : "apexThemeDaily";
  const redirectTo = `${window.location.origin}/#/auth/callback`;

  return (
    <div className={`apexApp ${themeClass}`}>
      {/* ===== Top bar ===== */}
      <header className="apexTopbar">
        <div className="apexBrand">
          <div className="apexLogo">APEX</div>
          <div className="apexTag">PURE ARABICA</div>
        </div>

        <div className="apexTopActions">
          <button className="apexPillBtn" type="button" onClick={() => alert("Admin panel (next)")}>
            Admin
          </button>

          <button className="apexPillBtn" type="button" onClick={() => window.open(apiUrl("/health"), "_blank")}>
            Backend
          </button>

          <button className="apexPillBtn apexPillBtnGold" type="button" onClick={() => setAuthOpen(true)}>
            {user ? "Account" : "Login"}
          </button>
        </div>
      </header>

      <div className="apexSubline">{headline.micro}</div>

      {/* ===== Hero ===== */}
      <section className="apexHero">
        <div className="apexHeroCard">
          <div className="apexHeroText">
            <div className="apexHeroTitle">
              <span className="apexGold">{headline.titleA}</span> <span>{headline.titleB}</span>
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
        <section className="apexCard">
          <div className="apexCardHead">
            <div>
              <div className="apexCardTitle">Blend Builder</div>
              <div className="apexCardSub">Generate the best blend for your identity</div>
            </div>

            <button className="apexBtnGold" type="button" onClick={fetchBlend} disabled={loadingBlend}>
              {loadingBlend ? "Generating..." : "Get My Blend"}
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
              <select className="apexSelect" value={sizeG} onChange={(e) => setSizeG(parseInt(e.target.value, 10))}>
                <option value={250}>250g</option>
                <option value={500}>500g</option>
                <option value={1000}>1kg</option>
              </select>
            </div>

            <div className="apexField">
              <div className="apexLabel">Brew method</div>
              <select className="apexSelect" value={prefs.method} onChange={(e) => setPrefs((p) => ({ ...p, method: e.target.value }))}>
                {METHOD_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="apexField">
              <div className="apexLabel">Strength</div>
              <select className="apexSelect" value={prefs.strength} onChange={(e) => setPrefs((p) => ({ ...p, strength: e.target.value }))}>
                {STRENGTH_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="apexField">
              <div className="apexLabel">Flavor direction</div>
              <select className="apexSelect" value={prefs.flavor_direction} onChange={(e) => setPrefs((p) => ({ ...p, flavor_direction: e.target.value }))}>
                {FLAVOR_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="apexField">
              <div className="apexLabel">Acidity</div>
              <select className="apexSelect" value={prefs.acidity} onChange={(e) => setPrefs((p) => ({ ...p, acidity: e.target.value }))}>
                {ACIDITY_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="apexField">
              <div className="apexLabel">Time</div>
              <select className="apexSelect" value={prefs.time} onChange={(e) => setPrefs((p) => ({ ...p, time: e.target.value }))}>
                {TIME_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="apexField">
              <div className="apexLabel">Milk</div>
              <select className="apexSelect" value={prefs.milk} onChange={(e) => setPrefs((p) => ({ ...p, milk: e.target.value }))}>
                {MILK_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>{o.label}</option>
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
                  <div className="apexBlendName">{safeText(blend.blend_name_suggestion)}</div>
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
                      <div className="apexRecipeName">{safeText(r.origin_name)}</div>
                      <div className="apexRecipeCode">{safeText(r.origin_code)}</div>
                    </div>
                    <div className="apexRecipeGrams">{Number(r.grams)}g</div>
                  </div>
                ))}
              </div>

              <div className="apexResultActions">
                <button className="apexBtnGold" type="button" onClick={saveCurrentBlend} disabled={!blend || saving}>
                  {saving ? "Saving..." : "Save Blend"}
                </button>

                <button className="apexPillBtn apexPillBtnGold" type="button" onClick={addBlendToCartFromGenerated} disabled={!blend}>
                  Add to Cart
                </button>

                <div className="apexSaveMeta">
                  {saveMsg ? saveMsg : user ? `Logged in: ${user.email || user.id}` : "Login to save your blends."}
                </div>
              </div>
            </div>
          ) : null}
        </section>

        {/* ===== Cart & Checkout ===== */}
        <section className="apexCard">
          <div className="apexCardHead">
            <div>
              <div className="apexCardTitle">Cart & Checkout</div>
              <div className="apexCardSub">Cash on delivery MVP</div>
            </div>
            <span className="apexChip">COD</span>
          </div>

          <div className="apexCardDivider" />

          <div className="apexCartBlock">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div className="apexCartTitle">Cart</div>
              <button className="apexPillBtn" type="button" onClick={clearCart} disabled={cart.length === 0}>
                Clear
              </button>
            </div>

            {cart.length === 0 ? (
              <div className="apexCartEmpty">Empty</div>
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
                      <button className="apexModalClose" type="button" onClick={() => removeCartItem(it.id)} title="Remove">
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
              <input className="apexInput" placeholder="Customer name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              <input className="apexInput" placeholder="01xxxxxxxxx" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
              <input className="apexInput" placeholder="City, street, building..." value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} />
              <textarea className="apexTextarea" placeholder="Optional notes" value={customerNotes} onChange={(e) => setCustomerNotes(e.target.value)} />
            </div>

            <div className="apexCartTitle" style={{ marginTop: 14 }}>
              Delivery location (required)
            </div>

            <LeafletMapPicker value={location} onChange={setLocation} />

            <button className="apexBtnGold" type="button" style={{ marginTop: 12 }} onClick={placeOrder} disabled={cart.length === 0}>
              Place Order
            </button>

            <div className="apexTinyNote" style={{ marginTop: 10 }}>
              Orders are saved with full details + items + recipe + location pin.
            </div>
          </div>
        </section>
      </main>

      {/* ===== Saved blends ===== */}
      {user ? (
        <section className="apexSaved">
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
                    {safeText(b.line).toUpperCase()} • {Number(b.size_g)}g • {Number(b.price)} EGP
                  </div>
                  <div className="apexSavedWhen">{b.created_at ? new Date(b.created_at).toLocaleString() : ""}</div>

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
        <section className="apexSaved">
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
                  <div className="apexSavedName">Order #{String(o.id).slice(0, 8).toUpperCase()}</div>

                  <div className={`apexSavedMeta ${statusClass(o.status)}`}>
                    {prettyStatus(o.status)} • {safeText(o.payment)} • {Number(o.total)} {safeText(o.currency || "EGP")}
                  </div>

                  <div className="apexSavedWhen">{o.created_at ? new Date(o.created_at).toLocaleString() : ""}</div>

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
                          lat: {Number(o.location_lat).toFixed(6)} | lng: {Number(o.location_lng).toFixed(6)}
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
                    <div className="apexSavedEmpty">No items found.</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
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
