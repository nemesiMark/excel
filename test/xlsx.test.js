// Test di salvataggio e apertura dei file .xlsx (andata e ritorno). Avvio: node --test test/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const win = {};
global.window = win;
const m = { exports: {} };
new Function("module", "exports", "define", fs.readFileSync(path.join(root, "vendor/exceljs.min.js"), "utf8"))(m, m.exports, undefined);
win.ExcelJS = m.exports;
for (const f of ["engine.js", "xlsx-io.js"]) new Function("window", fs.readFileSync(path.join(root, f), "utf8"))(win);
const { Engine: En, XlsxIO } = win;

const sheet = (name, cells, extra = {}) => ({ name, cells, nRows: 200, nCols: 26, colW: {}, freezeRow: false, freezeCol: false, ...extra });

test("salva e riapre: valori, formule, stili, fogli", async () => {
  const book = {
    sheets: [
      sheet("Conti", {
        A1: { v: "Voce", s: { b: true, fill: "#fff2a8", align: "center" } },
        B1: { v: "Importo", s: { i: true, color: "#c0392b", size: 14 } },
        A2: { v: "Affitto" }, B2: { v: "800", s: { fmt: "currency" } },
        A3: { v: "Luce" }, B3: { v: "65,5", s: { fmt: "currency", dec: 1 } },
        A4: { v: "Totale" }, B4: { v: "=SOMMA(B2:B3)", s: { bd: { t: "thin", b: "thick" } } },
        C2: { v: "0,25", s: { fmt: "percent" } },
        C3: { v: "15/03/2024", s: { fmt: "date" } },
        C4: { v: "'00123", s: {} },
        D1: { v: "=SE(B4>500;\"alto\";\"basso\")" },
        D2: { v: "=Altro!A1*2" },
        D3: { v: "=1/0" },
        D4: { v: "riga 1\nriga 2", s: { wrap: true } },
      }, { colW: { 0: 160 }, freezeRow: true }),
      sheet("Altro", { A1: { v: "21" } }),
    ],
    active: 0,
  };
  const buf = await XlsxIO.write(book, En.recalc(book), "Prova");
  const back = await XlsxIO.read(buf);
  assert.deepEqual(back.sheets.map((s) => s.name), ["Conti", "Altro"]);
  const c = back.sheets[0].cells;
  assert.equal(c.A1.v, "Voce");
  assert.equal(c.A1.s.b, true);
  assert.equal(c.A1.s.fill, "#fff2a8");
  assert.equal(c.A1.s.align, "center");
  assert.equal(c.B1.s.i, true);
  assert.equal(c.B1.s.color, "#c0392b");
  assert.equal(c.B1.s.size, 14);
  assert.equal(c.B2.v, 800);
  assert.equal(c.B2.s.fmt, "currency");
  assert.equal(c.B3.v, 65.5);
  assert.equal(c.B3.s.dec, 1);
  assert.equal(c.B4.v, "=SOMMA(B2:B3)");
  assert.equal(c.B4.s.bd.t, "thin");
  assert.equal(c.B4.s.bd.b, "thick");
  assert.equal(c.C2.v, 0.25);
  assert.equal(c.C2.s.fmt, "percent");
  assert.equal(c.C3.v, En.dateToSerial(2024, 3, 15));
  assert.equal(c.C3.s.fmt, "date");
  assert.equal(c.C4.v, "'00123");
  assert.equal(c.D1.v, '=SE(B4>500;"alto";"basso")');
  assert.equal(c.D2.v, "=Altro!A1*2");
  assert.equal(c.D4.v, "riga 1\nriga 2");
  assert.equal(c.D4.s.wrap, true);
  assert.equal(back.sheets[0].colW[0], 160);
  assert.equal(back.sheets[0].freezeRow, true);
  const calc = En.recalc(back);
  assert.equal(calc.get(0, 3, 1), 865.5);
  assert.equal(calc.get(0, 0, 3), "alto");
  assert.equal(calc.get(0, 1, 3), 42);
  assert.equal(En.formatValue(calc.get(0, 2, 2), c.C3.s), "15/03/2024");
});

test("nomi dei fogli non accettati dai file .xlsx", async () => {
  const book = { sheets: [sheet("Conti: 2024/25?", { A1: { v: "1" } }), sheet("x".repeat(40), { A1: { v: "2" } }), sheet("x".repeat(35), { A1: { v: "3" } })], active: 0 };
  const buf = await XlsxIO.write(book, En.recalc(book), "");
  const back = await XlsxIO.read(buf);
  assert.equal(back.sheets.length, 3);
  assert.equal(new Set(back.sheets.map((s) => s.name)).size, 3);
  assert.ok(back.sheets.every((s) => s.name.length <= 31 && !/[\\/?*:[\]]/.test(s.name)));
});

test("i fogli nascosti non vanno persi", async () => {
  const wb = new win.ExcelJS.Workbook();
  wb.addWorksheet("Visibile").getCell("A1").value = 1;
  const h = wb.addWorksheet("Nascosto"); h.state = "hidden"; h.getCell("A1").value = 2;
  const back = await XlsxIO.read(await wb.xlsx.writeBuffer());
  assert.deepEqual(back.sheets.map((s) => s.name), ["Visibile", "Nascosto"]);
});
