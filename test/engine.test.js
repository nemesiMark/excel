// Test del motore delle formule. Avvio: node --test test/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ctx = { window: {}, Intl, Date, Math, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "engine.js"), "utf8"), ctx);
const En = ctx.window.Engine;

// Crea una cartella da un oggetto { A1: valore, ... } e calcola una cella
function book(cells, extra = []) {
  const sheets = [{ name: "Foglio1", cells: {} }, ...extra.map((s) => ({ name: s.name, cells: {} }))];
  for (const [k, v] of Object.entries(cells)) sheets[0].cells[k] = { v };
  extra.forEach((s, i) => { for (const [k, v] of Object.entries(s.cells)) sheets[i + 1].cells[k] = { v }; });
  return { sheets, active: 0 };
}
function calc(formula, cells = {}, extra) {
  const b = book({ ...cells, Z99: formula }, extra);
  const p = En.parseAddr("Z99");
  return En.recalc(b).get(0, p.r, p.c);
}
const err = (v) => (v && typeof v === "object" && "e" in v ? v.e : v);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test("indirizzi", () => {
  assert.equal(En.colName(0), "A");
  assert.equal(En.colName(25), "Z");
  assert.equal(En.colName(26), "AA");
  assert.equal(En.colName(701), "ZZ");
  assert.equal(En.colName(702), "AAA");
  assert.equal(En.colIndex("AA"), 26);
  assert.equal(En.colIndex("zz"), 701);
  assert.deepEqual({ ...En.parseAddr("$B$7") }, { r: 6, c: 1 });
  assert.equal(En.parseAddr("7B"), null);
});

test("aritmetica e precedenza", () => {
  assert.equal(calc("=1+2*3"), 7);
  assert.equal(calc("=(1+2)*3"), 9);
  assert.equal(calc("=2^3^2"), 64); // da sinistra a destra come nei fogli di calcolo
  assert.equal(calc("=-2^2"), 4);
  assert.equal(calc("=10/4"), 2.5);
  assert.equal(calc("=2,5*2"), 5);
  assert.equal(calc("=50%"), 0.5);
  assert.equal(calc("=200*10%"), 20);
  assert.equal(err(calc("=1/0")), "#DIV/0!");
  assert.equal(calc('="a"&"b"&1'), "ab1");
  assert.equal(calc("=1=1"), true);
  assert.equal(calc("=2<>2"), false);
  assert.equal(calc('="abc"="ABC"'), true);
  assert.equal(calc("=A1+A2", { A1: "3", A2: "4,5" }), 7.5);
  assert.equal(calc("=A1*2", { A1: "" }), 0);
  assert.equal(err(calc('=A1+1', { A1: "ciao" })), "#VALORE!");
  assert.equal(err(calc("=1+")), "#ERRORE!");
  assert.equal(err(calc("=PIPPO(1)")), "#NOME?");
  assert.equal(err(calc("=pippo")), "#NOME?");
});

test("riferimenti, intervalli e altri fogli", () => {
  assert.equal(calc("=SOMMA(A1:A3)", { A1: "1", A2: "2", A3: "3" }), 6);
  assert.equal(calc("=SOMMA(A3:A1)", { A1: "1", A2: "2", A3: "3" }), 6);
  assert.equal(calc("=$A$1+A$2+$A3", { A1: "1", A2: "2", A3: "3" }), 6);
  assert.equal(calc("=Dati!B2*2", {}, [{ name: "Dati", cells: { B2: "21" } }]), 42);
  assert.equal(calc("='Mio foglio'!A1", {}, [{ name: "Mio foglio", cells: { A1: "x" } }]), "x");
  assert.equal(err(calc("=Nessuno!A1")), "#RIF!");
  assert.equal(calc("=SOMMA(Dati!A1:A2)", {}, [{ name: "Dati", cells: { A1: "5", A2: "6" } }]), 11);
});

test("riferimenti circolari", () => {
  const b = book({ A1: "=B1", B1: "=A1" });
  assert.equal(err(En.recalc(b).get(0, 0, 0)), "#CIRC!");
  const b2 = book({ A1: "=A1+1" });
  assert.equal(err(En.recalc(b2).get(0, 0, 0)), "#CIRC!");
});

