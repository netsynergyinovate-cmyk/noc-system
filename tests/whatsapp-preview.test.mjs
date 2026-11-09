import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultWhatsappConfig,
  renderWhatsappMessage,
  templateVariables,
} from "../src/lib/dashboard/whatsapp.ts";
import {
  parseWhatsappFormat,
  previewScenarios,
  usedTemplateVariables,
} from "../src/lib/dashboard/whatsapp-preview.ts";

test("format bold, italic, strikethrough", () => {
  assert.deepEqual(parseWhatsappFormat("a *b* _c_ ~d~ e"), [
    { type: "text", text: "a " },
    { type: "bold", text: "b" },
    { type: "text", text: " " },
    { type: "italic", text: "c" },
    { type: "text", text: " " },
    { type: "strike", text: "d" },
    { type: "text", text: " e" },
  ]);
});

test("format tidak salah tangkap", () => {
  for (const s of ["RB_Pusat_01", "2 * 3 * 4", "**", "plain", "* x*"])
    assert.deepEqual(parseWhatsappFormat(s), [{ type: "text", text: s }], s);
  assert.deepEqual(parseWhatsappFormat(""), []);
});

test("emoji tetap utuh", () => {
  assert.deepEqual(parseWhatsappFormat("🚨 *NOC [KRITIS]*"), [
    { type: "text", text: "🚨 " },
    { type: "bold", text: "NOC [KRITIS]" },
  ]);
});

test("template bawaan dirender untuk tiap skenario", () => {
  assert.equal(previewScenarios.length, 4);
  for (const s of previewScenarios) {
    const out = renderWhatsappMessage(defaultWhatsappConfig.template, s.alert);
    assert.ok(!/\{\w+\}/.test(out), s.id);
    assert.ok(out.includes(`[${s.alert.severity}]`), s.id);
    assert.ok(out.includes(s.alert.message), s.id);
    assert.ok(
      parseWhatsappFormat(out).some((g) => g.type === "bold"),
      s.id,
    );
  }
  const [down, , cpu, ok] = previewScenarios;
  assert.equal(down.alert.severity, "KRITIS");
  assert.equal(cpu.alert.severity, "PERINGATAN");
  assert.equal(ok.alert.severity, "NORMAL");
});

test("variabel aktif", () => {
  assert.deepEqual(
    usedTemplateVariables("{kind} {kind} {x} {time}", templateVariables),
    ["kind", "time"],
  );
  assert.deepEqual(usedTemplateVariables("tanpa", templateVariables), []);
  assert.equal(
    usedTemplateVariables(defaultWhatsappConfig.template, templateVariables)
      .length,
    6,
  );
});
