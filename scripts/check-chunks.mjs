import fs from "node:fs";

const s = fs.readFileSync(".next/static/chunks/40b3tdxbzsdmg.js", "utf8");
console.log("Chunk length:", s.length);
// Search for component names or strings
const matches = s.match(/[A-Z][a-zA-Z0-9]+(?:Map|Board|Panel|Layer|Table)/g);
console.log("Component-like names:", [...new Set(matches || [])].slice(0, 30));

// Find words around satellite-layer
const idx = s.indexOf("satellite-layer");
console.log(
  "Context around satellite-layer (500 chars):\n",
  s.slice(Math.max(0, idx - 400), idx + 400),
);
