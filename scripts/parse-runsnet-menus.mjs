import fs from "node:fs";

const html = fs.readFileSync("runsnet-dashboard.html", "utf-8");

// Search for all anchor tags
const links = [];
const aRegex = /<a\s+([^>]+)>([\s\S]*?)<\/a>/gi;
let match;
while ((match = aRegex.exec(html)) !== null) {
  const attrs = match[1];
  const text = match[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const hrefMatch = attrs.match(/href=["']([^"']*)["']/i);
  const onclickMatch = attrs.match(/onclick=["']([^"']*)["']/i);
  links.push({
    text,
    href: hrefMatch ? hrefMatch[1] : null,
    onclick: onclickMatch ? onclickMatch[1] : null,
    attrs
  });
}

console.log(`Total links found: ${links.length}`);
const relevant = links.filter(l => 
  /pelanggan|customer|invoice|tagihan|payment|bayar|kasir|ftth|menu|order/i.test(l.text) ||
  /pelanggan|customer|invoice|tagihan|payment|bayar|kasir|ftth|menu|order/i.test(l.onclick || "") ||
  /pelanggan|customer|invoice|tagihan|payment|bayar|kasir|ftth|menu|order/i.test(l.href || "")
);

console.log("=== Relevant Links ===");
console.log(JSON.stringify(relevant, null, 2));

// Search for scripts or functions
console.log("\n=== JavaScript Functions ===");
const scriptRegex = /<script[\s\S]*?<\/script>/gi;
const scripts = html.match(scriptRegex) || [];
for (const s of scripts) {
  if (/getmenu|pelanggan|invoice|payment/i.test(s)) {
    console.log("Script snippet:\n", s.slice(0, 1000));
  }
}

