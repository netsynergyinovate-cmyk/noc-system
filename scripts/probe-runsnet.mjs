import fs from "node:fs";

async function probe() {
  console.log("=== 1. Probing https://app.runsnet.id/login.php ===");
  try {
    const res = await fetch("https://app.runsnet.id/login.php", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    console.log("Status:", res.status);
    console.log("Set-Cookie:", res.headers.get("set-cookie"));
    const html = await res.text();
    fs.writeFileSync("runsnet-login.html", html, "utf-8");
    console.log("Saved runsnet-login.html (length:", html.length, ")");

    // Look for form, action, method, inputs
    const formMatch = html.match(/<form[\s\S]*?<\/form>/i);
    if (formMatch) {
      console.log("Found form:\n", formMatch[0]);
    } else {
      console.log(
        "No <form> found, checking raw HTML preview:\n",
        html.slice(0, 1500),
      );
    }
  } catch (e) {
    console.error("Fetch failed:", e);
  }
}

probe();
