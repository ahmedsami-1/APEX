import express from "express";
import cors from "cors";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";

// ================== App setup ==================
const app = express();

// Helpful on Render/behind proxy
app.set("trust proxy", 1);

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

// ✅ safer cors: don't throw from callback
const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // non-browser / server-to-server
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(null, false); // deny silently
  },
  credentials: true,
};

app.use(cors(corsOptions));
// ✅ Express 5 / path-to-regexp v6: "*" is invalid. Use regex or "/*"
app.options(/.*/, cors(corsOptions));

app.use(express.json({ limit: "1mb" }));

// ================== OpenAI client ==================
if (!process.env.OPENAI_API_KEY) console.warn("⚠️ Missing OPENAI_API_KEY");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ✅ Must be exactly gpt-5.2 (you requested no other model)
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.2";
if (OPENAI_MODEL !== "gpt-5.2") {
  console.warn(
    `⚠️ OPENAI_MODEL is "${OPENAI_MODEL}" but this server is locked to gpt-5.2.`
  );
}

const OPENAI_TEMPERATURE = Number(process.env.OPENAI_TEMPERATURE ?? "0.2");

// ================== Supabase Admin (server-only) ==================
if (!process.env.SUPABASE_URL) console.warn("⚠️ Missing SUPABASE_URL");
if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
  console.warn("⚠️ Missing SUPABASE_SERVICE_ROLE_KEY");

const supabaseAdmin =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;

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
      return res.status(500).json({ error: "Server missing SUPABASE_JWT_SECRET" });

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

/**
 * Load coffee origins from DB (stock aware).
 */
async function loadOriginsFromDB({ onlyAvailable = true } = {}) {
  if (!supabaseAdmin) throw new Error("Supabase admin not configured");

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

function clampNonNegInt(v, def = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(0, Math.floor(n));
}

function clampMoney(v, def = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(0, Math.round(n * 100) / 100);
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ================== Chart ==================
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
    for (const a of CHART_AXES) out[a.key] += w * clamp10(o[a.key], 5);
  }

  for (const a of CHART_AXES) out[a.key] = Math.round(out[a.key] * 10) / 10;
  return out;
}

function deriveTargetProfile(preferences) {
  const p = preferences || {};
  const method = safeStr(p.method || p.brew_method || "").toLowerCase();
  const strength = safeStr(p.strength || "").toLowerCase();
  const flavor = safeStr(p.flavor_direction || p.flavor || "").toLowerCase();
  const milk = safeStr(p.milk || p.with_milk || "").toLowerCase();
  const acidityPref = p.acidity_level ?? p.acidity ?? null;

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

  if (strength.includes("strong") || strength.includes("high")) {
    t.body += 1;
    t.bitterness += 1;
  } else if (strength.includes("light") || strength.includes("mild") || strength.includes("soft")) {
    t.body -= 1;
    t.bitterness -= 1;
    t.acidity += 1;
  }

  if (milk.includes("yes") || milk.includes("with") || milk.includes("milk")) {
    t.body += 1;
    t.chocolate += 1;
    t.nutty += 1;
    t.acidity -= 1;
  }

  if (flavor.includes("fruity") || flavor.includes("floral") || flavor.includes("citrus")) {
    t.fruitiness += 3;
    t.aroma += 1;
    t.chocolate -= 1;
    t.nutty -= 1;
  } else if (flavor.includes("choco") || flavor.includes("cocoa") || flavor.includes("caramel")) {
    t.chocolate += 3;
    t.fruitiness -= 1;
    t.acidity -= 1;
    t.body += 1;
  } else if (flavor.includes("nut")) {
    t.nutty += 3;
    t.chocolate += 1;
    t.fruitiness -= 1;
  } else if (flavor.includes("earthy") || flavor.includes("dark")) {
    t.body += 1;
    t.bitterness += 1;
    t.chocolate += 1;
    t.fruitiness -= 1;
  }

  if (acidityPref != null && Number.isFinite(Number(acidityPref))) {
    t.acidity = clamp10(acidityPref, t.acidity);
  }

  for (const k of Object.keys(t)) t[k] = clamp10(t[k], 5);
  return t;
}

