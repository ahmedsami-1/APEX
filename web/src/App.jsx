import { useEffect, useMemo, useState } from "react";
import { Routes, Route, Link, useNavigate, useLocation } from "react-router-dom";

/* =======================
   ADMIN PIN
======================= */
const ADMIN_PIN = "4321";

/* =======================
   PIN GUARD
======================= */
function RequireAdminPin({ children }) {
  const nav = useNavigate();
  const loc = useLocation();
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");

  const ok = localStorage.getItem("apex_admin_ok") === "1";

  function submit(e) {
    e.preventDefault();
    setErr("");
    if (pin === ADMIN_PIN) {
      localStorage.setItem("apex_admin_ok", "1");
      nav("/admin", { replace: true, state: { from: loc.pathname } });
    } else {
      setErr("Wrong PIN");
    }
  }

  if (ok) return children;

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 560, margin: "0 auto" }}>
        <div className="cardHead">
          <div>
            <div className="cardTitle">APEX Admin</div>
            <div className="cardHint">Enter PIN to continue</div>
          </div>
          <span className="badge">LOCKED</span>
        </div>

        <div className="cardBody">
          <form onSubmit={submit}>
            <div className="field">
              <div className="label">PIN</div>
              <input
                className="input"
                type="password"
                inputMode="numeric"
                placeholder="••••"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
              />
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button className="btn btnGold" type="submit">
                Unlock
              </button>
              <Link className="btn" to="/">
                Back to store
              </Link>
            </div>

            {err ? <div className="noticeErr">{err}</div> : null}
          </form>
        </div>
      </div>
    </div>
  );
}

