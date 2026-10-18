async function triggerSync() {
  console.log("=== 1. Logging in to NOC dashboard ===");
  const loginRes = await fetch("http://localhost:3000/api/auth/sign-in/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": "http://localhost:3000" },
    body: JSON.stringify({ email: "admin@noc.local", password: "AdminNOC2026!" }),
  });

  const cookie = loginRes.headers.get("set-cookie") || "";
  console.log("NOC Login status:", loginRes.status, "Cookie set:", !!cookie);

  const authHeaders = {
    Cookie: cookie.split(";")[0],
    Origin: "http://localhost:3000",
  };

  console.log("\n=== 2. Triggering POST /api/billing/runsnet/sync ===");
  const t0 = Date.now();
  const syncRes = await fetch("http://localhost:3000/api/billing/runsnet/sync", {
    method: "POST",
    headers: authHeaders,
  });

  console.log("Sync endpoint status:", syncRes.status);
  const syncJson = await syncRes.json();
  console.log(`Sync completed in ${((Date.now() - t0) / 1000).toFixed(1)}s!`);
  console.log("Response:", JSON.stringify(syncJson, null, 2));

  console.log("\n=== 3. Querying GET /api/billing/runsnet?tab=overview ===");
  const overviewRes = await fetch("http://localhost:3000/api/billing/runsnet?tab=overview", {
    headers: authHeaders,
  });
  const overviewJson = await overviewRes.json();
  console.log("Overview Data:", JSON.stringify(overviewJson, null, 2));

  console.log("\n=== 4. Querying sample customers, invoices, and payments ===");
  const custRes = await fetch("http://localhost:3000/api/billing/runsnet?tab=customers&limit=5", { headers: authHeaders });
  const custJson = await custRes.json();
  console.log(`Customers (sample ${custJson.data?.length}):`, custJson.data?.map(c => `${c.custId} | ${c.name} | ${c.status} | ${c.serviceProfile}`));

  const invRes = await fetch("http://localhost:3000/api/billing/runsnet?tab=invoices&limit=5", { headers: authHeaders });
  const invJson = await invRes.json();
  console.log(`Invoices (sample ${invJson.data?.length}):`, invJson.data?.map(i => `${i.invoiceCode} | ${i.custName} | Rp ${i.amount} | status: ${i.status}`));

  const payRes = await fetch("http://localhost:3000/api/billing/runsnet?tab=payments&limit=5", { headers: authHeaders });
  const payJson = await payRes.json();
  console.log(`Payments (sample ${payJson.data?.length}):`, payJson.data?.map(p => `${p.paymentCode} | ${p.custName} | Rp ${p.amount} | tgl: ${p.payDate}`));
}

triggerSync().catch(console.error);

