import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { diagnosticLayers, DNS_PROBE_NAME } from "../src/lib/diagnostics.ts";
import { anomalyRules } from "../src/lib/dashboard/anomalies.ts";
import {
  metricInfo,
  layerInfo,
  anomalyKindInfo,
  mikrotikSources,
  formatSource,
  INTERNET_PROBE,
} from "../src/lib/diagnostic-sources.ts";

test("1. COMPLETENESS GUARD: semua metric id dari diagnostics.ts dan diagnostics.service.ts terdaftar", () => {
  const dSrc = fs.readFileSync(path.resolve("src/lib/diagnostics.ts"), "utf8");
  const sSrc = fs.readFileSync(
    path.resolve("src/services/diagnostics.service.ts"),
    "utf8",
  );

  function scanSource(text, filename) {
    const pairs = [];

    // unchecked( "layer", "metric", ... )
    const uncheckRe =
      /unchecked\(\s*([a-zA-Z0-9_."$]+)\s*,\s*([a-zA-Z0-9_."$]+)/g;
    let m;
    while ((m = uncheckRe.exec(text)) !== null) {
      const l = m[1].replace(/["\s]/g, "");
      const met = m[2].replace(/["\s]/g, "");
      pairs.push({ layer: l, metric: met, origin: `unchecked in ${filename}` });
    }

    // pendingLayer( layer, ... )
    const pendRe = /pendingLayer\(\s*([a-zA-Z0-9_."$]+)/g;
    while ((m = pendRe.exec(text)) !== null) {
      const l = m[1].replace(/["\s]/g, "");
      pairs.push({
        layer: l,
        metric: "belum_diperiksa",
        origin: `pendingLayer in ${filename}`,
      });
    }

    // count( "metric", ... ) dalam analyzeLog
    const countRe = /count\(\s*"([^"]+)"/g;
    while ((m = countRe.exec(text)) !== null) {
      pairs.push({
        layer: "log",
        metric: m[1],
        origin: `count in ${filename}`,
      });
    }

    // Objek literal Finding dengan metric: "..."
    const objRe = /metric:\s*"([^"]+)"/g;
    while ((m = objRe.exec(text)) !== null) {
      const met = m[1];
      const slice = text.slice(
        Math.max(0, m.index - 500),
        Math.min(text.length, m.index + 500),
      );
      const lm = /layer:\s*"([^"]+)"/.exec(slice);
      if (lm) {
        pairs.push({
          layer: lm[1],
          metric: met,
          origin: `object literal in ${filename}`,
        });
      }
    }

    // Template cases / metrik bersyarat dinamis
    if (
      text.includes("upstream_gateway") &&
      text.includes("upstream_internet")
    ) {
      pairs.push({
        layer: "hulu",
        metric: "upstream_gateway",
        origin: `template in ${filename}`,
      });
      pairs.push({
        layer: "hulu",
        metric: "upstream_internet",
        origin: `template in ${filename}`,
      });
    }
    if (text.includes("ping_customer")) {
      pairs.push({
        layer: "aktif",
        metric: "ping_customer",
        origin: `const metric in ${filename}`,
      });
    }
    if (text.includes("traceroute_upstream")) {
      pairs.push({
        layer: "aktif",
        metric: "traceroute_upstream",
        origin: `const metric in ${filename}`,
      });
    }
    if (text.includes("dns_resolve")) {
      pairs.push({
        layer: "aktif",
        metric: "dns_resolve",
        origin: `const metric in ${filename}`,
      });
    }
    if (text.includes("rate_baseline")) {
      pairs.push({
        layer: "aktif",
        metric: "rate_baseline",
        origin: `const metric in ${filename}`,
      });
    }

    return pairs;
  }

  const allRawPairs = [
    ...scanSource(dSrc, "diagnostics.ts"),
    ...scanSource(sSrc, "diagnostics.service.ts"),
  ];

  const knownLayers = diagnosticLayers.map((l) => l.id);
  const expanded = [];

  for (const p of allRawPairs) {
    if (p.layer === "layer" || p.layer === "layer.id") {
      for (const l of knownLayers) {
        expanded.push({ layer: l, metric: p.metric, origin: p.origin });
      }
    } else if (p.metric === "kind") {
      expanded.push({
        layer: "hulu",
        metric: "upstream_gateway",
        origin: p.origin,
      });
      expanded.push({
        layer: "hulu",
        metric: "upstream_internet",
        origin: p.origin,
      });
    } else if (p.metric === "metric") {
      continue;
    } else {
      expanded.push(p);
    }
  }

  const missing = [];
  const tested = new Set();

  for (const { layer, metric, origin } of expanded) {
    const key = `${layer}:${metric}`;
    if (tested.has(key)) continue;
    tested.add(key);

    const info = metricInfo(layer, metric);
    if (
      !info ||
      info.explain.includes("belum memiliki deskripsi terdaftar") ||
      info.sources === undefined
    ) {
      missing.push({ key, origin });
    }
  }

  assert.equal(
    missing.length,
    0,
    `Terdapat metrik yang belum terdaftar di metricInfo: ${JSON.stringify(missing, null, 2)}`,
  );
  assert.ok(
    tested.size >= 50,
    `Scanner harus menemukan minimal 50 kombinasi layer:metric riil (ditemukan: ${tested.size})`,
  );
});

test("2. Setiap entri terdaftar memiliki title dan explain non-kosong, serta >= 1 source kecuali derived-only", () => {
  const DERIVED_ONLY = new Set(["belum_diperiksa", "galat", "kosong"]);
  const layers = diagnosticLayers.map((l) => l.id);

  for (const layer of layers) {
    const lInfo = layerInfo(layer);
    assert.ok(lInfo.explain.length > 0, `layerInfo(${layer}).explain non-kosong`);
    assert.ok(
      lInfo.sources.length >= 1,
      `layerInfo(${layer}).sources minimal 1 sumber`,
    );

    for (const source of lInfo.sources) {
      assert.ok(source.system, `source.system harus ada pada layer ${layer}`);
      assert.ok(source.path, `source.path harus ada pada layer ${layer}`);
      assert.ok(source.via, `source.via harus ada pada layer ${layer}`);
    }
  }

  const samplePairs = [
    ["hulu", "default_route"],
    ["hulu", "uplink_util"],
    ["hulu", "upstream_gateway"],
    ["hulu", "bgp"],
    ["hulu", "ipv6"],
    ["mikrotik", "pppoe_active"],
    ["mikrotik", "queue_limit"],
    ["mikrotik", "queue_usage"],
    ["mikrotik", "queue_drop"],
    ["mikrotik", "iface_errors"],
    ["mikrotik", "ip_conflict"],
    ["log", "log_coverage"],
    ["log", "ppp_flap"],
    ["firewall", "address_list"],
    ["firewall", "conntrack"],
    ["firewall", "filter_block"],
    ["firewall", "fasttrack"],
    ["optik", "onu_rx"],
    ["ont", "ont_found"],
    ["ont", "ont_wan"],
    ["trafik", "traffic_trend"],
    ["trafik", "netflow_top"],
    ["aktif", "ping_customer"],
    ["aktif", "traceroute_upstream"],
    ["billing", "billing_status"],
    ["billing", "arrears"],
  ];

  for (const [layer, metric] of samplePairs) {
    const info = metricInfo(layer, metric);
    assert.ok(info.title.length > 0, `metricInfo(${layer}, ${metric}).title`);
    assert.ok(
      info.explain.length > 0,
      `metricInfo(${layer}, ${metric}).explain`,
    );
    if (DERIVED_ONLY.has(metric)) {
      assert.equal(info.sources.length, 0, `derived metric sumber kosong`);
    } else {
      assert.ok(
        info.sources.length >= 1,
        `metricInfo(${layer}, ${metric}).sources harus memiliki >= 1 sumber`,
      );
    }
  }
});

test("3. Setiap sumber MikroTik: path diawali '/' dan via menyebut '/rest/'", () => {
  const verifiedSources = [];

  for (const kind of ["queue", "cpu", "port", "optical", "offline"]) {
    verifiedSources.push(...anomalyKindInfo[kind].sources);
  }

  for (const layer of diagnosticLayers) {
    verifiedSources.push(...layerInfo(layer.id).sources);
  }

  for (const s of verifiedSources) {
    if (s.system === "MikroTik") {
      assert.ok(
        s.path.startsWith("/"),
        `MikroTik path harus diawali '/' (RouterOS menu notation), didapat: ${s.path}`,
      );
      assert.ok(
        s.via.includes("/rest/"),
        `MikroTik via harus menyebut REST endpoint /rest/..., didapat: ${s.via}`,
      );
    }
  }
});

test("4. layerInfo terdefinisi untuk seluruh 9 diagnosticLayers, fallback aman untuk layer tak dikenal", () => {
  for (const layer of diagnosticLayers) {
    const info = layerInfo(layer.id);
    assert.ok(info, `layerInfo untuk layer ${layer.id} harus ada`);
    assert.ok(
      info.explain.length > 10,
      `explain layer ${layer.id} harus informatif`,
    );
    assert.ok(
      info.sources.length >= 1,
      `sources layer ${layer.id} tidak boleh kosong`,
    );
  }

  const fallback = layerInfo("layer_antah_berantah");
  assert.ok(fallback, "layerInfo unknown tidak melempar error");
  assert.equal(fallback.sources.length, 0);
  assert.ok(fallback.explain.includes("belum terdaftar"));
});

test("5. anomalyKindInfo mencakup 5 jenis anomali dan rule sama persis dengan anomalyRules[].description", () => {
  const kinds = ["queue", "cpu", "port", "optical", "offline"];
  assert.deepEqual(Object.keys(anomalyKindInfo).sort(), kinds.sort());

  for (const kind of kinds) {
    const item = anomalyKindInfo[kind];
    assert.ok(item, `anomalyKindInfo[${kind}] harus terdefinisi`);
    assert.ok(item.explain.length > 0, `explain ${kind} non-kosong`);
    assert.ok(item.sources.length >= 1, `sources ${kind} non-kosong`);

    const expectedRule = anomalyRules.find((r) => r.kind === kind);
    assert.ok(expectedRule, `aturan ${kind} ditemukan di anomalyRules`);
    assert.equal(
      item.rule,
      expectedRule.description,
      `Teks rule untuk anomali '${kind}' harus persis sama dengan anomalyRules.description`,
    );
  }
});

test("6. Helper mikrotikSources menyaring hanya sumber MikroTik dan formatSource memformat teks satu baris", () => {
  const mixedSources = [
    {
      system: "MikroTik",
      path: "/ppp/active",
      via: "REST GET /rest/ppp/active",
      fields: ["name", "address", "uptime"],
    },
    {
      system: "Database",
      path: "customer_traffic_samples",
      via: "SQL: customer_traffic_samples",
    },
  ];

  const filtered = mikrotikSources({ sources: mixedSources });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].system, "MikroTik");
  assert.equal(filtered[0].path, "/ppp/active");

  const formattedWithFields = formatSource(mixedSources[0]);
  assert.equal(
    formattedWithFields,
    "MikroTik · /ppp/active · REST GET /rest/ppp/active (name, address, uptime)",
  );

  const formattedWithoutFields = formatSource(mixedSources[1]);
  assert.equal(
    formattedWithoutFields,
    "Database · customer_traffic_samples · SQL: customer_traffic_samples",
  );
});

test("7. metricInfo untuk metrik yang tidak dikenal mengembalikan entri generik aman (never throws)", () => {
  const unknown = metricInfo("mikrotik", "metrik_gaib_xyz");
  assert.ok(unknown, "tidak melempar error");
  assert.equal(unknown.sources.length, 0);
  assert.ok(
    unknown.explain.includes("belum memiliki deskripsi terdaftar"),
    "explain menjelaskan metrik belum terdaftar",
  );
});

test("8. WAJIB (a): Setiap MikroTik path muncul sebagai literal /rest<path> di diagnostics.service.ts, client.ts atau collector/*.go", () => {
  const serviceCode = fs.readFileSync(
    path.resolve("src/services/diagnostics.service.ts"),
    "utf8",
  );
  const clientCode = fs.readFileSync(
    path.resolve("src/lib/mikrotik/client.ts"),
    "utf8",
  );
  const goCollectorFiles = fs
    .readdirSync(path.resolve("backend/internal/collector"))
    .filter((f) => f.endsWith(".go"));
  const goCollectorCode = goCollectorFiles
    .map((f) =>
      fs.readFileSync(path.resolve("backend/internal/collector", f), "utf8"),
    )
    .join("\n");

  // Ekspansi template literal tabel firewall dalam serviceCode
  const expandedService = serviceCode.replace(
    "/rest/ip/firewall/${table}",
    "/rest/ip/firewall/filter /rest/ip/firewall/raw /rest/ip/firewall/nat /rest/ip/firewall/mangle",
  );
  const combinedCode =
    expandedService + "\n" + clientCode + "\n" + goCollectorCode;

  const testedPaths = new Set();
  function collectPaths(sources) {
    for (const s of sources) {
      if (s.system === "MikroTik") {
        testedPaths.add(s.path);
      }
    }
  }

  for (const kind of ["queue", "cpu", "port", "optical", "offline"]) {
    collectPaths(anomalyKindInfo[kind].sources);
  }
  for (const l of diagnosticLayers) {
    collectPaths(layerInfo(l.id).sources);
  }

  for (const p of testedPaths) {
    const restPath = "/rest" + p;
    const found =
      combinedCode.includes(restPath) ||
      goCollectorCode.includes("rest" + p);
    assert.ok(
      found,
      `MikroTik path '${p}' (${restPath}) harus muncul di diagnostics.service.ts, client.ts atau collector/*.go`,
    );
  }
  assert.ok(
    testedPaths.size >= 15,
    `Minimal 15 path MikroTik unik terverifikasi (ditemukan: ${testedPaths.size})`,
  );
});

test("9. WAJIB (b): Setiap sumber system==='Database' ada sebagai pgTable('<nama>') di src/db/schema dan kolomnya terdefinisi", () => {
  const schemaDir = path.resolve("src/db/schema");
  const schemaFiles = fs
    .readdirSync(schemaDir)
    .filter((f) => f.endsWith(".ts"));
  const tableMap = new Map();

  for (const f of schemaFiles) {
    const content = fs.readFileSync(path.join(schemaDir, f), "utf8");
    const pgTableRegex = /pgTable\(\s*"([^"]+)"/g;
    let m;
    while ((m = pgTableRegex.exec(content)) !== null) {
      const tableName = m[1];
      const startIdx = m.index;
      const bodyStart = content.indexOf("{", startIdx);
      let depth = 1;
      let endIdx = bodyStart + 1;
      while (depth > 0 && endIdx < content.length) {
        if (content[endIdx] === "{") depth++;
        else if (content[endIdx] === "}") depth--;
        endIdx++;
      }
      const body = content.slice(bodyStart + 1, endIdx - 1);
      const colRegex = /[a-zA-Z0-9_]+\s*:\s*[a-zA-Z0-9_]+\(\s*"([^"]+)"/g;
      const cols = [];
      let cm;
      while ((cm = colRegex.exec(body)) !== null) {
        cols.push(cm[1]);
      }
      tableMap.set(tableName, cols);
    }
  }

  const allSources = [];
  for (const kind of ["queue", "cpu", "port", "optical", "offline"]) {
    allSources.push(...anomalyKindInfo[kind].sources);
  }
  for (const l of diagnosticLayers) {
    allSources.push(...layerInfo(l.id).sources);
  }

  let dbSourcesCount = 0;
  for (const s of allSources) {
    if (s.system === "Database") {
      dbSourcesCount++;
      assert.ok(
        tableMap.has(s.path),
        `Tabel Database '${s.path}' harus ada sebagai pgTable("${s.path}") di src/db/schema/*.ts`,
      );
      const schemaCols = new Set(tableMap.get(s.path));
      for (const col of s.fields || []) {
        assert.ok(
          schemaCols.has(col),
          `Kolom '${col}' pada sumber Database '${s.path}' harus terdefinisi di skema Drizzle`,
        );
      }
    }
  }
  assert.ok(dbSourcesCount >= 5, `Minimal 5 sumber Database diperiksa`);
});

test("10. WAJIB (c): Nilai dalam 'via' ({key: 'value'}, .proplist) cocok persis dengan pemanggil di kode", () => {
  const serviceSrc = fs.readFileSync(
    path.resolve("src/services/diagnostics.service.ts"),
    "utf8",
  );
  const diagSrc = fs.readFileSync(
    path.resolve("src/lib/diagnostics.ts"),
    "utf8",
  );
  const goCollectorFiles = fs
    .readdirSync(path.resolve("backend/internal/collector"))
    .filter((f) => f.endsWith(".go"));
  const goCollectorCode = goCollectorFiles
    .map((f) =>
      fs.readFileSync(path.resolve("backend/internal/collector", f), "utf8"),
    )
    .join("\n");

  // 1. Verifikasi INTERNET_PROBE dan DNS_PROBE_NAME
  assert.ok(
    serviceSrc.includes(`INTERNET_PROBE = "${INTERNET_PROBE}"`),
    `INTERNET_PROBE di service harus '${INTERNET_PROBE}'`,
  );
  assert.ok(
    diagSrc.includes(`DNS_PROBE_NAME = "${DNS_PROBE_NAME}"`),
    `DNS_PROBE_NAME di diagnostics.ts harus '${DNS_PROBE_NAME}'`,
  );

  // 2. Traceroute { address: '8.8.8.8', count: '2' }
  const tracerouteSource = metricInfo(
    "aktif",
    "traceroute_upstream",
  ).sources.find((s) => s.path === "/tool/traceroute");
  assert.ok(tracerouteSource);
  assert.ok(
    tracerouteSource.via.includes(`address: '${INTERNET_PROBE}'`),
    `Traceroute via harus mencantumkan address: '${INTERNET_PROBE}'`,
  );
  assert.ok(
    tracerouteSource.via.includes("count: '2'"),
    `Traceroute via harus mencantumkan count: '2'`,
  );

  // 3. DNS ping { address: 'google.com', count: '2' }
  const dnsSource = metricInfo("aktif", "dns_resolve").sources.find(
    (s) => s.path === "/tool/ping",
  );
  assert.ok(dnsSource);
  assert.ok(
    dnsSource.via.includes(`address: '${DNS_PROBE_NAME}'`),
    `DNS ping via harus mencantumkan address: '${DNS_PROBE_NAME}'`,
  );
  assert.ok(
    dnsSource.via.includes("count: '2'"),
    `DNS ping via harus mencantumkan count: '2'`,
  );

  // 4. Ping probe hulu & pelanggan { count: '10', interval: '0.2' }
  const pingProbe = metricInfo("hulu", "upstream_gateway").sources.find(
    (s) => s.path === "/tool/ping",
  );
  assert.ok(pingProbe);
  assert.ok(pingProbe.via.includes("count: '10'"));
  assert.ok(pingProbe.via.includes("interval: '0.2'"));

  // 5. Connection proplist service
  const connSource = metricInfo("firewall", "fasttrack").sources.find(
    (s) => s.path === "/ip/firewall/connection",
  );
  assert.ok(connSource);
  assert.ok(
    connSource.via.includes(".proplist=fasttrack,connection-mark,protocol"),
  );
  assert.ok(serviceSrc.includes("fasttrack,connection-mark,protocol"));

  // 6. Poller proplists di Go
  for (const kind of ["queue", "cpu", "port", "offline"]) {
    const s = anomalyKindInfo[kind].sources.find((x) => x.system === "MikroTik");
    assert.ok(s);
    const match = /\.proplist=([^ "]+)/.exec(s.via);
    assert.ok(match, "via must have .proplist: " + s.via);
    assert.ok(
      goCollectorCode.includes(match[1]),
      `Go collector must include proplist ${match[1]}`,
    );
  }
});

test("11. WAJIB (d): Tidak ada IP literal rekaan di explain (probe internet merujuk INTERNET_PROBE 8.8.8.8)", () => {
  const allExplains = [];

  for (const kind of ["queue", "cpu", "port", "optical", "offline"]) {
    allExplains.push({
      context: `anomaly.${kind}`,
      text: anomalyKindInfo[kind].explain,
    });
  }

  for (const l of diagnosticLayers) {
    allExplains.push({
      context: `layer.${l.id}`,
      text: layerInfo(l.id).explain,
    });
  }

  for (const l of diagnosticLayers) {
    const sampleMetrics = [
      "default_route",
      "uplink_util",
      "upstream_gateway",
      "upstream_internet",
      "pppoe_active",
      "queue_limit",
      "queue_usage",
      "log_coverage",
      "address_list",
      "onu_rx",
      "ont_found",
      "traffic_trend",
      "ping_customer",
      "traceroute_upstream",
      "dns_resolve",
      "billing_status",
    ];
    for (const m of sampleMetrics) {
      const info = metricInfo(l.id, m);
      if (!info.explain.includes("belum memiliki deskripsi")) {
        allExplains.push({
          context: `metric.${l.id}.${m}`,
          text: info.explain,
        });
      }
    }
  }

  // Pola IPv4 umum
  const ipRegex = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;

  for (const { context, text } of allExplains) {
    // Tidak boleh memuat IP sembarangan seperti 1.1.1.1
    assert.ok(
      !text.includes("1.1.1.1"),
      `Explain pada ${context} tidak boleh memuat IP rekaan 1.1.1.1`,
    );

    const matches = text.match(ipRegex) || [];
    for (const ip of matches) {
      // Jika memuat IP, harus persis INTERNET_PROBE ('8.8.8.8') dan diiringi teks 'INTERNET_PROBE'
      assert.equal(
        ip,
        INTERNET_PROBE,
        `Explain pada ${context} memuat IP tidak sah (${ip}). Hanya ${INTERNET_PROBE} yang diizinkan.`,
      );
      assert.ok(
        text.includes("INTERNET_PROBE"),
        `Penyebutan IP ${ip} pada ${context} harus didahului label konstanta 'INTERNET_PROBE'`,
      );
    }
  }
});

test("12. Setiap field MikroTik di registry benar-benar disebut di kode yang membacanya", () => {
  const read = (p) => fs.readFileSync(path.resolve(p), "utf8");
  const goDir = path.resolve("backend/internal/collector");
  const code = [
    read("src/lib/diagnostics.ts"),
    read("src/services/diagnostics.service.ts"),
    read("src/lib/mikrotik/client.ts"),
    ...fs
      .readdirSync(goDir)
      .filter((f) => f.endsWith(".go"))
      .map((f) => fs.readFileSync(path.join(goDir, f), "utf8")),
  ].join("\n");

  const metricIds = new Set();
  for (const f of ["src/lib/diagnostics.ts", "src/services/diagnostics.service.ts"]) {
    for (const m of read(f).matchAll(/metric:\s*"([a-z0-9_]+)"/g)) metricIds.add(m[1]);
  }
  const sources = [];
  for (const kind of ["queue", "cpu", "port", "optical", "offline"]) {
    sources.push(...anomalyKindInfo[kind].sources);
  }
  for (const l of diagnosticLayers) {
    sources.push(...layerInfo(l.id).sources);
    for (const id of metricIds) sources.push(...metricInfo(l.id, id).sources);
  }

  const missing = new Set();
  for (const s of sources) {
    if (s.system !== "MikroTik") continue;
    for (const field of s.fields ?? []) {
      const quoted = new RegExp(`["'\`.]${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`\\s,)\\]]`);
      if (!quoted.test(code)) missing.add(`${s.path} :: ${field}`);
    }
  }
  assert.deepEqual([...missing].sort(), [], "field MikroTik yang tidak ditemukan di kode pembacanya");
});
