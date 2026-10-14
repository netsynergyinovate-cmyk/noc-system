import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "@playwright/test";
import {
  SIGNED_OUT_PARAM,
  SIGNED_OUT_PATH,
  announceSignedOut,
  isSignedOutParam,
  listenForSignedOut,
} from "../src/lib/signed-out";

// Logika "keluar" tanpa browser: bendera ?keluar=1 hanya benar untuk teks "1"
// persis, dan kanal BroadcastChannel yang memberi tahu tab lain hanya bereaksi
// pada pesan berbentuk persis { type: "signed-out" }. Node punya
// BroadcastChannel global; semua kanal yang dibuka di sini ditutup, kalau tidak
// proses uji menggantung.

const CHANNEL = "noc-session";
// Waktu bagi pesan antar-instansi kanal untuk sampai (lewat loop kejadian Node)
// sebelum tes menyimpulkan "tidak ada yang datang".
const SETTLE_MS = 150;

// Menutup semua kanal dan pendengar yang dibuka sebuah tes.
const cleanups: Array<() => void> = [];
test.afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function listen() {
  let calls = 0;
  const stop = listenForSignedOut(() => {
    calls += 1;
  });
  cleanups.push(stop);
  return {
    stop,
    get calls() {
      return calls;
    },
  };
}

function rawChannel(name = CHANNEL) {
  const channel = new BroadcastChannel(name);
  cleanups.push(() => channel.close());
  return channel;
}

// Menunggu sampai `read()` mencapai `count`; gagal bila tidak sampai.
async function until(read: () => number, count: number) {
  await expect.poll(read, { timeout: 5_000 }).toBe(count);
}

// ---------------------------------------------------------------------------
// Bendera di alamat
// ---------------------------------------------------------------------------

test("SIGNED_OUT_PATH dan SIGNED_OUT_PARAM", () => {
  expect(SIGNED_OUT_PATH).toBe("/sign-in?keluar=1");
  expect(SIGNED_OUT_PARAM).toBe("keluar");
  // Alamat itu sendiri dinilai benar oleh isSignedOutParam.
  const query = new URL(SIGNED_OUT_PATH, "http://placeholder.invalid")
    .searchParams;
  expect(isSignedOutParam(query.get(SIGNED_OUT_PARAM))).toBe(true);
});

