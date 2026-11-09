import fs from "node:fs";

async function testQuery() {
  console.log("=== 1. Login to RunsNet ===");
  const getLogin = await fetch("https://app.runsnet.id/login.php");
  const cookies = getLogin.headers.get("set-cookie") || "";
  const phpsessid = (cookies.match(/PHPSESSID=([^;]+)/) || [])[1] || "";

  const loginParams = new URLSearchParams();
  loginParams.append("username", "netsynergyinovate@yahoo.com");
  loginParams.append("password", "netsynergyinovate@yahoo.com");
  loginParams.append("simpan", "");

  const postLogin = await fetch(
    "https://app.runsnet.id/view/control/bagan_login.php",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: `PHPSESSID=${phpsessid}`,
        Referer: "https://app.runsnet.id/login.php",
      },
      body: loginParams.toString(),
    },
  );

  const postCookies = postLogin.headers.get("set-cookie") || "";
  const session =
    (postCookies.match(/PHPSESSID=([^;]+)/) || [])[1] || phpsessid;
  console.log("Logged in with session:", session);

  const authHeaders = {
    Cookie: `PHPSESSID=${session}`,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Referer: "https://app.runsnet.id/view/",
  };

  // Helper for DataTables POST
  async function queryDataTable(name, path, searchVal = "") {
    console.log(`\n=== Testing ${name} (${path}) ===`);
    const dtBody = new URLSearchParams();
    dtBody.append("draw", "1");
    dtBody.append("start", "0");
    dtBody.append("length", "10");
    dtBody.append("search[value]", searchVal);
    dtBody.append("search[regex]", "false");

    const res = await fetch(`https://app.runsnet.id/view/${path}`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: dtBody.toString(),
    });

    console.log(`${name} status: ${res.status}`);
    const text = await res.text();
    fs.writeFileSync(`runsnet-data-${name}.json`, text);
    try {
      const json = JSON.parse(text);
      console.log(
        `${name} recordsTotal:`,
        json.recordsTotal,
        "recordsFiltered:",
        json.recordsFiltered,
      );
      console.log(`${name} sample row:`, json.data ? json.data[0] : "no data");
      return json;
    } catch (e) {
      console.log(
        `Failed to parse JSON for ${name}. Raw snippet:\n`,
        text.slice(0, 500),
      );
    }
  }

  // 1. Pelanggan
  await queryDataTable(
    "pelanggan",
    "model/previewc/query/pelanggan.php?data1=&data2=&data3=&data4=&target=ID00000000024&data6=",
  );

  // 2. Invoice
  await queryDataTable(
    "invoice",
    "model/previewc/query/invoice.php?data1=&data2=&data3=&data4=&data5=&target=ID00000000024",
  );

  // 3. Payment
  await queryDataTable(
    "payment",
    "model/previewc/query/payment.php?data1=&data2=&data4=&target=ID00000000024",
  );
}

testQuery().catch(console.error);
