import express from "express";
import cors from "cors";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";

// ================== App setup ==================
const app = express();

/**
 * CORS:
 * - Local: http://localhost:5173
 * - Render: https://apex-66yx.onrender.com
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

/**
 * Load coffee origins from DB (stock aware).
 * origins table expected columns:
 * code, name, stock_g, cost_per_g, notes, acidity, body, is_active
 */
async function loadOriginsFromDB({ onlyAvailable = true } = {}) {
  const sel =
    "code, name, stock_g, cost_per_g, notes, acidity, body, is_active";

  let q = supabaseAdmin.from("origins").select(sel);

  q = q.eq("is_active", true);
  if (onlyAvailable) q = q.gt("stock_g", 0);

  const { data, error } = await q.order("cost_per_g", { ascending: true });
  if (error) throw new Error("origins db error: " + error.message);

  return (data || []).map((o) => ({
    code: String(o.code),
    name: String(o.name || o.code),
    maxGrams: Math.max(0, parseInt(o.stock_g ?? 0, 10)), // stock in grams
    costPerG: Number(o.cost_per_g ?? 0),
    notes: Array.isArray(o.notes) ? o.notes : [],
    acidity: Number(o.acidity ?? 5),
    body: Number(o.body ?? 5),
  }));
}

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

    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    if (!jwtSecret) {
      return res
        .status(500)
        .json({ error: "Server missing SUPABASE_JWT_SECRET" });
    }

    // Verify Supabase JWT
    const payload = jwt.verify(token, jwtSecret);

    const email = payload?.email || payload?.user_metadata?.email || "";
    if (!email) return res.status(401).json({ error: "Invalid token (no email)" });

    if (!isAdminEmail(email)) {
      return res.status(403).json({ error: "Not admin" });
    }

    req.adminUser = { id: payload.sub, email };
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ================== Pricing ==================
const PACKAGING_COST = 15;
const MARGIN_PCT = 0.15;

function roundToNearest5(v) {
  return Math.round(v / 5) * 5;
}

function priceBlend(recipe, originMap) {
  const beanCost = recipe.reduce((s, r) => {
    const o = originMap.get(r.origin_code);
    if (!o) return s;
    return s + r.grams * o.costPerG;
  }, 0);

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

// ================== Helpers ==================
function safeStr(v, fallback = "") {
  if (v == null) return fallback;
  return String(v);
}

function clampInt(v, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function gramsSum(recipe) {
  if (!Array.isArray(recipe)) return 0;
  return recipe.reduce((s, r) => s + (Number(r?.grams) || 0), 0);
}

// ================== Validation / Scoring ==================
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
    if (!Number.isInteger(g)) score += 150;

    if (g < 20) score += (20 - g) * 25;

    const o = originMap.get(r.origin_code);
    if (o) {
      const max = o.maxGrams;
      if (g > max) score += (g - max) * 40; // heavy penalty for stock violation
      // mild penalty for using nearly all remaining stock (business safety)
      if (max > 0 && g > Math.floor(max * 0.9)) score += 50;
    }
  }

  if (recipe.length < 2) score += 1800;
  if (recipe.length > 5) score += (recipe.length - 5) * 500;

  const sum = gramsSum(recipe);
  score += Math.abs(sum - sizeG) * 15;

  return score;
}

