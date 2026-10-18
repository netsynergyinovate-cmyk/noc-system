import fs from "node:fs";

async function main() {
  // Step 1: Login
  const getLogin = await fetch("https://app.runsnet.id/login.php");
  const cookies = getLogin.headers.get("set-cookie") || "";
  const phpsessid = (cookies.match(/PHPSESSID=([^;]+)/) || [])[1] || "";

  const params = new URLSearchParams();
  params.append("username", "netsynergyinovate@yahoo.com");
  params.append("password", "netsynergyinovate@yahoo.com");
  params.append("simpan", "");

  const postLogin = await fetch("https://app.runsnet.id/view/control/bagan_login.php", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": `PHPSESSID=${phpsessid}`,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer": "https://app.runsnet.id/login.php"
    },
    body: params.toString()
  });

  const postCookies = postLogin.headers.get("set-cookie") || "";
  const finalSession = (postCookies.match(/PHPSESSID=([^;]+)/) || [])[1] || phpsessid;

  const authHeader = {
    "Cookie": `PHPSESSID=${finalSession}`,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://app.runsnet.id/view/control/bagan_login.php"
  };

  const targets = {
    pelanggan: "MVAxWkxyRHRIRDF2MU9EbUg1a0hUSm8wMU1GL3BFTHNaNitvcmRUNXJkZz0=",
    invoice: "QVIxVmlWNUMwRzBFaENsa2hlZVM2MS9PNnpBejNBMzl2L05xeUx6dXZ2TT0=",
    payment: "Qy90UHNlSmZVclhuUjd5TWNFZnF4SG94dnU2aFNBTFVJbWxEaUd1SWVZZz0="
  };

  const paramName = "WmxBZ3o0TVVUd1ZWYlc1TnZhUDVQQT09";

  for (const [name, token] of Object.entries(targets)) {
    console.log(`\n=== Fetching ${name} ===`);
    const url = `https://app.runsnet.id/view/?${paramName}=${encodeURIComponent(token)}`;
    const res = await fetch(url, { headers: authHeader });
    console.log(`Status: ${res.status}`);
    const html = await res.text();
    fs.writeFileSync(`runsnet-${name}.html`, html);
    console.log(`Saved runsnet-${name}.html (size: ${html.length})`);

    // Extract table headers and DataTables scripts/AJAX endpoints
    const ths = html.match(/<th[^>]*>[\s\S]*?<\/th>/gi) || [];
    console.log(`Table headers (${ths.length}):`, ths.map(h => h.replace(/<[^>]+>/g, "").trim()).filter(Boolean).slice(0, 15));

    // Look for DataTables initialization or pagination
    const dataTableMatches = html.match(/dataTable\([\s\S]*?\)|ajax:[\s\S]*?,/gi) || [];
    if (dataTableMatches.length > 0) {
      console.log("DataTable setup detected:", dataTableMatches[0].slice(0, 300));
    }
  }
}

main().catch(console.error);

