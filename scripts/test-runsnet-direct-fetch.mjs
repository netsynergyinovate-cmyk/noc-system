import fs from "node:fs";

async function main() {
  console.log("1. Logging in via HTTP POST...");
  // Step 1: GET login.php for initial cookie
  const getLogin = await fetch("https://app.runsnet.id/login.php");
  const cookies = getLogin.headers.get("set-cookie") || "";
  const phpsessid = (cookies.match(/PHPSESSID=([^;]+)/) || [])[1] || "";
  console.log("Got initial PHPSESSID:", phpsessid);

  // Step 2: POST credentials to view/control/bagan_login.php
  const params = new URLSearchParams();
  params.append("username", "netsynergyinovate@yahoo.com");
  params.append("password", "netsynergyinovate@yahoo.com");
  params.append("simpan", "");

  const postLogin = await fetch(
    "https://app.runsnet.id/view/control/bagan_login.php",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: `PHPSESSID=${phpsessid}`,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://app.runsnet.id/login.php",
      },
      body: params.toString(),
    },
  );

  const postCookies = postLogin.headers.get("set-cookie") || "";
  const finalSession =
    (postCookies.match(/PHPSESSID=([^;]+)/) || [])[1] || phpsessid;
  console.log("Post login status:", postLogin.status, "Session:", finalSession);

  const authHeader = {
    Cookie: `PHPSESSID=${finalSession}`,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Referer: "https://app.runsnet.id/view/control/bagan_login.php",
  };

  // Step 3: Fetch function_get_main.php
  console.log("\n2. Fetching function_get_main.php...");
  const resMain = await fetch(
    "https://app.runsnet.id/view/control/function/function_get_main.php",
    {
      method: "POST",
      headers: authHeader,
    },
  );
  const htmlMain = await resMain.text();
  console.log("function_get_main response (length:", htmlMain.length, ")");
  console.log(htmlMain.slice(0, 1500));
  fs.writeFileSync("runsnet-menu-main.html", htmlMain);

  // Step 4: Fetch function_get_menu.php for previewb, previewc, previewd
  for (const mod of ["previewb", "previewc", "previewd"]) {
    console.log(`\n3. Fetching function_get_menu.php for ${mod}...`);
    const resMod = await fetch(
      `https://app.runsnet.id/view/control/function/function_get_menu.php?menu=_&master=${mod}&level=LVL06`,
      {
        method: "POST",
        headers: authHeader,
      },
    );
    const htmlMod = await resMod.text();
    console.log(
      `${mod} response (length: ${htmlMod.length}):\n`,
      htmlMod.slice(0, 2000),
    );
    fs.writeFileSync(`runsnet-menu-${mod}.html`, htmlMod);
  }
}

main().catch(console.error);
