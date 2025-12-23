import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function read(p) {
  return fs.readFileSync(path.join(ROOT, p), "utf8");
}
function write(p, s) {
  fs.mkdirSync(path.dirname(path.join(ROOT, p)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, p), s, "utf8");
}

function ensureOnce(haystack, needle, insert) {
  if (haystack.includes(needle)) return haystack;
  return haystack + insert;
}

function replaceOrWarn(src, re, replacement, label) {
  const before = src;
  const after = src.replace(re, replacement);
  if (after === before) {
    console.warn(`[WARN] No change for: ${label}`);
  } else {
    console.log(`[OK] Applied: ${label}`);
  }
  return after;
}

const APP = "web/src/App.jsx";
const CSS = "web/src/apex.css";

let app = read(APP);

// 1) Button label: Get My Blend -> Generate Blend (only the literal text)
app = replaceOrWarn(
  app,
  /"Get My Blend"/g,
  `"Generate Blend"`,
  "Generate button label"
);

// 2) Add-to-cart label for generated blend (anchor by handler name nearby)
app = replaceOrWarn(
  app,
  /(onClick=\{addBlendToCartFromGenerated\}[^]*?\{[^]*?)"Add to Cart"([^]*?\})/m,
  `$1"Add Blend to Cart"$2`,
  "Add Blend to Cart (generated)"
);

// 3) Cart title badge: inject {cart.length}
app = replaceOrWarn(
  app,
  /(<div className="apexCardTitle">Cart & Checkout)(<\/div>)/g,
  `$1 <span className="apexCountBadge">{cart.length}</span>$2`,
  "Cart badge in title"
);

// 4) Better empty cart message (replace a very small empty marker if present)
app = app.replace(
  />\s*Empty\s*</g,
  `>Your cart is empty. Generate a blend, then tap “Add Blend to Cart”.<`
);

// 5) Small microcopy improvements (safe, optional)
app = app.replace(/"Place Order"/g, `"Place Order (Cash on Delivery)"`);

write(APP, app);

// CSS: add badge class (append safely if not present)
let css = read(CSS);
css = ensureOnce(
  css,
  ".apexCountBadge",
  `
.apexCountBadge{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width:22px;
  height:22px;
  padding:0 8px;
  border-radius:999px;
  margin-left:10px;
  font-size:12px;
  font-weight:800;
  background:rgba(255,255,255,0.10);
  border:1px solid rgba(255,255,255,0.14);
}
`
);

write(CSS, css);

console.log("Production polish done.");
