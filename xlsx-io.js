/* Excel — lettura e scrittura dei file .xlsx (con ExcelJS) */
(function () {
  "use strict";
  const En = window.Engine;
  const EPOCH = Date.UTC(1899, 11, 30);
  const ERR_EN = { "#DIV/0!": "#DIV/0!", "#VALORE!": "#VALUE!", "#RIF!": "#REF!", "#NOME?": "#NAME?", "#N/D": "#N/A", "#NUM!": "#NUM!", "#CIRC!": "#VALUE!", "#ERRORE!": "#VALUE!" };
  const ERR_IT = { "#VALUE!": "#VALORE!", "#REF!": "#RIF!", "#NAME?": "#NOME?", "#N/A": "#N/D" };

  const argb = (hex) => "FF" + hex.replace("#", "").toUpperCase().padStart(6, "0").slice(0, 6);
  const fromArgb = (a) => (a && /^[0-9A-F]{8}$/i.test(a) ? "#" + a.slice(2).toLowerCase() : null);

  function numFmt(st) {
    const d = st.dec;
    const zeros = (n) => (n > 0 ? "." + "0".repeat(n) : "");
    switch (st.fmt) {
      case "number": return "#,##0" + zeros(d ?? 2);
      case "currency": return "#,##0" + zeros(d ?? 2) + ' "€"';
      case "percent": return "0" + zeros(d ?? 0) + "%";
      case "date": return "dd/mm/yyyy";
      case "datetime": return "dd/mm/yyyy hh:mm";
      case "text": return "@";
      default: return d !== undefined ? "0" + zeros(d) : null;
    }
  }
  function fmtFromNumFmt(f) {
    if (!f || f === "General") return {};
    if (f === "@") return { fmt: "text" };
    const dec = ((/0\.(0+)/.exec(f) || [])[1] || "").length;
    if (/%/.test(f)) return { fmt: "percent", dec };
    if (/€|\[\$€|EUR/.test(f)) return { fmt: "currency", dec };
    if (/[dmy]{1,4}/i.test(f.replace(/"[^"]*"/g, ""))) return { fmt: /h/i.test(f) ? "datetime" : "date" };
    if (/#,##0/.test(f)) return { fmt: "number", dec };
    if (/^0(\.0+)?$/.test(f)) return { dec };
    return {};
  }

  async function write(book, calc, title) {
    const wb = new window.ExcelJS.Workbook();
    wb.creator = "Excel";
    wb.title = title || "";
    // Nomi dei fogli validi per i file .xlsx: al massimo 31 caratteri, niente * ? : \ / [ ], tutti diversi
    const used = new Set();
    const names = book.sheets.map((s, i) => {
      const base = (s.name.replace(/[*?:\\/[\]]/g, "-").replace(/^'+|'+$/g, "").trim() || "Foglio" + (i + 1)).slice(0, 31);
      let n = base, k = 2;
      while (used.has(n.toLowerCase())) { const suf = " (" + k++ + ")"; n = base.slice(0, 31 - suf.length) + suf; }
      used.add(n.toLowerCase());
      return n;
    });
    const fixRefs = (f) => book.sheets.reduce((acc, s, i) => (s.name !== names[i] ? En.renameSheetRefs(acc, s.name, names[i]) : acc), f);
    book.sheets.forEach((s, si) => {
      const views = (s.freezeRow || s.freezeCol) ? [{ state: "frozen", xSplit: s.freezeCol ? 1 : 0, ySplit: s.freezeRow ? 1 : 0 }] : [];
      const ws = wb.addWorksheet(names[si], { views });
      let maxC = 0;
      for (const [k, cell] of Object.entries(s.cells)) {
        const p = En.parseAddr(k);
        if (!p) continue;
        maxC = Math.max(maxC, p.c);
        const xc = ws.getCell(p.r + 1, p.c + 1);
        const st = cell.s || {};
        const raw = cell.v;
        if (raw !== undefined && raw !== "") {
          if (typeof raw === "string" && raw[0] === "=" && raw.length > 1) {
            let result = calc.get(si, p.r, p.c);
            if (En.isErr(result)) result = { error: ERR_EN[result.e] || "#VALUE!" };
            xc.value = { formula: En.toEnglish(fixRefs(raw)), result: result === null ? undefined : result };
          } else if (st.fmt === "text" && typeof raw === "string") {
            xc.value = raw;
          } else {
            const v = En.parseInput(raw).value;
            xc.value = v === null ? null : v;
          }
        }
        const font = {};
        if (st.b) font.bold = true;
        if (st.i) font.italic = true;
        if (st.u) font.underline = true;
        if (st.st) font.strike = true;
        if (st.color) font.color = { argb: argb(st.color) };
        if (st.size) font.size = st.size;
        if (Object.keys(font).length) xc.font = { name: "Calibri", size: 11, ...font };
        if (st.fill) xc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(st.fill) } };
        if (st.align || st.wrap) xc.alignment = { horizontal: st.align, wrapText: !!st.wrap, vertical: st.wrap ? "top" : "bottom" };
        const nf = numFmt(st);
        if (nf) xc.numFmt = nf;
        if (st.bd) {
          const b = {};
          for (const [side, key] of [["t", "top"], ["b", "bottom"], ["l", "left"], ["r", "right"]]) {
            if (st.bd[side]) b[key] = { style: st.bd[side] === "thick" ? "medium" : "thin", color: { argb: "FF000000" } };
          }
          xc.border = b;
        }
      }
      for (let c = 0; c <= Math.max(maxC, ...Object.keys(s.colW).map(Number)); c++) {
        ws.getColumn(c + 1).width = Math.round(((s.colW[c] || 100) / 7) * 10) / 10;
      }
    });
    return wb.xlsx.writeBuffer();
  }

  function readValue(cell) {
    const v = cell.value;
    if (v === null || v === undefined) return undefined;
    if (typeof v === "number" || typeof v === "boolean") return v;
    if (v instanceof Date) return (v.getTime() - EPOCH) / 86400000;
    if (typeof v === "string") {
      // un testo che sembrerebbe un numero o una data resta testo
      const p = En.parseInput(v);
      return typeof p.value === "string" || p.value === null ? v : "'" + v;
    }
    if (typeof v === "object") {
      const f = cell.formula || v.formula;
      if (f) return En.toItalian(f);
      if ("result" in v && v.result !== undefined) return readValue({ value: v.result });
      if (v.richText) return v.richText.map((t) => t.text).join("");
      if (v.text !== undefined) return typeof v.text === "string" ? v.text : (v.text.richText || []).map((t) => t.text).join("");
      if (v.error) return ERR_IT[v.error] || v.error;
    }
    return String(v);
  }

  async function read(buffer) {
    const wb = new window.ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheets = [];
    wb.worksheets.forEach((ws) => {
      const s = { name: ws.name, cells: {}, nRows: Math.max(200, ws.rowCount + 50), nCols: Math.max(26, ws.columnCount + 2), colW: {}, freezeRow: false, freezeCol: false };
      ws.eachRow({ includeEmpty: false }, (row, rn) => {
        row.eachCell({ includeEmpty: false }, (xc, cn) => {
          const k = En.addr(rn - 1, cn - 1);
          const cell = {};
          const raw = readValue(xc);
          if (raw !== undefined) cell.v = raw;
          const st = {};
          const font = xc.font || {};
          if (font.bold) st.b = true;
          if (font.italic) st.i = true;
          if (font.underline) st.u = true;
          if (font.strike) st.st = true;
          const fc = fromArgb(font.color && font.color.argb);
          if (fc && fc !== "#000000") st.color = fc;
          if (font.size && font.size !== 11) st.size = font.size;
          const fill = xc.fill;
          if (fill && fill.type === "pattern" && fill.pattern === "solid") { const c = fromArgb(fill.fgColor && fill.fgColor.argb); if (c && c !== "#ffffff") st.fill = c; }
          const al = xc.alignment || {};
          if (["left", "center", "right"].includes(al.horizontal)) st.align = al.horizontal;
          if (al.wrapText) st.wrap = true;
          Object.assign(st, fmtFromNumFmt(xc.numFmt));
          if (xc.value instanceof Date && !st.fmt) st.fmt = "date";
          const bd = {};
          const border = xc.border || {};
          for (const [side, key] of [["t", "top"], ["b", "bottom"], ["l", "left"], ["r", "right"]]) {
            const b = border[key];
            if (b && b.style) bd[side] = /medium|thick|double/.test(b.style) ? "thick" : "thin";
          }
          if (Object.keys(bd).length) st.bd = bd;
          for (const key of Object.keys(st)) if (st[key] === undefined) delete st[key];
          if (Object.keys(st).length) cell.s = st;
          if (cell.v !== undefined || cell.s) s.cells[k] = cell;
        });
      });
      for (let c = 1; c <= ws.columnCount; c++) {
        const w = ws.getColumn(c).width;
        if (w) s.colW[c - 1] = Math.round(w * 7);
      }
      const view = (ws.views || [])[0];
      if (view && view.state === "frozen") { s.freezeRow = (view.ySplit || 0) >= 1; s.freezeCol = (view.xSplit || 0) >= 1; }
      sheets.push(s);
    });
    if (!sheets.length) throw new Error("il file non contiene fogli");
    return { sheets, active: 0 };
  }

  window.XlsxIO = { write, read };
})();
