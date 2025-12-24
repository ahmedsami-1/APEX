import express from "express";
import cors from "cors";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

// ================== App setup ==================
const app = express();

/**
 * CORS:
 * - Local: http://localhost:5173
 * - Render: https://apex-66yx.onrender.com (مثال)
 * تقدر تزود origins في ENV: CORS_ORIGINS مفصولين بفواصل
 */
const defaultCors = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://apex-66yx.onrender.com",
];

const extraCors = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(new Set([...defaultCors, ...extraCors]));

app.use(
  cors({
    origin: (origin, cb) => {
      // allow server-to-server or tools
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS: " + origin));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));

// ================== OpenAI client ==================
if (!process.env.OPENAI_API_KEY) {
  console.warn("⚠️ Missing OPENAI_API_KEY");
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ================== Supabase Admin (server-only) ==================
if (!process.env.SUPABASE_URL) console.warn("⚠️ Missing SUPABASE_URL");
if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
  console.warn("⚠️ Missing SUPABASE_SERVICE_ROLE_KEY");

// IMPORTANT: service role should only live on server
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ================== Admin whitelist ==================
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function isAdminEmail(email) {
  if (!ADMIN_EMAILS.length) return false;
  return ADMIN_EMAILS.includes(email);
}

async function requireAdmin(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

    if (!token) return res.status(401).json({ error: "Missing bearer token" });
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_URL) {
      return res.status(500).json({ error: "Server missing Supabase admin env" });
    }

    // Validate token using Supabase (server-side)
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const email = data.user.email || "";
    if (!isAdminEmail(email)) {
      return res.status(403).json({ error: "Not admin" });
    }

    req.adminUser = data.user;
    next();
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}

// ================== Demo stock (بدّلها لاحقًا بـ DB) ==================
const ORIGINS = [
  { code: "BR_SANTOS", name: "Brazil Santos", maxGrams: 4000, costPerG: 0.85, notes: ["chocolate", "nuts", "caramel"], acidity: 3, body: 8 },
  { code: "CO_SUPREMO", name: "Colombia Supremo", maxGrams: 3000, costPerG: 0.95, notes: ["caramel", "cocoa"], acidity: 6, body: 6 },
  { code: "ET_YIRG", name: "Ethiopia Yirgacheffe", maxGrams: 1200, costPerG: 1.25, notes: ["floral", "citrus"], acidity: 8, body: 4 },
  { code: "HN_CLASSIC", name: "Honduras Classic", maxGrams: 2500, costPerG: 0.9, notes: ["nuts", "cocoa"], acidity: 5, body: 6 },
  { code: "ID_SUMATRA", name: "Indonesia Sumatra", maxGrams: 1100, costPerG: 1.05, notes: ["earthy", "dark-chocolate"], acidity: 3, body: 9 },
];

const PACKAGING_COST = 15;
const MARGIN_PCT = 0.15;

function roundToNearest5(v) {
  return Math.round(v / 5) * 5;
}

function priceBlend(recipe, originMap) {
  const beanCost = recipe.reduce(
    (s, r) => s + r.grams * originMap.get(r.origin_code).costPerG,
    0
  );
  const subtotal = beanCost + PACKAGING_COST;
  const preRound = subtotal * (1 + MARGIN_PCT);
  const total = roundToNearest5(preRound);
  return {
    beanCost: +beanCost.toFixed(2),
    packagingCost: PACKAGING_COST,
    marginPct: MARGIN_PCT,
    subtotal: +subtotal.toFixed(2),
    preRound: +preRound.toFixed(2),
    total,
  };
}

function violationScore(recipe, sizeG, originMap) {
  let score = 0;
  if (!Array.isArray(recipe)) return 1e9;

  const seen = new Set();
  for (const r of recipe) {
    if (!r || typeof r.origin_code !== "string") {
      score += 2000;
      continue;
    }
    if (!originMap.has(r.origin_code)) score += 2000;
    if (seen.has(r.origin_code)) score += 500;
    seen.add(r.origin_code);

    const g = Number(r.grams);
    if (!Number.isFinite(g)) score += 500;
    if (!Number.isInteger(g)) score += 100;
    if (g < 20) score += (20 - g) * 20;

    if (originMap.has(r.origin_code)) {
      const max = originMap.get(r.origin_code).maxGrams;
      if (g > max) score += (g - max) * 10;
    }
  }

  if (recipe.length < 2) score += 1500;
  if (recipe.length > 5) score += (recipe.length - 5) * 400;

  const sum = recipe.reduce((s, r) => s + (Number(r?.grams) || 0), 0);
  score += Math.abs(sum - sizeG) * 5;

  return score;
}

function validateStrict(recipe, sizeG, originMap) {
  if (!Array.isArray(recipe) || recipe.length < 2 || recipe.length > 5)
    throw new Error("recipe must have 2..5 items");

  let sum = 0;
  const seen = new Set();

  for (const r of recipe) {
    if (!originMap.has(r.origin_code)) throw new Error("unknown origin_code");
    if (seen.has(r.origin_code)) throw new Error("duplicate origin_code");
    seen.add(r.origin_code);

    if (!Number.isInteger(r.grams)) throw new Error("grams must be integer");
    if (r.grams < 20) throw new Error("min 20g per origin");

    const max = originMap.get(r.origin_code).maxGrams;
    if (r.grams > max) throw new Error("exceeds stock maxGrams");
    sum += r.grams;
  }

  if (sum !== sizeG) throw new Error(`grams sum must be exactly ${sizeG}`);
}

function autofixBestAttempt(recipe, sizeG, originMap) {
  let fixed = (Array.isArray(recipe) ? recipe : [])
    .filter((r) => r && originMap.has(r.origin_code))
    .map((r) => ({
      origin_code: r.origin_code,
      grams: Math.max(20, Math.floor(Number(r.grams) || 20)),
    }));

  fixed.sort((a, b) => b.grams - a.grams);
  const used = new Set();
  fixed = fixed.filter((r) =>
    used.has(r.origin_code) ? false : (used.add(r.origin_code), true)
  );

  fixed = fixed.slice(0, 5);

  if (fixed.length < 2) {
    const sorted = [...originMap.values()].sort((a, b) => a.costPerG - b.costPerG);
    const cheapest = sorted[0];
    const second = sorted[1];
    if (cheapest && !used.has(cheapest.code))
      fixed.push({ origin_code: cheapest.code, grams: 20 });
    if (fixed.length < 2 && second && !used.has(second.code))
      fixed.push({ origin_code: second.code, grams: 20 });
  }

  fixed = fixed.map((r) => {
    const max = originMap.get(r.origin_code).maxGrams;
    return { ...r, grams: Math.min(r.grams, max) };
  });

  let sum = fixed.reduce((s, r) => s + r.grams, 0);
  let guard = 0;

  while (sum !== sizeG && guard++ < 5000) {
    const dir = sum > sizeG ? -1 : 1;
    const idx = fixed.findIndex((r) => {
      const max = originMap.get(r.origin_code).maxGrams;
      return dir === -1 ? r.grams > 20 : r.grams < max;
    });
    if (idx === -1) break;
    fixed[idx].grams += dir;
    sum += dir;
  }

  sum = fixed.reduce((s, r) => s + r.grams, 0);
  if (sum !== sizeG) throw new Error("autofix failed to normalize");

  return fixed;
}

// ================== Health ==================
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

// ================== Recommend (OpenAI) ==================
app.post("/api/recommend", async (req, res) => {
  try {
    const { size_g, line, preferences } = req.body || {};
    if (!Number.isInteger(size_g) || size_g <= 0) throw new Error("size_g must be positive int");
    if (line !== "daily" && line !== "premium") throw new Error("line must be daily|premium");
    if (!preferences) throw new Error("preferences required");
    if (!process.env.OPENAI_API_KEY) throw new Error("Server missing OPENAI_API_KEY");

    const originMap = new Map(ORIGINS.map((o) => [o.code, o]));

    const systemBase = `
Return STRICT JSON only:
{
  "blend_name_suggestion": "APEX ...",
  "recipe": [{"origin_code":"BR_SANTOS","grams":120}],
  "why": "..."
}
Hard rules:
- Use ONLY origin_code values provided.
- Total grams must equal exactly ${size_g}.
- 2 to 5 origins.
- Minimum 20g per origin.
- Do not exceed maxGrams for any origin.
Line:
- daily: optimum quality-to-price
- premium: best taste, ignore cost
`;

    const userPayload = { size_g, line, preferences, available_origins: ORIGINS };

    let best = null;
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      const system = systemBase + (lastError ? `\nPrevious attempt failed: ${lastError}\nFix it.` : "");

      const r = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(userPayload) },
        ],
      });

      const text = (r.output_text || "").trim();

      try {
        const raw = JSON.parse(text);
        const recipe = raw?.recipe;

        const score = violationScore(recipe, size_g, originMap);
        if (!best || score < best.score) best = { raw, score, attempt };

        validateStrict(recipe, size_g, originMap);

        const strictRecipe = recipe.map((x) => ({ origin_code: x.origin_code, grams: x.grams }));
        const pricing = priceBlend(strictRecipe, originMap);

        return res.json({
          blend_name_suggestion: raw.blend_name_suggestion || "APEX Custom Blend",
          why: raw.why || "",
          recipe: strictRecipe.map((rr) => ({
            origin_code: rr.origin_code,
            origin_name: originMap.get(rr.origin_code).name,
            grams: rr.grams,
          })),
          price: pricing.total,
          pricing,
          meta: { attempts: attempt, usedAutofix: false },
        });
      } catch (e) {
        lastError = String(e?.message || e);
        continue;
      }
    }

    if (!best) throw new Error("No usable output after 3 attempts");

    const fixedRecipe = autofixBestAttempt(best.raw.recipe, size_g, originMap);
    const pricing = priceBlend(fixedRecipe, originMap);

    return res.json({
      blend_name_suggestion: best.raw.blend_name_suggestion || "APEX Custom Blend",
      why: best.raw.why || "",
      recipe: fixedRecipe.map((rr) => ({
        origin_code: rr.origin_code,
        origin_name: originMap.get(rr.origin_code).name,
        grams: rr.grams,
      })),
      price: pricing.total,
      pricing,
      meta: {
        attempts: 3,
        usedAutofix: true,
        bestAttempt: best.attempt,
        bestScore: best.score,
      },
    });
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

// ================== Admin APIs ==================
/**
 * GET /api/admin/orders?limit=200
 * بيرجع orders + items + location + snapshots (كامل)
 */
app.get("/api/admin/orders", requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "200", 10), 500);

    const { data: ords, error: ordErr } = await supabaseAdmin
      .from("orders")
      .select(
        `
        id, created_at, status, payment,
        customer_name, customer_phone, customer_address, customer_notes,
        currency, total,
        user_id,
        preferences,
        location_mode, location_lat, location_lng, location_address, location_maps_url, location_place_id,
        location_snapshot
      `
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (ordErr) return res.status(400).json({ error: ordErr.message });

    const orderIds = (ords || []).map((o) => o.id);
    let itemsByOrder = {};

    if (orderIds.length) {
      const { data: items, error: itemsErr } = await supabaseAdmin
        .from("order_items")
        .select("id, order_id, title, line, size_g, price, recipe, meta")
        .in("order_id", orderIds);

      if (itemsErr) return res.status(400).json({ error: itemsErr.message });

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

    res.json({ ok: true, orders: merged });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * PATCH /api/admin/orders/:id/status
 * body: { status: "new" | "in_progress" | "delivering" | "delivered" }
 */
app.patch("/api/admin/orders/:id/status", requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body || {};

    const allowed = ["new", "in_progress", "delivering", "delivered"];
    if (!allowed.includes(status))
      return res.status(400).json({ error: "Invalid status" });

    const { data, error } = await supabaseAdmin
      .from("orders")
      .update({
        status,
        // optional audit info if you want to store it later:
        // updated_at: new Date().toISOString(),
        // status_updated_by: req.adminUser?.email || null,
      })
      .eq("id", id)
      .select(
        `
        id, status, created_at,
        customer_name, customer_phone, customer_address,
        currency, total
      `
      )
      .single();

    if (error) return res.status(400).json({ error: error.message });

    res.json({ ok: true, order: data });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ================== Serve React build (for Deploy) ==================
// IMPORTANT: Build frontend first: web -> npm run build (outputs web/dist)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WEB_DIST = path.resolve(__dirname, "../web/dist");
app.use(express.static(WEB_DIST));

// SPA fallback - exclude /api
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(WEB_DIST, "index.html"));
});

// ================== Start ==================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log("Backend running: http://localhost:" + PORT));
