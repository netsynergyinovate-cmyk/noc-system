async function testPaymentDates() {
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

  function buildDtParams(start = 0, length = 100) {
    const p = new URLSearchParams();
    p.append("draw", "1");
    p.append("start", String(start));
    p.append("length", String(length));
    p.append("search[value]", "");
    p.append("search[regex]", "false");
    p.append("order[0][column]", "1");
    p.append("order[0][dir]", "desc");
    for (let i = 0; i < 12; i++) {
      p.append(`columns[${i}][data]`, String(i));
      p.append(`columns[${i}][name]`, "");
      p.append(`columns[${i}][searchable]`, "true");
      p.append(`columns[${i}][orderable]`, "true");
      p.append(`columns[${i}][search][value]`, "");
      p.append(`columns[${i}][search][regex]`, "false");
    }
    return p;
  }

  // Test with October 2026 date range
  const urlOct =
    "https://app.runsnet.id/view/model/previewc/query/payment.php?data1=10/01/2026&data2=10/16/2026&data4=&target=ID00000000024";
  const resOct = await fetch(urlOct, {
    method: "POST",
    headers: {
      Cookie: `PHPSESSID=${session}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: buildDtParams(0, 100).toString(),
  });
  const jsonOct = await resOct.json();
  console.log(
    "October 2026 payments count:",
    jsonOct.recordsFiltered,
    "returned:",
    jsonOct.data.length,
  );

  // Test with wider date range (e.g. 01/01/2025 to 12/31/2026)
  const urlAll =
    "https://app.runsnet.id/view/model/previewc/query/payment.php?data1=01/01/2025&data2=12/31/2026&data4=&target=ID00000000024";
  const resAll = await fetch(urlAll, {
    method: "POST",
    headers: {
      Cookie: `PHPSESSID=${session}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: buildDtParams(0, 100).toString(),
  });
  const jsonAll = await resAll.json();
  console.log(
    "Wide range (2025-2026) payments count:",
    jsonAll.recordsFiltered,
    "returned:",
    jsonAll.data.length,
  );
}

testPaymentDates().catch(console.error);
