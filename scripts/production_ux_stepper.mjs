import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const APP = "web/src/App.jsx";

let app = fs.readFileSync(path.join(ROOT, APP), "utf8");

// Step state
if (!app.includes("const [step,")) {
  app = app.replace(
    /useState\(/,
    `useState(
const [step, setStep] = useState(1);
`
  );
}

// Move to review after generate
app = app.replace(
  /await fetchBlend\(\);/g,
  `await fetchBlend(); setStep(3);`
);

// After add to cart → checkout
app = app.replace(
  /addBlendToCartFromGenerated\(\);/g,
  `addBlendToCartFromGenerated(); setStep(4);`
);

// Disable buttons while loading
app = app.replace(
  /<button/g,
  `<button disabled={loadingBlend}`
);

// Validation before place order
app = app.replace(
  /placeOrder\(\);/g,
  `
if (!name || !phone || cart.length === 0) {
  alert("Please complete your details and add at least one blend.");
  return;
}
placeOrder();
`
);

fs.writeFileSync(path.join(ROOT, APP), app);
console.log("Production UX stepper applied.");
