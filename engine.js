/* Foglio — motore delle formule (sintassi italiana: SOMMA(A1:A3; 2,5)) */
(function () {
  "use strict";

  /* ---------- Indirizzi ---------- */
  function colName(c) {
    let s = "";
    c += 1;
    while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); }
    return s;
  }
  function colIndex(name) {
    let n = 0;
    for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }
  const addr = (r, c) => colName(c) + (r + 1);
  function parseAddr(a) {
    const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(a.trim());
    return m ? { r: parseInt(m[2], 10) - 1, c: colIndex(m[1]) } : null;
  }

  /* ---------- Errori e valori ---------- */
  const ERR = (e) => ({ e });
  const isErr = (v) => v !== null && typeof v === "object" && "e" in v;
  const E = {
    DIV0: ERR("#DIV/0!"), VALUE: ERR("#VALORE!"), REF: ERR("#RIF!"), NAME: ERR("#NOME?"),
    NA: ERR("#N/D"), CIRC: ERR("#CIRC!"), NUM: ERR("#NUM!"), PARSE: ERR("#ERRORE!"),
  };
  const ERR_LITERALS = { "#DIV/0!": E.DIV0, "#VALORE!": E.VALUE, "#VALUE!": E.VALUE, "#RIF!": E.REF, "#REF!": E.REF, "#NOME?": E.NAME, "#NAME?": E.NAME, "#N/D": E.NA, "#N/A": E.NA, "#NUM!": E.NUM };

  /* ---------- Date (numero seriale come nei fogli di calcolo) ---------- */
  const EPOCH = Date.UTC(1899, 11, 30);
  const dateToSerial = (y, m, d) => (Date.UTC(y, m - 1, d) - EPOCH) / 86400000;
  function serialToDate(n) {
    const d = new Date(EPOCH + Math.round(n * 86400000));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), min: d.getUTCMinutes() };
  }
  function todaySerial() { const t = new Date(); return dateToSerial(t.getFullYear(), t.getMonth() + 1, t.getDate()); }

  /* ---------- Funzioni: nomi italiani e inglesi ---------- */
  const NAMES = {
    SOMMA: "SUM", MEDIA: "AVERAGE", MIN: "MIN", MAX: "MAX", "CONTA.NUMERI": "COUNT", "CONTA.VALORI": "COUNTA",
    "CONTA.VUOTE": "COUNTBLANK", SE: "IF", "SE.ERRORE": "IFERROR", E: "AND", O: "OR", NON: "NOT",
    ARROTONDA: "ROUND", "ARROTONDA.PER.ECC": "ROUNDUP", "ARROTONDA.PER.DIF": "ROUNDDOWN", INT: "INT", ASS: "ABS",
    RADQ: "SQRT", POTENZA: "POWER", RESTO: "MOD", "PI.GRECO": "PI", CASUALE: "RAND", "CASUALE.TRA": "RANDBETWEEN",
    PRODOTTO: "PRODUCT", MEDIANA: "MEDIAN", OGGI: "TODAY", ADESSO: "NOW", ANNO: "YEAR", MESE: "MONTH", GIORNO: "DAY",
    DATA: "DATE", GIORNI: "DAYS", CONCATENA: "CONCATENATE", LUNGHEZZA: "LEN", MAIUSC: "UPPER", MINUSC: "LOWER",
    SINISTRA: "LEFT", DESTRA: "RIGHT", "STRINGA.ESTRAI": "MID", "ANNULLA.SPAZI": "TRIM", VALORE: "VALUE",
    "CERCA.VERT": "VLOOKUP", "CERCA.ORIZZ": "HLOOKUP", INDICE: "INDEX", CONFRONTA: "MATCH",
    "SOMMA.SE": "SUMIF", "CONTA.SE": "COUNTIF", "MEDIA.SE": "AVERAGEIF", "SOMMA.PIÙ.SE": "SUMIFS", "CONTA.PIÙ.SE": "COUNTIFS",
    "VAL.VUOTO": "ISBLANK", "VAL.NUMERO": "ISNUMBER", "VAL.TESTO": "ISTEXT", "VAL.ERRORE": "ISERROR",
  };
  const EN_TO_IT = Object.fromEntries(Object.entries(NAMES).map(([it, en]) => [en, it]));

  /* ---------- Analisi del testo della formula ---------- */
  const IDENT = /[\p{L}_$][\p{L}\p{N}_.$]*/uy;
  const REF_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/;

  function tokenize(src, mode = "it") {
    const toks = [];
    let i = 0, pre = "";
    const push = (t) => { t.pre = pre; pre = ""; toks.push(t); };
    while (i < src.length) {
      const ch = src[i];
      if (/\s/.test(ch)) { pre += ch; i++; continue; }
      if (ch === '"') {
        let j = i + 1, s = "";
        while (j < src.length) {
          if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; }
          s += src[j++];
        }
        push({ t: "str", v: s, text: src.slice(i, j + 1) });
        i = j + 1; continue;
      }
      if (ch === "#") {
        const m = /^#[A-Z\/0-9]+[!?]?/i.exec(src.slice(i));
        const text = m ? m[0] : "#";
        push({ t: "err", v: ERR_LITERALS[text.toUpperCase()] || E.PARSE, text });
        i += text.length; continue;
      }
      // numeri: in italiano la virgola è il separatore decimale
      if (/\d/.test(ch) || ((ch === "." || (mode === "it" && ch === ",")) && /\d/.test(src[i + 1] || "") && !(toks.length && ["ref", "num", "rp"].includes(toks[toks.length - 1].t)))) {
        const dec = mode === "it" ? "[.,]" : "\\.";
        const m = new RegExp(`^\\d*(?:${dec}\\d+)?(?:[eE][+-]?\\d+)?`).exec(src.slice(i));
        let text = m[0];
        if (!text) text = ch;
        push({ t: "num", v: parseFloat(text.replace(",", ".")), text });
        i += text.length; continue;
      }
      if (ch === "'") {
        const j = src.indexOf("'", i + 1);
        if (j > 0 && src[j + 1] === "!") {
          const sheet = src.slice(i + 1, j);
          IDENT.lastIndex = j + 2;
          const m = IDENT.exec(src);
          if (m && REF_RE.test(m[0])) {
            push(refTok(m[0], sheet, src.slice(i, j + 2)));
            i = j + 2 + m[0].length; continue;
          }
        }
        push({ t: "bad", text: ch }); i++; continue;
      }
      IDENT.lastIndex = i;
      const im = IDENT.exec(src);
      if (im) {
        const word = im[0];
        let j = i + word.length;
        if (src[j] === "!") {
          IDENT.lastIndex = j + 1;
          const m2 = IDENT.exec(src);
          if (m2 && REF_RE.test(m2[0])) {
            push(refTok(m2[0], word, word + "!"));
            i = j + 1 + m2[0].length; continue;
          }
        }
        let k = j; while (k < src.length && /\s/.test(src[k])) k++;
        if (src[k] === "(") { push({ t: "fn", v: word.toUpperCase(), text: word }); i = j; continue; }
        if (REF_RE.test(word)) { push(refTok(word, null, "")); i = j; continue; }
        const up = word.toUpperCase();
        if (up === "VERO" || up === "TRUE") { push({ t: "bool", v: true, text: word }); i = j; continue; }
        if (up === "FALSO" || up === "FALSE") { push({ t: "bool", v: false, text: word }); i = j; continue; }
        push({ t: "name", v: word, text: word }); i = j; continue;
      }
      const two = src.slice(i, i + 2);
      if (two === "<>" || two === "<=" || two === ">=") { push({ t: "op", v: two, text: two }); i += 2; continue; }
      if ("+-*/^&=<>%:".includes(ch)) { push({ t: "op", v: ch, text: ch }); i++; continue; }
      if (ch === "(") { push({ t: "lp", text: ch }); i++; continue; }
      if (ch === ")") { push({ t: "rp", text: ch }); i++; continue; }
      if (ch === ";" || ch === ",") { push({ t: "sep", text: ch }); i++; continue; }
      push({ t: "bad", text: ch }); i++;
    }
    toks.end = pre;
    return toks;
  }
  function refTok(word, sheet, prefix) {
    const m = REF_RE.exec(word);
    return { t: "ref", sheet, prefix, ca: !!m[1], c: colIndex(m[2]), ra: !!m[3], r: parseInt(m[4], 10) - 1 };
  }
  function refText(t) { return (t.prefix || "") + (t.ca ? "$" : "") + colName(t.c) + (t.ra ? "$" : "") + (t.r + 1); }

  // Ricompone la formula dai pezzi (per spostare riferimenti e tradurre)
  function rebuild(toks, mode = "it") {
    let out = "";
    for (const t of toks) {
      out += t.pre || "";
      if (t.t === "ref") out += t.dead ? "#RIF!" : refText(t);
      else if (t.t === "num") out += mode === "it" ? t.text.replace(".", ",") : t.text.replace(",", ".");
      else if (t.t === "sep") out += mode === "it" ? ";" : ",";
      else if (t.t === "fn") out += mode === "it" ? (EN_TO_IT[t.v] || t.v) : (NAMES[t.v] || t.v);
      else if (t.t === "bool") out += mode === "it" ? (t.v ? "VERO" : "FALSO") : (t.v ? "TRUE" : "FALSE");
      else if (t.t === "skip") continue;
      else out += t.text;
    }
    return out + (toks.end || "");
  }

  /* ---------- Albero della formula ---------- */
  function parse(toks) {
    let p = 0;
    const peek = () => toks[p];
    const isOp = (v) => peek() && peek().t === "op" && peek().v === v;
    const fail = () => { throw new Error("sintassi"); };

    function expr() { return comparison(); }
    function comparison() {
      let n = concat();
      while (peek() && peek().t === "op" && ["=", "<>", "<", ">", "<=", ">="].includes(peek().v)) {
        const op = toks[p++].v; n = { k: "bin", op, a: n, b: concat() };
      }
      return n;
    }
    function concat() { let n = additive(); while (isOp("&")) { p++; n = { k: "bin", op: "&", a: n, b: additive() }; } return n; }
    function additive() {
      let n = mult();
      while (isOp("+") || isOp("-")) { const op = toks[p++].v; n = { k: "bin", op, a: n, b: mult() }; }
      return n;
    }
    function mult() {
      let n = power();
      while (isOp("*") || isOp("/")) { const op = toks[p++].v; n = { k: "bin", op, a: n, b: power() }; }
      return n;
    }
    function power() { let n = unary(); while (isOp("^")) { p++; n = { k: "bin", op: "^", a: n, b: unary() }; } return n; }
    function unary() {
      if (isOp("-")) { p++; return { k: "neg", a: unary() }; }
      if (isOp("+")) { p++; return unary(); }
      return postfix();
    }
    function postfix() { let n = primary(); while (isOp("%")) { p++; n = { k: "pct", a: n }; } return n; }
    function primary() {
      const t = toks[p++];
      if (!t) fail();
      switch (t.t) {
        case "num": return { k: "lit", v: t.v };
        case "str": return { k: "lit", v: t.v };
        case "bool": return { k: "lit", v: t.v };
        case "err": return { k: "lit", v: t.v };
        case "name": return { k: "lit", v: E.NAME };
        case "ref":
          if (isOp(":") && toks[p + 1] && toks[p + 1].t === "ref") {
            p++; const b = toks[p++];
            return { k: "range", sheet: t.sheet, r1: Math.min(t.r, b.r), c1: Math.min(t.c, b.c), r2: Math.max(t.r, b.r), c2: Math.max(t.c, b.c) };
          }
          return { k: "ref", sheet: t.sheet, r: t.r, c: t.c };
        case "fn": {
          if (!peek() || peek().t !== "lp") fail();
          p++;
          const args = [];
          if (peek() && peek().t === "rp") { p++; return { k: "fn", name: t.v, args }; }
          for (;;) {
            if (peek() && (peek().t === "sep" || peek().t === "rp")) args.push({ k: "lit", v: null });
            else args.push(expr());
            const n = toks[p++];
            if (!n) fail();
            if (n.t === "rp") break;
            if (n.t !== "sep") fail();
          }
          return { k: "fn", name: t.v, args };
        }
        case "lp": { const n = expr(); if (!peek() || peek().t !== "rp") fail(); p++; return n; }
        default: fail();
      }
    }
    const tree = expr();
    if (p < toks.length) fail();
    return tree;
  }

  const astCache = new Map();
  function compile(formula) {
    let a = astCache.get(formula);
    if (a) return a;
    try { a = parse(tokenize(formula.slice(1), "it")); } catch (e) { a = { k: "lit", v: E.PARSE }; }
    if (astCache.size > 5000) astCache.clear();
    astCache.set(formula, a);
    return a;
  }

  /* ---------- Conversioni ---------- */
  function toNum(v) {
    if (v === null || v === undefined || v === "") return 0;
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (isErr(v)) return v;
    const n = parseNumber(String(v));
    return n === null ? E.VALUE : n;
  }
  function toStr(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "boolean") return v ? "VERO" : "FALSO";
    if (typeof v === "number") return formatGeneral(v);
    if (isErr(v)) return v.e;
    return String(v);
  }
  function toBool(v) {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (v === null || v === "") return false;
    if (isErr(v)) return v;
    const u = String(v).toUpperCase();
    if (u === "VERO" || u === "TRUE") return true;
    if (u === "FALSO" || u === "FALSE") return false;
    return E.VALUE;
  }

  /* ---------- Valutazione ---------- */
  class Calc {
    constructor(book) {
      this.book = book;
      this.values = book.sheets.map(() => new Map());
      this.busy = new Set();
    }
    sheetIndex(name, host) {
      if (!name) return host;
      const i = this.book.sheets.findIndex((s) => s.name.toLowerCase() === name.toLowerCase());
      return i;
    }
    get(si, r, c) {
      const key = r + ":" + c;
      const cache = this.values[si];
      if (cache.has(key)) return cache.get(key);
      const cell = this.book.sheets[si].cells[addr(r, c)];
      if (!cell || cell.v === undefined || cell.v === "") return null;
      const raw = cell.v;
      let val;
      if (typeof raw === "string" && raw[0] === "=" && raw.length > 1) {
        const id = si + "|" + key;
        if (this.busy.has(id)) return E.CIRC;
        this.busy.add(id);
        try { val = this.eval(compile(raw), si); } catch (e) { val = E.VALUE; }
        this.busy.delete(id);
        if (val && typeof val === "object" && val.range) val = val.range[0][0];
        if (val === undefined) val = null;
        if (typeof val === "number" && !isFinite(val)) val = E.NUM;
      } else val = parseInput(raw).value;
      cache.set(key, val);
      return val;
    }
    range(n, si) {
      const s = this.sheetIndex(n.sheet, si);
      if (s < 0) return E.REF;
      const rows = [];
      for (let r = n.r1; r <= n.r2; r++) {
        const row = [];
        for (let c = n.c1; c <= n.c2; c++) row.push(this.get(s, r, c));
        rows.push(row);
      }
      return { range: rows };
    }
    eval(n, si) {
      switch (n.k) {
        case "lit": return n.v;
        case "ref": { const s = this.sheetIndex(n.sheet, si); return s < 0 ? E.REF : this.get(s, n.r, n.c); }
        case "range": return this.range(n, si);
        case "neg": { const v = toNum(this.scalar(n.a, si)); return isErr(v) ? v : -v; }
        case "pct": { const v = toNum(this.scalar(n.a, si)); return isErr(v) ? v : v / 100; }
        case "bin": return this.bin(n, si);
        case "fn": return this.call(n, si);
      }
      return E.VALUE;
    }
    scalar(n, si) {
      const v = this.eval(n, si);
      if (v && typeof v === "object" && v.range) return v.range.length === 1 && v.range[0].length === 1 ? v.range[0][0] : E.VALUE;
      return v;
    }
    bin(n, si) {
      const a = this.scalar(n.a, si), b = this.scalar(n.b, si);
      if (isErr(a)) return a;
      if (isErr(b)) return b;
      if (n.op === "&") return toStr(a) + toStr(b);
      if (["=", "<>", "<", ">", "<=", ">="].includes(n.op)) {
        const cmp = compare(a, b);
        return { "=": cmp === 0, "<>": cmp !== 0, "<": cmp < 0, ">": cmp > 0, "<=": cmp <= 0, ">=": cmp >= 0 }[n.op];
      }
      const x = toNum(a), y = toNum(b);
      if (isErr(x)) return x;
      if (isErr(y)) return y;
      switch (n.op) {
        case "+": return x + y;
        case "-": return x - y;
        case "*": return x * y;
        case "/": return y === 0 ? E.DIV0 : x / y;
        case "^": return Math.pow(x, y);
      }
      return E.VALUE;
    }
    call(n, si) {
      const name = EN_TO_IT[n.name] ? EN_TO_IT[n.name] : n.name;
      const f = FN[name];
      if (!f) return E.NAME;
      const self = this;
      // argomenti valutati solo quando servono (per SE)
      const args = n.args.map((a) => ({
        node: a,
        get value() { return self.eval(a, si); },
        get scalar() { return self.scalar(a, si); },
      }));
      return f(args, this, si);
    }
  }

  function compare(a, b) {
    const ta = typeof a, tb = typeof b;
    if (a === null) a = tb === "string" ? "" : tb === "boolean" ? false : 0;
    if (b === null) b = typeof a === "string" ? "" : typeof a === "boolean" ? false : 0;
    if (typeof a === "number" && typeof b === "number") return a === b ? 0 : a < b ? -1 : 1;
    if (typeof a === "string" && typeof b === "string") return a.localeCompare(b, "it", { sensitivity: "base" });
    if (typeof a === "boolean" && typeof b === "boolean") return a === b ? 0 : a ? 1 : -1;
    // numeri < testo < booleani
    const rank = (v) => (typeof v === "number" ? 0 : typeof v === "string" ? 1 : 2);
    void ta; void tb;
    return rank(a) - rank(b);
  }

  /* ---------- Libreria di funzioni ---------- */
  function flat(args, { numbersOnly = true } = {}) {
    const out = [];
    for (const a of args) {
      const v = a.value;
      if (v && typeof v === "object" && v.range) {
        for (const row of v.range) for (const x of row) {
          if (isErr(x)) return x;
          if (typeof x === "number") out.push(x);
          else if (!numbersOnly && x !== null && x !== "") out.push(x);
        }
      } else {
        if (isErr(v)) return v;
        if (numbersOnly) {
          if (v === null) continue;
          const n = toNum(v);
          if (isErr(n)) return n;
          out.push(n);
        } else if (v !== null) out.push(v);
      }
    }
    return out;
  }
  const num = (a) => toNum(a.scalar);
  function grid(a) {
    const v = a.value;
    if (v && typeof v === "object" && v.range) return v.range;
    return [[v]];
  }
  function matcher(crit) {
    if (typeof crit === "number" || typeof crit === "boolean") return (v) => compare(v, crit) === 0;
    let s = toStr(crit), op = "=";
    const m = /^(<>|<=|>=|=|<|>)(.*)$/.exec(s);
    if (m) { op = m[1]; s = m[2]; }
    const n = parseNumber(s);
    if (n !== null) {
      return (v) => {
        if (typeof v !== "number") return op === "<>" ? true : false;
        return { "=": v === n, "<>": v !== n, "<": v < n, ">": v > n, "<=": v <= n, ">=": v >= n }[op];
      };
    }
    if (op === "=" || op === "<>") {
      const re = new RegExp("^" + s.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
      return (v) => { const ok = re.test(toStr(v)); return op === "=" ? ok : !ok; };
    }
    return (v) => {
      const c = compare(toStr(v), s);
      return { "<": c < 0, ">": c > 0, "<=": c <= 0, ">=": c >= 0 }[op];
    };
  }
  const round = (x, d) => { const k = Math.pow(10, d); return Math.round((x + Math.sign(x) * 1e-12) * k) / k; };
  function firstErr(...vals) { return vals.find(isErr); }

  const FN = {
    SOMMA: (a) => { const v = flat(a); return isErr(v) ? v : v.reduce((s, x) => s + x, 0); },
    MEDIA: (a) => { const v = flat(a); return isErr(v) ? v : v.length ? v.reduce((s, x) => s + x, 0) / v.length : E.DIV0; },
    MIN: (a) => { const v = flat(a); return isErr(v) ? v : v.length ? Math.min(...v) : 0; },
    MAX: (a) => { const v = flat(a); return isErr(v) ? v : v.length ? Math.max(...v) : 0; },
    PRODOTTO: (a) => { const v = flat(a); return isErr(v) ? v : v.reduce((s, x) => s * x, 1); },
    MEDIANA: (a) => {
      const v = flat(a); if (isErr(v)) return v; if (!v.length) return E.NUM;
      v.sort((x, y) => x - y); const h = v.length >> 1;
      return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
    },
    "CONTA.NUMERI": (a) => {
      let n = 0;
      for (const x of a) { const v = x.value; if (v && v.range) v.range.forEach((r) => r.forEach((y) => { if (typeof y === "number") n++; })); else if (typeof v === "number") n++; }
      return n;
    },
    "CONTA.VALORI": (a) => {
      let n = 0;
      for (const x of a) { const v = x.value; if (v && v.range) v.range.forEach((r) => r.forEach((y) => { if (y !== null && y !== "") n++; })); else if (v !== null) n++; }
      return n;
    },
    "CONTA.VUOTE": (a) => { let n = 0; grid(a[0]).forEach((r) => r.forEach((y) => { if (y === null || y === "") n++; })); return n; },
    SE: (a) => {
      const c = toBool(a[0].scalar);
      if (isErr(c)) return c;
      if (c) return a[1] ? a[1].scalar : true;
      return a[2] ? a[2].scalar : false;
    },
    "SE.ERRORE": (a) => { const v = a[0].scalar; return isErr(v) ? (a[1] ? a[1].scalar : "") : v; },
    E: (a) => { const v = flat(a, { numbersOnly: false }); if (isErr(v)) return v; for (const x of v) { const b = toBool(x); if (isErr(b)) return b; if (!b) return false; } return true; },
    O: (a) => { const v = flat(a, { numbersOnly: false }); if (isErr(v)) return v; for (const x of v) { const b = toBool(x); if (isErr(b)) return b; if (b) return true; } return false; },
    NON: (a) => { const b = toBool(a[0].scalar); return isErr(b) ? b : !b; },
    ARROTONDA: (a) => { const x = num(a[0]), d = a[1] ? num(a[1]) : 0; return firstErr(x, d) || round(x, d); },
    "ARROTONDA.PER.ECC": (a) => { const x = num(a[0]), d = a[1] ? num(a[1]) : 0; if (firstErr(x, d)) return firstErr(x, d); const k = Math.pow(10, d); return Math.sign(x) * Math.ceil(Math.abs(x) * k - 1e-9) / k; },
    "ARROTONDA.PER.DIF": (a) => { const x = num(a[0]), d = a[1] ? num(a[1]) : 0; if (firstErr(x, d)) return firstErr(x, d); const k = Math.pow(10, d); return Math.sign(x) * Math.floor(Math.abs(x) * k + 1e-9) / k; },
    INT: (a) => { const x = num(a[0]); return isErr(x) ? x : Math.floor(x); },
    ASS: (a) => { const x = num(a[0]); return isErr(x) ? x : Math.abs(x); },
    RADQ: (a) => { const x = num(a[0]); return isErr(x) ? x : x < 0 ? E.NUM : Math.sqrt(x); },
    POTENZA: (a) => { const x = num(a[0]), y = num(a[1]); return firstErr(x, y) || Math.pow(x, y); },
    RESTO: (a) => { const x = num(a[0]), y = num(a[1]); if (firstErr(x, y)) return firstErr(x, y); if (y === 0) return E.DIV0; return x - y * Math.floor(x / y); },
    "PI.GRECO": () => Math.PI,
    CASUALE: () => Math.random(),
    "CASUALE.TRA": (a) => { const x = num(a[0]), y = num(a[1]); return firstErr(x, y) || Math.floor(Math.random() * (Math.floor(y) - Math.ceil(x) + 1)) + Math.ceil(x); },
    OGGI: () => todaySerial(),
    ADESSO: () => { const t = new Date(); return todaySerial() + (t.getHours() * 3600 + t.getMinutes() * 60 + t.getSeconds()) / 86400; },
    ANNO: (a) => { const x = num(a[0]); return isErr(x) ? x : serialToDate(x).y; },
    MESE: (a) => { const x = num(a[0]); return isErr(x) ? x : serialToDate(x).m; },
    GIORNO: (a) => { const x = num(a[0]); return isErr(x) ? x : serialToDate(x).d; },
    DATA: (a) => { const y = num(a[0]), m = num(a[1]), d = num(a[2]); return firstErr(y, m, d) || dateToSerial(y, m, d); },
    GIORNI: (a) => { const x = num(a[0]), y = num(a[1]); return firstErr(x, y) || Math.round(x - y); },
    CONCATENA: (a) => { let s = ""; for (const x of a) { const v = x.value; if (v && v.range) v.range.forEach((r) => r.forEach((y) => (s += toStr(y)))); else { if (isErr(v)) return v; s += toStr(v); } } return s; },
    LUNGHEZZA: (a) => toStr(a[0].scalar).length,
    MAIUSC: (a) => toStr(a[0].scalar).toLocaleUpperCase("it"),
    MINUSC: (a) => toStr(a[0].scalar).toLocaleLowerCase("it"),
    SINISTRA: (a) => { const n = a[1] ? num(a[1]) : 1; return isErr(n) ? n : toStr(a[0].scalar).slice(0, n); },
    DESTRA: (a) => { const n = a[1] ? num(a[1]) : 1; if (isErr(n)) return n; const s = toStr(a[0].scalar); return n <= 0 ? "" : s.slice(-n); },
    "STRINGA.ESTRAI": (a) => { const st = num(a[1]), n = num(a[2]); return firstErr(st, n) || toStr(a[0].scalar).substr(st - 1, n); },
    "ANNULLA.SPAZI": (a) => toStr(a[0].scalar).trim().replace(/\s+/g, " "),
    VALORE: (a) => { const v = a[0].scalar; if (typeof v === "number") return v; const n = parseNumber(toStr(v)); return n === null ? E.VALUE : n; },
    "VAL.VUOTO": (a) => { const v = a[0].scalar; return v === null; },
    "VAL.NUMERO": (a) => typeof a[0].scalar === "number",
    "VAL.TESTO": (a) => typeof a[0].scalar === "string",
    "VAL.ERRORE": (a) => isErr(a[0].scalar),
    "CERCA.VERT": (a) => lookup(a, false),
    "CERCA.ORIZZ": (a) => lookup(a, true),
    INDICE: (a) => {
      const g = grid(a[0]); const r = num(a[1]); const c = a[2] ? num(a[2]) : 1;
      if (firstErr(r, c)) return firstErr(r, c);
      const row = g[(r || 1) - 1];
      if (!row || row[(c || 1) - 1] === undefined) return E.REF;
      return row[(c || 1) - 1];
    },
    CONFRONTA: (a) => {
      const want = a[0].scalar; const g = grid(a[1]); const type = a[2] ? num(a[2]) : 1;
      const list = g.length === 1 ? g[0] : g.map((r) => r[0]);
      if (type === 0) { const i = list.findIndex((v) => compare(v, want) === 0); return i < 0 ? E.NA : i + 1; }
      let best = -1;
      for (let i = 0; i < list.length; i++) {
        if (list[i] === null) continue;
        const c = compare(list[i], want);
        if (type > 0 ? c <= 0 : c >= 0) best = i; else break;
      }
      return best < 0 ? E.NA : best + 1;
    },
    "SOMMA.SE": (a) => {
      const rg = grid(a[0]), test = matcher(a[1].scalar), sum = a[2] ? grid(a[2]) : rg;
      let s = 0;
      rg.forEach((row, i) => row.forEach((v, j) => { if (test(v)) { const x = sum[i] && sum[i][j]; if (typeof x === "number") s += x; } }));
      return s;
    },
    "CONTA.SE": (a) => { const test = matcher(a[1].scalar); let n = 0; grid(a[0]).forEach((r) => r.forEach((v) => { if (test(v)) n++; })); return n; },
    "MEDIA.SE": (a) => {
      const rg = grid(a[0]), test = matcher(a[1].scalar), av = a[2] ? grid(a[2]) : rg;
      let s = 0, n = 0;
      rg.forEach((row, i) => row.forEach((v, j) => { if (test(v)) { const x = av[i] && av[i][j]; if (typeof x === "number") { s += x; n++; } } }));
      return n ? s / n : E.DIV0;
    },
    "SOMMA.PIÙ.SE": (a) => {
      const sum = grid(a[0]); let s = 0;
      const conds = [];
      for (let k = 1; k + 1 < a.length; k += 2) conds.push([grid(a[k]), matcher(a[k + 1].scalar)]);
      sum.forEach((row, i) => row.forEach((x, j) => { if (conds.every(([g, t]) => g[i] && t(g[i][j])) && typeof x === "number") s += x; }));
      return s;
    },
    "CONTA.PIÙ.SE": (a) => {
      const conds = [];
      for (let k = 0; k + 1 < a.length; k += 2) conds.push([grid(a[k]), matcher(a[k + 1].scalar)]);
      if (!conds.length) return 0;
      let n = 0;
      conds[0][0].forEach((row, i) => row.forEach((_, j) => { if (conds.every(([g, t]) => g[i] && t(g[i][j]))) n++; }));
      return n;
    },
  };
  function lookup(a, horizontal) {
    const want = a[0].scalar;
    let g = grid(a[1]);
    if (horizontal) g = g[0].map((_, j) => g.map((r) => r[j]));
    const idx = num(a[2]);
    if (isErr(idx)) return idx;
    const approx = a[3] ? toBool(a[3].scalar) !== false : true;
    if (idx < 1 || idx > (g[0] || []).length) return E.REF;
    let hit = -1;
    if (!approx) hit = g.findIndex((r) => compare(r[0], want) === 0 && r[0] !== null);
    else {
      for (let i = 0; i < g.length; i++) {
        if (g[i][0] === null) continue;
        if (compare(g[i][0], want) <= 0) hit = i; else break;
      }
    }
    return hit < 0 ? E.NA : g[hit][idx - 1];
  }

  /* ---------- Numeri scritti dall'utente ---------- */
  function parseNumber(str) {
    const s = String(str).replace(/[\s ]/g, "");
    if (/^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return parseFloat(s.replace(/\./g, "").replace(",", "."));
    if (/^[+-]?\d+(,\d+)?$/.test(s)) return parseFloat(s.replace(",", "."));
    if (/^[+-]?,\d+$/.test(s)) return parseFloat(s.replace(",", "."));
    if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return parseFloat(s);
    if (/^[+-]?\d+(,\d+)?e[+-]?\d+$/i.test(s)) return parseFloat(s.replace(",", "."));
    return null;
  }
  // Interpreta ciò che l'utente scrive in una cella. hint = formato suggerito.
  function parseInput(raw) {
    if (raw === null || raw === undefined) return { value: null };
    if (typeof raw === "number" || typeof raw === "boolean") return { value: raw };
    const s = String(raw);
    if (s === "") return { value: null };
    if (s[0] === "'") return { value: s.slice(1), hint: "text" };
    const t = s.trim();
    const up = t.toUpperCase();
    if (up === "VERO" || up === "TRUE") return { value: true };
    if (up === "FALSO" || up === "FALSE") return { value: false };
    let m = /^(.+?)\s*%$/.exec(t);
    if (m) { const n = parseNumber(m[1]); if (n !== null) return { value: n / 100, hint: "percent" }; }
    m = /^€\s*(.+)$/.exec(t) || /^(.+?)\s*€$/.exec(t);
    if (m) { const n = parseNumber(m[1]); if (n !== null) return { value: n, hint: "currency" }; }
    m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/.exec(t);
    if (m) {
      let y = parseInt(m[3], 10); if (y < 100) y += 2000;
      const mo = parseInt(m[2], 10), d = parseInt(m[1], 10);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return { value: dateToSerial(y, mo, d), hint: "date" };
    }
    const n = parseNumber(t);
    if (n !== null) return { value: n };
    return { value: s };
  }

  /* ---------- Visualizzazione dei valori ---------- */
  const nf = new Map();
  function fmtNum(v, opts) {
    const k = JSON.stringify(opts);
    if (!nf.has(k)) nf.set(k, new Intl.NumberFormat("it-IT", opts));
    return nf.get(k).format(v);
  }
  function formatGeneral(v) {
    if (Number.isInteger(v) && Math.abs(v) < 1e15) return fmtNum(v, { useGrouping: false });
    if (Math.abs(v) >= 1e11 || (Math.abs(v) < 1e-6 && v !== 0)) return v.toExponential(4).replace(".", ",");
    return fmtNum(v, { useGrouping: false, maximumSignificantDigits: 12 });
  }
  function formatValue(v, st) {
    if (v === null || v === undefined) return "";
    if (isErr(v)) return v.e;
    if (typeof v === "boolean") return v ? "VERO" : "FALSO";
    if (typeof v === "string") return v;
    const f = (st && st.fmt) || "general";
    const d = st && st.dec !== undefined ? st.dec : null;
    switch (f) {
      case "number": return fmtNum(v, { useGrouping: "always", minimumFractionDigits: d ?? 2, maximumFractionDigits: d ?? 2 });
      case "currency": return fmtNum(v, { style: "currency", currency: "EUR", useGrouping: "always", minimumFractionDigits: d ?? 2, maximumFractionDigits: d ?? 2 });
      case "percent": return fmtNum(v, { style: "percent", minimumFractionDigits: d ?? 0, maximumFractionDigits: d ?? 0 });
      case "date": { const x = serialToDate(v); return `${String(x.d).padStart(2, "0")}/${String(x.m).padStart(2, "0")}/${x.y}`; }
      case "datetime": { const x = serialToDate(v); return `${String(x.d).padStart(2, "0")}/${String(x.m).padStart(2, "0")}/${x.y} ${String(x.h).padStart(2, "0")}:${String(x.min).padStart(2, "0")}`; }
      default:
        if (d !== null) return fmtNum(v, { useGrouping: false, minimumFractionDigits: d, maximumFractionDigits: d });
        return formatGeneral(v);
    }
  }

  /* ---------- Modifica dei riferimenti ---------- */
  // Copia/incolla e trascinamento: sposta i riferimenti relativi
  function shiftFormula(formula, dr, dc) {
    if (typeof formula !== "string" || formula[0] !== "=") return formula;
    const toks = tokenize(formula.slice(1), "it");
    for (const t of toks) {
      if (t.t !== "ref") continue;
      if (!t.ra) t.r += dr;
      if (!t.ca) t.c += dc;
      if (t.r < 0 || t.c < 0) t.dead = true;
    }
    return "=" + rebuild(toks, "it");
  }
  // Inserimento o eliminazione di righe/colonne (count > 0 inserisce, < 0 elimina)
  function adjustStructure(formula, hostSheet, targetSheet, axis, at, count) {
    if (typeof formula !== "string" || formula[0] !== "=") return formula;
    const toks = tokenize(formula.slice(1), "it");
    const key = axis === "row" ? "r" : "c";
    const same = (t) => (t.sheet ? t.sheet.toLowerCase() === targetSheet.toLowerCase() : hostSheet.toLowerCase() === targetSheet.toLowerCase());
    let changed = false;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.t !== "ref" || !same(t)) continue;
      const isRange = toks[i + 1] && toks[i + 1].t === "op" && toks[i + 1].v === ":" && toks[i + 2] && toks[i + 2].t === "ref";
      if (count > 0) {
        if (t[key] >= at) { t[key] += count; changed = true; }
        if (isRange) { const b = toks[i + 2]; if (b[key] >= at) { b[key] += count; changed = true; } i += 2; }
        continue;
      }
      const n = -count, end = at + n - 1;
      const del = (x) => x >= at && x <= end;
      if (isRange) {
        const b = toks[i + 2];
        const lo = Math.min(t[key], b[key]), hi = Math.max(t[key], b[key]);
        const nlo = del(lo) ? at : lo > end ? lo - n : lo;
        const nhi = del(hi) ? at - 1 : hi > end ? hi - n : hi;
        if (nhi < nlo) { t.dead = true; toks[i + 1].t = "skip"; toks[i + 2].t = "skip"; toks[i + 2].pre = ""; }
        else { t[key] = nlo; b[key] = nhi; }
        changed = true; i += 2;
      } else {
        if (del(t[key])) { t.dead = true; changed = true; }
        else if (t[key] > end) { t[key] -= n; changed = true; }
      }
    }
    return changed ? "=" + rebuild(toks, "it") : formula;
  }
  // Rinomina di un foglio
  function renameSheetRefs(formula, oldName, newName) {
    if (typeof formula !== "string" || formula[0] !== "=") return formula;
    const toks = tokenize(formula.slice(1), "it");
    let changed = false;
    for (const t of toks) {
      if (t.t === "ref" && t.sheet && t.sheet.toLowerCase() === oldName.toLowerCase()) {
        t.sheet = newName;
        t.prefix = /^[\p{L}_][\p{L}\p{N}_.]*$/u.test(newName) ? newName + "!" : `'${newName.replace(/'/g, "''")}'!`;
        changed = true;
      }
    }
    return changed ? "=" + rebuild(toks, "it") : formula;
  }
  // Traduzione per i file .xlsx (che usano nomi inglesi, virgole e punti)
  function toEnglish(formula) { return rebuild(tokenize(formula.replace(/^=/, ""), "it"), "en"); }
  function toItalian(formula) { return "=" + rebuild(tokenize(formula.replace(/^=/, ""), "en"), "it"); }

  function recalc(book) {
    const calc = new Calc(book);
    return { get: (si, r, c) => calc.get(si, r, c), calc };
  }

  const FUNCTION_HELP = {
    SOMMA: "Somma i numeri. SOMMA(A1:A10)",
    MEDIA: "Media dei numeri. MEDIA(A1:A10)",
    MIN: "Il valore più piccolo. MIN(A1:A10)",
    MAX: "Il valore più grande. MAX(A1:A10)",
    "CONTA.NUMERI": "Quante celle contengono numeri",
    "CONTA.VALORI": "Quante celle non sono vuote",
    "CONTA.SE": "Conta le celle che rispettano un criterio. CONTA.SE(A1:A10; \">5\")",
    "SOMMA.SE": "Somma le celle che rispettano un criterio. SOMMA.SE(A1:A10; \"Roma\"; B1:B10)",
    "MEDIA.SE": "Media delle celle che rispettano un criterio",
    "SOMMA.PIÙ.SE": "Somma con più criteri",
    "CONTA.PIÙ.SE": "Conta con più criteri",
    SE: "Sceglie in base a una condizione. SE(A1>10; \"alto\"; \"basso\")",
    "SE.ERRORE": "Valore alternativo in caso di errore",
    E: "VERO se tutte le condizioni sono vere",
    O: "VERO se almeno una condizione è vera",
    NON: "Inverte VERO e FALSO",
    ARROTONDA: "Arrotonda. ARROTONDA(A1; 2)",
    "ARROTONDA.PER.ECC": "Arrotonda per eccesso",
    "ARROTONDA.PER.DIF": "Arrotonda per difetto",
    INT: "Parte intera",
    ASS: "Valore assoluto",
    RADQ: "Radice quadrata",
    POTENZA: "Elevamento a potenza",
    RESTO: "Resto della divisione",
    PRODOTTO: "Moltiplica i numeri",
    MEDIANA: "Valore centrale",
    "PI.GRECO": "3,14159…",
    CASUALE: "Numero casuale tra 0 e 1",
    "CASUALE.TRA": "Intero casuale tra due valori",
    OGGI: "La data di oggi",
    ADESSO: "Data e ora attuali",
    DATA: "Crea una data. DATA(2026; 11; 19)",
    ANNO: "Anno di una data",
    MESE: "Mese di una data",
    GIORNO: "Giorno di una data",
    GIORNI: "Giorni tra due date. GIORNI(fine; inizio)",
    CONCATENA: "Unisce testi",
    LUNGHEZZA: "Numero di caratteri",
    MAIUSC: "Testo in maiuscolo",
    MINUSC: "Testo in minuscolo",
    SINISTRA: "Primi caratteri a sinistra",
    DESTRA: "Ultimi caratteri a destra",
    "STRINGA.ESTRAI": "Estrae caratteri dal mezzo",
    "ANNULLA.SPAZI": "Toglie gli spazi in più",
    VALORE: "Converte un testo in numero",
    "CERCA.VERT": "Cerca in verticale. CERCA.VERT(valore; A1:C10; 2; FALSO)",
    "CERCA.ORIZZ": "Cerca in orizzontale",
    INDICE: "Valore in una posizione. INDICE(A1:C10; riga; colonna)",
    CONFRONTA: "Posizione di un valore. CONFRONTA(valore; A1:A10; 0)",
    "VAL.VUOTO": "VERO se la cella è vuota",
    "VAL.NUMERO": "VERO se è un numero",
    "VAL.TESTO": "VERO se è un testo",
    "VAL.ERRORE": "VERO se è un errore",
  };

  window.Engine = {
    colName, colIndex, addr, parseAddr, isErr, parseInput, parseNumber, formatValue, formatGeneral,
    recalc, shiftFormula, adjustStructure, renameSheetRefs, toEnglish, toItalian, tokenize,
    serialToDate, dateToSerial, FUNCTION_HELP, FUNCTIONS: Object.keys(FN),
  };
})();