test("statistiche", () => {
  const c = { A1: "1", A2: "2", A3: "testo", A4: "", A5: "4" };
  assert.equal(calc("=SOMMA(A1:A5)", c), 7);
  assert.equal(calc("=MEDIA(A1:A5)", c), 7 / 3);
  assert.equal(calc("=MIN(A1:A5)", c), 1);
  assert.equal(calc("=MAX(A1:A5)", c), 4);
  assert.equal(calc("=MIN(A4)", c), 0);
  assert.equal(calc("=CONTA.NUMERI(A1:A5)", c), 3);
  assert.equal(calc("=CONTA.VALORI(A1:A5)", c), 4);
  assert.equal(calc("=CONTA.VUOTE(A1:A5)", c), 1);
  assert.equal(calc("=PRODOTTO(A1:A5)", c), 8);
  assert.equal(calc("=MEDIANA(A1:A5)", c), 2);
  assert.equal(calc("=MEDIANA(1;2;3;4)"), 2.5);
  assert.equal(err(calc("=MEDIA(A4)", c)), "#DIV/0!");
  assert.equal(calc("=SOMMA(1;2;3)"), 6);
  assert.equal(calc("=SOMMA(VERO;1)"), 2);
  assert.equal(err(calc("=SOMMA(A1:A2)", { A1: "1", A2: "=1/0" })), "#DIV/0!");
  assert.equal(calc("=sum(1;2)"), 3); // anche i nomi inglesi
});

test("MIN e MAX su intervalli molto grandi", () => {
  const cells = {};
  for (let i = 1; i <= 150000; i++) cells["A" + i] = i;
  assert.equal(calc("=MAX(A1:A150000)", cells), 150000);
  assert.equal(calc("=MIN(A1:A150000)", cells), 1);
});

test("logica", () => {
  assert.equal(calc('=SE(A1>10;"alto";"basso")', { A1: "11" }), "alto");
  assert.equal(calc('=SE(A1>10;"alto";"basso")', { A1: "5" }), "basso");
  assert.equal(calc("=SE(FALSO;1)"), false);
  assert.equal(calc("=SE(VERO;1/0;2)") && err(calc("=SE(VERO;1/0;2)")), "#DIV/0!");
  assert.equal(calc("=SE(FALSO;1/0;2)"), 2); // il ramo non scelto non conta
  assert.equal(calc('=SE.ERRORE(1/0;"x")'), "x");
  assert.equal(calc('=SE.ERRORE(5;"x")'), 5);
  assert.equal(calc("=E(VERO;1;2>1)"), true);
  assert.equal(calc("=E(VERO;FALSO)"), false);
  assert.equal(calc("=O(FALSO;0)"), false);
  assert.equal(calc("=O(FALSO;1)"), true);
  assert.equal(calc("=NON(VERO)"), false);
  assert.equal(calc("=VAL.VUOTO(A1)"), true);
  assert.equal(calc("=VAL.NUMERO(A1)", { A1: "3" }), true);
  assert.equal(calc("=VAL.TESTO(A1)", { A1: "a" }), true);
  assert.equal(calc("=VAL.ERRORE(1/0)"), true);
  assert.equal(calc("=VAL.ERRORE(1)"), false);
});

test("matematica", () => {
  assert.equal(calc("=ARROTONDA(2,345;2)"), 2.35);
  assert.equal(calc("=ARROTONDA(-2,5;0)"), -3);
  assert.equal(calc("=ARROTONDA(1234;-2)"), 1200);
  assert.equal(calc("=ARROTONDA.PER.ECC(2,1;0)"), 3);
  assert.equal(calc("=ARROTONDA.PER.ECC(-2,1;0)"), -3);
  assert.equal(calc("=ARROTONDA.PER.DIF(2,9;0)"), 2);
  assert.equal(calc("=ARROTONDA.PER.DIF(-2,9;0)"), -2);
  assert.equal(calc("=INT(-2,5)"), -3);
  assert.equal(calc("=ASS(-4)"), 4);
  assert.equal(calc("=RADQ(16)"), 4);
  assert.equal(err(calc("=RADQ(-1)")), "#NUM!");
  assert.equal(calc("=POTENZA(2;10)"), 1024);
  assert.equal(calc("=RESTO(10;3)"), 1);
  assert.equal(calc("=RESTO(-3;2)"), 1);
  assert.equal(err(calc("=RESTO(1;0)")), "#DIV/0!");
  near(calc("=PI.GRECO()"), Math.PI);
  const r = calc("=CASUALE()"); assert.ok(r >= 0 && r < 1);
  const rb = calc("=CASUALE.TRA(3;5)"); assert.ok([3, 4, 5].includes(rb));
  assert.equal(err(calc("=CASUALE.TRA(5;3)")), "#NUM!");
});

