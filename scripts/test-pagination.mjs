async function testPagination() {
  console.log("=== Testing length=100 vs start pagination ===");
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

  const body100 = new URLSearchParams();
  body100.append("draw", "1");
  body100.append("start", "0");
  body100.append("length", "100");

  const res = await fetch(
    "https://app.runsnet.id/view/model/previewc/query/pelanggan.php?data1=&data2=&data3=&data4=&target=ID00000000024&data6=",
    {
      method: "POST",
      headers: {
        Cookie: `PHPSESSID=${session}`,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: body100.toString(),
    },
  );

  const json = await res.json();
  console.log(
    `With length=100: returned ${json.data?.length} rows out of ${json.recordsFiltered} total!`,
  );
}

testPagination().catch(console.error);
