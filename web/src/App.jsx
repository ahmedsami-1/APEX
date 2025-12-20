import React, { useEffect, useMemo, useState } from "react";
import "./apex.css";
console.log("SUPABASE URL:", import.meta.env.VITE_SUPABASE_URL);
console.log("SUPABASE KEY:", import.meta.env.VITE_SUPABASE_ANON_KEY);
import { supabase } from "./supabaseClient";

supabase.auth.getSession().then(({ data, error }) => {
  console.log("SESSION:", data?.session);
  console.log("SESSION ERROR:", error);
});

//import { supabase } from "./supabaseClient";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";

const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, ""); // optional

function apiUrl(path) {
  // If VITE_API_BASE is empty, assume same origin
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

export default function App() {
  const [session, setSession] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);

  const [line, setLine] = useState("daily"); // daily|premium
  const [sizeG, setSizeG] = useState(250);
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);

  const [loadingBlend, setLoadingBlend] = useState(false);
  const [blend, setBlend] = useState(null);
  const [blendErr, setBlendErr] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const [savedBlends, setSavedBlends] = useState([]);
  const [loadingSaved, setLoadingSaved] = useState(false);

  const user = session?.user || null;

  // Session bootstrap
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
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

  const canSave = Boolean(user && blend && blend.recipe && Array.isArray(blend.recipe));

  const headline = useMemo(() => {
    // You asked for better copy like: "Your coffee, your identity"
    return {
      title: "Purebred Power. Pure Arabica.",
      subtitle:
        "AI-crafted blends based on your taste and routine. Your coffee. Your signature.",
    };
  }, []);

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

      const data = await res.json();
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
        .limit(10);

      if (error) throw error;
      setSavedBlends(data || []);
    } catch (e) {
      // Don't hard-fail UI
      console.error(e);
    } finally {
      setLoadingSaved(false);
    }
  }

  // Auto load saved blends on login
  useEffect(() => {
    if (user) loadSavedBlends();
    else setSavedBlends([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function saveCurrentBlend() {
    setSaveMsg("");
    if (!user) {
      setSaveMsg("Login required to save blends.");
      setAuthOpen(true);
      return;
    }
    if (!blend) return;

    setSaving(true);
    try {
      const row = {
        user_id: user.id,
        blend_name: blend.blend_name_suggestion || "APEX Custom Blend",
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

  return (
    <div className="apexRoot">
      {/* Top bar */}
      <header className="apexTop">
        <div className="apexBrand">
          <div className="apexLogo">APEX</div>
          <div className="apexTag">PURE ARABICA</div>
        </div>

        <div className="apexTopRight">
          <button className="apexPillBtn" type="button">
            Admin
          </button>
          <button className="apexPillBtn" type="button">
            Backend
          </button>

          {/* ✅ Login button next to Admin/Backend (Option 1) */}
          <button
            className="apexPillBtn apexPillBtnGold"
            type="button"
            onClick={() => setAuthOpen(true)}
          >
            {user ? "Account" : "Login"}
          </button>
        </div>
      </header>

      <div className="apexSubline">
        Your blend. Your identity. Crafted by AI, roasted by APEX.
      </div>

      {/* Hero */}
      <section className="apexHero">
        <div className="apexHeroText">
          <h1 className="apexH1">
            <span className="apexGold">{headline.title.split(".")[0]}.</span>{" "}
            {headline.title.split(".").slice(1).join(".").trim()}
          </h1>
          <p className="apexP">{headline.subtitle}</p>

          <div className="apexBadges">
            <span className="apexBadge">Exact grams</span>
            <span className="apexBadge">Fresh roast</span>
            <span className="apexBadge">COD</span>
          </div>
        </div>

        {/* Horse image: keep it in CSS/background in your apex.css.
            If you also render an img, ensure path works on Render (use /apex-horse_2.png in /public). */}
        <div className="apexHeroHorse" aria-hidden="true" />
      </section>

      {/* Main grid */}
      <main className="apexGrid">
        {/* Blend Builder */}
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

          <div className="apexChips">
            <span className="apexChip">Accurate grams</span>
            <span className="apexChip">Stock aware</span>
            <span className="apexChip">Pricing included</span>
            <span className="apexChip">Daily / Premium</span>
          </div>

          <div className="apexFormGrid">
            <div className="apexField">
              <label className="apexLabel">Line</label>
              <div className="apexSegment">
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
              <label className="apexLabel">Size</label>
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
              <label className="apexLabel">Brew method</label>
              <select
                className="apexSelect"
                value={prefs.method}
                onChange={(e) => setPrefs((p) => ({ ...p, method: e.target.value }))}
              >
                {METHOD_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="apexField">
              <label className="apexLabel">Strength</label>
              <select
                className="apexSelect"
                value={prefs.strength}
                onChange={(e) => setPrefs((p) => ({ ...p, strength: e.target.value }))}
              >
                {STRENGTH_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="apexField">
              <label className="apexLabel">Flavor direction</label>
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
              <label className="apexLabel">Acidity</label>
              <select
                className="apexSelect"
                value={prefs.acidity}
                onChange={(e) => setPrefs((p) => ({ ...p, acidity: e.target.value }))}
              >
                {ACIDITY_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="apexField">
              <label className="apexLabel">Time</label>
              <select
                className="apexSelect"
                value={prefs.time}
                onChange={(e) => setPrefs((p) => ({ ...p, time: e.target.value }))}
              >
                {TIME_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="apexField">
              <label className="apexLabel">Milk</label>
              <select
                className="apexSelect"
                value={prefs.milk}
                onChange={(e) => setPrefs((p) => ({ ...p, milk: e.target.value }))}
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
                  <div className="apexResultName">{blend.blend_name_suggestion}</div>
                  <div className="apexResultWhy">{blend.why}</div>
                </div>
                <div className="apexResultPrice">{blend.price} EGP</div>
              </div>

              <div className="apexResultRecipeTitle">Recipe ({sizeG}g)</div>
              <div className="apexRecipe">
                {blend.recipe.map((r) => (
                  <div className="apexRecipeRow" key={r.origin_code}>
                    <div className="apexRecipeName">{r.origin_name}</div>
                    <div className="apexRecipeCode">{r.origin_code}</div>
                    <div className="apexRecipeG">{r.grams}g</div>
                  </div>
                ))}
              </div>

              <div className="apexResultActions">
                <button
                  className="apexBtnGold"
                  type="button"
                  onClick={saveCurrentBlend}
                  disabled={!canSave || saving}
                  title={!user ? "Login required" : ""}
                >
                  {saving ? "Saving..." : "Save Blend"}
                </button>
                <div className="apexSmallMsg">
                  {saveMsg ? saveMsg : user ? `Logged in: ${user.email || user.id}` : ""}
                </div>
              </div>
            </div>
          ) : null}
        </section>

        {/* Right card (placeholder for your existing Cart & Checkout) */}
        <section className="apexCard">
          <div className="apexCardHead">
            <div>
              <div className="apexCardTitle">Cart & Checkout</div>
              <div className="apexCardSub">Cash on delivery MVP</div>
            </div>
            <span className="apexChip apexChipGold">COD</span>
          </div>

          <div className="apexCartBlock">
            <div className="apexCartTitle">Cart</div>
            <div className="apexCartEmpty">Empty</div>
          </div>

          <div className="apexCartTotal">
            <div className="apexCartTotalLabel">Total</div>
            <div className="apexCartTotalValue">0 EGP</div>
          </div>

          <div className="apexDivider" />

          <div className="apexCardTitle" style={{ marginTop: 6 }}>
            Delivery details
          </div>
          <div className="apexFormGrid" style={{ marginTop: 10 }}>
            <input className="apexInput" placeholder="Customer name" />
            <input className="apexInput" placeholder="01xxxxxxxxx" />
            <input className="apexInput" placeholder="City, street, building..." />
            <textarea className="apexTextarea" placeholder="Optional notes" rows={4} />
          </div>

          <button className="apexBtnGold" type="button" style={{ marginTop: 12 }}>
            Place Order
          </button>

          <div className="apexTinyNote" style={{ marginTop: 10 }}>
            Orders are stored in <code>server/data/orders.json</code> (MVP)
          </div>
        </section>
      </main>

      {/* Saved blends */}
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
                  <div className="apexSavedName">{b.blend_name}</div>
                  <div className="apexSavedMeta">
                    {String(b.line).toUpperCase()} • {b.size_g}g • {b.price} EGP
                  </div>
                  <div className="apexSavedWhen">
                    {new Date(b.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {/* Auth Modal */}
      {authOpen ? (
        <div className="apexModalOverlay" onMouseDown={() => setAuthOpen(false)}>
          <div className="apexModalCard" onMouseDown={(e) => e.stopPropagation()}>
            <div className="apexModalTop">
              <div className="apexModalTitle">{user ? "Account" : "Login"}</div>
              <button className="apexModalClose" onClick={() => setAuthOpen(false)}>
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
                providers={["google", "apple"]}
                // view="sign_in" // optional
              />
            )}

            <div className="apexTinyNote" style={{ marginTop: 10 }}>
              Phone OTP needs an SMS provider (Twilio). Google/Email works now.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
