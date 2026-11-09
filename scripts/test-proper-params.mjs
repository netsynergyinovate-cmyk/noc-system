import fs from "node:fs";

async function testWithProperParams() {
  console.log("=== Testing with full DataTables columns payload ===");
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
      },
      body: loginParams.toString(),
    },
  );

  const session =
    (postLogin.headers.get("set-cookie")?.match(/PHPSESSID=([^;]+)/) ||
      [])[1] || phpsessid;

  // Build standard DataTables 12 columns params
  function buildDtParams(start = 0, length = 10, search = "") {
    const p = new URLSearchParams();
    p.append("draw", "1");
    p.append("start", String(start));
    p.append("length", String(length));
    p.append("search[value]", search);
    p.append("search[regex]", "false");
    p.append("order[0][column]", "1");
    p.append("order[0][dir]", "desc");

    for (let i = 0; i < 12; i++) {
      p.append(`columns[${i}][data]`, String(i));
      p.append(`columns[${i}][name]`, "");
      p.append(`columns[${i}][searchable]`, "true");
      p.append(
        `columns[${i}][orderable]`,
        i === 0 || i === 11 ? "false" : "true",
      );
      p.append(`columns[${i}][search][value]`, "");
      p.append(`columns[${i}][search][regex]`, "false");
    }
    return p;
  }

  // Test 1: Pelanggan start=0, length=100
  console.log("\n1. Fetching pelanggan with length=100...");
  const resPelanggan = await fetch(
    "https://app.runsnet.id/view/model/previewc/query/pelanggan.php?data1=&data2=&data3=&data4=&target=ID00000000024&data6=",
    {
      method: "POST",
      headers: {
        Cookie: `PHPSESSID=${session}`,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: buildDtParams(0, 100).toString(),
    },
  );

  const textPelanggan = await resPelanggan.text();
  console.log("Pelanggan response status:", resPelanggan.status);
  try {
    const json = JSON.parse(textPelanggan);
    console.log(
      "SUCCESS! Pelanggan recordsFiltered:",
      json.recordsFiltered,
      "rows returned:",
      json.data.length,
    );
  } catch (e) {
    console.log("Failed. Snippet:", textPelanggan.slice(0, 300));
  }

  // Test 2: Invoice start=0, length=100
  console.log("\n2. Fetching invoice with length=100...");
  const resInvoice = await fetch(
    "https://app.runsnet.id/view/model/previewc/query/invoice.php?data1=&data2=&data3=&data4=&data5=&target=ID00000000024",
    {
      method: "POST",
      headers: {
        Cookie: `PHPSESSID=${session}`,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: buildDtParams(0, 100).toString(),
    },
  );

  const textInvoice = await resInvoice.text();
  console.log("Invoice response status:", resInvoice.status);
  try {
    const json = JSON.parse(textInvoice);
    console.log(
      "SUCCESS! Invoice recordsFiltered:",
      json.recordsFiltered,
      "rows returned:",
      json.data.length,
    );
  } catch (e) {
    console.log("Failed. Snippet:", textInvoice.slice(0, 300));
  }

  // Test 3: Payment start=0, length=100
  console.log("\n3. Fetching payment with length=100...");
  const resPayment = await fetch(
    "https://app.runsnet.id/view/model/previewc/query/payment.php?data1=&data2=&data4=&target=ID00000000024",
    {
      method: "POST",
      headers: {
        Cookie: `PHPSESSID=${session}`,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: buildDtParams(0, 100).toString(),
    },
  );

  const textPayment = await resPayment.text();
  console.log("Payment response status:", resPayment.status);
  try {
    const json = JSON.parse(textPayment);
    console.log(
      "SUCCESS! Payment recordsFiltered:",
      json.recordsFiltered,
      "rows returned:",
      json.data.length,
    );
  } catch (e) {
    console.log("Failed. Snippet:", textPayment.slice(0, 300));
  }
}

testWithProperParams().catch(console.error);