test.describe("isSignedOutParam", () => {
  test('benar hanya untuk teks persis "1"', () => {
    expect(isSignedOutParam("1")).toBe(true);
  });

  const falsy: Array<[string, unknown]> = [
    ["undefined", undefined],
    ["null", null],
    ["teks kosong", ""],
    ['"0"', "0"],
    ['"true"', "true"],
    ['"01"', "01"],
    ['" 1"', " 1"],
    ['"1 "', "1 "],
    ['"11"', "11"],
    ['"١" (angka Arab-Indic)', "١"],
    ["array ['1']", ["1"]],
    ["array ['1', '2']", ["1", "2"]],
    ["angka 1", 1],
    ["true", true],
    ["objek", { 0: "1" }],
    ["<script>", "<script>alert(1)</script>"],
  ];
  for (const [label, value] of falsy) {
    test(`salah untuk ${label}`, () => {
      expect(isSignedOutParam(value)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// Kanal antar-tab
// ---------------------------------------------------------------------------

test("dua pendengar sama-sama menerima announceSignedOut() dari kanal lain", async () => {
  const first = listen();
  const second = listen();
  // Pengirim tidak menerima pesannya sendiri, jadi pendengar yang satu tidak
  // bisa dijadikan "pengirim" bagi yang lain: announceSignedOut membuat
  // kanalnya sendiri.
  announceSignedOut();
  await until(() => first.calls, 1);
  await until(() => second.calls, 1);
  // Tepat sekali per pengumuman, juga setelah menunggu.
  await delay(SETTLE_MS);
  expect(first.calls).toBe(1);
  expect(second.calls).toBe(1);

  announceSignedOut();
  announceSignedOut();
  await until(() => first.calls, 3);
  await until(() => second.calls, 3);
});

test("pesan dari kanal mentah berbentuk persis { type: 'signed-out' } diterima", async () => {
  const listener = listen();
  rawChannel().postMessage({ type: "signed-out" });
  await until(() => listener.calls, 1);
});

test("kanal pengirim ditutup segera: pesannya tetap sampai, dan pengirim tidak menerima pesannya sendiri", async () => {
  const listener = listen();
  // Persis yang dilakukan announceSignedOut: buka, kirim, tutup.
  const sender = new BroadcastChannel(CHANNEL);
  let echoed = 0;
  sender.onmessage = () => {
    echoed += 1;
  };
  sender.postMessage({ type: "signed-out" });
  sender.close();
  await until(() => listener.calls, 1);
  await delay(SETTLE_MS);
  expect(echoed).toBe(0);
});

test.describe("pesan berbentuk lain diabaikan", () => {
  // Kunci tambahan ({type, extra}) SENGAJA ditolak: pesan yang membawa muatan
  // lain adalah pesan lain di kanal yang sama, dan menanggapinya dengan membuang
  // tab ke halaman masuk akan menjadi pengalihan yang tidak diminta. Bila kelak
  // ada versi pesan dengan bidang tambahan, ia harus dikenali dengan sengaja di
  // isSignedOutMessage.
  const ignored: Array<[string, unknown]> = [
    ["{ type: 'x' }", { type: "x" }],
    ["{ type: 'SIGNED-OUT' }", { type: "SIGNED-OUT" }],
    ["{ type: 'signed-out ' }", { type: "signed-out " }],
    ["{ type: ['signed-out'] }", { type: ["signed-out"] }],
    ["{ type: null }", { type: null }],
    ["string 'signed-out'", "signed-out"],
    ["string JSON", '{"type":"signed-out"}'],
    ["null", null],
    ["angka", 1],
    ["true", true],
    ["objek tanpa type", { signedOut: true }],
    ["objek kosong", {}],
    ["array ['signed-out']", ["signed-out"]],
    ["array [{type}]", [{ type: "signed-out" }]],
    [
      "{ type: 'signed-out', extra: 1 } (kunci tambahan ditolak)",
      { type: "signed-out", extra: 1 },
    ],
    ["{ extra: 1, type: 'signed-out' }", { extra: 1, type: "signed-out" }],
  ];

  for (const [label, message] of ignored) {
    test(label, async () => {
      const listener = listen();
      const sender = rawChannel();
      sender.postMessage(message);
      await delay(SETTLE_MS);
      expect(listener.calls).toBe(0);
      // Kontrol positif: kanalnya hidup, pesan yang sah sesudahnya diterima.
      sender.postMessage({ type: "signed-out" });
      await until(() => listener.calls, 1);
    });
  }
});

test("pesan di kanal dengan nama lain tidak didengar", async () => {
  const listener = listen();
  rawChannel("noc-session-lain").postMessage({ type: "signed-out" });
  rawChannel("noc").postMessage({ type: "signed-out" });
  await delay(SETTLE_MS);
  expect(listener.calls).toBe(0);
});

test("fungsi berhenti benar-benar menghentikan, dan hanya pendengar itu", async () => {
  const stopped = listen();
  const alive = listen();
  announceSignedOut();
  await until(() => stopped.calls, 1);
  await until(() => alive.calls, 1);

  stopped.stop();
  announceSignedOut();
  await until(() => alive.calls, 2);
  await delay(SETTLE_MS);
  expect(stopped.calls).toBe(1);

  // Memanggil berhenti dua kali tidak melempar.
  expect(() => stopped.stop()).not.toThrow();
});

// ---------------------------------------------------------------------------
// Tanpa BroadcastChannel
// ---------------------------------------------------------------------------

// Menjalankan `run` dengan global BroadcastChannel diganti, lalu memulihkannya
// apa adanya (termasuk bila aslinya pengambil nilai yang malas).
async function withBroadcastChannel(
  replacement: unknown,
  run: () => void | Promise<void>,
) {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "BroadcastChannel",
  );
  Object.defineProperty(globalThis, "BroadcastChannel", {
    value: replacement,
    configurable: true,
    writable: true,
    enumerable: false,
  });
  try {
    await run();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "BroadcastChannel", descriptor);
    } else {
      Reflect.deleteProperty(globalThis, "BroadcastChannel");
    }
  }
}

test("tanpa BroadcastChannel: announceSignedOut diam, listenForSignedOut memberi fungsi kosong", async () => {
  await withBroadcastChannel(undefined, () => {
    expect(typeof BroadcastChannel).toBe("undefined");
    expect(() => announceSignedOut()).not.toThrow();
    let calls = 0;
    const stop = listenForSignedOut(() => {
      calls += 1;
    });
    expect(typeof stop).toBe("function");
    expect(() => stop()).not.toThrow();
    expect(calls).toBe(0);
  });
  // Global dipulihkan: kanal sungguhan bekerja lagi.
  expect(typeof BroadcastChannel).toBe("function");
  const listener = listen();
  announceSignedOut();
  await until(() => listener.calls, 1);
});

test("BroadcastChannel yang melempar (konstruktor atau kirim) tidak merambat", async () => {
  class Throwing {
    constructor() {
      throw new Error("kanal tidak tersedia");
    }
  }
  await withBroadcastChannel(Throwing, () => {
    expect(() => announceSignedOut()).not.toThrow();
    const stop = listenForSignedOut(() => {
      throw new Error("tidak boleh dipanggil");
    });
    expect(() => stop()).not.toThrow();
  });

  let closed = 0;
  class SendFails {
    postMessage() {
      throw new Error("kirim gagal");
    }
    close() {
      closed += 1;
    }
  }
  await withBroadcastChannel(SendFails, () => {
    expect(() => announceSignedOut()).not.toThrow();
  });
  // Kanal yang gagal mengirim tetap ditutup.
  expect(closed).toBe(1);
});
