import test from "node:test";
import assert from "node:assert/strict";
import { toCsv } from "../src/lib/csv-export.ts";

test("RFC 4180 escaping", () => {
  const csv = toCsv(["a", "b"], [["x,y", 'he said "hi"'], ["line1\nline2", "ok"]]);
  assert.equal(csv, 'a,b\r\n"x,y","he said ""hi"""\r\n"line1\nline2",ok\r\n');
});

test("formula injection dinetralkan", () => {
  for (const v of ["=1+1", "-cmd", "+eval", "@sum"]) {
    assert.equal(toCsv(["h"], [[v]]), `h\r\n'${v}\r\n`);
  }
});

test("null/undefined kosong, number & boolean apa adanya", () => {
  assert.equal(toCsv(["a", "b", "c", "d"], [[null, undefined, -5, false]]), "a,b,c,d\r\n,,-5,false\r\n");
});
