import test from "node:test";
import assert from "node:assert/strict";
import {
  renderWhatsappMessage,
  shouldSendAlert,
} from "../src/lib/dashboard/whatsapp.ts";

const a = {
  severity: "critical",
  kind: "offline",
  subject: "Budi",
  router: "RB1",
  time: "10:00:00",
  message: "mati",
};

test("render semua variabel + label keparahan", () => {
  assert.equal(
    renderWhatsappMessage(
      "{severity}|{kind}|{subject}|{router}|{time}|{message}",
      a,
    ),
    "\u{1F6A8} KRITIS|offline|Budi|RB1|10:00:00|mati",
  );
  assert.ok(
    renderWhatsappMessage("{severity}", { ...a, severity: "warning" }).includes(
      "PERINGATAN",
    ),
  );
});

test("variabel tak dikenal dibiarkan; nilai tidak diganti ulang", () => {
  assert.equal(
    renderWhatsappMessage("{x} {kind}", { ...a, kind: "{severity}" }),
    "{x} {severity}",
  );
  assert.equal(renderWhatsappMessage("{toString}", a), "{toString}");
});

test("shouldSendAlert", () => {
  const rows = [
    ["critical", "critical", true],
    ["warning", "critical", false],
    ["info", "critical", false],
    ["critical", "warning", true],
    ["warning", "warning", true],
    ["info", "warning", false],
  ];
  for (const [s, m, want] of rows)
    assert.equal(shouldSendAlert(s, m), want, `${s}/${m}`);
});