/* =======================
   HOME
======================= */
function Home() {
  const [loading, setLoading] = useState(false);
  const [out, setOut] = useState(null); // original response from backend
  const [err, setErr] = useState("");

  // core inputs
  const [line, setLine] = useState("daily");
  const [sizeG, setSizeG] = useState(250);

  // preferences
  const [method, setMethod] = useState("espresso");
  const [strength, setStrength] = useState("balanced");
  const [flavor, setFlavor] = useState("chocolate_nuts");
  const [acidity, setAcidity] = useState("medium");
  const [time, setTime] = useState("morning");
  const [milk, setMilk] = useState("black");

  // naming
  const [customName, setCustomName] = useState("");
  const [usingAlt, setUsingAlt] = useState(false);

  // cart / checkout
  const [cart, setCart] = useState([]);
  const [custName, setCustName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [placing, setPlacing] = useState(false);
  const [orderRes, setOrderRes] = useState(null);

  // Tell CSS which line is active (daily / premium)
  useEffect(() => {
    document.body.dataset.line = line;
    return () => {
      delete document.body.dataset.line;
    };
  }, [line]);

  // When new output arrives, default to main pick and set name
  useEffect(() => {
    if (!out) return;
    setUsingAlt(false);
    setCustomName(out.blend_name_suggestion || "APEX Custom");
  }, [out]);

  const activePick = useMemo(() => {
    if (!out) return null;
    if (usingAlt && out.second_pick) {
      return {
        isAlt: true,
        blend_name_suggestion: out.second_pick.blend_name_suggestion,
        short_why: out.second_pick.short_why,
        recipe: out.second_pick.recipe,
        // price/pricing remain from main pick in this MVP (you can price alt later if you want)
        price: out.price,
        pricing: out.pricing,
      };
    }
    return {
      isAlt: false,
      blend_name_suggestion: out.blend_name_suggestion,
      short_why: out.short_why,
      recipe: out.recipe,
      price: out.price,
      pricing: out.pricing,
    };
  }, [out, usingAlt]);

  async function getBlend() {
    setErr("");
    setOut(null);
    setOrderRes(null);
    setLoading(true);

    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          size_g: Number(sizeG),
          line,
          preferences: {
            method,
            strength,
            flavor_direction: flavor,
            acidity,
            time,
            milk,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Request failed");

      setOut(data);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  function addToCart() {
    if (!activePick) return;

    const title = (customName || activePick.blend_name_suggestion || "APEX Custom").trim();

    setCart((c) => [
      ...c,
      {
        title,
        price: Number(activePick.price || 0),
        line,
        size_g: Number(sizeG),
        recipe: activePick.recipe || [],
      },
    ]);
  }

  function removeItem(idx) {
    setCart((c) => c.filter((_, i) => i !== idx));
  }

  async function placeOrder() {
    setOrderRes(null);
    setErr("");

    if (!cart.length) return setErr("Cart is empty.");
    if (!custName || !phone || !address) return setErr("Name, phone, address are required.");

    setPlacing(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: { name: custName, phone, address, notes },
          items: cart,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Order failed");

      setOrderRes(data.order);
      setCart([]);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setPlacing(false);
    }
  }

  const total = cart.reduce((s, it) => s + (Number(it.price) || 0), 0);
  const isPremium = line === "premium";
  const hasAlt = !!out?.second_pick;

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="logoRow">
            <div className="wordmark">APEX</div>
            <span className="badge">PURE ARABICA</span>
          </div>
          <div className="subtitle">Your blend. Your identity. Crafted by AI, roasted by APEX.</div>
        </div>

        <div className="navbtns">
          <Link className="btn" to="/admin">
            Admin
          </Link>
          <a className="btn" href="http://localhost:3001/health" target="_blank" rel="noreferrer">
            Backend
          </a>
        </div>
      </div>

      {/* HERO */}
      <div className="hero">
        <img className="heroHorseImg" src="/src/assets/apex-horse.png" alt="APEX horse" />
        <div className="heroInner">
          <div>
            <h2 className="heroTitle">
              <span>Purebred Power.</span> Pure Arabica.
            </h2>
            <div className="heroSub">
              AI-crafted blends based on your taste and routine. Your coffee . Your Signature.
            </div>
          </div>

          {/* Keep this minimal to avoid visual noise */}
          <div className="pillRow" style={{ marginTop: 2 }}>
          </div>
        </div>
      </div>

      {err ? <div className="noticeErr">{err}</div> : null}
      {orderRes ? (
        <div className="noticeOk">
          ✅ Order created: <b>{orderRes.id}</b>
        </div>
      ) : null}

      <div className="grid2">
        {/* LEFT: BLEND BUILDER */}
        <div className="card">
          <div className="cardHead">
            <div>
              <div className="cardTitle">Blend Builder</div>
              <div className="cardHint">Get the main recommendation, plus an alternative pick</div>
            </div>
            <button className="btn btnGold" onClick={getBlend} disabled={loading}>
              {loading ? "Crafting…" : "Get My Blend"}
            </button>
          </div>

          <div className="cardBody">
            <div className="formRow">
              {/* SLIDER TOGGLE */}
              <div className="field">
                <div className="label">Line</div>
                <div className={"toggleSlider " + (isPremium ? "isPremium" : "isDaily")}>
                  <div className="toggleKnob" />
                  <button type="button" className="toggleBtn" onClick={() => setLine("daily")}>
                    Daily
                  </button>
                  <button type="button" className="toggleBtn" onClick={() => setLine("premium")}>
                    Premium
                  </button>
                </div>
              </div>

              <div className="field">
                <div className="label">Size</div>
                <select className="select" value={sizeG} onChange={(e) => setSizeG(Number(e.target.value))}>
                  <option value={250}>250g</option>
                  <option value={500}>500g</option>
                  <option value={1000}>1kg</option>
                </select>
              </div>

              <div className="field">
                <div className="label">Brew method</div>
                <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="espresso">Espresso</option>
                  <option value="v60">V60 / Pour-over</option>
                  <option value="moka">Moka pot</option>
                  <option value="french_press">French press</option>
                </select>
              </div>

              <div className="field">
                <div className="label">Strength</div>
                <select className="select" value={strength} onChange={(e) => setStrength(e.target.value)}>
                  <option value="soft">Soft</option>
                  <option value="balanced">Balanced</option>
                  <option value="strong">Strong</option>
                </select>
              </div>

              <div className="field">
                <div className="label">Flavor direction</div>
                <select className="select" value={flavor} onChange={(e) => setFlavor(e.target.value)}>
                  <option value="chocolate_nuts">Chocolate + Nuts</option>
                  <option value="caramel_cocoa">Caramel + Cocoa</option>
                  <option value="floral_citrus">Floral + Citrus</option>
                  <option value="earthy_dark">Earthy + Dark chocolate</option>
                </select>
              </div>

              <div className="field">
                <div className="label">Acidity</div>
                <select className="select" value={acidity} onChange={(e) => setAcidity(e.target.value)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>

              <div className="field">
                <div className="label">Time</div>
                <select className="select" value={time} onChange={(e) => setTime(e.target.value)}>
                  <option value="morning">Morning</option>
                  <option value="afternoon">Afternoon</option>
                  <option value="night">Night</option>
                </select>
              </div>

              <div className="field">
                <div className="label">Milk</div>
                <select className="select" value={milk} onChange={(e) => setMilk(e.target.value)}>
                  <option value="black">Black</option>
                  <option value="milk">With milk</option>
                </select>
              </div>
            </div>

            {activePick ? (
              <>
                <div className="hr" />

                {/* Pick switch */}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <span className="badge">{activePick.isAlt ? "ALTERNATIVE" : "MAIN PICK"}</span>

                  {hasAlt ? (
                    <button
                      className="btn"
                      type="button"
                      onClick={() => {
                        setUsingAlt((v) => !v);
                        // also update custom name to match the chosen pick
                        const next = !usingAlt;
                        const newName = next ? out.second_pick.blend_name_suggestion : out.blend_name_suggestion;
                        setCustomName(newName || "");
                      }}
                    >
                      {usingAlt ? "Use main pick" : "Try alternative"}
                    </button>
                  ) : (
                    <span className="pill">No alternative available</span>
                  )}
                </div>

                <div className="hr" />

                <div className="kpiRow">
                  <div className="kpi">
                    <div className="kpiLabel">Blend name</div>
                    <input className="input" value={customName} onChange={(e) => setCustomName(e.target.value)} />
                  </div>
                  <div className="kpi">
                    <div className="kpiLabel">Price</div>
                    <div className="kpiValue">{activePick.price} EGP</div>
                  </div>
                  <div className="kpi">
                    <div className="kpiLabel">Attempts</div>
                    <div className="kpiValue">
                      {out?.meta?.attempts ?? "-"} {out?.meta?.usedAutofix ? "(autofix)" : ""}
                    </div>
                  </div>
                </div>

                {/* short_why (3 sentences) */}
                <div style={{ marginTop: 12, color: "var(--muted)" }}>
                  {activePick.short_why || "—"}
                </div>

                <div className="hr" />

                <div className="cardTitle" style={{ marginBottom: 10 }}>
                  Recipe ({sizeG}g)
                </div>

                {/* Bars */}
                <div>
                  {(() => {
                    const recipe = activePick.recipe || [];
                    const maxG = Math.max(...recipe.map((r) => Number(r.grams) || 0), 1);
                    return recipe.map((r) => {
                      const pct = Math.max(0, Math.min(100, ((Number(r.grams) || 0) / maxG) * 100));
                      return (
                        <div className="barRow" key={r.origin_code}>
                          <div className="barMeta">
                            <div className="barName">{r.origin_name}</div>
                            <div className="barCode">{r.origin_code}</div>
                          </div>
                          <div className="barTrack">
                            <div className="barFill" style={{ width: pct + "%" }} />
                          </div>
                          <div className="barGrams">{r.grams}g</div>
                        </div>
                      );
                    });
                  })()}
                </div>

                {/* Table */}
                <table className="table" style={{ marginTop: 10 }}>
                  <thead>
                    <tr>
                      <th>Origin</th>
                      <th>Code</th>
                      <th>Grams</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(activePick.recipe || []).map((r) => (
                      <tr key={r.origin_code}>
                        <td>{r.origin_name}</td>
                        <td className="mono" style={{ padding: "8px 10px", display: "inline-block" }}>
                          {r.origin_code}
                        </td>
                        <td>
                          <b>{r.grams}g</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="btn btnGold" onClick={addToCart}>
                    Add to Cart
                  </button>
                </div>

                <div style={{ marginTop: 12 }}>
                  <details>
                    <summary style={{ cursor: "pointer", color: "var(--muted)" }}>Show raw JSON</summary>
                    <pre className="mono">{JSON.stringify(out, null, 2)}</pre>
                  </details>
                </div>
              </>
            ) : (
              <div style={{ marginTop: 12, color: "var(--muted)" }}>
                Craft a blend that feels like you .
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: CART & CHECKOUT */}
        <div className="card">
          <div className="cardHead">
            <div>
              <div className="cardTitle">Cart & Checkout</div>
              <div className="cardHint">Cash on delivery MVP</div>
            </div>
            <div className="badge">COD</div>
          </div>

          <div className="cardBody">
            <div className="cardTitle" style={{ marginBottom: 10 }}>
              Cart
            </div>

            {cart.length === 0 ? (
              <div style={{ color: "var(--muted)" }}>Empty</div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {cart.map((it, idx) => (
                  <div key={idx} className="card" style={{ boxShadow: "none" }}>
                    <div className="cardBody" style={{ padding: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ fontWeight: 800 }}>{it.title}</div>
                        <div style={{ fontWeight: 800, color: "var(--gold2)" }}>{it.price} EGP</div>
                      </div>
                      <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 6 }}>
                        {it.size_g}g • {it.line}
                      </div>
                      <div style={{ marginTop: 8 }}>
                        <button className="btn" onClick={() => removeItem(idx)}>
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="hr" />
            <div className="kpiRow">
              <div className="kpi">
                <div className="kpiLabel">Total</div>
                <div className="kpiValue">{total} EGP</div>
              </div>
            </div>

            <div className="hr" />

            <div className="cardTitle" style={{ marginBottom: 10 }}>
              Delivery details
            </div>

            <div className="field">
              <div className="label">Name</div>
              <input className="input" value={custName} onChange={(e) => setCustName(e.target.value)} placeholder="Customer name" />
            </div>

            <div className="field" style={{ marginTop: 10 }}>
              <div className="label">Phone</div>
              <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxxx" />
            </div>

            <div className="field" style={{ marginTop: 10 }}>
              <div className="label">Address</div>
              <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="City, street, building…" />
            </div>

            <div className="field" style={{ marginTop: 10 }}>
              <div className="label">Notes</div>
              <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
              <button className="btn btnGold" onClick={placeOrder} disabled={placing}>
                {placing ? "Placing…" : "Place Order"}
              </button>
            </div>

            <div className="trustRow">
              <div className="trust">☕ Freshly roasted</div>
              <div className="trust">📦 Cash on delivery</div>
              <div className="trust">🧾 Exact grams recipe</div>
            </div>

            <div style={{ marginTop: 10, color: "var(--muted)", fontSize: 12 }}>
              Orders stored locally in <span className="mono">server/data/orders.json</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =======================
   ADMIN
======================= */
function Admin() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [orders, setOrders] = useState([]);
  const [q, setQ] = useState("");

  async function load() {
    setErr("");
    setLoading(true);
    try {
      const res = await fetch("/api/orders");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load orders");
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return orders;
    return orders.filter((o) => {
      return (
        String(o.id || "").toLowerCase().includes(s) ||
        String(o.customer?.name || "").toLowerCase().includes(s) ||
        String(o.customer?.phone || "").toLowerCase().includes(s)
      );
    });
  }, [orders, q]);

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="logoRow">
            <div className="wordmark">APEX</div>
            <span className="badge">ADMIN</span>
          </div>
          <div className="subtitle">Orders dashboard</div>
        </div>

        <div className="navbtns">
          <button className="btn" onClick={() => nav("/")}>
            Back
          </button>
          <button
            className="btn"
            onClick={() => {
              localStorage.removeItem("apex_admin_ok");
              window.location.href = "/admin";
            }}
          >
            Logout
          </button>
        </div>
      </div>

      {err ? <div className="noticeErr">{err}</div> : null}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="cardHead">
          <div>
            <div className="cardTitle">Orders</div>
            <div className="cardHint">Search, refresh, review details</div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              className="input"
              style={{ width: 320 }}
              placeholder="Search by id, name, phone…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button className="btn btnGold" onClick={load} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="cardBody">
          <div className="pillRow" style={{ marginBottom: 12 }}>
            <span className="pill">{filtered.length} orders</span>
            <span className="pill">
              Raw:{" "}
              <a className="mono" href="http://localhost:3001/api/orders" target="_blank" rel="noreferrer">
                /api/orders
              </a>
            </span>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Total</th>
                  <th>Items</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <b>{o.id}</b>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>{o.status}</div>
                    </td>
                    <td>{o.customer?.name}</td>
                    <td>{o.customer?.phone}</td>
                    <td>
                      <b style={{ color: "var(--gold2)" }}>{o.total} EGP</b>
                    </td>
                    <td>
                      {(o.items || []).map((it, idx) => (
                        <div key={idx} style={{ marginBottom: 6 }}>
                          <b>{it.title}</b> <span style={{ color: "var(--muted)" }}>({it.price} EGP)</span>
                        </div>
                      ))}
                    </td>
                    <td style={{ color: "var(--muted)" }}>
                      {String(o.createdAt || "").replace("T", " ").replace("Z", "")}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ color: "var(--muted)", padding: 12 }}>
                      No orders yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =======================
   ROUTES
======================= */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route
        path="/admin"
        element={
          <RequireAdminPin>
            <Admin />
          </RequireAdminPin>
        }
      />
    </Routes>
  );
}
