/* Foglio — foglio di calcolo */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const En = window.Engine;
  const { addr, colName } = En;
  const STORE = "foglio.cartella", PREFS = "foglio.preferenze";
  const NATIVE = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.foglio;
  const DEF_W = 100, HEAD_W = 46;

  const wrap = $("wrap"), gridEl = $("grid"), selBox = $("selBox"), handle = $("fillHandle");
  const editorEl = $("cellEditor"), fbar = $("formulaInput"), nameBox = $("nameBox"), titleEl = $("title");

  /* ---------- Utilità ---------- */
  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), ms);
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(PREFS) || "{}") || {}; } catch (e) { prefs = {}; }
  const savePrefs = () => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch (e) { /* ignoro */ } };

  /* ---------- Dati ---------- */
  const newSheet = (name) => ({ name, cells: {}, nRows: 200, nCols: 26, colW: {}, freezeRow: false, freezeCol: false });
  let book = { sheets: [newSheet("Foglio1")], active: 0 };
  let calc = En.recalc(book);
  const sheet = () => book.sheets[book.active];
  const cellAt = (r, c, s = sheet()) => s.cells[addr(r, c)];

  /* ---------- Annulla / ripeti ---------- */
  const undoStack = [], redoStack = [];
  function snapshot() {
    undoStack.push(JSON.stringify(book));
    if (undoStack.length > 80) undoStack.shift();
    redoStack.length = 0;
  }
  function restore(json) {
    const keepSel = { ...sel };
    book = JSON.parse(json);
    renderAll();
    select(Math.min(keepSel.ar, sheet().nRows - 1), Math.min(keepSel.ac, sheet().nCols - 1));
    changed(false);
  }
  function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(book)); restore(undoStack.pop()); }
  function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(book)); restore(redoStack.pop()); }

  /* ---------- Salvataggio automatico ---------- */
  let saveTimer;
  function changed(recalc = true) {
    if (recalc) { calc = En.recalc(book); paintAll(); }
    $("saveState").textContent = "Modifiche non salvate…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 600);
    updateStats();
  }
  function persist() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ title: titleEl.value, book }));
      $("saveState").textContent = "Salvato su questo dispositivo";
    } catch (e) {
      $("saveState").textContent = "Non salvato: cartella troppo grande, scaricala in .xlsx";
    }
  }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE) || "null");
      if (d && d.book && Array.isArray(d.book.sheets) && d.book.sheets.length) {
        book = d.book; titleEl.value = d.title || "Cartella senza titolo";
        book.active = Math.min(book.active || 0, book.sheets.length - 1);
        $("saveState").textContent = "Salvato su questo dispositivo";
        return;
      }
    } catch (e) { /* ignoro */ }
    // esempio iniziale
    const s = book.sheets[0];
    const put = (a, v, st) => { s.cells[a] = { v }; if (st) s.cells[a].s = st; };
    put("A1", "Spese di novembre", { b: true, size: 14 });
    put("A3", "Voce", { b: true, fill: "#dcefe3", bd: { b: "thin" } });
    put("B3", "Importo", { b: true, fill: "#dcefe3", bd: { b: "thin" }, align: "right" });
    put("A4", "Affitto"); put("B4", "650", { fmt: "currency" });
    put("A5", "Spesa"); put("B5", "320,40", { fmt: "currency" });
    put("A6", "Bollette"); put("B6", "95,90", { fmt: "currency" });
    put("A7", "Totale", { b: true, bd: { t: "thin" } }); put("B7", "=SOMMA(B4:B6)", { b: true, fmt: "currency", bd: { t: "thin" } });
    put("A9", "Scrivi nelle celle, usa formule come =SOMMA(B4:B6) e scarica il file .xlsx quando hai finito.", { i: true, color: "#5f6862" });
    s.colW = { 0: 150, 1: 110 };
    titleEl.value = "Benvenuto in Foglio";
  }

  /* ---------- Disegno della griglia ---------- */
  let painted = new Set();
  function colW(c) { return sheet().colW[c] || DEF_W; }
  function renderAll() {
    const s = sheet();
    const parts = ['<colgroup><col style="width:' + HEAD_W + 'px">'];
    for (let c = 0; c < s.nCols; c++) parts.push(`<col style="width:${colW(c)}px">`);
    parts.push('</colgroup><thead><tr><th class="corner"></th>');
    for (let c = 0; c < s.nCols; c++) parts.push(`<th data-c="${c}">${colName(c)}<span class="rs" data-rs="${c}"></span></th>`);
    parts.push("</tr></thead><tbody>");
    const row = "<td></td>".repeat(s.nCols);
    for (let r = 0; r < s.nRows; r++) parts.push(`<tr><th data-r="${r}">${r + 1}</th>${row}</tr>`);
    parts.push("</tbody>");
    gridEl.innerHTML = parts.join("");
    fitTableWidth();
    gridEl.classList.toggle("freeze-row", !!s.freezeRow);
    gridEl.classList.toggle("freeze-col", !!s.freezeCol);
    $("btnFreezeRow").classList.toggle("on", !!s.freezeRow);
    $("btnFreezeCol").classList.toggle("on", !!s.freezeCol);
    painted = new Set();
    calc = En.recalc(book);
    paintAll();
    renderTabs();
  }
  function fitTableWidth() {
    let w = HEAD_W;
    for (let c = 0; c < sheet().nCols; c++) w += colW(c);
    gridEl.style.width = w + "px";
  }
  // testo scuro sui colori chiari e viceversa
  function inkFor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return null;
    const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#1b1f1c" : "#ffffff";
  }
  const tdAt = (r, c) => { const tr = gridEl.tBodies[0] && gridEl.tBodies[0].rows[r]; return tr ? tr.cells[c + 1] : null; };

  function paintAll() {
    const s = sheet();
    const keys = new Set(Object.keys(s.cells));
    for (const k of painted) keys.add(k);
    const next = new Set();
    for (const k of keys) {
      const p = En.parseAddr(k);
      if (!p || p.r >= s.nRows || p.c >= s.nCols) continue;
      if (paintCell(p.r, p.c)) next.add(k);
      if (p.c > 0 && !keys.has(addr(p.r, p.c - 1)) && s.cells[addr(p.r, p.c - 1)]) paintCell(p.r, p.c - 1);
    }
    painted = next;
    drawSelection();
  }

  let showFormulas = false;
  function paintCell(r, c) {
    const td = tdAt(r, c);
    if (!td) return false;
    const s = sheet();
    const cell = s.cells[addr(r, c)];
    td.className = "";
    td.removeAttribute("style");
    if (!cell) { td.textContent = ""; return false; }
    const st = cell.s || {};
    const raw = cell.v;
    const val = raw === undefined || raw === "" ? null : calc.get(book.active, r, c);
    let text;
    if (showFormulas && typeof raw === "string" && raw[0] === "=") { text = raw; td.classList.add("formula-view"); }
    else text = st.fmt === "text" && typeof raw === "string" ? raw : En.formatValue(val, st);
    td.textContent = text;
    if (En.isErr(val)) td.classList.add("err");
    else if (!st.align) {
      if (typeof val === "number" && st.fmt !== "text") td.classList.add("num");
      else if (typeof val === "boolean") td.classList.add("ctr");
    }
    if (st.wrap) td.classList.add("wrap");
    const css = td.style;
    if (st.align) css.textAlign = st.align;
    if (st.b) css.fontWeight = "700";
    if (st.i) css.fontStyle = "italic";
    if (st.u || st.st) css.textDecoration = [st.u ? "underline" : "", st.st ? "line-through" : ""].join(" ").trim();
    if (st.color) css.color = st.color;
    if (st.fill) { css.background = st.fill; if (!st.color) css.color = inkFor(st.fill); }
    // il testo lungo prosegue nelle celle vuote a destra
    if (text && !st.wrap && !td.classList.contains("num") && !td.classList.contains("ctr") && (!st.align || st.align === "left")) {
      const right = s.cells[addr(r, c + 1)];
      if (!right || right.v === undefined || right.v === "") td.classList.add("ovf");
    }
    if (st.size) css.fontSize = st.size + "pt";
    if (st.bd) {
      const sh = [], w = (k) => (st.bd[k] === "thick" ? 2 : 1), col = "var(--cell-ink)";
      if (st.bd.t) sh.push(`inset 0 ${w("t")}px 0 ${col}`);
      if (st.bd.b) sh.push(`inset 0 -${w("b")}px 0 ${col}`);
      if (st.bd.l) sh.push(`inset ${w("l")}px 0 0 ${col}`);
      if (st.bd.r) sh.push(`inset -${w("r")}px 0 0 ${col}`);
      if (sh.length) css.boxShadow = sh.join(",");
    }
    return true;
  }

  /* ---------- Selezione ---------- */
  const sel = { ar: 0, ac: 0, r1: 0, c1: 0, r2: 0, c2: 0 };
  function setRange(ar, ac, br, bc) {
    const s = sheet();
    ar = clamp(ar, 0, s.nRows - 1); br = clamp(br, 0, s.nRows - 1);
    ac = clamp(ac, 0, s.nCols - 1); bc = clamp(bc, 0, s.nCols - 1);
    sel.r1 = Math.min(ar, br); sel.r2 = Math.max(ar, br);
    sel.c1 = Math.min(ac, bc); sel.c2 = Math.max(ac, bc);
    drawSelection();
    updateBar();
    updateStats();
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function select(r, c, extendTo) {
    const s = sheet();
    r = clamp(r, 0, s.nRows - 1); c = clamp(c, 0, s.nCols - 1);
    if (extendTo) { setRange(sel.ar, sel.ac, r, c); return; }
    sel.ar = r; sel.ac = c;
    setRange(r, c, r, c);
    scrollIntoView(r, c);
  }
  function rectOf(r1, c1, r2, c2) {
    const a = tdAt(r1, c1), b = tdAt(r2, c2);
    if (!a || !b) return null;
    const w = wrap.getBoundingClientRect(), ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return {
      left: ra.left - w.left + wrap.scrollLeft, top: ra.top - w.top + wrap.scrollTop,
      width: rb.right - ra.left, height: rb.bottom - ra.top,
    };
  }
  function drawSelection() {
    const r = rectOf(sel.r1, sel.c1, sel.r2, sel.c2);
    if (!r) return;
    Object.assign(selBox.style, { left: r.left - 1 + "px", top: r.top - 1 + "px", width: r.width + 1 + "px", height: r.height + 1 + "px" });
    selBox.classList.toggle("single", sel.r1 === sel.r2 && sel.c1 === sel.c2);
    Object.assign(handle.style, { left: r.left + r.width - 5 + "px", top: r.top + r.height - 5 + "px" });
    handle.hidden = editing;
    $$("th.on", gridEl).forEach((th) => th.classList.remove("on"));
    const head = gridEl.tHead.rows[0];
    for (let c = sel.c1; c <= sel.c2; c++) head.cells[c + 1] && head.cells[c + 1].classList.add("on");
    const body = gridEl.tBodies[0];
    for (let rr = sel.r1; rr <= sel.r2 && rr - sel.r1 < 2000; rr++) body.rows[rr] && body.rows[rr].cells[0].classList.add("on");
  }
  function scrollIntoView(r, c) {
    const td = tdAt(r, c);
    if (!td) return;
    const w = wrap.getBoundingClientRect(), t = td.getBoundingClientRect();
    const headH = gridEl.tHead.getBoundingClientRect().height, headW = HEAD_W * zoomK();
    if (t.top < w.top + headH) wrap.scrollTop -= w.top + headH - t.top;
    else if (t.bottom > w.bottom - 14) wrap.scrollTop += t.bottom - w.bottom + 14;
    if (t.left < w.left + headW) wrap.scrollLeft -= w.left + headW - t.left;
    else if (t.right > w.right - 14) wrap.scrollLeft += t.right - w.right + 14;
  }
  function updateBar() {
    nameBox.value = sel.r1 === sel.r2 && sel.c1 === sel.c2 ? addr(sel.ar, sel.ac) : `${addr(sel.r1, sel.c1)}:${addr(sel.r2, sel.c2)}`;
    if (!editing) {
      const cell = cellAt(sel.ar, sel.ac);
      fbar.value = cell && cell.v !== undefined ? rawForEdit(cell) : "";
    }
    refreshRibbon();
  }
  function rawForEdit(cell) {
    const v = cell.v;
    const st0 = cell.s || {};
    if (typeof v === "number") {
      if (st0.fmt === "date" || st0.fmt === "datetime") return En.formatValue(v, { fmt: st0.fmt });
      if (st0.fmt === "percent") return String(+(v * 100).toPrecision(15)).replace(".", ",") + "%";
      return String(v).replace(".", ",");
    }
    if (typeof v === "boolean") return v ? "VERO" : "FALSO";
    if (typeof v !== "string") return v === null || v === undefined ? "" : String(v);
    if (v[0] === "=") return v;
    const st = cell.s || {};
    // le date si modificano come data, le percentuali come percentuale
    const p = En.parseInput(v);
    if (typeof p.value === "number" && (st.fmt === "date" || st.fmt === "datetime") && p.hint !== "date") return En.formatValue(p.value, { fmt: "date" });
    return v;
  }
  function refreshRibbon() {
    const st = (cellAt(sel.ar, sel.ac) || {}).s || {};
    $$("[data-style]").forEach((b) => b.classList.toggle("on", !!st[b.dataset.style]));
    $$("[data-align]").forEach((b) => b.classList.toggle("on", st.align === b.dataset.align));
    $("btnWrap").classList.toggle("on", !!st.wrap);
    $("numFmt").value = st.fmt || "general";
    $("fontSize").value = String(st.size || 11);
  }
  function forEachSel(fn) {
    for (let r = sel.r1; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++) fn(r, c);
  }
  // Limita le selezioni di righe/colonne intere all'area usata (per non creare migliaia di celle)
  function usedBounds(s = sheet()) {
    let mr = -1, mc = -1;
    for (const k of Object.keys(s.cells)) { const p = En.parseAddr(k); if (p) { mr = Math.max(mr, p.r); mc = Math.max(mc, p.c); } }
    return { mr, mc };
  }

  /* ---------- Statistiche della selezione ---------- */
  function updateStats() {
    const out = $("selStats");
    if (sel.r1 === sel.r2 && sel.c1 === sel.c2) { out.textContent = ""; return; }
    let sum = 0, n = 0, cnt = 0;
    const { mr, mc } = usedBounds();
    for (let r = sel.r1; r <= Math.min(sel.r2, mr); r++) for (let c = sel.c1; c <= Math.min(sel.c2, mc); c++) {
      const v = calc.get(book.active, r, c);
      if (v !== null && v !== "") cnt++;
      if (typeof v === "number") { sum += v; n++; }
    }
    const f = (x) => En.formatValue(x, { fmt: "number", dec: Number.isInteger(x) ? 0 : 2 });
    out.textContent = n ? `Media: ${f(sum / n)}   Conteggio: ${cnt}   Somma: ${f(sum)}` : cnt ? `Conteggio: ${cnt}` : "";
  }

  /* ---------- Scrittura nelle celle ---------- */
  function setRaw(r, c, raw, s = sheet()) {
    const k = addr(r, c);
    const cell = s.cells[k] || {};
    if (raw === "" || raw === null || raw === undefined) {
      delete cell.v;
      if (!cell.s) { delete s.cells[k]; return; }
    } else {
      cell.v = raw;
      const p = En.parseInput(raw);
      if (p.hint && p.hint !== "text" && !(cell.s && cell.s.fmt)) cell.s = { ...(cell.s || {}), fmt: p.hint };
    }
    s.cells[k] = cell;
  }
  function styleSel(fn) {
    snapshot();
    const { mr, mc } = usedBounds();
    const full = sel.r2 - sel.r1 > 500 || sel.c2 - sel.c1 > 100;
    forEachSel((r, c) => {
      if (full && (r > mr || c > mc)) return;
      const k = addr(r, c);
      const cell = sheet().cells[k] || {};
      cell.s = cell.s || {};
      fn(cell.s, r, c);
      for (const key of Object.keys(cell.s)) if (cell.s[key] === undefined || cell.s[key] === false || cell.s[key] === null) delete cell.s[key];
      if (!Object.keys(cell.s).length) delete cell.s;
      if (cell.v === undefined && !cell.s) delete sheet().cells[k];
      else sheet().cells[k] = cell;
    });
    changed();
    refreshRibbon();
  }

  /* ---------- Modifica di una cella ---------- */
  let editing = false, editFromBar = false, refMode = null;
  function startEdit(initial, fromBar = false) {
    const td = tdAt(sel.ar, sel.ac);
    if (!td) return;
    editing = true; editFromBar = fromBar;
    const cell = cellAt(sel.ar, sel.ac);
    editorEl.value = initial !== undefined ? initial : cell ? rawForEdit(cell) : "";
    fbar.value = editorEl.value;
    placeEditor();
    editorEl.hidden = false;
    handle.hidden = true;
    if (!fromBar) { editorEl.focus(); editorEl.setSelectionRange(editorEl.value.length, editorEl.value.length); }
  }
  function placeEditor() {
    const r = rectOf(sel.ar, sel.ac, sel.ar, sel.ac);
    if (!r) return;
    const st = (cellAt(sel.ar, sel.ac) || {}).s || {};
    editorEl.style.fontSize = (st.size || 11) * zoomK() + "pt";
    editorEl.style.fontWeight = st.b ? "700" : "400";
    editorEl.style.left = r.left - 1 + "px";
    editorEl.style.top = r.top - 1 + "px";
    editorEl.style.minWidth = r.width + 2 + "px";
    editorEl.style.width = r.width + 2 + "px";
    editorEl.style.height = Math.max(r.height + 2, 26) + "px";
    autosizeEditor();
  }
  function autosizeEditor() {
    editorEl.style.width = "0px";
    const min = parseFloat(editorEl.style.minWidth) || 100;
    editorEl.style.width = Math.min(Math.max(min, editorEl.scrollWidth + 12), wrap.clientWidth - 40) + "px";
    editorEl.style.height = "0px";
    editorEl.style.height = Math.max(editorEl.scrollHeight + 4, 26) + "px";
  }
  function commitEdit(moveR = 0, moveC = 0) {
    if (!editing) return;
    const val = editorEl.value;
    editing = false; refMode = null;
    editorEl.hidden = true;
    clearRefHints();
    const cell = cellAt(sel.ar, sel.ac);
    const old = cell && cell.v !== undefined ? rawForEdit(cell) : "";
    if (val !== old) {
      snapshot();
      let v = val;
      // =somma(a1:a3) → =SOMMA(A1:A3)
      if (v[0] === "=") v = "=" + En.tokenize(v.slice(1)).map((t) => (t.pre || "") + (t.t === "fn" ? t.text.toUpperCase() : t.t === "ref" ? (t.prefix || "") + (t.ca ? "$" : "") + colName(t.c) + (t.ra ? "$" : "") + (t.r + 1) : t.text || "")).join("") ;
      setRaw(sel.ar, sel.ac, v);
      changed();
    }
    wrap.focus({ preventScroll: true });
    if (moveR || moveC) select(sel.ar + moveR, sel.ac + moveC);
    else updateBar();
    handle.hidden = false;
  }
  function cancelEdit() {
    editing = false; refMode = null;
    editorEl.hidden = true;
    clearRefHints();
    handle.hidden = false;
    wrap.focus({ preventScroll: true });
    updateBar();
  }
  const isFormulaEdit = () => editing && editorEl.value.trim()[0] === "=";
  // Durante la scrittura di una formula, un clic su una cella inserisce il riferimento
  function canInsertRef() {
    if (!isFormulaEdit()) return false;
    const el = editFromBar ? fbar : editorEl;
    const before = el.value.slice(0, el.selectionStart).trimEnd();
    return /[=(;,+\-*/^&<>:]$/.test(before) || refMode !== null;
  }
  function insertRef(r1, c1, r2, c2) {
    const el = editFromBar ? fbar : editorEl;
    const ref = r1 === r2 && c1 === c2 ? addr(r1, c1) : `${addr(Math.min(r1, r2), Math.min(c1, c2))}:${addr(Math.max(r1, r2), Math.max(c1, c2))}`;
    if (!refMode) refMode = { start: el.selectionStart, len: 0 };
    const v = el.value;
    el.value = v.slice(0, refMode.start) + ref + v.slice(refMode.start + refMode.len);
    refMode.len = ref.length;
    const pos = refMode.start + ref.length;
    el.setSelectionRange(pos, pos);
    (editFromBar ? editorEl : fbar).value = el.value;
    autosizeEditor();
    showRefHints();
  }
  let hints = [];
  function clearRefHints() { hints.forEach((h) => h.remove()); hints = []; }
  function showRefHints() {
    clearRefHints();
    if (!isFormulaEdit()) return;
    const toks = En.tokenize(editorEl.value.trim().slice(1));
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.t !== "ref" || t.sheet) continue;
      let r2 = t.r, c2 = t.c;
      if (toks[i + 1] && toks[i + 1].v === ":" && toks[i + 2] && toks[i + 2].t === "ref") { r2 = toks[i + 2].r; c2 = toks[i + 2].c; i += 2; }
      const rc = rectOf(Math.min(t.r, r2), Math.min(t.c, c2), Math.max(t.r, r2), Math.max(t.c, c2));
      if (!rc) continue;
      const d = document.createElement("div");
      d.className = "ref-hint";
      Object.assign(d.style, { left: rc.left - 1 + "px", top: rc.top - 1 + "px", width: rc.width + 1 + "px", height: rc.height + 1 + "px" });
      wrap.appendChild(d); hints.push(d);
    }
  }

  editorEl.addEventListener("input", () => { refMode = null; fbar.value = editorEl.value; autosizeEditor(); showRefHints(); });
  editorEl.addEventListener("keydown", (e) => {
    e.stopPropagation(); // i tasti dell'editor non devono arrivare alla griglia
    if ((e.metaKey || e.ctrlKey) && ["s", "o", "f", "p"].includes(e.key.toLowerCase())) { commitEdit(); document.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey })); e.preventDefault(); return; }
    if (e.key === "Enter" && (e.altKey || e.ctrlKey)) {
      e.preventDefault();
      const p = editorEl.selectionStart;
      editorEl.setRangeText("\n", p, editorEl.selectionEnd, "end");
      editorEl.dispatchEvent(new Event("input"));
      return;
    }
    if (e.key === "Enter") { e.preventDefault(); commitEdit(e.shiftKey ? -1 : 1, 0); return; }
    if (e.key === "Tab") { e.preventDefault(); commitEdit(0, e.shiftKey ? -1 : 1); return; }
    if (e.key === "Escape") { e.preventDefault(); cancelEdit(); return; }
    // in una formula, le frecce scelgono una cella da inserire
    if (canInsertRef() && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && editorEl.selectionStart === editorEl.value.length) {
      e.preventDefault();
      const cur = refMode && refMode.cursor ? refMode.cursor : { r: sel.ar, c: sel.ac };
      const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      const nr = clamp(cur.r + d[0], 0, sheet().nRows - 1), nc = clamp(cur.c + d[1], 0, sheet().nCols - 1);
      insertRef(nr, nc, nr, nc);
      refMode.cursor = { r: nr, c: nc };
      return;
    }
    if (!["Shift", "Alt", "Meta", "Control"].includes(e.key)) refMode = null;
  });
  editorEl.addEventListener("blur", () => {
    // il clic su una cella durante una formula non deve chiudere la modifica
    setTimeout(() => { if (editing && !editFromBar && document.activeElement !== editorEl && document.activeElement !== fbar && !pointerSelecting) commitEdit(); }, 0);
  });

  fbar.addEventListener("focus", () => { if (!editing) startEdit(undefined, true); else editFromBar = true; });
  fbar.addEventListener("input", () => { refMode = null; if (!editing) startEdit(fbar.value, true); editorEl.value = fbar.value; autosizeEditor(); showRefHints(); });
  fbar.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); editorEl.value = fbar.value; commitEdit(1, 0); }
    else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
    else if (e.key === "Tab") { e.preventDefault(); editorEl.value = fbar.value; commitEdit(0, 1); }
  });
  fbar.addEventListener("blur", () => { setTimeout(() => { if (editing && editFromBar && document.activeElement !== fbar && !pointerSelecting) { editorEl.value = fbar.value; commitEdit(); } }, 0); });

  nameBox.addEventListener("focus", () => nameBox.select());
  nameBox.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { updateBar(); wrap.focus(); return; }
    if (e.key !== "Enter") return;
    e.preventDefault();
    const [a, b] = nameBox.value.toUpperCase().split(":");
    const pa = En.parseAddr(a || ""), pb = b ? En.parseAddr(b) : null;
    if (!pa) { toast("Indirizzo non valido: scrivi per esempio B7 o A1:C10"); return; }
    ensureSize(Math.max(pa.r, pb ? pb.r : 0) + 1, Math.max(pa.c, pb ? pb.c : 0) + 1);
    select(pa.r, pa.c);
    if (pb) setRange(pa.r, pa.c, pb.r, pb.c);
    wrap.focus();
  });
  function ensureSize(rows, cols) {
    const s = sheet();
    if (rows <= s.nRows && cols <= s.nCols) return;
    s.nRows = Math.max(s.nRows, rows); s.nCols = Math.max(s.nCols, cols);
    renderAll();
  }

  /* ---------- Mouse sulla griglia ---------- */
  let pointerSelecting = false, dragMode = null;
  function cellFromEvent(e) {
    const td = e.target.closest && e.target.closest("td");
    if (!td || !gridEl.contains(td)) return null;
    return { r: td.parentElement.rowIndex - 1, c: td.cellIndex - 1 };
  }
  function cellFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const td = el.closest("td"), th = el.closest("th");
    if (td && gridEl.contains(td)) return { r: td.parentElement.rowIndex - 1, c: td.cellIndex - 1 };
    if (th && th.dataset.r) return { r: +th.dataset.r, c: 0 };
    if (th && th.dataset.c) return { r: 0, c: +th.dataset.c };
    return null;
  }

  gridEl.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const rs = e.target.dataset && e.target.dataset.rs;
    if (rs !== undefined) { startResize(e, +rs); return; }
    const th = e.target.closest("th");
    if (th) {
      e.preventDefault();
      if (editing) commitEdit();
      const s = sheet();
      if (th.classList.contains("corner")) { sel.ar = 0; sel.ac = 0; setRange(0, 0, s.nRows - 1, s.nCols - 1); return; }
      if (th.dataset.c !== undefined) {
        const c = +th.dataset.c;
        if (e.shiftKey) setRange(0, sel.ac, s.nRows - 1, c);
        else { sel.ar = 0; sel.ac = c; setRange(0, c, s.nRows - 1, c); }
        dragMode = "cols";
      } else {
        const r = +th.dataset.r;
        if (e.shiftKey) setRange(sel.ar, 0, r, s.nCols - 1);
        else { sel.ar = r; sel.ac = 0; setRange(r, 0, r, s.nCols - 1); }
        dragMode = "rows";
      }
      pointerSelecting = true;
      wrap.focus({ preventScroll: true });
      return;
    }
    const p = cellFromEvent(e);
    if (!p) return;
    if (canInsertRef()) {
      e.preventDefault();
      pointerSelecting = true; dragMode = "ref";
      refAnchor = p;
      insertRef(p.r, p.c, p.r, p.c);
      return;
    }
    if (editing) commitEdit();
    e.preventDefault();
    wrap.focus({ preventScroll: true });
    if (e.shiftKey) select(p.r, p.c, true);
    else select(p.r, p.c);
    pointerSelecting = true; dragMode = "cells";
  });
  let refAnchor = null;
  document.addEventListener("mousemove", (e) => {
    if (!pointerSelecting) return;
    const p = cellFromPoint(e.clientX, e.clientY);
    if (!p) return;
    const s = sheet();
    if (dragMode === "cells") setRange(sel.ar, sel.ac, p.r, p.c);
    else if (dragMode === "cols") setRange(0, sel.ac, s.nRows - 1, p.c);
    else if (dragMode === "rows") setRange(sel.ar, 0, p.r, s.nCols - 1);
    else if (dragMode === "ref" && refAnchor) insertRef(refAnchor.r, refAnchor.c, p.r, p.c);
  });
  document.addEventListener("mouseup", () => {
    if (!pointerSelecting) return;
    pointerSelecting = false;
    if (dragMode === "ref") (editFromBar ? fbar : editorEl).focus();
    dragMode = null;
  });
  gridEl.addEventListener("dblclick", (e) => {
    const p = cellFromEvent(e);
    if (p) { select(p.r, p.c); startEdit(); }
  });

  // Larghezza colonne
  function startResize(e, c) {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, w0 = colW(c), col = gridEl.querySelectorAll("col")[c + 1];
    const k = zoomK();
    let moved = false;
    const mv = (ev) => { moved = true; const w = Math.max(24, Math.round(w0 + (ev.clientX - x0) / k)); col.style.width = w + "px"; sheet().colW[c] = w; fitTableWidth(); drawSelection(); };
    const up = () => {
      document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up);
      if (moved) changed(false);
    };
    document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
  }
  // Doppio clic sul bordo: adatta la colonna al contenuto
  gridEl.addEventListener("dblclick", (e) => {
    const rs = e.target.dataset && e.target.dataset.rs;
    if (rs === undefined) return;
    const c = +rs;
    let max = 30;
    const body = gridEl.tBodies[0];
    const meas = document.createElement("span");
    meas.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;font:11pt " + getComputedStyle(gridEl).fontFamily;
    document.body.appendChild(meas);
    for (const k of Object.keys(sheet().cells)) {
      const p = En.parseAddr(k);
      if (!p || p.c !== c) continue;
      const td = body.rows[p.r] && body.rows[p.r].cells[c + 1];
      if (!td) continue;
      meas.style.fontSize = td.style.fontSize || "11pt";
      meas.style.fontWeight = td.style.fontWeight || "400";
      meas.textContent = td.textContent;
      max = Math.max(max, meas.offsetWidth + 14);
    }
    meas.remove();
    snapshot();
    sheet().colW[c] = Math.min(600, max);
    gridEl.querySelectorAll("col")[c + 1].style.width = sheet().colW[c] + "px";
    fitTableWidth(); drawSelection(); changed(false);
  });

  /* ---------- Riempimento con la maniglia ---------- */
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault(); e.stopPropagation();
    const src = { r1: sel.r1, c1: sel.c1, r2: sel.r2, c2: sel.c2 };
    const prev = document.createElement("div");
    prev.className = "fill-preview";
    wrap.appendChild(prev);
    let target = null;
    const mv = (ev) => {
      const p = cellFromPoint(ev.clientX, ev.clientY);
      if (!p) return;
      const dDown = p.r - src.r2, dUp = src.r1 - p.r, dRight = p.c - src.c2, dLeft = src.c1 - p.c;
      const m = Math.max(dDown, dUp, dRight, dLeft);
      if (m <= 0) { target = null; prev.style.display = "none"; return; }
      if (m === dDown) target = { dir: "down", r1: src.r1, c1: src.c1, r2: p.r, c2: src.c2 };
      else if (m === dUp) target = { dir: "up", r1: p.r, c1: src.c1, r2: src.r2, c2: src.c2 };
      else if (m === dRight) target = { dir: "right", r1: src.r1, c1: src.c1, r2: src.r2, c2: p.c };
      else target = { dir: "left", r1: src.r1, c1: p.c, r2: src.r2, c2: src.c2 };
      const rc = rectOf(target.r1, target.c1, target.r2, target.c2);
      if (rc) Object.assign(prev.style, { display: "block", left: rc.left + "px", top: rc.top + "px", width: rc.width + "px", height: rc.height + "px" });
    };
    const up = () => {
      document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up);
      prev.remove();
      if (!target) return;
      snapshot();
      fillSeries(src, target);
      sel.r1 = target.r1; sel.c1 = target.c1; sel.r2 = target.r2; sel.c2 = target.c2;
      changed();
      updateBar();
    };
    document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
  });

  // Riempie target partendo da src: numeri in serie, date giorno per giorno, testi con numero finale, formule spostate
  function fillSeries(src, tgt, forceCopy = false) {
    const s = sheet();
    const vertical = tgt.dir === "down" || tgt.dir === "up";
    const lines = vertical ? range(src.c1, src.c2) : range(src.r1, src.r2);
    for (const line of lines) {
      const srcIdx = vertical ? range(src.r1, src.r2) : range(src.c1, src.c2);
      const get = (i) => (vertical ? cellAt(i, line) : cellAt(line, i));
      const items = srcIdx.map((i) => ({ i, cell: get(i) }));
      const nums = items.map(({ cell }) => {
        if (cell && typeof cell.v === "number") return cell.v;
        if (!cell || typeof cell.v !== "string" || cell.v[0] === "=") return null;
        const p = En.parseInput(cell.v);
        return typeof p.value === "number" ? p.value : null;
      });
      const allNum = nums.every((x) => x !== null);
      let step = null;
      if (!forceCopy && allNum) {
        if (nums.length >= 2) step = (nums[nums.length - 1] - nums[0]) / (nums.length - 1);
        else if (items[0].cell && items[0].cell.s && /date/.test(items[0].cell.s.fmt || "")) step = 1;
      }
      const textNum = !forceCopy && items.length === 1 && items[0].cell && typeof items[0].cell.v === "string" && /^(.*?)(\d+)$/.exec(items[0].cell.v);
      const tIdx = vertical ? range(tgt.r1, tgt.r2) : range(tgt.c1, tgt.c2);
      const forward = tgt.dir === "down" || tgt.dir === "right";
      for (const t of tIdx) {
        if (t >= srcIdx[0] && t <= srcIdx[srcIdx.length - 1]) continue;
        const off = forward ? t - srcIdx[srcIdx.length - 1] : srcIdx[0] - t; // distanza dal bordo
        const k = forward ? (off - 1) % items.length : items.length - 1 - ((off - 1) % items.length);
        const from = items[k];
        const r = vertical ? t : line, c = vertical ? line : t;
        const fr = vertical ? from.i : line, fc = vertical ? line : from.i;
        const dest = addr(r, c);
        if (!from.cell) { delete s.cells[dest]; continue; }
        const nc = clone(from.cell);
        if (step !== null) {
          const base = forward ? nums[nums.length - 1] : nums[0];
          const val = base + (forward ? off : -off) * step;
          nc.v = (nc.s && /date/.test(nc.s.fmt || "")) ? En.formatValue(val, { fmt: "date" }) : En.formatGeneral(val);
        } else if (textNum) {
          const n = parseInt(textNum[2], 10) + (forward ? off : -off);
          nc.v = textNum[1] + Math.max(0, n);
        } else if (typeof nc.v === "string" && nc.v[0] === "=") {
          nc.v = En.shiftFormula(nc.v, r - fr, c - fc);
        }
        s.cells[dest] = nc;
      }
    }
  }
  const range = (a, b) => { const o = []; for (let i = a; i <= b; i++) o.push(i); return o; };

  /* ---------- Tastiera ---------- */
  wrap.addEventListener("keydown", (e) => {
    if (editing) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[k]) {
      e.preventDefault();
      const [dr, dc] = moves[k];
      const cur = e.shiftKey ? edgeOfSel(dr, dc) : { r: sel.ar, c: sel.ac };
      let nr = cur.r + dr, nc = cur.c + dc;
      if (mod) { const j = jump(cur.r, cur.c, dr, dc); nr = j.r; nc = j.c; }
      if (e.shiftKey) { setRange(sel.ar, sel.ac, nr, nc); scrollIntoView(clamp(nr, 0, sheet().nRows - 1), clamp(nc, 0, sheet().nCols - 1)); }
      else select(nr, nc);
      return;
    }
    if (k === "Enter") { e.preventDefault(); moveInSel(e.shiftKey ? -1 : 1, 0); return; }
    if (k === "Tab") { e.preventDefault(); moveInSel(0, e.shiftKey ? -1 : 1); return; }
    if (k === "F2") { e.preventDefault(); startEdit(); return; }
    if (k === "Delete" || k === "Backspace") { e.preventDefault(); clearSel("content"); return; }
    if (k === "Escape") { clip = clip && clip.cut ? clip : null; selBox.classList.remove("copying"); return; }
    if (k === "PageDown" || k === "PageUp") {
      e.preventDefault();
      const rows = Math.floor(wrap.clientHeight / 25) - 1;
      select(sel.ar + (k === "PageDown" ? rows : -rows), sel.ac);
      return;
    }
    if (k === "Home") { e.preventDefault(); select(mod ? 0 : sel.ar, 0); return; }
    if (mod) {
      const kk = k.toLowerCase();
      if (kk === "b") { e.preventDefault(); toggleStyle("b"); }
      else if (kk === "i") { e.preventDefault(); toggleStyle("i"); }
      else if (kk === "u") { e.preventDefault(); toggleStyle("u"); }
      else if (kk === "a") { e.preventDefault(); sel.ar = 0; sel.ac = 0; setRange(0, 0, sheet().nRows - 1, sheet().nCols - 1); }
      else if (kk === "d") { e.preventDefault(); fillCmd("down"); }
      else if (kk === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (kk === "y") { e.preventDefault(); redo(); }
      return;
    }
    if (k.length === 1 && !e.altKey) { e.preventDefault(); startEdit(k); }
  });
  function edgeOfSel(dr, dc) {
    // con Maiusc+frecce estendo dal lato opposto all'ancora
    return { r: dr ? (sel.r1 === sel.ar ? sel.r2 : sel.r1) : sel.ar === sel.r1 ? sel.r2 : sel.r1, c: dc ? (sel.c1 === sel.ac ? sel.c2 : sel.c1) : sel.ac === sel.c1 ? sel.c2 : sel.c1 };
  }
  function moveInSel(dr, dc) {
    if (sel.r1 === sel.r2 && sel.c1 === sel.c2) { select(sel.ar + dr, sel.ac + dc); return; }
    let r = sel.ar + dr, c = sel.ac + dc;
    if (r > sel.r2) { r = sel.r1; c++; } if (r < sel.r1) { r = sel.r2; c--; }
    if (c > sel.c2) { c = sel.c1; r++; if (r > sel.r2) r = sel.r1; } if (c < sel.c1) { c = sel.c2; r--; if (r < sel.r1) r = sel.r2; }
    sel.ar = r; sel.ac = c;
    drawSelection(); updateBar(); scrollIntoView(r, c);
  }
  function jump(r, c, dr, dc) {
    const s = sheet();
    const has = (rr, cc) => { const x = cellAt(rr, cc); return x && x.v !== undefined && x.v !== ""; };
    const inside = (rr, cc) => rr >= 0 && cc >= 0 && rr < s.nRows && cc < s.nCols;
    let rr = r + dr, cc = c + dc;
    if (!inside(rr, cc)) return { r, c };
    if (has(r, c) && has(rr, cc)) { while (inside(rr + dr, cc + dc) && has(rr + dr, cc + dc)) { rr += dr; cc += dc; } return { r: rr, c: cc }; }
    while (inside(rr, cc) && !has(rr, cc)) { rr += dr; cc += dc; }
    if (!inside(rr, cc)) return { r: clamp(rr - dr, 0, s.nRows - 1), c: clamp(cc - dc, 0, s.nCols - 1) };
    return { r: rr, c: cc };
  }

  /* ---------- Copia, taglia, incolla ---------- */
  let clip = null;
  function selToTSV() {
    const { mr, mc } = usedBounds();
    const rows = [];
    for (let r = sel.r1; r <= Math.min(sel.r2, Math.max(mr, sel.r1)); r++) {
      const row = [];
      for (let c = sel.c1; c <= Math.min(sel.c2, Math.max(mc, sel.c1)); c++) {
        const cell = cellAt(r, c);
        row.push(cell ? En.formatValue(calc.get(book.active, r, c), cell.s) : "");
      }
      rows.push(row.join("\t"));
    }
    return rows.join("\n");
  }
  function doCopy(cut) {
    const { mr, mc } = usedBounds();
    const r2 = Math.min(sel.r2, Math.max(mr, sel.r1)), c2 = Math.min(sel.c2, Math.max(mc, sel.c1));
    const cells = [];
    for (let r = sel.r1; r <= r2; r++) { const row = []; for (let c = sel.c1; c <= c2; c++) row.push(cellAt(r, c) ? clone(cellAt(r, c)) : null); cells.push(row); }
    clip = { tsv: selToTSV(), si: book.active, r1: sel.r1, c1: sel.c1, cells, cut };
    selBox.classList.add("copying");
    return clip.tsv;
  }
  function doPaste(text) {
    if (text === undefined || text === null) return;
    snapshot();
    const s = sheet();
    const normalized = text.replace(/\r\n/g, "\n").replace(/\n$/, "");
    if (clip && normalized === clip.tsv.replace(/\n$/, "")) {
      const src = book.sheets[clip.si];
      if (clip.cut) clip.cells.forEach((row, i) => row.forEach((_, j) => { delete src.cells[addr(clip.r1 + i, clip.c1 + j)]; }));
      clip.cells.forEach((row, i) => row.forEach((cell, j) => {
        const r = sel.ar + i, c = sel.ac + j;
        if (r >= s.nRows || c >= s.nCols) return;
        const k = addr(r, c);
        if (!cell) { delete s.cells[k]; return; }
        const nc = clone(cell);
        if (!clip.cut && typeof nc.v === "string" && nc.v[0] === "=") nc.v = En.shiftFormula(nc.v, r - (clip.r1 + i), c - (clip.c1 + j));
        s.cells[k] = nc;
      }));
      const h = clip.cells.length, w = clip.cells[0] ? clip.cells[0].length : 1;
      if (clip.cut) { clip = null; selBox.classList.remove("copying"); }
      setRange(sel.ar, sel.ac, sel.ar + h - 1, sel.ac + w - 1);
    } else {
      const rows = normalized.split("\n").map((l) => l.split("\t"));
      ensureSize(sel.ar + rows.length, sel.ac + Math.max(...rows.map((r) => r.length)));
      rows.forEach((row, i) => row.forEach((v, j) => setRaw(sel.ar + i, sel.ac + j, v.trim() === "" ? "" : v)));
      setRange(sel.ar, sel.ac, sel.ar + rows.length - 1, sel.ac + Math.max(...rows.map((r) => r.length)) - 1);
    }
    changed();
  }
  const gridActive = () => !editing && (document.activeElement === wrap || document.activeElement === document.body);
  document.addEventListener("copy", (e) => {
    if (!gridActive()) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", doCopy(false));
  });
  document.addEventListener("cut", (e) => {
    if (!gridActive()) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", doCopy(true));
  });
  document.addEventListener("paste", (e) => {
    if (!gridActive()) return;
    e.preventDefault();
    doPaste(e.clipboardData.getData("text/plain"));
  });
  $("btnCopy").addEventListener("click", () => { wrap.focus(); if (!document.execCommand("copy")) navigator.clipboard?.writeText(doCopy(false)); });
  $("btnCut").addEventListener("click", () => { wrap.focus(); if (!document.execCommand("cut")) navigator.clipboard?.writeText(doCopy(true)); });
  $("btnPaste").addEventListener("click", async () => {
    try { doPaste(await navigator.clipboard.readText()); }
    catch (e) { if (clip) doPaste(clip.tsv); else toast("Il browser non permette di incollare da qui: usa ⌘V (Ctrl+V)"); }
  });

  /* ---------- Comandi del nastro ---------- */
  // I pulsanti non rubano il fuoco alla griglia
  $$(".ribbon button, .popover button, .qb").forEach((b) => b.addEventListener("mousedown", (e) => e.preventDefault()));

  function toggleStyle(key) {
    const st = (cellAt(sel.ar, sel.ac) || {}).s || {};
    const on = !st[key];
    styleSel((s) => { s[key] = on; });
  }
  $$("[data-style]").forEach((b) => b.addEventListener("click", () => toggleStyle(b.dataset.style)));
  $$("[data-align]").forEach((b) => b.addEventListener("click", () => {
    const cur = ((cellAt(sel.ar, sel.ac) || {}).s || {}).align;
    styleSel((s) => { s.align = cur === b.dataset.align ? undefined : b.dataset.align; });
  }));
  $("btnWrap").addEventListener("click", () => { const on = !((cellAt(sel.ar, sel.ac) || {}).s || {}).wrap; styleSel((s) => { s.wrap = on; }); });
  $("fontSize").addEventListener("change", (e) => { const v = +e.target.value; styleSel((s) => { s.size = v === 11 ? undefined : v; }); wrap.focus(); });
  $("textColor").addEventListener("input", (e) => { $("swText").style.background = e.target.value; styleSel((s) => { s.color = e.target.value; }); });
  $("fillColor").addEventListener("input", (e) => { $("swFill").style.background = e.target.value; styleSel((s) => { s.fill = e.target.value.toLowerCase() === "#ffffff" ? undefined : e.target.value; }); });
  $("numFmt").addEventListener("change", (e) => { const f = e.target.value; styleSel((s) => { s.fmt = f === "general" ? undefined : f; s.dec = undefined; }); wrap.focus(); });
  $$("[data-fmt]").forEach((b) => b.addEventListener("click", () => {
    const f = b.dataset.fmt;
    styleSel((s) => { s.fmt = s.fmt === f ? undefined : f; s.dec = undefined; });
  }));
  function stepDec(d) {
    styleSel((s, r, c) => {
      const v = calc.get(book.active, r, c);
      let cur = s.dec;
      if (cur === undefined) {
        if (s.fmt === "number" || s.fmt === "currency") cur = 2;
        else if (s.fmt === "percent") cur = 0;
        else cur = typeof v === "number" ? Math.min(10, ((String(v).split(".")[1]) || "").length) : 0;
      }
      s.dec = clamp(cur + d, 0, 10);
    });
  }
  $("btnDecMore").addEventListener("click", () => stepDec(1));
  $("btnDecLess").addEventListener("click", () => stepDec(-1));

  $$("[data-border]").forEach((b) => b.addEventListener("click", () => {
    closePops();
    const kind = b.dataset.border;
    styleSel((s, r, c) => {
      const bd = {};
      if (kind === "all") { bd.t = bd.b = bd.l = bd.r = "thin"; }
      else if (kind === "outer" || kind === "thick") {
        const w = kind === "thick" ? "thick" : "thin";
        Object.assign(bd, s.bd || {});
        if (r === sel.r1) bd.t = w; if (r === sel.r2) bd.b = w; if (c === sel.c1) bd.l = w; if (c === sel.c2) bd.r = w;
      } else if (kind === "bottom") { Object.assign(bd, s.bd || {}); if (r === sel.r2) bd.b = "thin"; }
      s.bd = Object.keys(bd).length ? bd : undefined;
    });
  }));
  $$("[data-clear]").forEach((b) => b.addEventListener("click", () => { closePops(); clearSel(b.dataset.clear); }));
  function clearSel(what) {
    snapshot();
    const s = sheet();
    for (const k of Object.keys(s.cells)) {
      const p = En.parseAddr(k);
      if (!p || p.r < sel.r1 || p.r > sel.r2 || p.c < sel.c1 || p.c > sel.c2) continue;
      if (what === "all") delete s.cells[k];
      else if (what === "format") { delete s.cells[k].s; if (s.cells[k].v === undefined) delete s.cells[k]; }
      else { delete s.cells[k].v; if (!s.cells[k].s) delete s.cells[k]; }
    }
    changed();
    updateBar();
  }

  /* ---------- Somma automatica ---------- */
  function autoFn(fn) {
    const s = sheet();
    const isNum = (r, c) => typeof calc.get(book.active, r, c) === "number";
    snapshot();
    if (sel.r1 !== sel.r2 || sel.c1 !== sel.c2) {
      // selezione: risultato sotto ogni colonna
      const r = sel.r2 + 1;
      ensureSize(r + 1, s.nCols);
      for (let c = sel.c1; c <= sel.c2; c++) setRaw(r, c, `=${fn}(${addr(sel.r1, c)}:${addr(sel.r2, c)})`);
      changed();
      select(r, sel.c1);
      return;
    }
    let r = sel.ar - 1, c = sel.ac;
    while (r >= 0 && isNum(r, c)) r--;
    let formula;
    if (r < sel.ar - 1) formula = `=${fn}(${addr(r + 1, c)}:${addr(sel.ar - 1, c)})`;
    else {
      let cc = sel.ac - 1;
      while (cc >= 0 && isNum(sel.ar, cc)) cc--;
      formula = cc < sel.ac - 1 ? `=${fn}(${addr(sel.ar, cc + 1)}:${addr(sel.ar, sel.ac - 1)})` : `=${fn}()`;
    }
    undoStack.pop();
    if (/\(\)$/.test(formula)) { startEdit(formula); editorEl.setSelectionRange(formula.length - 1, formula.length - 1); return; }
    startEdit(formula);
  }
  $("btnAutoSum").addEventListener("click", () => autoFn("SOMMA"));
  $("btnAutoSum2").addEventListener("click", () => autoFn("SOMMA"));
  $$("[data-auto]").forEach((b) => b.addEventListener("click", () => { closePops(); autoFn(b.dataset.auto); }));

  /* ---------- Riempi ---------- */
  function fillCmd(kind) {
    snapshot();
    if (kind === "down") {
      if (sel.r1 === sel.r2) { if (sel.r1 === 0) { undoStack.pop(); return; } fillSeries({ r1: sel.r1 - 1, c1: sel.c1, r2: sel.r1 - 1, c2: sel.c2 }, { dir: "down", r1: sel.r1 - 1, c1: sel.c1, r2: sel.r2, c2: sel.c2 }, true); }
      else fillSeries({ r1: sel.r1, c1: sel.c1, r2: sel.r1, c2: sel.c2 }, { dir: "down", ...selRect() }, true);
    } else if (kind === "right") {
      if (sel.c1 === sel.c2) { if (sel.c1 === 0) { undoStack.pop(); return; } fillSeries({ r1: sel.r1, c1: sel.c1 - 1, r2: sel.r2, c2: sel.c1 - 1 }, { dir: "right", r1: sel.r1, c1: sel.c1 - 1, r2: sel.r2, c2: sel.c2 }, true); }
      else fillSeries({ r1: sel.r1, c1: sel.c1, r2: sel.r2, c2: sel.c1 }, { dir: "right", ...selRect() }, true);
    } else {
      // serie: dalla prima cella (o dalle prime due) verso il basso o a destra
      const vertical = sel.r2 > sel.r1;
      const filled = (r, c) => { const x = cellAt(r, c); return x && x.v !== undefined; };
      if (vertical) {
        const n = filled(sel.r1 + 1, sel.c1) ? 2 : 1;
        fillSeries({ r1: sel.r1, c1: sel.c1, r2: sel.r1 + n - 1, c2: sel.c2 }, { dir: "down", ...selRect() });
      } else {
        const n = filled(sel.r1, sel.c1 + 1) ? 2 : 1;
        fillSeries({ r1: sel.r1, c1: sel.c1, r2: sel.r2, c2: sel.c1 + n - 1 }, { dir: "right", ...selRect() });
      }
    }
    changed();
  }
  const selRect = () => ({ r1: sel.r1, c1: sel.c1, r2: sel.r2, c2: sel.c2 });
  $$("[data-fill]").forEach((b) => b.addEventListener("click", () => { closePops(); fillCmd(b.dataset.fill); }));

  /* ---------- Righe e colonne ---------- */
  function structure(kind) {
    const s = sheet();
    const rowsSel = sel.c1 === 0 && sel.c2 === s.nCols - 1, colsSel = sel.r1 === 0 && sel.r2 === s.nRows - 1;
    const axis = kind.endsWith("Row") ? "row" : "col";
    const at = axis === "row" ? sel.r1 : sel.c1;
    let n = 1;
    if (axis === "row" && rowsSel) n = sel.r2 - sel.r1 + 1;
    if (axis === "col" && colsSel) n = sel.c2 - sel.c1 + 1;
    const count = kind.startsWith("ins") ? n : -n;
    if (count < 0 && (axis === "row" ? s.nRows : s.nCols) <= n) { toast("Non posso eliminare tutte le righe o le colonne"); return; }
    snapshot();
    const moved = {};
    for (const [k, cell] of Object.entries(s.cells)) {
      const p = En.parseAddr(k);
      if (!p) continue;
      let idx = axis === "row" ? p.r : p.c;
      if (count > 0) { if (idx >= at) idx += count; }
      else { if (idx >= at && idx < at - count) continue; if (idx >= at - count) idx += count; }
      moved[axis === "row" ? addr(idx, p.c) : addr(p.r, idx)] = cell;
    }
    s.cells = moved;
    if (axis === "col") {
      const w = {};
      for (const [c, v] of Object.entries(s.colW)) {
        let i = +c;
        if (count > 0) { if (i >= at) i += count; } else { if (i >= at && i < at - count) continue; if (i >= at - count) i += count; }
        w[i] = v;
      }
      s.colW = w;
      s.nCols = Math.max(1, s.nCols + count);
    } else s.nRows = Math.max(1, s.nRows + count);
    // aggiorno i riferimenti di tutte le formule della cartella
    for (const sh of book.sheets) for (const cell of Object.values(sh.cells)) {
      if (typeof cell.v === "string" && cell.v[0] === "=") cell.v = En.adjustStructure(cell.v, sh.name, s.name, axis, at, count);
    }
    renderAll();
    if (axis === "row") { sel.ar = at; setRange(at, sel.c1, at + Math.max(0, n - 1), rowsSel ? s.nCols - 1 : sel.c1); }
    else { sel.ac = at; setRange(colsSel ? 0 : sel.r1, at, colsSel ? s.nRows - 1 : sel.r1, at + Math.max(0, n - 1)); }
    changed(false);
  }
  $$("[data-struct]").forEach((b) => b.addEventListener("click", () => structure(b.dataset.struct)));
  $("btnAddRows").addEventListener("click", () => { snapshot(); sheet().nRows += 100; renderAll(); changed(false); toast("Aggiunte 100 righe"); });

  /* ---------- Area dei dati attorno alla cella (per ordinare) ---------- */
  function currentRegion(r, c) {
    const has = (rr, cc) => { const x = cellAt(rr, cc); return x && x.v !== undefined && x.v !== ""; };
    let r1 = r, r2 = r, c1 = c, c2 = c, grew = true;
    while (grew) {
      grew = false;
      const rowHas = (rr) => { for (let cc = c1; cc <= c2; cc++) if (has(rr, cc)) return true; return false; };
      const colHas = (cc) => { for (let rr = r1; rr <= r2; rr++) if (has(rr, cc)) return true; return false; };
      if (r1 > 0 && rowHas(r1 - 1)) { r1--; grew = true; }
      if (r2 < sheet().nRows - 1 && rowHas(r2 + 1)) { r2++; grew = true; }
      if (c1 > 0 && colHas(c1 - 1)) { c1--; grew = true; }
      if (c2 < sheet().nCols - 1 && colHas(c2 + 1)) { c2++; grew = true; }
    }
    return { r1, c1, r2, c2 };
  }
  function workRange() {
    if (sel.r1 !== sel.r2 || sel.c1 !== sel.c2) {
      const { mr, mc } = usedBounds();
      return { r1: sel.r1, c1: sel.c1, r2: Math.min(sel.r2, mr), c2: Math.min(sel.c2, mc), auto: false };
    }
    return { ...currentRegion(sel.ar, sel.ac), auto: true };
  }
  function hasHeader(rg) {
    if (rg.r2 <= rg.r1) return false;
    let allText = true;
    for (let c = rg.c1; c <= rg.c2; c++) { const v = calc.get(book.active, rg.r1, c); if (typeof v !== "string") allText = false; }
    if (!allText) return false;
    for (let c = rg.c1; c <= rg.c2; c++) { const v = calc.get(book.active, rg.r1 + 1, c); if (typeof v !== "string" && v !== null) return true; }
    const st = (cellAt(rg.r1, rg.c1) || {}).s || {};
    return !!st.b || rg.auto;
  }
  function moveRows(rg, order) {
    // order[i] = riga di origine per la posizione i
    const s = sheet();
    const copy = order.map((src) => range(rg.c1, rg.c2).map((c) => (cellAt(src, c) ? clone(cellAt(src, c)) : null)));
    order.forEach((src, i) => {
      const r = rg.r1 + i;
      copy[i].forEach((cell, j) => {
        const k = addr(r, rg.c1 + j);
        if (!cell) { delete s.cells[k]; return; }
        if (typeof cell.v === "string" && cell.v[0] === "=") cell.v = En.shiftFormula(cell.v, r - src, 0);
        s.cells[k] = cell;
      });
    });
  }
  function sortSel(dir) {
    closePops();
    const rg = workRange();
    if (rg.r2 < rg.r1) return toast("Non ci sono dati da ordinare");
    const head = hasHeader(rg);
    const body = { ...rg, r1: rg.r1 + (head ? 1 : 0) };
    if (body.r2 <= body.r1) return toast("Servono almeno due righe da ordinare");
    const key = clamp(sel.ac, rg.c1, rg.c2);
    const rows = range(body.r1, body.r2);
    const val = (r) => calc.get(book.active, r, key);
    const rank = (v) => (v === null || v === "" ? 3 : typeof v === "number" ? 0 : typeof v === "string" ? 1 : 2);
    const coll = new Intl.Collator("it", { numeric: true, sensitivity: "base" });
    rows.sort((a, b) => {
      const va = val(a), vb = val(b), ra = rank(va), rb = rank(vb);
      if (ra === 3 || rb === 3) return ra - rb; // vuote sempre in fondo
      let d = ra - rb;
      if (!d) d = ra === 0 ? va - vb : ra === 1 ? coll.compare(va, vb) : (va === vb ? 0 : va ? 1 : -1);
      return dir === "asc" ? d : -d;
    });
    snapshot();
    moveRows(body, rows);
    changed();
    sel.r1 = rg.r1; sel.r2 = rg.r2; sel.c1 = rg.c1; sel.c2 = rg.c2;
    drawSelection();
    toast(`Ordinato per la colonna ${colName(key)}${head ? " (prima riga lasciata come intestazione)" : ""}`);
  }
  $$("[data-sort]").forEach((b) => b.addEventListener("click", () => sortSel(b.dataset.sort)));

  $("btnDedup").addEventListener("click", () => {
    const rg = workRange();
    const head = hasHeader(rg);
    const body = { ...rg, r1: rg.r1 + (head ? 1 : 0) };
    const seen = new Set(), keep = [];
    for (let r = body.r1; r <= body.r2; r++) {
      const key = range(rg.c1, rg.c2).map((c) => JSON.stringify(calc.get(book.active, r, c))).join("|");
      if (!seen.has(key)) { seen.add(key); keep.push(r); }
    }
    const removed = body.r2 - body.r1 + 1 - keep.length;
    if (!removed) return toast("Nessun duplicato trovato");
    snapshot();
    moveRows({ ...body, r2: body.r1 + keep.length - 1 }, keep);
    for (let r = body.r1 + keep.length; r <= body.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) delete sheet().cells[addr(r, c)];
    changed();
    toast(`Rimosse ${removed} righe duplicate`);
  });

  /* ---------- Funzioni ---------- */
  const GROUPS = {
    math: ["SOMMA", "MEDIA", "MIN", "MAX", "PRODOTTO", "MEDIANA", "ARROTONDA", "ARROTONDA.PER.ECC", "ARROTONDA.PER.DIF", "INT", "ASS", "RADQ", "POTENZA", "RESTO", "CONTA.NUMERI", "CONTA.VALORI", "CONTA.SE", "SOMMA.SE", "MEDIA.SE", "SOMMA.PIÙ.SE", "CONTA.PIÙ.SE", "CASUALE", "CASUALE.TRA", "PI.GRECO"],
    logic: ["SE", "SE.ERRORE", "E", "O", "NON", "VAL.VUOTO", "VAL.NUMERO", "VAL.TESTO", "VAL.ERRORE"],
    text: ["CONCATENA", "LUNGHEZZA", "MAIUSC", "MINUSC", "SINISTRA", "DESTRA", "STRINGA.ESTRAI", "ANNULLA.SPAZI", "VALORE"],
    date: ["OGGI", "ADESSO", "DATA", "ANNO", "MESE", "GIORNO", "GIORNI"],
    lookup: ["CERCA.VERT", "CERCA.ORIZZ", "INDICE", "CONFRONTA"],
  };
  let fnFilter = null;
  function renderFnList() {
    const q = $("fnSearch").value.trim().toUpperCase();
    const names = (fnFilter ? GROUPS[fnFilter] : Object.keys(En.FUNCTION_HELP).sort((a, b) => a.localeCompare(b, "it")))
      .filter((n) => !q || n.includes(q) || (En.FUNCTION_HELP[n] || "").toUpperCase().includes(q));
    $("fnList").innerHTML = names.map((n) => `<button data-fn="${n}"><b>${n}</b><small>${(En.FUNCTION_HELP[n] || "").replace(/</g, "&lt;")}</small></button>`).join("") || '<p style="padding:8px;color:var(--ink-2)">Nessuna funzione trovata</p>';
  }
  $("fnSearch").addEventListener("input", renderFnList);
  $("fnList").addEventListener("mousedown", (e) => e.preventDefault());
  $("fnList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-fn]");
    if (!b) return;
    closePops();
    const name = b.dataset.fn;
    if (isFormulaEdit()) {
      const el = editFromBar ? fbar : editorEl;
      el.setRangeText(name + "(", el.selectionStart, el.selectionEnd, "end");
      el.dispatchEvent(new Event("input"));
      el.focus();
    } else startEdit("=" + name + "(");
  });
  $$("[data-fgroup]").forEach((b) => b.addEventListener("click", () => { fnFilter = b.dataset.fgroup; openPop($("popFunctions"), b); }));
  $("btnToday").addEventListener("click", () => {
    snapshot();
    const t = new Date();
    setRaw(sel.ar, sel.ac, `${String(t.getDate()).padStart(2, "0")}/${String(t.getMonth() + 1).padStart(2, "0")}/${t.getFullYear()}`);
    changed(); updateBar();
  });
  $("btnShowFormulas").addEventListener("click", () => { showFormulas = !showFormulas; $("btnShowFormulas").classList.toggle("on", showFormulas); paintAll(); });

  /* ---------- Menu a comparsa ---------- */
  let openPopEl = null, openBtn = null;
  function openPop(pop, btn) {
    const same = openPopEl === pop && openBtn === btn;
    closePops();
    if (same) return;
    pop.hidden = false;
    const r = btn.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + "px";
    pop.style.top = r.bottom + 4 + "px";
    openPopEl = pop; openBtn = btn;
    if (pop.id === "popFunctions") { $("fnSearch").value = ""; renderFnList(); if (!fnFilter) setTimeout(() => $("fnSearch").focus(), 0); }
  }
  function closePops() {
    if (openPopEl) openPopEl.hidden = true;
    openPopEl = null; openBtn = null;
  }
  $$("[data-pop]").forEach((btn) => btn.addEventListener("click", () => { if (btn.dataset.pop === "popFunctions") fnFilter = null; openPop($(btn.dataset.pop), btn); }));
  document.addEventListener("mousedown", (e) => { if (openPopEl && !openPopEl.contains(e.target) && !(openBtn && openBtn.contains(e.target))) closePops(); });

  /* ---------- Schede ---------- */
  function showTab(name) {
    $$(".rtab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
    $$(".panel").forEach((p) => (p.hidden = p.dataset.panel !== name));
    prefs.tab = name; savePrefs();
  }
  $$(".rtab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));

  /* ---------- Fogli ---------- */
  function renderTabs() {
    $("sheetTabs").innerHTML = book.sheets.map((s, i) => `<button class="sheet-tab${i === book.active ? " on" : ""}" data-si="${i}" title="Doppio clic per rinominare, clic destro per altre opzioni">${s.name.replace(/</g, "&lt;")}</button>`).join("");
  }
  $("sheetTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-si]");
    if (!b || +b.dataset.si === book.active) return;
    if (editing) commitEdit();
    book.active = +b.dataset.si;
    renderAll(); select(0, 0); changed(false);
  });
  $("sheetTabs").addEventListener("dblclick", (e) => { const b = e.target.closest("[data-si]"); if (b) renameSheet(+b.dataset.si); });
  $("sheetTabs").addEventListener("contextmenu", (e) => {
    const b = e.target.closest("[data-si]");
    if (!b) return;
    e.preventDefault();
    const i = +b.dataset.si;
    const m = document.createElement("div");
    m.className = "popover menu ctx-menu";
    m.innerHTML = '<button data-a="rename">Rinomina</button><button data-a="dup">Duplica</button><button data-a="del">Elimina</button>';
    document.body.appendChild(m);
    m.style.left = e.clientX + "px"; m.style.top = e.clientY - m.offsetHeight - 4 + "px";
    const close = () => { m.remove(); document.removeEventListener("mousedown", out); };
    const out = (ev) => { if (!m.contains(ev.target)) close(); };
    setTimeout(() => document.addEventListener("mousedown", out), 0);
    m.addEventListener("click", (ev) => {
      const a = ev.target.dataset.a; close();
      if (a === "rename") renameSheet(i);
      if (a === "dup") {
        snapshot();
        const copy = clone(book.sheets[i]);
        let n = 2; while (book.sheets.some((s) => s.name === `${copy.name} (${n})`)) n++;
        copy.name = `${copy.name} (${n})`;
        book.sheets.splice(i + 1, 0, copy); book.active = i + 1;
        renderAll(); select(0, 0); changed(false);
      }
      if (a === "del") {
        if (book.sheets.length === 1) return toast("La cartella deve avere almeno un foglio");
        if (!confirm(`Eliminare il foglio «${book.sheets[i].name}»?`)) return;
        snapshot();
        book.sheets.splice(i, 1);
        book.active = Math.min(book.active, book.sheets.length - 1);
        renderAll(); select(0, 0); changed();
      }
    });
  });
  function renameSheet(i) {
    const old = book.sheets[i].name;
    const name = (prompt("Nome del foglio:", old) || "").trim();
    if (!name || name === old) return;
    if (/[\\/?*[\]:]/.test(name)) return toast("Il nome non può contenere \\ / ? * [ ] :");
    if (book.sheets.some((s, j) => j !== i && s.name.toLowerCase() === name.toLowerCase())) return toast("Esiste già un foglio con questo nome");
    snapshot();
    book.sheets[i].name = name;
    for (const sh of book.sheets) for (const cell of Object.values(sh.cells)) if (typeof cell.v === "string" && cell.v[0] === "=") cell.v = En.renameSheetRefs(cell.v, old, name);
    renderTabs(); changed();
  }
  function addSheet() {
    snapshot();
    let n = book.sheets.length + 1;
    while (book.sheets.some((s) => s.name === "Foglio" + n)) n++;
    book.sheets.push(newSheet("Foglio" + n));
    book.active = book.sheets.length - 1;
    renderAll(); select(0, 0); changed(false);
  }
  $("btnAddSheet").addEventListener("click", addSheet);
  $("btnAddSheet2").addEventListener("click", addSheet);

  /* ---------- Visualizza ---------- */
  $("btnFreezeRow").addEventListener("click", () => { sheet().freezeRow = !sheet().freezeRow; gridEl.classList.toggle("freeze-row", sheet().freezeRow); $("btnFreezeRow").classList.toggle("on", sheet().freezeRow); changed(false); });
  $("btnFreezeCol").addEventListener("click", () => { sheet().freezeCol = !sheet().freezeCol; gridEl.classList.toggle("freeze-col", sheet().freezeCol); $("btnFreezeCol").classList.toggle("on", sheet().freezeCol); changed(false); });
  $("btnGrid").addEventListener("click", () => { prefs.nogrid = !prefs.nogrid; gridEl.classList.toggle("nogrid", prefs.nogrid); $("btnGrid").classList.toggle("on", !prefs.nogrid); savePrefs(); });
  const zoomK = () => (parseFloat(getComputedStyle(gridEl).getPropertyValue("--zoom")) || 1);
  function setZoom(p) {
    p = clamp(Math.round(p), 50, 200);
    gridEl.style.setProperty("--zoom", p / 100);
    $("zoom").value = p; $("zoomOut").textContent = p + "%";
    drawSelection();
  }
  $("zoom").addEventListener("input", (e) => setZoom(+e.target.value));
  $("btnZoom100").addEventListener("click", () => setZoom(100));
  const THEMES = ["auto", "light", "dark"], THEME_LABEL = { auto: "Tema: auto", light: "Tema: chiaro", dark: "Tema: scuro" };
  function setTheme(t) {
    if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    $("themeLabel").textContent = THEME_LABEL[t]; prefs.theme = t; savePrefs();
  }
  $("btnTheme").addEventListener("click", () => setTheme(THEMES[(THEMES.indexOf(prefs.theme || "auto") + 1) % 3]));
  $("btnFull").addEventListener("click", () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => toast("Schermo intero non disponibile")); });
  wrap.addEventListener("scroll", () => { if (editing) placeEditor(); });
  addEventListener("resize", () => { drawSelection(); if (editing) placeEditor(); });

  /* ---------- Trova e sostituisci ---------- */
  const findbar = $("findbar"), findInput = $("findInput");
  function openFind() { findbar.hidden = false; findInput.focus(); findInput.select(); countFind(); }
  function matches() {
    const q = findInput.value.trim().toLocaleLowerCase();
    if (!q) return [];
    const s = sheet(), out = [];
    for (const [k, cell] of Object.entries(s.cells)) {
      const p = En.parseAddr(k);
      if (!p || cell.v === undefined) continue;
      const shown = En.formatValue(calc.get(book.active, p.r, p.c), cell.s).toLocaleLowerCase();
      if (shown.includes(q) || String(cell.v).toLocaleLowerCase().includes(q)) out.push(p);
    }
    return out.sort((a, b) => a.r - b.r || a.c - b.c);
  }
  function countFind() { const n = matches().length; $("findCount").textContent = findInput.value ? (n === 1 ? "1 cella" : `${n} celle`) : ""; }
  function findNext() {
    const ms = matches();
    countFind();
    if (!ms.length) return;
    const next = ms.find((m) => m.r > sel.ar || (m.r === sel.ar && m.c > sel.ac)) || ms[0];
    select(next.r, next.c);
  }
  $("btnFind").addEventListener("click", openFind);
  findInput.addEventListener("input", countFind);
  findInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); findNext(); } if (e.key === "Escape") closeFind(); });
  $("replaceInput").addEventListener("keydown", (e) => { if (e.key === "Escape") closeFind(); });
  $("findNext").addEventListener("click", findNext);
  $("replaceAll").addEventListener("click", () => {
    const q = findInput.value.trim();
    if (!q) return;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    let n = 0;
    snapshot();
    for (const cell of Object.values(sheet().cells)) {
      if (typeof cell.v !== "string") continue;
      const v = cell.v.replace(re, () => { n++; return $("replaceInput").value; });
      if (v !== cell.v) cell.v = v;
    }
    if (!n) undoStack.pop();
    changed();
    toast(n ? `Sostituite ${n} occorrenze` : "Nessuna occorrenza trovata");
    countFind();
  });
  function closeFind() { findbar.hidden = true; wrap.focus(); }
  $("findClose").addEventListener("click", closeFind);

  /* ---------- File ---------- */
  $("btnNew").addEventListener("click", () => {
    const used = book.sheets.some((s) => Object.keys(s.cells).length);
    if (used && !confirm("Iniziare una nuova cartella? Quella attuale verrà sostituita: se ti serve, scaricala prima in .xlsx.")) return;
    snapshot();
    book = { sheets: [newSheet("Foglio1")], active: 0 };
    titleEl.value = "Cartella senza titolo";
    renderAll(); select(0, 0); changed(false);
  });
  $("btnOpen").addEventListener("click", () => $("fileOpen").click());
  $("btnImportCsv").addEventListener("click", () => $("fileOpen").click());
  $("fileOpen").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) openFile(f); });
  async function openFile(f) {
    const used = book.sheets.some((s) => Object.keys(s.cells).length);
    if (used && !confirm(`Aprire «${f.name}»? La cartella attuale verrà sostituita.`)) return;
    try {
      const name = f.name.toLowerCase();
      let nb;
      if (name.endsWith(".xlsx")) {
        if (!window.ExcelJS) throw new Error("componente non caricato");
        nb = await window.XlsxIO.read(await f.arrayBuffer());
      } else {
        nb = { sheets: [csvToSheet(await f.text(), f.name.replace(/\.[^.]+$/, "").slice(0, 31) || "Foglio1")], active: 0 };
      }
      snapshot();
      book = nb;
      titleEl.value = f.name.replace(/\.[^.]+$/, "");
      renderAll(); select(0, 0); changed(false);
      toast(`Aperto «${f.name}»`);
    } catch (err) {
      console.error(err);
      toast("Non riesco ad aprire questo file: " + err.message, 4000);
    }
  }
  function csvToSheet(text, name) {
    const first = text.split(/\r?\n/)[0] || "";
    const delim = ["\t", ";", ","].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], cur = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cur); cur = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    const s = newSheet(name.replace(/[\\/?*[\]:]/g, " "));
    s.nRows = Math.max(200, rows.length + 20);
    s.nCols = Math.max(26, ...rows.map((r) => r.length));
    rows.forEach((r, i) => r.forEach((v, j) => {
      if (v === "") return;
      // CSV con il punto decimale (es. 12.5): lo leggo come numero
      let raw = v;
      if (delim === "," && /^-?\d+\.\d+$/.test(v)) raw = v.replace(".", ",");
      s.cells[addr(i, j)] = { v: raw };
    }));
    return s;
  }
  $("btnExportCsv").addEventListener("click", () => {
    const s = sheet(), { mr, mc } = usedBounds();
    if (mr < 0) return toast("Il foglio è vuoto");
    const lines = [];
    for (let r = 0; r <= mr; r++) {
      const row = [];
      for (let c = 0; c <= mc; c++) {
        const cell = s.cells[addr(r, c)];
        let t = cell ? En.formatValue(calc.get(book.active, r, c), { ...(cell.s || {}), fmt: cell.s && /date/.test(cell.s.fmt || "") ? cell.s.fmt : undefined }) : "";
        if (/[;"\n]/.test(t)) t = '"' + t.replace(/"/g, '""') + '"';
        row.push(t);
      }
      lines.push(row.join(";"));
    }
    download(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv" }), fileBase() + " - " + s.name + ".csv");
  });
  const fileBase = () => (titleEl.value.trim() || "Cartella").replace(/[\\/:*?"<>|]+/g, "-");

  async function download(blob, name) {
    if (NATIVE) {
      const b64 = await new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result).split(",")[1]); rd.onerror = rej; rd.readAsDataURL(blob); });
      NATIVE.postMessage({ type: "save", name, data: b64 });
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`Scaricato «${name}»`);
  }
  async function saveXlsx() {
    if (editing) commitEdit();
    if (!window.ExcelJS || !window.XlsxIO) return toast("Attendi un attimo: sto ancora caricando i componenti.");
    const btn = $("btnSave");
    btn.disabled = true; btn.textContent = "Preparo il file…";
    try {
      calc = En.recalc(book);
      const buf = await window.XlsxIO.write(book, calc, titleEl.value);
      await download(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), fileBase() + ".xlsx");
    } catch (err) {
      console.error(err);
      toast("Errore durante il salvataggio: " + err.message, 4000);
    } finally {
      btn.disabled = false; btn.textContent = NATIVE ? "Salva .xlsx" : "Scarica .xlsx";
    }
  }
  $("btnSave").addEventListener("click", saveXlsx);

  function buildPrint() {
    const s = sheet(), { mr, mc } = usedBounds();
    if (mr < 0) { $("printArea").innerHTML = "<p>Foglio vuoto</p>"; return; }
    let html = "<table>";
    for (let r = 0; r <= mr; r++) {
      html += "<tr>";
      for (let c = 0; c <= mc; c++) {
        const td = tdAt(r, c);
        const cell = s.cells[addr(r, c)];
        const style = td ? td.getAttribute("style") || "" : "";
        const cls = td && td.classList.contains("num") ? ' class="num"' : "";
        const txt = td ? td.textContent : "";
        html += `<td${cls} style="${style.replace(/"/g, "&quot;")};width:${colW(c)}px">${txt.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</td>`;
        void cell;
      }
      html += "</tr>";
    }
    $("printArea").innerHTML = html + "</table>";
  }
  $("btnPdf").addEventListener("click", () => {
    if (editing) commitEdit();
    buildPrint();
    if (NATIVE) { NATIVE.postMessage({ type: "print", title: titleEl.value || "Cartella" }); return; }
    const t = document.title;
    document.title = titleEl.value || "Cartella";
    toast("Nella finestra di stampa scegli «Salva come PDF»");
    setTimeout(() => { print(); document.title = t; }, 300);
  });
  $("btnUndo").addEventListener("click", undo);
  $("btnRedo").addEventListener("click", redo);

  /* ---------- Scorciatoie globali ---------- */
  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Escape") closePops();
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === "s") { e.preventDefault(); saveXlsx(); }
    else if (k === "o") { e.preventDefault(); $("btnOpen").click(); }
    else if (k === "f") { e.preventDefault(); openFind(); }
    else if (k === "p") { e.preventDefault(); $("btnPdf").click(); }
  });
  titleEl.addEventListener("input", () => changed(false));
  titleEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); wrap.focus(); } });

  /* ---------- Collegamento con l'app per Mac ---------- */
  window.foglio = {
    toast,
    command(cmd) {
      const map = { new: "btnNew", open: "btnOpen", save: "btnSave", print: "btnPdf", find: "btnFind" };
      if (cmd === "undo" || cmd === "redo") {
        // durante la scrittura in una cella annulla il testo, altrimenti le modifiche al foglio
        const a = document.activeElement;
        if (a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT")) return document.execCommand(cmd);
        return cmd === "undo" ? undo() : redo();
      }
      if (map[cmd]) $(map[cmd]).click();
    },
    openBase64(name, b64) {
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      openFile(new File([bytes], name));
    },
  };
  if (NATIVE) $("btnSave").textContent = "Salva .xlsx";

  /* ---------- Avvio ---------- */
  load();
  setTheme(prefs.theme || "auto");
  showTab(prefs.tab || "home");
  gridEl.classList.toggle("nogrid", !!prefs.nogrid);
  $("btnGrid").classList.toggle("on", !prefs.nogrid);
  renderAll();
  select(0, 0);
  wrap.focus();
  addEventListener("beforeunload", () => { clearTimeout(saveTimer); persist(); });
})();