function buildChartPayload(blendProfile, targetProfile) {
  return {
    axes: CHART_AXES.map((a) => ({ key: a.key, label: a.label, min: 0, max: 10 })),
    series: [
      { name: "Your Blend", values: CHART_AXES.map((a) => Number(blendProfile?.[a.key] ?? 0)) },
      { name: "Your Target", values: CHART_AXES.map((a) => Number(targetProfile?.[a.key] ?? 0)) },
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

function autofixBestAttempt(recipe, sizeG, originMap) {
  let fixed = (Array.isArray(recipe) ? recipe : [])
    .filter((r) => r && originMap.has(r.origin_code))
    .map((r) => ({
      origin_code: r.origin_code,
      grams: Math.max(20, Math.floor(Number(r.grams) || 20)),
    }));

  fixed.sort((a, b) => b.grams - a.grams);

  const used = new Set();
  fixed = fixed.filter((r) => (used.has(r.origin_code) ? false : (used.add(r.origin_code), true)));

  fixed = fixed.slice(0, 5);

  if (fixed.length < 2) {
    const sorted = [...originMap.values()].sort((a, b) => a.costPerG - b.costPerG);
    const cheapest = sorted[0];
    const second = sorted[1];
    if (cheapest && !used.has(cheapest.code)) fixed.push({ origin_code: cheapest.code, grams: 20 });
    if (fixed.length < 2 && second && !used.has(second.code))
      fixed.push({ origin_code: second.code, grams: 20 });
  }

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

// ================== Jobs (Async Recommend) ==================
const WORKER_ID = process.env.WORKER_ID || `worker-${Math.random().toString(16).slice(2)}`;
const WORKER_ENABLED = String(process.env.WORKER_ENABLED ?? "1") === "1";
const WORKER_POLL_MS = Math.max(500, parseInt(process.env.WORKER_POLL_MS || "1500", 10));
const WORKER_IDLE_SLEEP_MS = Math.max(200, parseInt(process.env.WORKER_IDLE_SLEEP_MS || "600", 10));
const JOB_MAX_ATTEMPTS = Math.max(1, parseInt(process.env.JOB_MAX_ATTEMPTS || "2", 10));

async function createJob(type, payload) {
  if (!supabaseAdmin) throw new Error("Supabase admin not configured");

  const { data, error } = await supabaseAdmin
    .from("jobs")
    .insert([
      {
        type,
        status: "queued",
        payload,
        attempts: 0,
        locked_at: null,
        locked_by: null,
      },
    ])
    .select("id, type, status, created_at")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function readJob(id) {
  if (!supabaseAdmin) throw new Error("Supabase admin not configured");

  const { data, error } = await supabaseAdmin
    .from("jobs")
    .select("id, type, status, payload, result, error, attempts, created_at, updated_at")
    .eq("id", id)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

// Best-effort lock: select oldest queued job, then update if still queued.
async function lockNextQueuedJob(type = "recommend") {
  if (!supabaseAdmin) throw new Error("Supabase admin not configured");

  const { data: queued, error: qErr } = await supabaseAdmin
    .from("jobs")
    .select("id")
    .eq("status", "queued")
    .eq("type", type)
    .order("created_at", { ascending: true })
    .limit(1);

  if (qErr) throw new Error(qErr.message);

  const job = queued?.[0];
  if (!job) return null;

  const { data: locked, error: lErr } = await supabaseAdmin
    .from("jobs")
    .update({
      status: "running",
      locked_at: nowIso(),
      locked_by: WORKER_ID,
      updated_at: nowIso(),
    })
    .eq("id", job.id)
    .eq("status", "queued")
    .select("id, payload, attempts, type")
    .single();

  if (lErr) return null; // locked by someone else
  return locked;
}

async function markJobSuccess(id, result) {
  const { error } = await supabaseAdmin
    .from("jobs")
    .update({
      status: "succeeded",
      result,
      error: null,
      updated_at: nowIso(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

async function markJobFailed(id, errMsg) {
  const { error } = await supabaseAdmin
    .from("jobs")
    .update({
      status: "failed",
      error: errMsg,
      updated_at: nowIso(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

async function bumpAttempts(id, attempts) {
  const { error } = await supabaseAdmin
    .from("jobs")
    .update({
      attempts: (attempts || 0) + 1,
      updated_at: nowIso(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ================== Recommend core (same logic as before, returns JSON) ==================
async function runRecommend(payload) {
  if (OPENAI_MODEL !== "gpt-5.2") {
    throw new Error(
      `Server locked to gpt-5.2. Current OPENAI_MODEL="${OPENAI_MODEL}" is not allowed.`
    );
  }

  const { size_g, line, preferences } = payload || {};

  if (!Number.isInteger(size_g) || size_g <= 0) throw new Error("size_g must be positive int");
  if (line !== "daily" && line !== "premium") throw new Error("line must be daily|premium");
  if (!preferences) throw new Error("preferences required");
  if (!process.env.OPENAI_API_KEY) throw new Error("Server missing OPENAI_API_KEY");

  const ORIGINS_DB = await loadOriginsFromDB({ onlyAvailable: true });
  if (!ORIGINS_DB.length) throw new Error("No stock available right now.");

  const originMap = new Map(ORIGINS_DB.map((o) => [o.code, o]));
  const availableOriginsForModel = ORIGINS_DB.map((o) => ({
    code: o.code,
    name: o.name,
    maxGrams: o.maxGrams,
    costPerG: o.costPerG,
    notes: o.notes,
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
`.trim();

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
              properties: { label: { type: "string" }, evidence: { type: "string" } },
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

  const FORMAT_NAME = "apex_blend_v1";
  const MAX_ATTEMPTS = 5;
  let best = null;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const system =
      systemBase +
      (lastError
        ? `\n\nPrevious attempt failed validation with error: ${lastError}\nReturn corrected JSON that passes ALL constraints.`
        : "");

    const gen = await openai.responses.create({
      model: OPENAI_MODEL,
      temperature: OPENAI_TEMPERATURE,
      max_output_tokens: Math.max(1200, parseInt(process.env.OPENAI_MAX_OUTPUT_TOKENS || "1800", 10)),
      input: [
        { role: "system", content: [{ type: "input_text", text: system }] },
        { role: "user", content: [{ type: "input_text", text: JSON.stringify(userPayload) }] },
      ],
      text: { format: { name: FORMAT_NAME, type: "json_schema", strict: true, schema: outputSchema } },
    });

    const rawText = (gen.output_text || "").trim();
    const raw = safeJsonParse(rawText);

    try {
      if (!raw) throw new Error("Model returned non-JSON text");

      const recipe = raw?.recipe;

      const score = violationScore(recipe, size_g, originMap);
      if (!best || score < best.score) best = { raw, score, attempt };

      validateStrict(recipe, size_g, originMap);

      const strictRecipe = recipe.map((r) => ({ origin_code: r.origin_code, grams: r.grams }));

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

      return {
        blend_name_suggestion: raw.blend_name_suggestion || "APEX Custom Blend",
        recipe: outRecipe,
        optimality_proof: raw.optimality_proof || null,
        taste_persona_letter: raw.taste_persona_letter || null,
        target_profile: targetProfile,
        blend_profile: blendProfile,
        chart,
        price: pricing.total,
        pricing,
        meta: { attempts: attempt, usedAutofix: false, stockSource: "db", model: OPENAI_MODEL, format: FORMAT_NAME },
      };
    } catch (e) {
      lastError = String(e?.message || e);
      continue;
    }
  }

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
          "Profile alignment uses only provided notes and sensory numbers.",
        ],
        why_this_grams: [
          `Normalized to exactly ${size_g}g while keeping each component meaningful (>= 20g) and within stock.`,
          "Adjusting any component by ±20g will shift balance, but constraints must remain satisfied.",
        ],
        difference_vs_alternatives: [],
        honesty_clause: "Fallback explanation stays conservative: no invented tasting claims, only data-bound reasoning.",
      },
    };
  });

  return {
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
          why_current_is_optimum_for_given_prefs: "Current output prioritizes strict correctness under failure conditions.",
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
      how_to_brew_best: ["Keep ratio consistent. If you use milk, extract slightly stronger or tighten brew ratio for clarity."],
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
      format: FORMAT_NAME,
    },
  };
}

// ================== Health ==================
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now(), worker: WORKER_ID }));

// ================== Recommend (Async Job) ==================
app.post("/api/recommend", async (req, res) => {
  try {
    if (!supabaseAdmin) throw new Error("Server missing Supabase env vars");
    if (!process.env.OPENAI_API_KEY) throw new Error("Server missing OPENAI_API_KEY");

    if (OPENAI_MODEL !== "gpt-5.2") {
      return res.status(400).json({
        ok: false,
        error: `Server locked to gpt-5.2. Current OPENAI_MODEL="${OPENAI_MODEL}" not allowed.`,
      });
    }

    const { size_g, line, preferences } = req.body || {};
    if (!Number.isInteger(size_g) || size_g <= 0) throw new Error("size_g must be positive int");
    if (line !== "daily" && line !== "premium") throw new Error("line must be daily|premium");
    if (!preferences) throw new Error("preferences required");

    const payload = { size_g, line, preferences };
    const job = await createJob("recommend", payload);

    return res.json({ ok: true, job_id: job.id, status: job.status });
  } catch (e) {
    return res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// Poll job
app.get("/api/jobs/:id", async (req, res) => {
  try {
    if (!supabaseAdmin) throw new Error("Server missing Supabase env vars");

    const job = await readJob(req.params.id);

    return res.json({
      ok: true,
      job: {
        id: job.id,
        type: job.type,
        status: job.status,
        attempts: job.attempts,
        created_at: job.created_at,
        updated_at: job.updated_at,
        error: job.error,
        result: job.result,
      },
    });
  } catch (e) {
    return res.status(404).json({ ok: false, error: String(e?.message || e) });
  }
});

// ================== Admin Stock APIs ==================
const ORIGIN_SEL = `
  code, name, stock_g, cost_per_g, notes, is_active,
  acidity, body, sweetness, bitterness, aroma, fruitiness, chocolate, nutty
`;

app.get("/api/admin/origins", requireAdmin, async (req, res) => {
  try {
    if (!supabaseAdmin) throw new Error("Server missing Supabase env vars");

    const includeInactive = String(req.query.include_inactive || "0") === "1";

    let q = supabaseAdmin.from("origins").select(ORIGIN_SEL).order("code", { ascending: true });
    if (!includeInactive) q = q.eq("is_active", true);

    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });

    res.json({ ok: true, origins: data || [] });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/admin/origins", requireAdmin, async (req, res) => {
  try {
    if (!supabaseAdmin) throw new Error("Server missing Supabase env vars");

    const b = req.body || {};
    const code = safeStr(b.code).trim();
    if (!code) return res.status(400).json({ error: "code required" });

    const row = {
      code,
      name: safeStr(b.name).trim() || code,
      stock_g: clampNonNegInt(b.stock_g, 0),
      cost_per_g: clampMoney(b.cost_per_g, 0),
      notes: Array.isArray(b.notes) ? b.notes.map((x) => safeStr(x).trim()).filter(Boolean) : [],
      is_active: b.is_active == null ? true : !!b.is_active,
      acidity: clamp10(b.acidity, 5),
      body: clamp10(b.body, 5),
      sweetness: clamp10(b.sweetness, 5),
      bitterness: clamp10(b.bitterness, 5),
      aroma: clamp10(b.aroma, 5),
      fruitiness: clamp10(b.fruitiness, 5),
      chocolate: clamp10(b.chocolate, 5),
      nutty: clamp10(b.nutty, 5),
    };

    const { data, error } = await supabaseAdmin.from("origins").insert([row]).select(ORIGIN_SEL).single();
    if (error) return res.status(400).json({ error: error.message });

    res.json({ ok: true, origin: data });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.patch("/api/admin/origins/:code", requireAdmin, async (req, res) => {
  try {
    if (!supabaseAdmin) throw new Error("Server missing Supabase env vars");

    const code = safeStr(req.params.code).trim();
    if (!code) return res.status(400).json({ error: "code required" });

    const b = req.body || {};
    const patch = {};

    if (b.name != null) patch.name = safeStr(b.name).trim();
    if (b.stock_g != null) patch.stock_g = clampNonNegInt(b.stock_g, 0);
    if (b.cost_per_g != null) patch.cost_per_g = clampMoney(b.cost_per_g, 0);
    if (b.is_active != null) patch.is_active = !!b.is_active;

    if (b.notes != null) {
      patch.notes = Array.isArray(b.notes) ? b.notes.map((x) => safeStr(x).trim()).filter(Boolean) : [];
    }

    for (const k of ["acidity", "body", "sweetness", "bitterness", "aroma", "fruitiness", "chocolate", "nutty"]) {
      if (b[k] != null) patch[k] = clamp10(b[k], 5);
    }

    if (!Object.keys(patch).length) return res.status(400).json({ error: "No fields to update" });

    const { data, error } = await supabaseAdmin.from("origins").update(patch).eq("code", code).select(ORIGIN_SEL).single();
    if (error) return res.status(400).json({ error: error.message });

    res.json({ ok: true, origin: data });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.delete("/api/admin/origins/:code", requireAdmin, async (req, res) => {
  try {
    if (!supabaseAdmin) throw new Error("Server missing Supabase env vars");

    const code = safeStr(req.params.code).trim();
    if (!code) return res.status(400).json({ error: "code required" });

    const { data, error } = await supabaseAdmin
      .from("origins")
      .update({ is_active: false, stock_g: 0 })
      .eq("code", code)
      .select(ORIGIN_SEL)
      .single();

    if (error) return res.status(400).json({ error: error.message });

    res.json({ ok: true, origin: data });
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

// ================== Error middleware ==================
app.use((err, req, res, next) => {
  const msg = String(err?.message || err);
  console.error("Unhandled error:", err);
  res.status(500).json({ error: msg || "Server error" });
});

// ================== Worker loop ==================
let workerRunning = false;

async function workerTickOnce() {
  if (!WORKER_ENABLED) return;
  if (!supabaseAdmin) return;
  if (workerRunning) return;

  workerRunning = true;
  try {
    const job = await lockNextQueuedJob("recommend");
    if (!job) {
      await sleep(WORKER_IDLE_SLEEP_MS);
      return;
    }

    await bumpAttempts(job.id, job.attempts);

    try {
      const result = await runRecommend(job.payload);
      await markJobSuccess(job.id, result);
    } catch (e) {
      const errMsg = String(e?.message || e);

      const attemptsNow = (job.attempts || 0) + 1;
      if (attemptsNow < JOB_MAX_ATTEMPTS) {
        await supabaseAdmin
          .from("jobs")
          .update({
            status: "queued",
            error: errMsg,
            locked_at: null,
            locked_by: null,
            updated_at: nowIso(),
          })
          .eq("id", job.id);
      } else {
        await markJobFailed(job.id, errMsg);
      }
    }
  } catch (e) {
    console.error("Worker tick error:", e);
  } finally {
    workerRunning = false;
  }
}

function startWorkerLoop() {
  if (!WORKER_ENABLED) {
    console.log("Worker disabled (WORKER_ENABLED=0)");
    return;
  }
  if (!supabaseAdmin) {
    console.log("Worker not started: missing Supabase env vars");
    return;
  }
  console.log(`Worker started: ${WORKER_ID} poll=${WORKER_POLL_MS}ms`);
  setInterval(() => {
    workerTickOnce().catch((e) => console.error("workerTickOnce fatal:", e));
  }, WORKER_POLL_MS);
}

// ================== Start ==================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log("Backend running: http://localhost:" + PORT);
  startWorkerLoop();
});
