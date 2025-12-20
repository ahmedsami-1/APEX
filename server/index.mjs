import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { promises as fs } from "fs";
import path from "path";

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ===== Demo stock (بدّلها لاحقًا بـ DB + stock الحقيقي) =====
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
  const beanCost = recipe.reduce((s, r) => s + r.grams * originMap.get(r.origin_code).costPerG, 0);
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
  // lower is better
  let score = 0;
  if (!Array.isArray(recipe)) return 1e9;

  // duplicates / invalid codes
  const seen = new Set();
  for (const r of recipe) {
    if (!r || typeof r.origin_code !== "string") { score += 2000; continue; }
    if (!originMap.has(r.origin_code)) score += 2000;
    if (seen.has(r.origin_code)) score += 500; // duplicate
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
  if (!Array.isArray(recipe) || recipe.length < 2 || recipe.length > 5) throw new Error("recipe must have 2..5 items");
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
  // keep valid codes only
  let fixed = (Array.isArray(recipe) ? recipe : [])
    .filter(r => r && originMap.has(r.origin_code))
    .map(r => ({ origin_code: r.origin_code, grams: Math.max(20, Math.floor(Number(r.grams) || 20)) }));

  // remove duplicates (keep the first by grams desc)
  fixed.sort((a, b) => b.grams - a.grams);
  const used = new Set();
  fixed = fixed.filter(r => (used.has(r.origin_code) ? false : (used.add(r.origin_code), true)));

  // keep at most 5
  fixed = fixed.slice(0, 5);

  // ensure at least 2
  if (fixed.length < 2) {
    const cheapest = [...originMap.values()].sort((a, b) => a.costPerG - b.costPerG)[0];
    if (cheapest && !used.has(cheapest.code)) fixed.push({ origin_code: cheapest.code, grams: 20 });
    const second = [...originMap.values()].sort((a, b) => a.costPerG - b.costPerG)[1];
    if (fixed.length < 2 && second && !used.has(second.code)) fixed.push({ origin_code: second.code, grams: 20 });
  }

  // cap by maxGrams
  fixed = fixed.map(r => {
    const max = originMap.get(r.origin_code).maxGrams;
    return { ...r, grams: Math.min(r.grams, max) };
  });

  // normalize sum to exactly sizeG
  let sum = fixed.reduce((s, r) => s + r.grams, 0);
  let guard = 0;
  while (sum !== sizeG && guard++ < 5000) {
    const dir = sum > sizeG ? -1 : 1;
    const idx = fixed.findIndex(r => {
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

function safeSecondPick(rawSecond, sizeG, originMap) {
  if (!rawSecond) return null;

  // Try strict validate first
  try {
    validateStrict(rawSecond.recipe, sizeG, originMap);
    const strict = rawSecond.recipe.map(r => ({ origin_code: r.origin_code, grams: r.grams }));
    return {
      blend_name_suggestion: rawSecond.blend_name_suggestion || "APEX Alternative",
      short_why: rawSecond.short_why || "",
      recipe: strict.map(r => ({
        origin_code: r.origin_code,
        origin_name: originMap.get(r.origin_code).name,
        grams: r.grams,
      })),
      meta: { usedAutofix: false },
    };
  } catch {
    // Autofix if it can
    try {
      const fixed = autofixBestAttempt(rawSecond.recipe, sizeG, originMap);
      return {
        blend_name_suggestion: rawSecond.blend_name_suggestion || "APEX Alternative",
        short_why: rawSecond.short_why || "",
        recipe: fixed.map(r => ({
          origin_code: r.origin_code,
          origin_name: originMap.get(r.origin_code).name,
          grams: r.grams,
        })),
        meta: { usedAutofix: true },
      };
    } catch {
      return null;
    }
  }
}

// ======================
// Orders storage (local JSON)
// ======================
const DATA_DIR = path.resolve(process.cwd(), "data");
const ORDERS_PATH = path.join(DATA_DIR, "orders.json");

async function readOrders() {
  try {
    const txt = await fs.readFile(ORDERS_PATH, "utf8");
    return JSON.parse(txt);
  } catch {
    return [];
  }
}

async function writeOrders(orders) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(ORDERS_PATH, JSON.stringify(orders, null, 2), "utf8");
}

function makeId() {
  return "ord_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

// ✅ Health route
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

// ======================
// AI Recommend (Phase 2-C)
// ======================
app.post("/api/recommend", async (req, res) => {
  try {
    const { size_g, line, preferences } = req.body || {};
    if (!Number.isInteger(size_g) || size_g <= 0) throw new Error("size_g must be positive int");
    if (line !== "daily" && line !== "premium") throw new Error("line must be daily|premium");
    if (!preferences) throw new Error("preferences required");

    const originMap = new Map(ORIGINS.map(o => [o.code, o]));

    const systemBase = `
You are APEX, a luxury coffee brand blend architect and copywriter.

Return STRICT JSON only with this exact shape:
{
  "blend_name_suggestion": "APEX ...",
  "recipe": [{"origin_code":"BR_SANTOS","grams":120}],
  "short_why": "EXACTLY 3 short sentences.",
  "second_pick": {
    "blend_name_suggestion": "APEX ...",
    "recipe": [{"origin_code":"CO_SUPREMO","grams":120}],
    "short_why": "EXACTLY 3 short sentences."
  }
}

Hard rules (apply to BOTH recipe and second_pick.recipe):
- Use ONLY origin_code values provided.
- Total grams must equal exactly ${size_g}.
- 2 to 5 origins.
- Minimum 20g per origin.
- Do not exceed maxGrams for any origin.
- grams must be integers.

Line behavior:
- daily: optimum quality-to-price (cost matters)
- premium: best taste and character (ignore cost)

Copy rules for short_why:
- EXACTLY 3 short sentences.
- Sound premium and confident.
- No roasting jargon.
- No percentages.
- No technical explanations.
- Mention: flavor impression + mouthfeel/strength + best moment/use case.

Naming rules:
- 2 to 3 words max after "APEX"
- No generic words like "Coffee", "Blend", "Roast"
- Strong + elegant vibe (e.g., "Midnight Ember", "Golden Crest", "Dark Crown")
`;

    const userPayload = {
      size_g,
      line,
      preferences,
      available_origins: ORIGINS,
    };

    let best = null; // { raw, score, attempt }
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

        // strict validation for MAIN recipe
        validateStrict(recipe, size_g, originMap);

        const strictRecipe = recipe.map(x => ({ origin_code: x.origin_code, grams: x.grams }));
        const pricing = priceBlend(strictRecipe, originMap);

        const secondPick = safeSecondPick(raw.second_pick, size_g, originMap);

        return res.json({
          blend_name_suggestion: raw.blend_name_suggestion || "APEX Custom",
          short_why: raw.short_why || "",
          recipe: strictRecipe.map(rr => ({
            origin_code: rr.origin_code,
            origin_name: originMap.get(rr.origin_code).name,
            grams: rr.grams,
          })),
          price: pricing.total,
          pricing,
          second_pick: secondPick,
          meta: { attempts: attempt, usedAutofix: false },
        });
      } catch (e) {
        lastError = String(e?.message || e);
        continue;
      }
    }

    if (!best) throw new Error("No usable output after 3 attempts");

    // ✅ Autofix best attempt for MAIN recipe
    const fixedRecipe = autofixBestAttempt(best.raw.recipe, size_g, originMap);
    const pricing = priceBlend(fixedRecipe, originMap);

    const secondPick = safeSecondPick(best.raw.second_pick, size_g, originMap);

    return res.json({
      blend_name_suggestion: best.raw.blend_name_suggestion || "APEX Custom",
      short_why: best.raw.short_why || "",
      recipe: fixedRecipe.map(r => ({
        origin_code: r.origin_code,
        origin_name: originMap.get(r.origin_code).name,
        grams: r.grams,
      })),
      price: pricing.total,
      pricing,
      second_pick: secondPick,
      meta: { attempts: 3, usedAutofix: true, bestAttempt: best.attempt, bestScore: best.score },
    });
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

// ======================
// Orders API (COD MVP)
// ======================
app.post("/api/orders", async (req, res) => {
  try {
    const body = req.body || {};
    const customer = body.customer || {};
    const items = Array.isArray(body.items) ? body.items : [];

    if (!customer.name || !customer.phone || !customer.address) {
      throw new Error("customer.name/phone/address are required");
    }
    if (items.length < 1) throw new Error("items required");

    for (const it of items) {
      if (!it.title || !Number.isFinite(it.price) || !it.recipe || !Array.isArray(it.recipe)) {
        throw new Error("each item must have title, price, recipe[]");
      }
    }

    const orders = await readOrders();

    const order = {
      id: makeId(),
      createdAt: new Date().toISOString(),
      status: "new",
      payment: "COD",
      customer: {
        name: String(customer.name),
        phone: String(customer.phone),
        address: String(customer.address),
        notes: customer.notes ? String(customer.notes) : "",
      },
      items: items.map(it => ({
        title: String(it.title),
        price: Number(it.price),
        line: it.line ? String(it.line) : "daily",
        size_g: Number(it.size_g || 250),
        recipe: it.recipe.map(r => ({
          origin_code: String(r.origin_code),
          origin_name: String(r.origin_name || r.origin_code),
          grams: Number(r.grams),
        })),
      })),
      total: items.reduce((s, it) => s + Number(it.price || 0), 0),
    };

    orders.unshift(order);
    await writeOrders(orders);

    res.json({ ok: true, order });
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

app.get("/api/orders", async (req, res) => {
  const orders = await readOrders();
  res.json({ ok: true, orders });
});
import path from "path";
const WEB_DIST = path.resolve(process.cwd(), "../web/dist");

app.use(express.static(WEB_DIST));

// SPA fallback: any non-API route -> index.html
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(WEB_DIST, "index.html"));
});

// ✅ START SERVER (keep last)
app.listen(3001, () => console.log("Backend running: http://localhost:3001"));