function validateStrict(recipe, sizeG, originMap) {
  if (!Array.isArray(recipe) || recipe.length < 2 || recipe.length > 5) {
    throw new Error("recipe must have 2..5 items");
  }

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

/**
 * Autofix: strict correctness > taste nuance
 * (used only if all AI attempts fail)
 */
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

  // clamp by stock
  fixed = fixed.map((r) => {
    const max = originMap.get(r.origin_code).maxGrams;
    return { ...r, grams: Math.min(r.grams, max) };
  });

  let sum = fixed.reduce((s, r) => s + r.grams, 0);
  let guard = 0;

  while (sum !== sizeG && guard++ < 12000) {
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

// ================== Recommend (OpenAI, Stock-aware, High-Explainability) ==================
app.post("/api/recommend", async (req, res) => {
  try {
    const { size_g, line, preferences } = req.body || {};

    if (!Number.isInteger(size_g) || size_g <= 0)
      throw new Error("size_g must be positive int");
    if (line !== "daily" && line !== "premium")
      throw new Error("line must be daily|premium");
    if (!preferences) throw new Error("preferences required");
    if (!process.env.OPENAI_API_KEY)
      throw new Error("Server missing OPENAI_API_KEY");

    // ✅ Load stock from DB
    const ORIGINS_DB = await loadOriginsFromDB({ onlyAvailable: true });
    if (!ORIGINS_DB.length) {
      return res.status(400).json({ error: "No stock available right now." });
    }

    const originMap = new Map(ORIGINS_DB.map((o) => [o.code, o]));

    // Tight list for the model (truth-bound)
    const availableOriginsForModel = ORIGINS_DB.map((o) => ({
      code: o.code,
      name: o.name,
      maxGrams: o.maxGrams,
      costPerG: o.costPerG,
      notes: o.notes,
      acidity: o.acidity,
      body: o.body,
    }));

    // ====== Professional, novel output spec ======
    // Idea: "Proof-of-choice" + "Counterfactuals" + "Taste persona letter"
    const systemBase = `
You are APEX Blend Architect: a coffee formulator + a rational explainer.
You MUST be truthful and strictly bound to the provided available_origins data.

Return STRICT JSON only. No markdown. No extra keys. No extra commentary.

JSON SCHEMA (MUST match exactly):
{
  "blend_name_suggestion": "APEX ...",
  "recipe": [
    {
      "origin_code": "BR_SANTOS",
      "grams": 120,
      "explain": {
        "role_in_structure": "Base | Bridge | Accent | Depth | Brightness",
        "why_this_origin": [
          "Bullet: tie to preferences + origin notes/body/acidity",
          "Bullet: tie to line (daily vs premium) and value"
        ],
        "why_this_grams": [
          "Explain grams as a ratio decision (percentage-ish) and what it does in cup",
          "Explain what would change if grams were +/- 20g"
        ],
        "difference_vs_alternatives": [
          {
            "alternative_origin_code": "CO_SUPREMO",
            "why_not": "short, rational, data-bound reason",
            "what_you_gain_by_current_choice": "short, rational"
          }
        ],
        "honesty_clause": "One sentence confirming you only used provided notes and did not invent tasting claims."
      }
    }
  ],
  "optimality_proof": {
    "objective": "daily|premium",
    "constraints_checklist": [
      "Total equals exactly ${size_g}g",
      "2..5 origins, each >=20g integer",
      "Each grams <= maxGrams (stock)",
      "No duplicate origins"
    ],
    "score_logic": [
      "Explain the optimization logic: value vs taste, and how stock limits shaped choices",
      "Explain structure math: base %, accent %, balance"
    ],
    "counterfactuals": [
      {
        "change": "If we increase acidity one level",
        "what_would_change_in_recipe": "one-liner",
        "why_current_is_optimum_for_given_prefs": "one-liner"
      }
    ],
    "stock_respect_notes": [
      "Mention if you avoided using near-empty stock when possible",
      "Mention if a bean is scarce and used as accent"
    ]
  },
  "taste_persona_letter": {
    "title": "Your Coffee Persona",
    "opening": "2-3 sentences, respectful, no manipulation, grounded in inputs only",
    "traits": [
      { "label": "Taste compass", "evidence": "based on flavor_direction + acidity + milk" },
      { "label": "Ritual style", "evidence": "based on time + brew method" },
      { "label": "Power dial", "evidence": "based on strength choice" }
    ],
    "why_this_blend_matches_you": [
      "Bullet 1",
      "Bullet 2",
      "Bullet 3"
    ],
    "how_to_brew_best": [
      "Short practical brewing guidance matching method + milk"
    ],
    "closing": "One classy line."
  }
}

HARD RULES:
- Use ONLY origin_code values present in available_origins.
- Total grams must equal exactly ${size_g}.
- Recipe must contain 2 to 5 origins.
- grams must be INTEGER.
- Minimum 20g per origin.
- Do not exceed maxGrams per origin.
- Explanations must be data-bound: you can reference only notes/acidity/body/costPerG/stock/maxGrams.
- No fake tasting claims: do not invent flavors not present in notes.

Optimization goals:
- daily: maximize quality-to-price; avoid expensive origins unless they add clear value aligned with preferences.
- premium: maximize cup quality; cost is secondary.
- Always keep recipe coherent with preferences (method/strength/flavor_direction/acidity/time/milk).

Tone rules:
- Respectful, logical, organized, confident but not hype.
- Explain cause -> effect.
`;

    const userPayload = {
      size_g,
      line,
      preferences,
      available_origins: availableOriginsForModel,
      constraints_hint: {
        min_per_origin_g: 20,
        max_origins: 5,
        must_be_truthful: true,
        show_counterfactuals: true,
      },
    };

    // ====== Higher accuracy strategy ======
    // 1) generate candidate
    // 2) validate strictly
    // 3) (optional) second-pass critique step: ask model to self-check constraints + improve explanations
    const MAX_ATTEMPTS = 6;

    let best = null;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const system =
        systemBase +
        (lastError
          ? `\nPrevious attempt failed validation with error: ${lastError}\nReturn a corrected JSON that passes HARD RULES.`
          : "");

      const gen = await openai.responses.create({
        model: "gpt-5.2",
        input: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(userPayload) },
        ],
      });

      const rawText = (gen.output_text || "").trim();

      try {
        const raw = JSON.parse(rawText);
        const recipe = raw?.recipe;

        const score = violationScore(recipe, size_g, originMap);
        if (!best || score < best.score) best = { raw, score, attempt };

        validateStrict(recipe, size_g, originMap);

        // ✅ Second pass: tighten reasoning, keep recipe same
        // We freeze recipe grams/origins and ask for stronger explanations (no changing recipe)
        const frozenRecipe = recipe.map((r) => ({
          origin_code: r.origin_code,
          grams: r.grams,
        }));

        const critiqueSystem = `
You are a strict editor.
You MUST NOT change the recipe grams or origin_code list.
Improve ONLY the explanations to be more logical, structured, and persuasive.
Remain truthful and bound to available origins data. Return STRICT JSON with the SAME schema and SAME recipe values.
`;

        const critiquePayload = {
          ...userPayload,
          frozen_recipe: frozenRecipe,
          draft: raw,
          rule: "Do not change recipe.* Only explanations.",
        };

        const crit = await openai.responses.create({
          model: "gpt-5.2",
          input: [
            { role: "system", content: critiqueSystem },
            { role: "user", content: JSON.stringify(critiquePayload) },
          ],
        });

        const critText = (crit.output_text || "").trim();
        let final = raw;

        try {
          const improved = JSON.parse(critText);

          // enforce "no recipe change"
          const improvedRecipe = improved?.recipe || [];
          const same =
            Array.isArray(improvedRecipe) &&
            improvedRecipe.length === frozenRecipe.length &&
            improvedRecipe.every((x, i) => {
              return (
                x?.origin_code === frozenRecipe[i]?.origin_code &&
                x?.grams === frozenRecipe[i]?.grams
              );
            });

          if (same) final = improved;
        } catch {
          // ignore critique parse errors
        }

        // Build strict recipe for pricing
        const strictRecipe = frozenRecipe.map((x) => ({
          origin_code: x.origin_code,
          grams: x.grams,
        }));

        const pricing = priceBlend(strictRecipe, originMap);

        // normalize output for frontend
        const outRecipe = strictRecipe.map((rr) => {
          const o = originMap.get(rr.origin_code);
          const found = (final.recipe || []).find((x) => x?.origin_code === rr.origin_code);
          return {
            origin_code: rr.origin_code,
            origin_name: o?.name || rr.origin_code,
            grams: rr.grams,
            explain: found?.explain || null,
          };
        });

        return res.json({
          blend_name_suggestion: final.blend_name_suggestion || "APEX Custom Blend",
          recipe: outRecipe,
          optimality_proof: final.optimality_proof || null,
          taste_persona_letter: final.taste_persona_letter || null,
          price: pricing.total,
          pricing,
          meta: {
            attempts: attempt,
            usedAutofix: false,
            stockSource: "db",
            model: "gpt-5.2",
          },
        });
      } catch (e) {
        lastError = String(e?.message || e);
        continue;
      }
    }

    // ====== Final safety net (autofix) ======
    if (!best) throw new Error("No usable output after attempts");

    const fixedRecipe = autofixBestAttempt(best.raw?.recipe, size_g, originMap);
    validateStrict(fixedRecipe, size_g, originMap);

    const pricing = priceBlend(fixedRecipe, originMap);

    // provide honest fallback explanations
    const fallback = {
      blend_name_suggestion: safeStr(best.raw?.blend_name_suggestion, "APEX Custom Blend"),
      recipe: fixedRecipe.map((rr) => {
        const o = originMap.get(rr.origin_code);
        return {
          origin_code: rr.origin_code,
          origin_name: o?.name || rr.origin_code,
          grams: rr.grams,
          explain: {
            role_in_structure: "Balance",
            why_this_origin: [
              "Selected from currently available stock and compatible profile fields (notes/body/acidity).",
              "Autofix mode prioritizes strict rule correctness when AI output fails validation."
            ],
            why_this_grams: [
              `Normalized to hit exactly ${size_g}g while keeping each component meaningful (>= 20g) and within stock limits.`,
              "If you adjust any component by ±20g, the balance shifts but the strict constraints still must be respected."
            ],
            difference_vs_alternatives: [],
            honesty_clause:
              "This explanation is conservative: it avoids claims beyond the provided data and focuses on constraints compliance."
          },
        };
      }),
      optimality_proof: {
        objective: line,
        constraints_checklist: [
          `Total equals exactly ${size_g}g`,
          "2..5 origins, each >=20g integer",
          "Each grams <= maxGrams (stock)",
          "No duplicate origins",
        ],
        score_logic: [
          "Fallback mode used because the AI draft did not pass strict validation after multiple attempts.",
          "This output is guaranteed constraint-correct; taste optimization is limited under autofix.",
        ],
        counterfactuals: [],
        stock_respect_notes: [
          "All grams are within available stock for each origin.",
        ],
      },
      taste_persona_letter: {
        title: "Your Coffee Persona",
        opening:
          "Based on your selected preferences, this blend was built to respect your choices and the available stock, with strict rule correctness.",
        traits: [
          { label: "Taste compass", evidence: "Derived from your flavor_direction/acidity/milk choices." },
          { label: "Ritual style", evidence: "Derived from your brew method + time." },
          { label: "Power dial", evidence: "Derived from your strength selection." },
        ],
        why_this_blend_matches_you: [
          "It stays inside your selected flavor direction without inventing notes.",
          "It preserves balance by enforcing minimum meaningful contributions per origin.",
          "It respects stock so what you order can actually be produced."
        ],
        how_to_brew_best: [
          "Use your chosen method; keep grind/ratio consistent. If drinking with milk, lean slightly stronger extraction."
        ],
        closing: "If you tweak preferences, we can re-optimize with a different structure."
      }
    };

    return res.json({
      blend_name_suggestion: fallback.blend_name_suggestion,
      recipe: fallback.recipe,
      optimality_proof: fallback.optimality_proof,
      taste_persona_letter: fallback.taste_persona_letter,
      price: pricing.total,
      pricing,
      meta: {
        attempts: MAX_ATTEMPTS,
        usedAutofix: true,
        bestAttempt: best.attempt,
        bestScore: best.score,
        stockSource: "db",
        model: "gpt-5.2",
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
        id, user_id,
        created_at, updated_at,
        status, payment,
        customer_name, customer_phone, customer_address, customer_notes,
        currency, total,
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
        .select("id, order_id, created_at, title, line, size_g, price, recipe, meta")
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
 * body: { status: "new" | "in_progress" | "delivering" | "delivered" | "cancelled" }
 */
app.patch("/api/admin/orders/:id/status", requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body || {};

    const allowed = ["new", "in_progress", "delivering", "delivered", "cancelled"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const { data, error } = await supabaseAdmin
      .from("orders")
      .update({ status })
      .eq("id", id)
      .select(
        `
        id, user_id,
        created_at, updated_at,
        status,
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
