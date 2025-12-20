import React, { useEffect, useMemo, useState } from "react";
import "./apex.css";

import { supabase } from "./supabaseClient";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";

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

export default function App() {
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

  const user = session?.user || null;
  const canSave = Boolean(user && blend && Array.isArray(blend.recipe));

  const headline = useMemo(() => {
    // الجمل اللي انت شايفها أحسن: تمام جدًا
    return {
      titleA: "Purebred Power.",
      titleB: "Pure Arabica.",
      subtitle:
        "AI-crafted blends based on your taste and routine. Your coffee. Your signature.",
      micro:
        "Your blend. Your identity. Crafted by AI, roasted by APEX.",
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

  // When user logs in, load their saved blends
  useEffect(() => {
    if (!user?.id) {
      setSavedBlends([]);
      return;
    }
    loadSavedBlends();
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
        .limit(20);

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
        blend_name: safeText(blend.blend_name_suggestion || "APEX Custom Blend"),
        line,
        size_g: sizeG,
        preferences: prefs,
        recipe: blend.recipe,
        price: Number(blend.price || 0),
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

  // Theme class: premium يغيّر الإضاءة كلها + يوضح الحصان
  const themeClass = line === "premium" ? "apexThemePremium" : "apexThemeDaily";

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
            onClick={() => alert("Admin panel (next)")}
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

          {/* Horse area */}
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
              <div className="apexCardSub">
                Get the main recommendation, plus an alternative pick
              </div>
            </div>

            <button
              className="apexBtnGold"
              type="button"
              onClick={fetchBlend}
              disabled={loadingBlend}
            >
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
            {/* Line */}
            <div className="apexField">
              <div className="apexLabel">Line</div>
              <div className="apexSeg">
                <button
                  type="button"
                  className={`apexSegBtn ${
                    line === "daily" ? "isActive" : ""
                  }`}
                  onClick={() => setLine("daily")}
                >
                  Daily (optimum)
                </button>
                <button
                  type="button"
                  className={`apexSegBtn ${
                    line === "premium" ? "isActive" : ""
                  }`}
                  onClick={() => setLine("premium")}
                >
                  Premium (best taste)
                </button>
              </div>
            </div>

            {/* Size */}
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

            {/* Brew */}
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

            {/* Strength */}
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

            {/* Flavor */}
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

            {/* Acidity */}
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

            {/* Time */}
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

            {/* Milk */}
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

          {/* Errors */}
          {blendErr ? <div className="apexError">{blendErr}</div> : null}

          {/* Result */}
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

              <div className="apexResultActions">
                <button
                  className="apexBtnGold"
                  type="button"
                  onClick={saveCurrentBlend}
                  disabled={!blend || saving}
                >
                  {saving ? "Saving..." : "Save Blend"}
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

        {/* ===== Cart & Checkout (placeholder) ===== */}
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
            <div className="apexCartTitle">Cart</div>
            <div className="apexCartEmpty">Empty</div>

            <div className="apexTotalBox">
              <div className="apexTotalLabel">Total</div>
              <div className="apexTotalValue">0 EGP</div>
            </div>

            <div className="apexCartTitle" style={{ marginTop: 14 }}>
              Delivery details
            </div>

            <div className="apexCheckoutGrid">
              <input className="apexInput" placeholder="Customer name" />
              <input className="apexInput" placeholder="01xxxxxxxxx" />
              <input className="apexInput" placeholder="City, street, building..." />
              <textarea className="apexTextarea" placeholder="Optional notes" />
            </div>

            <button className="apexBtnGold" type="button" style={{ marginTop: 12 }}>
              Place Order
            </button>

            <div className="apexTinyNote" style={{ marginTop: 10 }}>
              Orders are stored in <code>server/data/orders.json</code> (MVP)
            </div>
          </div>
        </section>
      </main>

      {/* ===== Saved blends (visible only when logged in) ===== */}
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
                    {safeText(b.line).toUpperCase()} • {Number(b.size_g)}g •{" "}
                    {Number(b.price)} EGP
                  </div>
                  <div className="apexSavedWhen">
                    {b.created_at ? new Date(b.created_at).toLocaleString() : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {/* ===== Auth Modal ===== */}
      {authOpen ? (
        <div className="apexModalOverlay" onMouseDown={() => setAuthOpen(false)}>
          <div
            className="apexModalCard"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="apexModalTop">
              <div className="apexModalTitle">{user ? "Account" : "Login"}</div>
              <button
                className="apexModalClose"
                onClick={() => setAuthOpen(false)}
              >
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
                providers={["google"]}   // شيل apple
                redirectTo={window.location.origin}
                theme="dark"
              />
              
            )}

            <div className="apexTinyNote" style={{ marginTop: 10 }}>
              Email + Google/Apple works now. Phone OTP needs an SMS provider.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