test("testo", () => {
  assert.equal(calc('=CONCATENA("a";1;"b")'), "a1b");
  assert.equal(calc('=LUNGHEZZA("ciao")'), 4);
  assert.equal(calc('=MAIUSC("città")'), "CITTÀ");
  assert.equal(calc('=MINUSC("ABC")'), "abc");
  assert.equal(calc('=SINISTRA("ciao";2)'), "ci");
  assert.equal(calc('=SINISTRA("ciao")'), "c");
  assert.equal(calc('=DESTRA("ciao";2)'), "ao");
  assert.equal(calc('=STRINGA.ESTRAI("ciao mondo";6;5)'), "mondo");
  assert.equal(calc('=ANNULLA.SPAZI("  a   b  ")'), "a b");
  assert.equal(calc('=VALORE("12,5")'), 12.5);
  assert.equal(err(calc('=VALORE("x")')), "#VALORE!");
  assert.equal(calc('="Totale: "&SOMMA(1;2)'), "Totale: 3");
  assert.equal(calc('=LUNGHEZZA(1,5)'), 3); // "1,5"
});

test("date", () => {
  assert.equal(calc("=DATA(2024;3;15)"), En.dateToSerial(2024, 3, 15));
  assert.equal(calc("=ANNO(DATA(2024;3;15))"), 2024);
  assert.equal(calc("=MESE(DATA(2024;3;15))"), 3);
  assert.equal(calc("=GIORNO(DATA(2024;3;15))"), 15);
  assert.equal(calc("=GIORNI(DATA(2024;3;15);DATA(2024;3;1))"), 14);
  assert.equal(calc("=DATA(2024;13;1)"), En.dateToSerial(2025, 1, 1));
  assert.equal(calc("=A1+1", { A1: "31/12/2023" }), En.dateToSerial(2024, 1, 1));
  const t = new Date();
  assert.equal(calc("=OGGI()"), En.dateToSerial(t.getFullYear(), t.getMonth() + 1, t.getDate()));
  assert.ok(calc("=ADESSO()") >= calc("=OGGI()"));
  assert.equal(En.dateToSerial(1900, 3, 1), 61); // come nei fogli di calcolo
});

test("ricerca", () => {
  const t = { A1: "Roma", B1: "10", A2: "Milano", B2: "20", A3: "Napoli", B3: "30" };
  assert.equal(calc('=CERCA.VERT("Milano";A1:B3;2;FALSO)', t), 20);
  assert.equal(calc('=CERCA.VERT("milano";A1:B3;2;0)', t), 20);
  assert.equal(err(calc('=CERCA.VERT("Torino";A1:B3;2;FALSO)', t)), "#N/D");
  assert.equal(err(calc('=CERCA.VERT("Roma";A1:B3;3;FALSO)', t)), "#RIF!");
  const s = { A1: "1", B1: "a", A2: "5", B2: "b", A3: "10", B3: "c" };
  assert.equal(calc("=CERCA.VERT(7;A1:B3;2)", s), "b");
  assert.equal(calc("=CERCA.VERT(7;A1:B3;2;VERO)", s), "b");
  assert.equal(err(calc("=CERCA.VERT(0;A1:B3;2)", s)), "#N/D");
  const h = { A1: "x", B1: "y", A2: "1", B2: "2" };
  assert.equal(calc('=CERCA.ORIZZ("y";A1:B2;2;FALSO)', h), 2);
  assert.equal(calc("=INDICE(A1:B3;2;2)", t), 20);
  assert.equal(calc("=INDICE(A1:A3;3)", t), "Napoli");
  assert.equal(err(calc("=INDICE(A1:B3;9;1)", t)), "#RIF!");
  assert.equal(calc('=CONFRONTA("Napoli";A1:A3;0)', t), 3);
  assert.equal(calc("=CONFRONTA(7;A1:A3;1)", s), 2);
  assert.equal(err(calc('=CONFRONTA("x";A1:A3;0)', t)), "#N/D");
  assert.equal(calc('=CONFRONTA("Mil*";A1:A3;0)', t), 2);
});

