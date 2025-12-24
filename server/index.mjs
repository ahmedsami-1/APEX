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
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS: " + origin));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));

// ================== OpenAI client ==================
if (!process.env.OPENAI_API_KEY) console.warn("⚠️ Missing OPENAI_API_KEY");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Model via ENV (easy switch)
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.2"; // set OPENAI_MODEL=gpt-5.2
const OPENAI_TEMPERATURE = Number(process.env.OPENAI_TEMPERATURE ?? "0.2");

// ================== Supabase Admin (server-only) ==================
if (!process.env.SUPABASE_URL) console.warn("⚠️ Missing SUPABASE_URL");
if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
  console.warn("⚠️ Missing SUPABASE_SERVICE_ROLE_KEY");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

/**
 * Load coffee origins from DB (stock aware).
 * origins columns expected:
 * code, name, stock_g, cost_per_g, notes, is_active,
 * acidity, body, sweetness, bitterness, aroma, fruitiness, chocolate, nutty
 */
async function loadOriginsFromDB({ onlyAvailable = true } = {}) {
  const sel = [
    "code",
    "name",
    "stock_g",
    "cost_per_g",
    "notes",
    "is_active",
    "acidity",
    "body",
    "sweetness",
    "bitterness",
    "aroma",
    "fruitiness",
    "chocolate",
    "nutty",
  ].join(", ");

  let q = supabaseAdmin.from("origins").select(sel);

  q = q.eq("is_active", true);
  if (onlyAvailable) q = q.gt("stock_g", 0);

  const { data, error } = await q.order("cost_per_g", { ascending: true });
  if (error) throw new Error("origins db error: " + error.message);

  const clamp01to10 = (v, def = 5) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.max(1, Math.min(10, n));
  };

  return (data || []).map((o) => ({
    code: String(o.code),
    name: String(o.name || o.code),
    maxGrams: Math.max(0, parseInt(o.stock_g ?? 0, 10)),
    costPerG: Number(o.cost_per_g ?? 0),
    notes: Array.isArray(o.notes) ? o.notes : [],
    // sensory 1..10
    acidity: clamp01to10(o.acidity, 5),
    body: clamp01to10(o.body, 5),
    sweetness: clamp01to10(o.sweetness, 5),
    bitterness: clamp01to10(o.bitterness, 5),
    aroma: clamp01to10(o.aroma, 5),
    fruitiness: clamp01to10(o.fruitiness, 5),
    chocolate: clamp01to10(o.chocolate, 5),
    nutty: clamp01to10(o.nutty, 5),
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
    if (!jwtSecret)
      return res
        .status(500)
        .json({ error: "Server missing SUPABASE_JWT_SECRET" });

    const payload = jwt.verify(token, jwtSecret);

    const email = payload?.email || payload?.user_metadata?.email || "";
    if (!email) return res.status(401).json({ error: "Invalid token (no email)" });

    if (!isAdminEmail(email)) return res.status(403).json({ error: "Not admin" });

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

function gramsSum(recipe) {
  if (!Array.isArray(recipe)) return 0;
  return recipe.reduce((s, r) => s + (Number(r?.grams) || 0), 0);
}

function clamp10(v, def = 5) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(10, n));
}

const CHART_AXES = [
  { key: "body", label: "Body" },
  { key: "acidity", label: "Acidity" },
  { key: "sweetness", label: "Sweetness" },
  { key: "bitterness", label: "Bitterness" },
  { key: "aroma", label: "Aroma" },
  { key: "fruitiness", label: "Fruitiness" },
  { key: "chocolate", label: "Chocolate" },
  { key: "nutty", label: "Nutty" },
];

function computeBlendProfile(recipe, originMap) {
  const total = gramsSum(recipe);
  if (!total) {
    const empty = {};
    for (const a of CHART_AXES) empty[a.key] = 0;
    return empty;
  }

  const out = {};
  for (const a of CHART_AXES) out[a.key] = 0;

  for (const r of recipe) {
    const o = originMap.get(r.origin_code);
    if (!o) continue;
    const w = (Number(r.grams) || 0) / total;
    for (const a of CHART_AXES) {
      out[a.key] += w * clamp10(o[a.key], 5);
    }
  }

  // 1 decimal
  for (const a of CHART_AXES) out[a.key] = Math.round(out[a.key] * 10) / 10;

  return out;
}

/**
 * Convert user preferences -> target sensory profile (1..10).
 * We keep it conservative: it's a "target dial", not a fake tasting claim.
 * This helps AI explain "based on what exactly".
 */
function deriveTargetProfile(preferences) {
  const p = preferences || {};
  const method = safeStr(p.method || p.brew_method || "").toLowerCase();
  const strength = safeStr(p.strength || "").toLowerCase();
  const flavor = safeStr(p.flavor_direction || p.flavor || "").toLowerCase();
  const milk = safeStr(p.milk || p.with_milk || "").toLowerCase();
  const acidityPref = p.acidity_level ?? p.acidity ?? null;

  // neutral baseline
  const t = {
    body: 5,
    acidity: 5,
    sweetness: 5,
    bitterness: 5,
    aroma: 5,
    fruitiness: 5,
    chocolate: 5,
    nutty: 5,
  };

  // method nudges
  if (method.includes("espresso")) {
    t.body += 2;
    t.bitterness += 1;
    t.acidity -= 1;
    t.chocolate += 1;
  } else if (method.includes("v60") || method.includes("pour") || method.includes("filter")) {
    t.acidity += 2;
    t.aroma += 1;
    t.fruitiness += 2;
    t.body -= 1;
  } else if (method.includes("french")) {
    t.body += 2;
    t.chocolate += 1;
    t.nutty += 1;
  }

  // strength
  if (strength.includes("strong") || strength.includes("high")) {
    t.body += 1;
    t.bitterness += 1;
  } else if (strength.includes("light") || strength.includes("mild")) {
    t.body -= 1;
    t.bitterness -= 1;
    t.acidity += 1;
  }

  // milk
  if (milk.includes("yes") || milk.includes("with") || milk.includes("milk")) {
    t.body += 1;
    t.chocolate += 1;
    t.nutty += 1;
    t.acidity -= 1;
  }

  // flavor direction
  if (flavor.includes("fruity") || flavor.includes("floral")) {
    t.fruitiness += 3;
    t.aroma += 1;
    t.chocolate -= 1;
    t.nutty -= 1;
  } else if (flavor.includes("choco") || flavor.includes("cocoa")) {
    t.chocolate += 3;
    t.fruitiness -= 1;
    t.acidity -= 1;
    t.body += 1;
  } else if (flavor.includes("nut")) {
    t.nutty += 3;
    t.chocolate += 1;
    t.fruitiness -= 1;
  } else if (flavor.includes("balanced")) {
    // keep near center
    t.body += 0;
  }

  // explicit acidity preference overrides (if numeric)
  if (acidityPref != null && Number.isFinite(Number(acidityPref))) {
    t.acidity = clamp10(acidityPref, t.acidity);
  }

  // clamp
  for (const k of Object.keys(t)) t[k] = clamp10(t[k], 5);

  return t;
}

function buildChartPayload(blendProfile, targetProfile) {
  return {
    axes: CHART_AXES.map((a) => ({ key: a.key, label: a.label, min: 0, max: 10 })),
    series: [
      {
        name: "Your Blend",
        values: CHART_AXES.map((a) => Number(blendProfile?.[a.key] ?? 0)),
      },
      {
        name: "Your Target",
        values: CHART_AXES.map((a) => Number(targetProfile?.[a.key] ?? 0)),
      },
    ],
  };
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
      if (g > max) score += (g - max) * 40;
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
 * Autofix: strict correctness > taste nuance (last resort)
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

// ================== Recommend (OpenAI, Stock-aware, High-Explainability + Chart) ==================
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
      // sensory
      acidity: o.acidity,
      body: o.body,
      sweetness: o.sweetness,
      bitterness: o.bitterness,
      aroma: o.aroma,
      fruitiness: o.fruitiness,
      chocolate: o.chocolate,
      nutty: o.nutty,
    }));

    const targetProfile = deriveTargetProfile(preferences);

    // ====== Output spec: professional + "proof of choice" + persona letter ======
    const systemBase = `
You are APEX Blend Architect: a coffee formulator + a rational explainer.
You MUST be truthful and strictly bound to provided available_origins (notes + sensory numbers).
You MUST NOT invent flavors beyond each origin's notes array.

Return STRICT JSON only.

Hard constraints:
- Use ONLY origin_code from available_origins.
- Total grams must equal exactly ${size_g}.
- 2..5 origins.
- grams integer.
- min 20g per origin.
- grams <= maxGrams for each origin (stock).
- Explanations must be logical, calm, and convincing. No hype.

Explainability requirements:
- For each origin: say exactly why it was chosen AND why that grams (what it changes in cup).
- Show at least 1 counterfactual (what would change if we pushed one dial).
- Include a respectful "Taste Persona" letter based ONLY on user's preferences (not guessing private traits).

Optimization:
- daily: maximize quality-to-price (avoid expensive beans unless they add necessary structure).
- premium: maximize cup quality (cost secondary).
`;

    // JSON schema (Structured Outputs) for much higher reliability
    const outputSchema = {
      type: "object",
      additionalProperties: false,
      required: ["blend_name_suggestion", "recipe", "optimality_proof", "taste_persona_letter"],
      properties: {
        blend_name_suggestion: { type: "string" },
        recipe: {
          type: "array",
          minItems: 2,
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["origin_code", "grams", "explain"],
            properties: {
              origin_code: { type: "string" },
              grams: { type: "integer" },
              explain: {
                type: "object",
                additionalProperties: false,
                required: [
                  "role_in_structure",
                  "why_this_origin",
                  "why_this_grams",
                  "difference_vs_alternatives",
                  "honesty_clause",
                ],
                properties: {
                  role_in_structure: { type: "string" },
                  why_this_origin: {
                    type: "array",
                    minItems: 2,
                    maxItems: 6,
                    items: { type: "string" },
                  },
                  why_this_grams: {
                    type: "array",
                    minItems: 2,
                    maxItems: 6,
                    items: { type: "string" },
                  },
                  difference_vs_alternatives: {
                    type: "array",
                    minItems: 0,
                    maxItems: 3,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["alternative_origin_code", "why_not", "what_you_gain_by_current_choice"],
                      properties: {
                        alternative_origin_code: { type: "string" },
                        why_not: { type: "string" },
                        what_you_gain_by_current_choice: { type: "string" },
                      },
                    },
                  },
                  honesty_clause: { type: "string" },
                },
              },
            },
          },
        },
        optimality_proof: {
          type: "object",
          additionalProperties: false,
          required: ["objective", "constraints_checklist", "score_logic", "counterfactuals", "stock_respect_notes"],
          properties: {
            objective: { type: "string" },
            constraints_checklist: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 8 },
            score_logic: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 8 },
            counterfactuals: {
              type: "array",
              minItems: 1,
              maxItems: 3,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["change", "what_would_change_in_recipe", "why_current_is_optimum_for_given_prefs"],
                properties: {
                  change: { type: "string" },
                  what_would_change_in_recipe: { type: "string" },
                  why_current_is_optimum_for_given_prefs: { type: "string" },
                },
              },
            },
            stock_respect_notes: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
          },
        },
        taste_persona_letter: {
          type: "object",
          additionalProperties: false,
          required: ["title", "opening", "traits", "why_this_blend_matches_you", "how_to_brew_best", "closing"],
          properties: {
            title: { type: "string" },
            opening: { type: "string" },
            traits: {
              type: "array",
              minItems: 2,
              maxItems: 5,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["label", "evidence"],
                properties: {
                  label: { type: "string" },
                  evidence: { type: "string" },
                },
              },
            },
            why_this_blend_matches_you: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 },
            how_to_brew_best: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
            closing: { type: "string" },
          },
        },
      },
    };

    const userPayload = {
      size_g,
      line,
      preferences,
      target_profile: targetProfile,
      available_origins: availableOriginsForModel,
      constraints_hint: {
        min_per_origin_g: 20,
        max_origins: 5,
        must_be_truthful: true,
        show_counterfactuals: true,
      },
    };

    const MAX_ATTEMPTS = 5;
    let best = null;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const system =
        systemBase +
        (lastError
          ? `\nPrevious attempt failed validation with error: ${lastError}\nReturn corrected JSON that passes ALL constraints.`
          : "");

      const gen = await openai.responses.create({
        model: OPENAI_MODEL,
        temperature: OPENAI_TEMPERATURE,
        input: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(userPayload) },
        ],
        text: {
          format: {
            type: "json_schema",
            strict: true,
            schema: outputSchema,
          },
        },
      });

      const rawText = (gen.output_text || "").trim();

      try {
        const raw = JSON.parse(rawText);
        const recipe = raw?.recipe;

        const score = violationScore(recipe, size_g, originMap);
        if (!best || score < best.score) best = { raw, score, attempt };

        validateStrict(recipe, size_g, originMap);

        const strictRecipe = recipe.map((r) => ({
          origin_code: r.origin_code,
          grams: r.grams,
        }));

        const pricing = priceBlend(strictRecipe, originMap);

        const blendProfile = computeBlendProfile(strictRecipe, originMap);
        const chart = buildChartPayload(blendProfile, targetProfile);

        const outRecipe = strictRecipe.map((rr) => {
          const o = originMap.get(rr.origin_code);
          const found = (raw.recipe || []).find((x) => x?.origin_code === rr.origin_code);
          return {
            origin_code: rr.origin_code,
            origin_name: o?.name || rr.origin_code,
            grams: rr.grams,
            explain: found?.explain || null,
          };
        });

        return res.json({
          blend_name_suggestion: raw.blend_name_suggestion || "APEX Custom Blend",
          recipe: outRecipe,
          optimality_proof: raw.optimality_proof || null,
          taste_persona_letter: raw.taste_persona_letter || null,

          // ✅ chart payload for frontend (radar/spider chart)
          target_profile: targetProfile,
          blend_profile: blendProfile,
          chart,

          price: pricing.total,
          pricing,
          meta: {
            attempts: attempt,
            usedAutofix: false,
            stockSource: "db",
            model: OPENAI_MODEL,
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

    const blendProfile = computeBlendProfile(fixedRecipe, originMap);
    const chart = buildChartPayload(blendProfile, targetProfile);

    const fallbackRecipe = fixedRecipe.map((rr) => {
      const o = originMap.get(rr.origin_code);
      return {
        origin_code: rr.origin_code,
        origin_name: o?.name || rr.origin_code,
        grams: rr.grams,
        explain: {
          role_in_structure: "Balance (Fallback)",
          why_this_origin: [
            "Chosen from currently available stock; fallback mode focuses on correctness over nuanced optimization.",
            "Profile alignment uses only provided notes and sensory numbers."
          ],
          why_this_grams: [
            `Normalized to exactly ${size_g}g while keeping each component meaningful (>= 20g) and within stock.`,
            "Adjusting any component by ±20g will shift balance, but constraints must remain satisfied."
          ],
          difference_vs_alternatives: [],
          honesty_clause:
            "Fallback explanation stays conservative: no invented tasting claims, only data-bound reasoning.",
        },
      };
    });

    return res.json({
      blend_name_suggestion: safeStr(best.raw?.blend_name_suggestion, "APEX Custom Blend"),
      recipe: fallbackRecipe,
      optimality_proof: {
        objective: line,
        constraints_checklist: [
          `Total equals exactly ${size_g}g`,
          "2..5 origins, each >=20g integer",
          "Each grams <= maxGrams (stock)",
          "No duplicate origins",
        ],
        score_logic: [
          "Fallback used because AI output did not pass strict validation after multiple attempts.",
          "This result is constraint-correct; taste optimization is limited in autofix.",
        ],
        counterfactuals: [
          {
            change: "If we push one dial (e.g., more fruitiness)",
            what_would_change_in_recipe: "We would shift grams toward higher-fruitiness origins if stock allows.",
            why_current_is_optimum_for_given_prefs:
              "Current output prioritizes strict correctness under failure conditions.",
          },
        ],
        stock_respect_notes: ["All grams are within available stock for each origin."],
      },
      taste_persona_letter: {
        title: "Your Coffee Persona",
        opening:
          "Based on your selected preferences, this blend was built to respect your choices and the available stock with strict correctness.",
        traits: [
          { label: "Taste compass", evidence: "Derived only from your flavor_direction/acidity/milk selections." },
          { label: "Ritual style", evidence: "Derived only from your brew method + timing selections." },
          { label: "Power dial", evidence: "Derived only from your strength selection." },
        ],
        why_this_blend_matches_you: [
          "It stays inside your chosen direction without inventing notes.",
          "It preserves balance by enforcing meaningful minimum contributions per origin.",
          "It respects stock so the blend is actually producible.",
        ],
        how_to_brew_best: [
          "Keep ratio consistent. If you use milk, extract slightly stronger or tighten brew ratio for clarity.",
        ],
        closing: "If you tweak your preferences, we can re-optimize with a different structure.",
      },

      target_profile: targetProfile,
      blend_profile: blendProfile,
      chart,

      price: pricing.total,
      pricing,
      meta: {
        attempts: MAX_ATTEMPTS,
        usedAutofix: true,
        bestAttempt: best.attempt,
        bestScore: best.score,
        stockSource: "db",
        model: OPENAI_MODEL,
      },
    });
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

// ================== Admin APIs ==================
/**
 * GET /api/admin/orders?limit=200
 * بيرجع orders + items + location + snapshots
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