test("condizionali", () => {
  const t = { A1: "Roma", B1: "10", A2: "Milano", B2: "20", A3: "Roma", B3: "30", A4: "", B4: "40" };
  assert.equal(calc('=SOMMA.SE(A1:A4;"Roma";B1:B4)', t), 40);
  assert.equal(calc('=SOMMA.SE(B1:B4;">15")', t), 90);
  assert.equal(calc('=CONTA.SE(A1:A4;"Roma")', t), 2);
  assert.equal(calc('=CONTA.SE(A1:A4;"R*")', t), 2);
  assert.equal(calc('=CONTA.SE(B1:B4;">=20")', t), 3);
  assert.equal(calc('=CONTA.SE(B1:B4;20)', t), 1);
  assert.equal(calc('=CONTA.SE(A1:A4;"<>Roma")', t), 2);
  assert.equal(calc('=MEDIA.SE(A1:A4;"Roma";B1:B4)', t), 20);
  assert.equal(err(calc('=MEDIA.SE(A1:A4;"Torino";B1:B4)', t)), "#DIV/0!");
  assert.equal(calc('=SOMMA.PIÙ.SE(B1:B4;A1:A4;"Roma";B1:B4;">15")', t), 30);
  assert.equal(calc('=CONTA.PIÙ.SE(A1:A4;"Roma";B1:B4;"<20")', t), 1);
  assert.equal(calc('=SOMMA.SE(B1:B4;">"&B2)', t), 70);
});

test("numeri scritti a mano", () => {
  const P = (s) => En.parseInput(s);
  assert.equal(P("12").value, 12);
  assert.equal(P("12,5").value, 12.5);
  assert.equal(P("1.234,5").value, 1234.5);
  assert.equal(P("-3").value, -3);
  assert.equal(P("50%").value, 0.5);
  assert.equal(P("50%").hint, "percent");
  assert.equal(P("€ 10").value, 10);
  assert.equal(P("10 €").hint, "currency");
  assert.equal(P("15/03/2024").value, En.dateToSerial(2024, 3, 15));
  assert.equal(P("15/03/24").hint, "date");
  assert.equal(P("31/02/2024").value, "31/02/2024"); // data impossibile: resta testo
  assert.equal(P("'123").value, "123");
  assert.equal(P("vero").value, true);
  assert.equal(P("ciao").value, "ciao");
  assert.equal(P("").value, null);
});

test("formati", () => {
  const F = En.formatValue;
  assert.equal(F(1234.5, { fmt: "number" }), "1.234,50");
  assert.equal(F(1234.5, { fmt: "currency" }).replace(/\s/g, " "), "1.234,50 €");
  assert.equal(F(0.256, { fmt: "percent" }), "26%");
  assert.equal(F(0.256, { fmt: "percent", dec: 1 }), "25,6%");
  assert.equal(F(En.dateToSerial(2024, 3, 5), { fmt: "date" }), "05/03/2024");
  assert.equal(F(En.dateToSerial(2024, 3, 5) + 0.5, { fmt: "datetime" }), "05/03/2024 12:00");
  assert.equal(F(3.14159, { dec: 2 }), "3,14");
  assert.equal(F(0.1 + 0.2), "0,3");
  assert.equal(F(1e12), "1000000000000");
  assert.equal(F(true), "VERO");
  assert.equal(F({ e: "#N/D" }), "#N/D");
  assert.equal(F(null), "");
});

test("spostamento dei riferimenti (copia e trascina)", () => {
  assert.equal(En.shiftFormula("=A1+$B$1+C$1+$D1", 1, 1), "=B2+$B$1+D$1+$D2");
  assert.equal(En.shiftFormula("=SOMMA(A1:A3)", 0, 2), "=SOMMA(C1:C3)");
  assert.equal(En.shiftFormula("=A1", -1, 0), "=#RIF!");
  assert.equal(En.shiftFormula("=Dati!A1*2,5", 1, 0), "=Dati!A2*2,5");
  assert.equal(En.shiftFormula('="A1"&A1', 1, 0), '="A1"&A2');
  assert.equal(En.shiftFormula("ciao", 1, 0), "ciao");
});

test("inserire ed eliminare righe e colonne", () => {
  const A = En.adjustStructure;
  assert.equal(A("=A5", "F", "F", "row", 2, 1), "=A6");
  assert.equal(A("=A1", "F", "F", "row", 2, 1), "=A1");
  assert.equal(A("=SOMMA(A1:A5)", "F", "F", "row", 2, 2), "=SOMMA(A1:A7)");
  assert.equal(A("=A5", "F", "F", "row", 4, -1), "=#RIF!");
  assert.equal(A("=A6", "F", "F", "row", 4, -1), "=A5");
  assert.equal(A("=SOMMA(A1:A5)", "F", "F", "row", 1, -2), "=SOMMA(A1:A3)");
  assert.equal(A("=SOMMA(A2:A3)", "F", "F", "row", 1, -2), "=SOMMA(#RIF!)");
  assert.equal(A("=C1", "F", "F", "col", 1, 1), "=D1");
  assert.equal(A("=Altro!A5", "F", "F", "row", 0, 1), "=Altro!A5");
  assert.equal(A("=F!A5", "Altro", "F", "row", 0, 1), "=F!A6");
});

test("rinomina fogli e traduzione per .xlsx", () => {
  assert.equal(En.renameSheetRefs("=Dati!A1+dati!B2", "Dati", "Vendite 2024"), "='Vendite 2024'!A1+'Vendite 2024'!B2");
  assert.equal(En.renameSheetRefs("=Dati!A1", "Dati", "Conti"), "=Conti!A1");
  assert.equal(En.toEnglish('=SOMMA(A1:A3;2,5)'), "SUM(A1:A3,2.5)");
  assert.equal(En.toEnglish('=SE(A1>0;VERO;"a;b")'), 'IF(A1>0,TRUE,"a;b")');
  assert.equal(En.toEnglish("=SOMMA.PIÙ.SE(A1:A2;B1:B2;1)"), "SUMIFS(A1:A2,B1:B2,1)");
  assert.equal(En.toItalian("SUM(A1:A3,2.5)"), "=SOMMA(A1:A3;2,5)");
  assert.equal(En.toItalian("IFERROR(VLOOKUP(A1,B:C,2,FALSE),0)").startsWith("=SE.ERRORE(CERCA.VERT("), true);
  assert.equal(En.toItalian("'My Sheet'!A1*2"), "='My Sheet'!A1*2");
});

test("ogni funzione ha la sua spiegazione e la sintassi", () => {
  for (const n of En.FUNCTIONS) {
    assert.ok(En.FUNCTION_HELP[n], `manca la spiegazione di ${n}`);
    assert.ok(En.FUNCTION_SYNTAX && En.FUNCTION_SYNTAX[n], `manca la sintassi di ${n}`);
  }
});

test("suggerimenti: solo le funzioni che iniziano con quanto scritto", () => {
  const S = En.suggest;
  assert.equal(S("").length, En.FUNCTIONS.length);
  assert.ok(S("S").every((n) => n.startsWith("S")));
  assert.ok(S("S").includes("SOMMA") && S("S").includes("SE"));
  assert.deepEqual([...S("somma.p")].map(String), ["SOMMA.PIÙ.SE"]);
  assert.deepEqual([...S("SOMMA.PIU")].map(String), ["SOMMA.PIÙ.SE"]); // senza accento va bene lo stesso
  assert.ok(S("CO").every((n) => n.startsWith("CO")));
  assert.ok(!S("CO").includes("SOMMA"));
  assert.deepEqual([...S("ZZZ")].map(String), []);
  assert.deepEqual([...S("A1")].map(String), []);
  // la parola che si sta scrivendo prima del cursore
  const W = En.wordAtCaret;
  assert.deepEqual({ ...W("=", 1) }, { start: 1, word: "" });
  assert.deepEqual({ ...W("=som", 4) }, { start: 1, word: "som" });
  assert.deepEqual({ ...W("=SOMMA(A1;me", 12) }, { start: 10, word: "me" });
  assert.deepEqual({ ...W("=1+co", 5) }, { start: 3, word: "co" });
  assert.equal(W('="som', 5), null); // dentro un testo tra virgolette
  assert.equal(W("=Dati!A", 7), null); // riferimento a un altro foglio
  assert.equal(W("ciao", 4), null); // non è una formula
  assert.equal(W("=SOMMA(", 7), null); // subito dopo una parentesi: niente elenco
  assert.equal(W("=12", 3), null);
});
