/* Monitor Ipm – dashboard. Nessuna dipendenza oltre a Chart.js (vendor/). */
(function () {
  "use strict";

  var MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
  var MESI_LUNGHI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
  var DOY_MESI = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
  var NF = new Intl.NumberFormat("it-IT", { useGrouping: "always" });
  var NF1 = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1, useGrouping: "always" });

  var FONT = '"Rethink Sans", -apple-system, "Segoe UI", Roboto, sans-serif';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var css = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); };

  /* ---------- utilità dati ---------- */
  function parseCSV(text) {
    var rows = [], row = [], cur = "", q = false, i, c;
    text = text.replace(/^﻿/, "");
    for (i = 0; i < text.length; i++) {
      c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else { q = false; } }
        else { cur += c; }
      } else if (c === '"') { q = true; }
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cur); cur = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else { cur += c; }
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    var head = rows.shift() || [];
    return rows.map(function (r) {
      var o = {};
      head.forEach(function (h, k) { o[h] = r[k] === undefined ? "" : r[k]; });
      return o;
    });
  }
  function num(v) { return v === "" || v === undefined || v === null ? null : Number(v); }
  function load(name) {
    return fetch("data/" + name, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("File " + name + ": errore " + r.status);
      return r.text();
    }).then(parseCSV);
  }
  function ts(d) { var p = d.split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function doy(d) { var p = d.split("-"); return Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2]) - Date.UTC(+p[0], 0, 0)) / 864e5); }
  function fmtData(d, corta) {
    var p = d.split("-");
    return +p[2] + " " + MESI_LUNGHI[+p[1] - 1] + " " + p[0];
  }
  function fmtTs(t, corta) { var x = new Date(t); return fmtData(x.getUTCFullYear() + "-" + (x.getUTCMonth() + 1) + "-" + x.getUTCDate(), corta); }
  function sortBy(a, k) { return a.slice().sort(function (x, y) { return x[k] < y[k] ? -1 : x[k] > y[k] ? 1 : 0; }); }
  function uniq(a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); }
  function fmtN(v) { return v === null || v === undefined ? "n.d." : NF.format(v); }

  /* ---------- palette (colori validati: vedi README) ---------- */
  var CAT = [
    ["#2D4C8C", "#5B7CC4"], ["#E39A1F", "#E39A1F"], ["#8FA6D1", "#C3D0EA"],
    ["#D9482B", "#D9482B"], ["#86AE95", "#86AE95"]
  ];
  function isDark() { return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches; }
  function cat(i) { return CAT[i][isDark() ? 1 : 0]; }

  /* ---------- controlli ---------- */
  function seg(el, opts, val, cb) {
    el.textContent = "";
    opts.forEach(function (o) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = o.label; b.dataset.v = o.v;
      b.setAttribute("aria-pressed", String(o.v === val));
      b.addEventListener("click", function () {
        Array.prototype.forEach.call(el.children, function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        cb(o.v);
      });
      el.appendChild(b);
    });
  }
  function legend(card, items) {
    var el = $(".legend", card);
    if (!el) return;
    el.textContent = "";
    if (items.length < 2) return;
    items.forEach(function (it) {
      var s = document.createElement("span");
      var sw = document.createElement("span");
      sw.className = "sw"; sw.style.background = it.color;
      s.appendChild(sw); s.appendChild(document.createTextNode(it.label));
      el.appendChild(s);
    });
  }
  function tableView(card, head, rows) {
    var wrap = $(".tablewrap", card);
    wrap.textContent = "";
    var t = document.createElement("table"), th = document.createElement("thead"), tr = document.createElement("tr");
    head.forEach(function (h) { var c = document.createElement("th"); c.scope = "col"; c.textContent = h; tr.appendChild(c); });
    th.appendChild(tr); t.appendChild(th);
    var tb = document.createElement("tbody");
    rows.forEach(function (r) {
      var rr = document.createElement("tr");
      r.forEach(function (v, i) { var c = document.createElement("td"); c.textContent = typeof v === "string" ? v : fmtN(v); rr.appendChild(c); });
      tb.appendChild(rr);
    });
    t.appendChild(tb); wrap.appendChild(t);
  }
  function wireTableBtn(card) {
    var btn = $(".tbl-btn", card), wrap = $(".tablewrap", card), plot = $(".plot", card);
    btn.addEventListener("click", function () {
      var open = wrap.hidden;
      wrap.hidden = !open;
      plot.style.display = open ? "none" : "";
      btn.setAttribute("aria-expanded", String(open));
      btn.textContent = open ? "Mostra come grafico" : "Mostra come tabella";
      if (!open) { var ch = charts.get(card.id); if (ch) ch.resize(); }
    });
  }

  /* ---------- Chart.js: plugin ---------- */
  var charts = new Map();
  var crosshair = {
    id: "crosshair",
    afterDraw: function (chart) {
      if (chart.config.type === "bar") return;
      var a = chart.tooltip && chart.tooltip.getActiveElements ? chart.tooltip.getActiveElements() : [];
      if (!a.length) return;
      var x = a[0].element.x, ca = chart.chartArea, ctx = chart.ctx;
      ctx.save(); ctx.strokeStyle = css("--muted"); ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, ca.top); ctx.lineTo(x, ca.bottom); ctx.stroke(); ctx.restore();
    }
  };
  var endLabels = {
    id: "endLabels",
    afterDatasetsDraw: function (chart, args, opts) {
      if (!opts || !opts.on) return;
      var items = [], ctx = chart.ctx, ca = chart.chartArea;
      chart.data.datasets.forEach(function (ds, i) {
        if (!chart.isDatasetVisible(i)) return;
        var meta = chart.getDatasetMeta(i);
        for (var k = meta.data.length - 1; k >= 0; k--) {
          if (ds.data[k] && ds.data[k].y !== null && ds.data[k].y !== undefined) {
            items.push({ y: meta.data[k].y, t: ds.label, c: ds.borderColor }); break;
          }
        }
      });
      items.sort(function (a, b) { return a.y - b.y; });
      for (var j = 1; j < items.length; j++) if (items[j].y - items[j - 1].y < 14) items[j].y = items[j - 1].y + 14;
      ctx.save(); ctx.font = "12px " + FONT; ctx.textBaseline = "middle";
      items.forEach(function (it) {
        ctx.fillStyle = it.c; ctx.fillRect(ca.right + 6, it.y - 4, 8, 8);
        ctx.fillStyle = css("--ink2"); ctx.fillText(it.t, ca.right + 18, it.y);
      });
      ctx.restore();
    }
  };
  /* linea di riferimento al 100% (vista sovraffollamento) */
  var ref100 = {
    id: "ref100",
    afterDatasetsDraw: function (chart, args, opts) {
      if (!opts || !opts.on) return;
      var x = chart.scales.x.getPixelForValue(100), ca = chart.chartArea, ctx = chart.ctx;
      ctx.save(); ctx.strokeStyle = css("--ink"); ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(x, ca.top); ctx.lineTo(x, ca.bottom); ctx.stroke(); ctx.restore();
    }
  };
  /* etichette con il valore sulle barre */
  var barLabels = {
    id: "barLabels",
    afterDatasetsDraw: function (chart, args, opts) {
      if (!opts || !opts.on) return;
      var ctx = chart.ctx, horiz = chart.options.indexAxis === "y", small = window.innerWidth < 600;
      ctx.save(); ctx.fillStyle = css("--ink"); ctx.font = "600 " + (small ? 11 : 12) + "px " + FONT;
      chart.data.datasets.forEach(function (ds, i) {
        if (chart.getDatasetMeta(i).hidden) return;
        chart.getDatasetMeta(i).data.forEach(function (bar, j) {
          var v = ds.data[j]; if (v === null || v === undefined || isNaN(v)) return;
          var t = opts.fmt ? opts.fmt(v, j, i) : NF.format(v);
          ctx.strokeStyle = css("--card"); ctx.lineWidth = 4; ctx.lineJoin = "round";
          if (horiz) { ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.strokeText(t, bar.x + 6, bar.y); ctx.fillText(t, bar.x + 6, bar.y); }
          else { ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.strokeText(t, bar.x, bar.y - 5); ctx.fillText(t, bar.x, bar.y - 5); }
        });
      });
      ctx.restore();
    }
  };
  Chart.register(crosshair, endLabels, ref100, barLabels);
  Chart.defaults.font.family = FONT;

  function baseOptions(o) {
    var grid = css("--grid"), muted = css("--muted");
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      layout: { padding: { right: o.endLabels ? 84 : 8, top: 6 } },
      interaction: { mode: o.mode || "index", axis: "x", intersect: false },
      plugins: {
        legend: { display: false },
        endLabels: { on: !!o.endLabels },
        tooltip: {
          backgroundColor: css("--card"), titleColor: css("--ink"), bodyColor: css("--ink2"),
          borderColor: css("--border"), borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true,
          callbacks: {
            title: function (items) { return items.length ? o.title(items[0]) : ""; },
            label: function (it) {
              var v = it.parsed[o.vAxis || "y"];
              return " " + it.dataset.label + ": " + (v === null || v === undefined || isNaN(v) ? (o.nullText || "non riportato") : (o.fmt ? o.fmt(v) : NF.format(v)));
            }
          }
        }
      },
      scales: o.scales(grid, muted)
    };
  }
  function yScale(grid, muted, title, extra) {
    var s = {
      beginAtZero: true, grid: { color: grid }, border: { display: false },
      ticks: { color: muted, callback: function (v) { return NF.format(v); } },
      title: { display: !!title, text: title, color: muted }
    };
    for (var k in extra) s[k] = extra[k];
    return s;
  }
  function render(id, cfg) {
    var card = document.getElementById(id), canvas = $("canvas", card);
    var old = charts.get(id); if (old) old.destroy();
    charts.set(id, new Chart(canvas, cfg));
  }
  var zoomPeriodo = false; /* true = solo l’anno in corso */
  function lineDs(label, pts, color, o) {
    o = o || {};
    return {
      label: label, data: pts, borderColor: color, backgroundColor: color,
      borderWidth: o.w || 2, pointRadius: o.r !== undefined ? o.r : (zoomPeriodo ? 4 : (window.innerWidth < 600 ? 2 : 3)), pointHoverRadius: 6,
      pointBackgroundColor: color, pointBorderColor: css("--card"), pointBorderWidth: zoomPeriodo ? 2 : 1,
      pointHitRadius: 14, tension: 0, spanGaps: false, order: o.order || 0
    };
  }
  function dateTicksScale(min, max, grid, muted) {
    return {
      type: "linear", min: min, max: max, grid: { display: false }, border: { color: grid },
      ticks: { color: muted, maxRotation: 0, callback: function (v) { return v.__l || ""; } },
      afterBuildTicks: function (axis) {
        var t = [], y0 = new Date(min).getUTCFullYear(), y1 = new Date(max).getUTCFullYear(), y, m, v;
        var step = (max - min) < 500 * 864e5 ? (window.innerWidth < 600 ? 2 : 1) : (window.innerWidth < 600 ? 12 : 6);
        for (y = y0; y <= y1; y++) for (m = 0; m < 12; m += step) {
          v = Date.UTC(y, m, 1);
          if (v >= min && v <= max) t.push({ value: v, label: m === 0 ? String(y) : "luglio" });
        }
        axis.ticks = t;
      }
    };
  }
  /* i tick con label personalizzata: Chart.js passa il valore numerico, quindi mappiamo via formato */
  function dateScale(min, max, grid, muted) {
    var sc = dateTicksScale(min, max, grid, muted);
    sc.ticks.callback = function (v) {
      var d = new Date(v);
      return d.getUTCMonth() === 0 ? String(d.getUTCFullYear()) : MESI_LUNGHI[d.getUTCMonth()];
    };
    return sc;
  }
  var DAY = 864e5;
  /* asse x con anni (serie storica): etichette 1991, ogni 5 anni, e l’anno corrente */
  function yearScale(min, max, grid, muted, last) {
    return {
      type: "linear", min: min, max: max, grid: { display: false }, border: { color: grid },
      ticks: { color: muted, maxRotation: 0, autoSkip: false, callback: function (v) { return String(v); } },
      afterBuildTicks: function (axis) {
        var t = [], y, gap = window.innerWidth < 600 ? 7 : 2;
        for (y = Math.ceil(min); y <= max; y++) {
          if (y === 1991 || y === last) { t.push({ value: y }); continue; }
          if (y % (window.innerWidth < 600 ? 10 : 5) === 0 && last - y >= gap) t.push({ value: y });
        }
        axis.ticks = t;
      }
    };
  }
  function setPressed(el, val) { Array.prototype.forEach.call(el.children, function (b) { b.setAttribute("aria-pressed", String(b.dataset.v === val)); }); }

  /* ---------- main ---------- */
  Promise.all([
    fetch("data/stato.json", { cache: "no-cache" }).then(function (r) { return r.json(); }),
    load("serie_nazionale.csv"), load("presenze_ipm.csv"), load("delitti_selezionati.csv"), load("documenti.csv"),
    load("capienze.csv").catch(function () { return []; }),
    load("serie_storica.csv").catch(function () { return []; }),
    load("trasferimenti_adulti.csv").catch(function () { return []; })
  ]).then(function (res) { start(res[0], res[1], res[2], res[3], res[4], res[5], res[6], res[7]); })
    .catch(function (e) {
      var s = $("#stamp"); s.textContent = "";
      var d = document.createElement("div"); d.className = "err";
      d.textContent = "Impossibile caricare i dati: " + e.message;
      s.appendChild(d);
    });

  function start(stato, serieRaw, ipmRaw, delRaw, docs, capRaw, storRaw, trasfRaw) {
    var serie = sortBy(serieRaw, "data_rif").map(function (r) {
      var o = { d: r.data_rif, anno: +r.anno, t: ts(r.data_rif) };
      ["presenti", "ingressi_totale", "ingressi_esclusi_trasf", "trasferimenti", "presenza_media_giornaliera",
        "trasf_adulti", "ingressi_italiani", "ingressi_stranieri", "eta_14_15", "eta_16_17", "eta_18_20", "eta_21_24", "italiani_m", "italiani_f", "stranieri_m", "stranieri_f"]
        .forEach(function (k) { o[k] = num(r[k]); });
      var s = (o.stranieri_m === null || o.stranieri_f === null) ? null : o.stranieri_m + o.stranieri_f;
      var tt = s === null || o.italiani_m === null || o.italiani_f === null ? null : s + o.italiani_m + o.italiani_f;
      o.quota_str = tt ? 100 * s / tt : null;
      return o;
    });
    var ipm = ipmRaw.map(function (r) {
      return { d: r.data_rif, anno: +r.anno, ipm: r.ipm, presenti: num(r.presenti), ingressi: num(r.ingressi_totale),
        esclusi: num(r.ingressi_esclusi_trasf), media: num(r.presenza_media_giornaliera) };
    });
    var del = delRaw.map(function (r) {
      return { d: r.data_rif, anno: +r.anno, delitto: r.delitto, naz: r.nazionalita, sesso: r.sesso, rip: r.riportato === "1", n: num(r.delitti) };
    });
    var ultimo = serie[serie.length - 1], prec = serie[serie.length - 2];
    var ANNO_Q = 2026; /* primo anno con documenti quindicinali */
    var ss = sortBy(storRaw, "anno").map(function (r) {
      return { a: +r.anno, ii: num(r.ingressi_italiani), is: num(r.ingressi_stranieri), it: num(r.ingressi_totale), mi: num(r.media_italiani), ms: num(r.media_stranieri), mt: num(r.media_totale) };
    });
    var haSS = ss.length > 0, ssA0 = haSS ? ss[0].a : 0, ssA1 = haSS ? ss[ss.length - 1].a : 0;

    /* testata */
    var st = $("#stamp"); st.textContent = "";
    [["Dati riferiti al ", fmtData(stato.ultimo_dato_riferito_al)], ["Ultima verifica dei dati ministeriali: ", fmtData(stato.verificato_il)]]
      .forEach(function (p) {
        var s = document.createElement("span"); s.appendChild(document.createTextNode(p[0]));
        var b = document.createElement("strong"); b.textContent = p[1]; s.appendChild(b); st.appendChild(s);
      });
    $("#m-docs").textContent = "Documenti inclusi: " + stato.documenti_inclusi + " (dal " + fmtData(stato.primo_dato_riferito_al) + " al " + fmtData(stato.ultimo_dato_riferito_al) + ")";
    var probs = (stato.documenti_con_problemi || []);
    var al = $("#alert");
    var msg = [];
    if (probs.length) msg.push(probs.length + " documento/i non incluso/i perché i controlli di coerenza non sono passati: " + probs.join("; ") + ".");
    if (stato.nota_sito) msg.push(stato.nota_sito);
    if (msg.length) { al.textContent = msg.join(" "); al.hidden = false; }

    /* variazioni: aggiornamento precedente e stesso periodo dell'anno prima */
    function sg(v, f) { return (v > 0 ? "+" : v < 0 ? "−" : "") + (f ? f(Math.abs(v)) : NF.format(Math.abs(v))); }
    function varTxt(a, b) {
      var d = a - b;
      return sg(d) + (b ? " (" + sg(100 * d / b, function (x) { return NF1.format(x) + "%"; }) + ")" : "");
    }
    function annoPrec(r) {
      var x0 = new Date(r.t), target = Date.UTC(r.anno - 1, x0.getUTCMonth(), x0.getUTCDate()), best = null;
      serie.forEach(function (x) {
        if (x.anno !== r.anno - 1) return;
        var dd = Math.abs(x.t - target) / 864e5;
        if (dd <= 10 && (!best || dd < best.dd)) best = { r: x, dd: dd };
      });
      return best && best.r;
    }
    function confronto(campo) {
      for (var i = serie.length - 1; i >= 0; i--) {
        var r = serie[i];
        if (r.anno !== ultimo.anno) break;
        if (r[campo] === null) continue;
        var p = annoPrec(r);
        if (p && p[campo] !== null) return { r: r, p: p, ultimo: i === serie.length - 1 };
      }
      return null;
    }
    function notaAnno(campo, sing, plur) {
      var c = confronto(campo);
      if (!c) return "Confronto con lo stesso periodo dell’anno precedente non disponibile";
      var d = c.r[campo] - c.p[campo];
      var v = sg(d) + " " + (Math.abs(d) === 1 ? sing : plur) + (c.p[campo] ? " (" + sg(100 * d / c.p[campo], function (x) { return NF1.format(x) + "%"; }) + ")" : "");
      if (c.ultimo) return "Rispetto allo stesso periodo del " + c.p.anno + ": " + v + " rispetto al " + fmtData(c.p.d);
      return "Ultimo confronto possibile con lo stesso periodo del " + c.p.anno + ": al " + fmtData(c.r.d) + ", " + v + " rispetto al " + fmtData(c.p.d);
    }
    function notaQuota() {
      var c = confronto("quota_str");
      if (!c) return "Confronto con lo stesso periodo dell’anno precedente non disponibile";
      var d = c.r.quota_str - c.p.quota_str;
      var pp = (d > 0 ? "+" : d < 0 ? "−" : "") + NF1.format(Math.abs(d)) + " punti percentuali";
      if (c.ultimo) return "Rispetto allo stesso periodo del " + c.p.anno + ": sono il " + NF1.format(c.r.quota_str) + "%, contro il " + NF1.format(c.p.quota_str) + "% del " + fmtData(c.p.d) + " (" + pp + ")";
      return "Ultimo confronto possibile con lo stesso periodo del " + c.p.anno + ": al " + fmtData(c.r.d) + " erano il " + NF1.format(c.r.quota_str) + "%, contro il " + NF1.format(c.p.quota_str) + "% del " + fmtData(c.p.d) + " (" + pp + ")";
    }
    var kp = $("#kpis"); kp.textContent = "";
    /* i numeri dei riquadri “contano” da zero al caricamento (disattivato se il dispositivo chiede meno animazioni) */
    function contatore(el, finale) {
      var m = /^([\d.]+)(?:,(\d+))?(.*)$/.exec(finale);
      if (!m || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
      var tgt = parseFloat(m[1].replace(/\./g, "") + (m[2] ? "." + m[2] : "")), dec = m[2] ? m[2].length : 0, suf = m[3] || "", t0 = null, dur = 1100;
      var f = new Intl.NumberFormat("it-IT", { useGrouping: "always", minimumFractionDigits: dec, maximumFractionDigits: dec });
      function passo(ts) {
        if (t0 === null) t0 = ts;
        var p = Math.min(1, (ts - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        el.textContent = p >= 1 ? finale : f.format(tgt * e) + suf;
        if (p < 1) requestAnimationFrame(passo);
      }
      el.textContent = f.format(0) + suf;
      requestAnimationFrame(passo);
    }
    function kpi(label, value, notes, conf) {
      var k = document.createElement("div"); k.className = "kpi";
      var l = document.createElement("div"); l.className = "label"; l.textContent = label; k.appendChild(l);
      var v = document.createElement("div"); v.className = "value"; v.textContent = value; k.appendChild(v);
      contatore(v, value);
      notes.forEach(function (t) { var n = document.createElement("div"); n.className = "note"; n.textContent = t; k.appendChild(n); });
      if (conf) { var f = document.createElement("div"); f.className = "note conf"; f.textContent = conf; k.appendChild(f); }
      kp.appendChild(k);
    }
    kpi("Presenti negli Ipm", fmtN(ultimo.presenti), [
      "al " + fmtData(ultimo.d),
      prec ? sg(ultimo.presenti - prec.presenti) + " rispetto al " + fmtData(prec.d) + ", aggiornamento precedente" : ""
    ].filter(Boolean), notaAnno("presenti", "detenuto", "detenuti"));
    kpi("Ingressi da inizio " + ultimo.anno, fmtN(ultimo.ingressi_totale), [
      "dal 1° gennaio al " + fmtData(ultimo.d) + ", compresi i trasferimenti"
    ], notaAnno("ingressi_totale", "ingresso", "ingressi"));
    var str = ultimo.stranieri_m + ultimo.stranieri_f, tot = str + ultimo.italiani_m + ultimo.italiani_f;
    kpi("Stranieri tra i presenti", NF1.format(100 * str / tot) + "%", [fmtN(str) + " su " + fmtN(tot) + " · al " + fmtData(ultimo.d)], notaQuota());

    ["c-presenze", "c-ingressi", "c-ingressi-naz", "c-trasf", "c-eta", "c-chi", "c-delitti", "c-ipm-conf", "c-ipm-one"].forEach(function (id) { wireTableBtn(document.getElementById(id)); });

    var ultimoPerAnno = {};
    serie.forEach(function (r) { ultimoPerAnno[r.anno] = r.d; });
    var anniDel = Object.keys(ultimoPerAnno).map(Number).sort();
    var tMin = serie[0].t - 30 * DAY, tMax = ultimo.t + 30 * DAY;
    var titleDate = function (it) { return fmtTs(it.parsed.x); };

    /* 1. presenze: serie storica (media annua) + situazione attuale, oppure solo i dati quindicinali del 2026 */
    var cPres = document.getElementById("c-presenze"), stPres = { vista: haSS ? "storica" : "anno" };
    var rec = serie.filter(function (r) { return r.anno >= ANNO_Q; });
    function drawPresenze() {
      var st = stPres.vista === "storica", head, rows;
      if (st) {
        var med = ss.map(function (r) { return { x: r.a, y: r.mt }; });
        var cur = [{ x: ultimo.anno, y: ultimo.presenti }];
        var d1 = lineDs("Media annua", med, cat(0), { r: window.innerWidth < 600 ? 2 : 3 });
        var d2 = lineDs("Situazione al " + fmtData(ultimo.d), cur, cat(3), { r: 6 });
        legend(cPres, [{ label: d1.label, color: cat(0) }, { label: d2.label, color: cat(3) }]);
        /* tratteggio dall’ultimo dato consolidato alla situazione attuale */
        var d3 = lineDs("raccordo", [med[med.length - 1], cur[0]], cat(0), { r: 0 });
        d3.borderDash = [5, 4]; d3.pointHitRadius = 0; d3.pointHoverRadius = 0; d3.borderWidth = 1.5; d3.order = 2;
        var op = baseOptions({
          mode: "nearest",
          title: function () { return ""; },
          scales: function (g, m) { return { x: yearScale(ssA0 - 0.5, ultimo.anno + 0.5, g, m, ultimo.anno), y: yScale(g, m, "presenti", { suggestedMax: 650 }) }; }
        });
        op.plugins.tooltip.filter = function (it) { return it.datasetIndex !== 2; };
        op.plugins.tooltip.callbacks.label = function (it) {
          return it.datasetIndex === 1 ? fmtData(ultimo.d) + ": " + NF.format(it.parsed.y) + " (presenti alla data)" : it.parsed.x + ": " + NF.format(it.parsed.y) + " (presenza media giornaliera)";
        };
        render("c-presenze", { type: "line", data: { datasets: [d1, d2, d3] }, options: op });
        head = ["Anno", "Presenza media giornaliera"];
        rows = ss.map(function (r) { return [String(r.a), r.mt]; }).concat([["Situazione al " + fmtData(ultimo.d), ultimo.presenti]]);
        $("#d-presenze").textContent = "Detenuti presenti negli istituti: media annua (" + ssA0 + "-" + ssA1 + ") e situazione attuale (all’ultimo aggiornamento)";
        $("#n-presenze").textContent = "La media annua è la presenza media giornaliera di ciascun anno solare; la situazione attuale è il numero di presenti alla data del documento più recente. Sono due misure diverse e non si confrontano direttamente.";
      } else {
        legend(cPres, []);
        var pts = rec.map(function (r) { return { x: r.t, y: r.presenti }; });
        var t0 = Date.UTC(ANNO_Q, 0, 1) - 10 * DAY, t1 = ultimo.t + 10 * DAY;
        render("c-presenze", {
          type: "line", data: { datasets: [lineDs("Presenti", pts, cat(0), { r: 4 })] },
          options: baseOptions({ title: titleDate, scales: function (g, m) { return { x: dateScale(t0, t1, g, m), y: yScale(g, m, "presenti", { suggestedMax: 650 }) }; } })
        });
        head = ["Data di riferimento", "Presenti"];
        rows = rec.map(function (r) { return [fmtData(r.d), r.presenti]; });
        $("#d-presenze").textContent = "Detenuti presenti negli istituti a ciascuna data di riferimento " + (ultimo.anno > ANNO_Q ? "dal " : "del ") + ANNO_Q;
        $("#n-presenze").textContent = "Dati quindicinali " + (ultimo.anno > ANNO_Q ? "dal " : "del ") + ANNO_Q + ": fotografia dei presenti alla data di ciascun documento.";
      }
      tableView(cPres, head, rows);
    }
    seg($('[data-ctl="vista"]', cPres), [{ v: "storica", label: "Serie storica" }, { v: "anno", label: "Andamento " + (ultimo.anno > ANNO_Q ? "dal " : "") + ANNO_Q }], stPres.vista, function (v) { stPres.vista = v; drawPresenze(); });

    /* 2. ingressi per anno: serie storica (esclusi i trasferimenti) + dato parziale dell’anno in corso */
    var cIng = document.getElementById("c-ingressi");
    function drawIngressi() {
      var rows = ss.map(function (r) { return { a: r.a, v: r.it, corrente: false }; });
      if (ultimo.ingressi_esclusi_trasf !== null && ultimo.anno > ssA1) rows.push({ a: ultimo.anno, v: ultimo.ingressi_esclusi_trasf, corrente: true });
      if (!rows.length) { $("#n-ingressi").textContent = "Serie storica non trovata: carica il file serie_storica.csv nella cartella docs/data del repository"; return; }
      var picco = rows.reduce(function (m, r) { return !r.corrente && r.v > m.v ? r : m; }, rows[0]);
      var ultimoChiuso = rows.filter(function (r) { return !r.corrente; }).pop();
      var cClosed = cat(0), cCur = cat(1), small = window.innerWidth < 600;
      legend(cIng, [{ label: "Anno concluso", color: cClosed }, { label: "Anno in corso (dato parziale)", color: cCur }]);
      $("#d-ingressi").textContent = "Ingressi di ciascun anno, esclusi i trasferimenti tra istituti: " + rows[0].a + "-" + ultimoChiuso.a + " e dato parziale del " + ultimo.anno + " al " + fmtData(ultimo.d);
      render("c-ingressi", {
        type: "bar",
        data: {
          labels: rows.map(function (r) { return String(r.a); }),
          datasets: [{
            label: "Ingressi", data: rows.map(function (r) { return r.v; }),
            backgroundColor: rows.map(function (r) { return r.corrente ? cCur : cClosed; }),
            borderWidth: 0, borderRadius: 2, borderSkipped: "bottom", maxBarThickness: 22
          }]
        },
        options: (function () {
          var o = baseOptions({
            mode: "index", vAxis: "y", nullText: "non disponibile",
            title: function (it) { var r = rows[it.dataIndex]; return r.corrente ? "Anno " + r.a + " · dato parziale al " + fmtData(ultimo.d) : "Anno " + r.a; },
            scales: function (g, m) {
              return {
                x: { grid: { display: false }, border: { color: g }, ticks: { color: m, maxRotation: 0, autoSkip: false, font: { size: small ? 11 : 12 },
                  callback: function (v, i) { var a = rows[i].a; return (a === ssA0 || a % (small ? 10 : 5) === 0) && !rows[i].corrente ? String(a) : ""; } } },
                y: yScale(g, m, small ? "" : "ingressi nell’anno", {})
              };
            }
          });
          o.datasets = { bar: { categoryPercentage: 0.9, barPercentage: 0.85 } };
          o.layout.padding.top = 22;
          o.plugins.barLabels = { on: true, fmt: function (v, j) { var r = rows[j]; return (r === picco || r === ultimoChiuso) ? NF.format(v) : ""; } };
          return o;
        })()
      });
      tableView(cIng, ["Anno", "Ingressi nell’anno"], rows.map(function (r) { return [r.corrente ? r.a + " (parziale, al " + fmtData(ultimo.d) + ")" : String(r.a), r.v]; }));
      var n = "Gli ingressi escludono i trasferimenti tra istituti.";
      if (rows[rows.length - 1].corrente) n += " Il dato " + ultimo.anno + " è parziale e arriva fino al " + fmtData(ultimo.d) + ": comprendendo i trasferimenti gli ingressi sarebbero " + fmtN(ultimo.ingressi_totale) + ".";
      $("#n-ingressi").textContent = n;
    }

    /* 2b. ingressi per nazionalità: linee anno per anno */
    var cIN = document.getElementById("c-ingressi-naz"), stIN = { modo: "ass" };
    function drawIngNaz() {
      if (!haSS) return;
      var pct = stIN.modo === "pct", small = window.innerWidth < 600;
      var parz = ultimo.anno > ssA1 && ultimo.ingressi_italiani !== null && ultimo.ingressi_stranieri !== null;
      var ult = parz ? ultimo.anno : ssA1;
      var defs = [["Italiani", function (r) { return r.ii; }], ["Stranieri", function (r) { return r.is; }]];
      var base = ss.map(function (r) { return { a: r.a, ii: r.ii, is: r.is, it: r.it }; });
      if (parz) base.push({ a: ultimo.anno, ii: ultimo.ingressi_italiani, is: ultimo.ingressi_stranieri, it: ultimo.ingressi_italiani + ultimo.ingressi_stranieri, p: true });
      var ds = defs.map(function (d, i) {
        var x = lineDs(d[0], base.map(function (r) { return { x: r.a, y: pct ? 100 * d[1](r) / r.it : d[1](r) }; }), cat(i), { r: small ? 2 : 3 });
        if (parz) {
          var n = base.length - 1;
          x.segment = { borderDash: function (c) { return c.p1DataIndex === n ? [4, 4] : undefined; } };
          x.pointRadius = base.map(function (_, k) { return k === n ? 6 : (small ? 2 : 3); });
        }
        return x;
      });
      legend(cIN, ds.map(function (d) { return { label: d.label, color: d.borderColor }; }));
      render("c-ingressi-naz", {
        type: "line", data: { datasets: ds },
        options: baseOptions({
          endLabels: true, fmt: pct ? function (v) { return NF1.format(v) + "%"; } : null,
          title: function (it) { return it.parsed.x === ultimo.anno && parz ? "Anno " + it.parsed.x + " · dato parziale al " + fmtData(ultimo.d) : "Anno " + it.parsed.x; },
          scales: function (g, m) {
            return { x: yearScale(ssA0 - 0.5, ult + 0.5, g, m, ult), y: yScale(g, m, small ? "" : (pct ? "% sugli ingressi" : "ingressi nell’anno"), pct ? { max: 100, ticks: { color: m, callback: function (v) { return v + "%"; } } } : {}) };
          }
        })
      });
      tableView(cIN, ["Anno"].concat(defs.map(function (d) { return d[0] + (pct ? " (%)" : ""); })),
        base.map(function (r) { return [r.p ? r.a + " (parziale, al " + fmtData(ultimo.d) + ")" : String(r.a)].concat(defs.map(function (d) { return pct ? Math.round(1000 * d[1](r) / r.it) / 10 : d[1](r); })); }));
      $("#n-ingressi-naz").textContent = "Gli ingressi escludono i trasferimenti tra istituti." + (parz ? " Il dato " + ultimo.anno + " è parziale: il tratteggio lo collega all’ultimo anno concluso e arriva fino al " + fmtData(ultimo.d) + "." : " Il dettaglio per nazionalità dell’anno in corso non è ancora disponibile.");
    }
    seg($('[data-ctl="modo"]', cIN), [{ v: "ass", label: "Valori assoluti" }, { v: "pct", label: "% sul totale" }], "ass", function (v) { stIN.modo = v; drawIngNaz(); });

    /* 2c. trasferimenti verso strutture per adulti: serie annuale + parziale dell’anno in corso, oppure andamento cumulato dell’anno */
    var cTr = document.getElementById("c-trasf"), stTr = { vista: "storica" };
    var trasf = trasfRaw.map(function (r) { return { a: +r.anno, v: num(r.trasferimenti_adulti) }; }).sort(function (x, y) { return x.a - y.a; });
    var recT = serie.filter(function (r) { return r.anno >= ANNO_Q && r.trasf_adulti !== null; });
    var trUlt = recT.length ? recT[recT.length - 1] : null;
    function drawTrasf() {
      var small = window.innerWidth < 600, nota = "Detenuti maggiorenni che lasciano un Ipm per una struttura per adulti";
      if (stTr.vista === "storica") {
        var rows = trasf.map(function (r) { return { a: r.a, v: r.v, corrente: false }; });
        if (trUlt && (!rows.length || trUlt.anno > rows[rows.length - 1].a)) rows.push({ a: trUlt.anno, v: trUlt.trasf_adulti, corrente: true });
        if (!rows.length) { $("#n-trasf").textContent = "Dati non trovati: carica il file trasferimenti_adulti.csv nella cartella docs/data del repository"; return; }
        var cC = cat(0), cP = cat(1);
        legend(cTr, [{ label: "Anno concluso", color: cC }, { label: "Anno in corso (dato parziale)", color: cP }]);
        var chiusi = rows.filter(function (r) { return !r.corrente; });
        $("#d-trasf").textContent = nota + ": " + rows[0].a + "-" + chiusi[chiusi.length - 1].a + (trUlt ? " e dato parziale del " + trUlt.anno + " al " + fmtData(trUlt.d) : "");
        render("c-trasf", {
          type: "bar",
          data: { labels: rows.map(function (r) { return String(r.a); }), datasets: [{
            label: "Trasferiti", data: rows.map(function (r) { return r.v; }),
            backgroundColor: rows.map(function (r) { return r.corrente ? cP : cC; }), borderWidth: 0, borderRadius: 3, borderSkipped: "bottom", maxBarThickness: 36 }] },
          options: (function () {
            var o = baseOptions({
              mode: "index", vAxis: "y",
              title: function (it) { var r = rows[it.dataIndex]; return r.corrente ? "Anno " + r.a + " · dato parziale al " + fmtData(trUlt.d) : "Anno " + r.a; },
              scales: function (g, m) {
                return { x: { grid: { display: false }, border: { color: g }, ticks: { color: m, maxRotation: 0, autoSkip: false, font: { size: small ? 10 : 12 },
                  callback: function (v, i) { return small && rows[i].a % 4 !== 3 && !rows[i].corrente ? "" : String(rows[i].a); } } },
                  y: yScale(g, m, small ? "" : "detenuti trasferiti nell’anno", {}) };
              }
            });
            o.layout.padding.top = 22; o.plugins.barLabels = { on: true };
            return o;
          })()
        });
        tableView(cTr, ["Anno", "Trasferiti a strutture per adulti"], rows.map(function (r) { return [r.corrente ? r.a + " (parziale, al " + fmtData(trUlt.d) + ")" : String(r.a), r.v]; }));
        $("#n-trasf").textContent = trUlt ? "Il dato " + trUlt.anno + " è cumulato da inizio anno fino al " + fmtData(trUlt.d) + ": non è ancora un anno completo." : "";
      } else {
        legend(cTr, []);
        if (!recT.length) {
          var vecchio = charts.get("c-trasf"); if (vecchio) { vecchio.destroy(); charts.delete("c-trasf"); }
          tableView(cTr, ["Data di riferimento", "Trasferiti da inizio anno"], []);
          $("#d-trasf").textContent = nota;
          $("#n-trasf").textContent = "Dato in aggiornamento: non ancora disponibile per l’anno in corso.";
          return;
        }
        var pts = recT.map(function (r) { return { x: r.t, y: r.trasf_adulti }; });
        var t0 = Date.UTC(ANNO_Q, 0, 1) - 10 * DAY, t1 = ultimo.t + 10 * DAY;
        $("#d-trasf").textContent = nota + ": totale cumulato da inizio anno a ciascuna data di riferimento";
        render("c-trasf", {
          type: "line", data: { datasets: [lineDs("Trasferiti da inizio anno", pts, cat(1), { r: 4 })] },
          options: baseOptions({ title: titleDate, scales: function (g, m) { return { x: dateScale(t0, t1, g, m), y: yScale(g, m, "trasferiti da inizio anno", {}) }; } })
        });
        tableView(cTr, ["Data di riferimento", "Trasferiti da inizio anno"], recT.map(function (r) { return [fmtData(r.d), r.trasf_adulti]; }));
        $("#n-trasf").textContent = "Il dato è cumulato da inizio anno e riparte da zero a gennaio.";
      }
    }
    seg($('[data-ctl="vista"]', cTr), [{ v: "storica", label: "Serie storica" }, { v: "anno", label: "Andamento " + (ultimo.anno > ANNO_Q ? "dal " : "") + ANNO_Q }], "storica", function (v) { stTr.vista = v; drawTrasf(); });

    /* 3. età */
    var cEta = document.getElementById("c-eta"), stEta = { modo: "ass" };
    var ETA = [["eta_14_15", "14-15"], ["eta_16_17", "16-17"], ["eta_18_20", "18-20"], ["eta_21_24", "21-24"]];
    function drawEta() {
      var pct = stEta.modo === "pct", rows = serie.filter(function (r) { return ETA.every(function (e) { return r[e[0]] !== null; }); });
      var ds = ETA.map(function (e, i) {
        var col = cat(i);
        return lineDs(e[1] + " anni", rows.map(function (r) {
          var tot = ETA.reduce(function (s, x) { return s + r[x[0]]; }, 0);
          return { x: r.t, y: pct ? 100 * r[e[0]] / tot : r[e[0]] };
        }), col);
      });
      legend(cEta, ds.map(function (d) { return { label: d.label, color: d.borderColor }; }));
      render("c-eta", {
        type: "line", data: { datasets: ds },
        options: baseOptions({
          endLabels: true, title: titleDate, fmt: pct ? function (v) { return NF1.format(v) + "%"; } : null,
          scales: function (g, m) {
            return { x: dateScale(tMin, tMax, g, m), y: yScale(g, m, pct ? "% dei presenti" : "presenti", pct ? { suggestedMax: 60, ticks: { color: m, callback: function (v) { return v + "%"; } } } : {}) };
          }
        })
      });
      tableView(cEta, ["Data di riferimento"].concat(ETA.map(function (e) { return e[1] + " anni" + (pct ? " (%)" : ""); })),
        rows.map(function (r) {
          var tot = ETA.reduce(function (s, x) { return s + r[x[0]]; }, 0);
          return [fmtData(r.d)].concat(ETA.map(function (e) { return pct ? Math.round(1000 * r[e[0]] / tot) / 10 : r[e[0]]; }));
        }));
    }
    seg($('[data-ctl="modo"]', cEta), [{ v: "ass", label: "Valori assoluti" }, { v: "pct", label: "% sul totale" }], "ass", function (v) { stEta.modo = v; drawEta(); });

    /* 4. nazionalità / genere: serie storica (media annua, solo nazionalità) oppure dal 2020 alla data di riferimento */
    var cChi = document.getElementById("c-chi"), stChi = { dim: "naz", modo: "ass", fonte: haSS ? "storica" : "rec" };
    function drawChi() {
      var pct = stChi.modo === "pct", st = stChi.fonte === "storica", small = window.innerWidth < 600;
      var segP = $('[data-card="c-chi"]', cChi); if (segP) segP.style.display = st ? "none" : "";
      var fmtP = pct ? function (v) { return NF1.format(v) + "%"; } : null;
      if (st) {
        var defs = [["Italiani", function (r) { return r.mi; }], ["Stranieri", function (r) { return r.ms; }]];
        var curV = [ultimo.italiani_m + ultimo.italiani_f, ultimo.stranieri_m + ultimo.stranieri_f], curT = curV[0] + curV[1];
        var ds = defs.map(function (d, i) {
          var pts = ss.map(function (r) { return { x: r.a, y: pct ? 100 * d[1](r) / r.mt : d[1](r) }; });
          pts.push({ x: ultimo.anno, y: pct ? 100 * curV[i] / curT : curV[i] });
          var x = lineDs(d[0], pts, cat(i), { r: small ? 2 : 3 });
          var n = pts.length - 1;
          x.segment = { borderDash: function (c) { return c.p1DataIndex === n ? [4, 4] : undefined; } };
          x.pointRadius = pts.map(function (_, k) { return k === n ? 6 : (small ? 2 : 3); });
          return x;
        });
        legend(cChi, ds.map(function (d) { return { label: d.label, color: d.borderColor }; }));
        render("c-chi", {
          type: "line", data: { datasets: ds },
          options: baseOptions({
            endLabels: true, fmt: fmtP,
            title: function (it) { return it.parsed.x === ultimo.anno ? "Situazione al " + fmtData(ultimo.d) + " (presenti alla data)" : "Media del " + it.parsed.x + " (presenza media giornaliera)"; },
            scales: function (g, m) {
              return { x: yearScale(ssA0 - 0.5, ultimo.anno + 0.5, g, m, ultimo.anno), y: yScale(g, m, small ? "" : (pct ? "% dei presenti" : "presenti"), pct ? { max: 100, ticks: { color: m, callback: function (v) { return v + "%"; } } } : {}) };
            }
          })
        });
        tableView(cChi, ["Anno"].concat(defs.map(function (d) { return d[0] + (pct ? " (%)" : ""); })),
          ss.map(function (r) { return [String(r.a)].concat(defs.map(function (d) { return pct ? Math.round(1000 * d[1](r) / r.mt) / 10 : d[1](r); })); })
            .concat([["Situazione al " + fmtData(ultimo.d)].concat(curV.map(function (v) { return pct ? Math.round(1000 * v / curT) / 10 : v; }))]));
        $("#d-chi").textContent = "Presenza media giornaliera di ciascun anno (" + ssA0 + "-" + ssA1 + ") e situazione attuale";
        $("#n-chi").textContent = "Il tratteggio collega la media annua alla situazione attuale (presenti alla data del documento più recente), che è una misura diversa. Per genere i dati sono disponibili solo dal 2020.";
        return;
      }
      var defs2 = stChi.dim === "naz"
        ? [["Italiani", function (r) { return r.italiani_m + r.italiani_f; }], ["Stranieri", function (r) { return r.stranieri_m + r.stranieri_f; }]]
        : [["Maschi", function (r) { return r.italiani_m + r.stranieri_m; }], ["Femmine", function (r) { return r.italiani_f + r.stranieri_f; }]];
      var rows = serie.filter(function (r) { return r.italiani_m !== null; });
      var tot = function (r) { return r.italiani_m + r.italiani_f + r.stranieri_m + r.stranieri_f; };
      var ds2 = defs2.map(function (d, i) {
        return lineDs(d[0], rows.map(function (r) { return { x: r.t, y: pct ? 100 * d[1](r) / tot(r) : d[1](r) }; }), cat(i));
      });
      legend(cChi, ds2.map(function (d) { return { label: d.label, color: d.borderColor }; }));
      render("c-chi", {
        type: "line", data: { datasets: ds2 },
        options: baseOptions({
          endLabels: true, title: titleDate, fmt: fmtP,
          scales: function (g, m) {
            return { x: dateScale(tMin, tMax, g, m), y: yScale(g, m, pct ? "% dei presenti" : "presenti", pct ? { max: 100, ticks: { color: m, callback: function (v) { return v + "%"; } } } : {}) };
          }
        })
      });
      tableView(cChi, ["Data di riferimento"].concat(defs2.map(function (d) { return d[0] + (pct ? " (%)" : ""); })),
        rows.map(function (r) { return [fmtData(r.d)].concat(defs2.map(function (d) { return pct ? Math.round(1000 * d[1](r) / tot(r)) / 10 : d[1](r); })); }));
      $("#d-chi").textContent = "Presenti alla data di riferimento";
      $("#n-chi").textContent = "";
    }
    var segFonte = $('[data-ctl="fonte"]', cChi), segDim = $('[data-ctl="dim"]', cChi);
    if (haSS) seg(segFonte, [{ v: "storica", label: "Serie storica" }, { v: "rec", label: "Dal 2020" }], stChi.fonte, function (v) { stChi.fonte = v; if (v === "storica") { stChi.dim = "naz"; setPressed(segDim, "naz"); } drawChi(); });
    else segFonte.style.display = "none";
    seg(segDim, [{ v: "naz", label: "Nazionalità" }, { v: "sesso", label: "Genere" }], "naz", function (v) {
      stChi.dim = v;
      if (v === "sesso" && stChi.fonte === "storica") { stChi.fonte = "rec"; setPressed(segFonte, "rec"); }
      drawChi();
    });
    seg($('[data-ctl="modo"]', cChi), [{ v: "ass", label: "Valori assoluti" }, { v: "pct", label: "% sul totale" }], "ass", function (v) { stChi.modo = v; drawChi(); });

    /* 5. delitti: ultimo documento di ogni anno */
    var cDel = document.getElementById("c-delitti");
    var NOMI = {
      omicidio_volontario_consumato: "Omicidio volontario consumato", omicidio_volontario_tentato: "Omicidio volontario tentato",
      violenze_sessuali: "Violenze sessuali", furto: "Furto", rapina: "Rapina", stupefacenti: "Stupefacenti"
    };
    var stDel = { reato: "rapina", scomp: "tot" };
    function valDel(anno, reato, naz, sesso) {
      /* il file ha 9 righe per reato (italiani/stranieri/totale x m/f/mf): se ne prende UNA sola, mai la somma */
      var nz = naz || "totale", sx = sesso || "mf";
      var d = ultimoPerAnno[anno], rows = del.filter(function (r) {
        return r.d === d && r.delitto === reato && r.naz === nz && r.sesso === sx;
      });
      if (!rows.length || rows.some(function (r) { return !r.rip; })) return { v: null, d: d };
      return { v: rows.reduce(function (s, r) { return s + r.n; }, 0), d: d };
    }
    function drawDel() {
      var def = stDel.scomp === "tot" ? [["Tutti", null, null]]
        : stDel.scomp === "naz" ? [["Italiani", "italiani", null], ["Stranieri", "stranieri", null]]
          : [["Maschi", null, "m"], ["Femmine", null, "f"]];
      var labels = anniDel.map(function (a) {
        var d = ultimoPerAnno[a], p = d.split("-");
        if (window.innerWidth < 600) return (+p[1] === 12 && +p[2] === 31) ? String(a) : [String(a), "parziale"];
        return [String(a), "al " + (+p[2]) + " " + MESI_LUNGHI[+p[1] - 1]];
      });
      var ds = def.map(function (x, i) {
        return {
          label: x[0], backgroundColor: cat(i), borderColor: cat(i), borderWidth: 0, borderRadius: 4, borderSkipped: "bottom",
          maxBarThickness: 36, data: anniDel.map(function (a) { return valDel(a, stDel.reato, x[1], x[2]).v; })
        };
      });
      legend(cDel, def.map(function (x, i) { return { label: x[0], color: cat(i) }; }));
      render("c-delitti", {
        type: "bar", data: { labels: labels, datasets: ds },
        options: (function () {
          var o = baseOptions({
            mode: "index", vAxis: "y",
            title: function (it) { return "Anno " + anniDel[it.dataIndex] + " · dati al " + fmtData(ultimoPerAnno[anniDel[it.dataIndex]]); },
            scales: function (g, m) {
              return { x: { grid: { display: false }, border: { color: g }, ticks: { color: m, maxRotation: 0, autoSkip: false, font: { size: window.innerWidth < 600 ? 11 : 12 } } }, y: yScale(g, m, window.innerWidth < 600 ? "" : "reati degli ingressi", {}) };
            }
          });
          o.datasets = { bar: { categoryPercentage: 0.8, barPercentage: 0.9 } };
          o.layout.padding.top = 22;
          if (ds.length === 1 || window.innerWidth >= 600) o.plugins.barLabels = { on: true };
          return o;
        })()
      });
      var head = ["Anno", "Dati al"].concat(def.map(function (x) { return x[0]; }));
      tableView(cDel, head, anniDel.map(function (a) {
        return [String(a), fmtData(ultimoPerAnno[a])].concat(def.map(function (x) { return valDel(a, stDel.reato, x[1], x[2]).v; }));
      }));
      var nr = anniDel.filter(function (a) { return valDel(a, stDel.reato, null, null).v === null; });
      $("#n-delitti").textContent = "I numeri contano i reati, non le persone: chi entra per più reati compare più volte." + (nr.length
        ? " Anni senza dato (reato non riportato nel file .pdf, quindi non necessariamente zero): " + nr.join(", ") + "."
        : "");
    }
    var sel = $('[data-ctl="reato"]', cDel);
    Object.keys(NOMI).forEach(function (k) {
      var o = document.createElement("option"); o.value = k; o.textContent = NOMI[k]; if (k === stDel.reato) o.selected = true; sel.appendChild(o);
    });
    sel.addEventListener("change", function () { stDel.reato = sel.value; drawDel(); });
    seg($('[data-ctl="scomp"]', cDel), [{ v: "tot", label: "Totale" }, { v: "naz", label: "Per nazionalità" }, { v: "sesso", label: "Per genere" }], "tot",
      function (v) { stDel.scomp = v; drawDel(); });

    /* 6. istituti */
    var ultimaData = ipm.reduce(function (m, r) { return r.d > m ? r.d : m; }, "");
    var ipmNomi = uniq(ipm.map(function (r) { return r.ipm; }));
    var attivi = ipm.filter(function (r) { return r.d === ultimaData; });
    var cap = {}; capRaw.forEach(function (r) { cap[r.ipm] = { posti: num(r.posti), genere: r.genere, info: r.info }; });
    var haCap = Object.keys(cap).length > 0;
    var FONTE_CAP = "Fonte: elaborazione sulla base delle capienze comunicate nella nota della Direzione generale del Personale e delle Risorse - Dipartimento per la Giustizia minorile e di Comunità, 9 ottobre 2026";
    var cConf = document.getElementById("c-ipm-conf"), stConf = { misura: "presenti" };
    var MIS = { presenti: "Presenti", ingressi: "Ingressi da inizio anno", media: "Presenza media giornaliera", affollamento: "Presenti su posti disponibili" };
    function drawConf() {
      var k = stConf.misura, aff = k === "affollamento";
      $("#d-ipm-conf").textContent = aff
        ? "Presenti al " + fmtData(ultimaData) + " in rapporto ai posti regolamentari: oltre il 100% l’istituto è sovraffollato"
        : "Dati al " + fmtData(ultimaData) + ". Un istituto con barra vuota non ha presenti in quella data";
      var rows = aff
        ? attivi.filter(function (r) { return cap[r.ipm] && r.presenti !== null; }).map(function (r) {
            return { ipm: r.ipm, presenti: r.presenti, posti: cap[r.ipm].posti, affollamento: 100 * r.presenti / cap[r.ipm].posti };
          }).sort(function (a, b) { return b.affollamento - a.affollamento; })
        : attivi.filter(function (r) { return r[k] !== null; }).sort(function (a, b) { return b[k] - a[k]; });
      var cRosso = cat(3), cBlu = cat(0);
      legend(cConf, aff ? [{ label: "Entro i posti disponibili", color: cBlu }, { label: "Oltre i posti disponibili", color: cRosso }] : []);
      var nota = $("#n-ipm-conf");
      nota.textContent = aff ? FONTE_CAP : "";
      if (aff) {
        if (!rows.length) nota.textContent = "Dati sulle capienze non trovati: carica il file capienze.csv nella cartella docs/data del repository";
        else {
        var senza = attivi.filter(function (r) { return !cap[r.ipm]; }).map(function (r) { return r.ipm; });
        nota.textContent = (senza.length ? "Senza capienza indicata nella nota: " + senza.join(", ") + ". " : "") + "Per Roma i " + (cap.Roma ? cap.Roma.posti : "") + " posti comprendono sezione maschile e femminile (" + (cap.Roma ? cap.Roma.info : "") + "), i presenti sono quelli complessivi.\n" + FONTE_CAP;
        }
      }
      var host = $("#p-ipm-conf"); host.style.height = (rows.length * 26 + 56) + "px";
      render("c-ipm-conf", {
        type: "bar", data: {
          labels: rows.map(function (r) { return r.ipm; }),
          datasets: [{ label: MIS[k], data: rows.map(function (r) { return aff ? Math.round(r.affollamento * 10) / 10 : r[k]; }), backgroundColor: aff ? rows.map(function (r) { return r.affollamento > 100 ? cRosso : cBlu; }) : cBlu, borderRadius: 4, borderSkipped: "start", maxBarThickness: 18 }]
        },
        options: (function () {
          var o = baseOptions({
            mode: "nearest", vAxis: "x", fmt: aff ? function (v) { return NF1.format(v) + "%"; } : k === "media" ? function (v) { return NF1.format(v); } : null,
            title: function (it) { return it.label; },
            scales: function (g, m) {
              return {
                x: aff ? yScale(g, m, "", { position: "top", suggestedMax: 120, ticks: { color: m, callback: function (v) { return NF.format(v) + "%"; } } }) : yScale(g, m, "", { position: "top" }),
                y: { grid: { display: false }, border: { color: g }, ticks: { color: m, autoSkip: false } }
              };
            }
          });
          if (aff) {
            o.plugins.tooltip.callbacks.afterLabel = function (it) { var r = rows[it.dataIndex]; return " " + NF.format(r.presenti) + " presenti su " + NF.format(r.posti) + " posti"; };
            o.plugins.ref100 = { on: true };
          }
          o.layout.padding.right = aff ? 120 : 46;
          o.plugins.barLabels = { on: true, fmt: aff ? function (v, j) { var r = rows[j]; return NF1.format(v) + "% (" + NF.format(r.presenti) + " su " + NF.format(r.posti) + ")"; } : (k === "media" ? function (v) { return NF1.format(v); } : null) };
          o.indexAxis = "y"; o.interaction = { mode: "nearest", axis: "y", intersect: false };
          return o;
        })()
      });
      if (aff) tableView(cConf, ["Istituto", "Posti", "Presenti", "Presenti su posti (%)"], rows.map(function (r) { return [r.ipm, r.posti, r.presenti, NF1.format(r.affollamento) + "%"]; }));
      else tableView(cConf, ["Istituto", MIS[k]], rows.map(function (r) { return [r.ipm, r[k]]; }));
    }
    seg($('[data-ctl="misura"]', cConf), [{ v: "presenti", label: "Presenti" }, { v: "ingressi", label: "Ingressi da inizio anno" }, { v: "media", label: "Presenza media" }].concat([{ v: "affollamento", label: "Sovraffollamento" }]), "presenti",
      function (v) { stConf.misura = v; drawConf(); });

    var cOne = document.getElementById("c-ipm-one"), selI = $('[data-ctl="ipm"]', cOne);
    var perUltimo = {}; attivi.forEach(function (r) { perUltimo[r.ipm] = r.presenti; });
    ipmNomi.sort(function (a, b) { return (perUltimo[b] === undefined ? -1 : perUltimo[b]) - (perUltimo[a] === undefined ? -1 : perUltimo[a]) || (a < b ? -1 : 1); });
    ipmNomi.forEach(function (n) {
      var o = document.createElement("option"); o.value = n; o.textContent = n + (perUltimo[n] === undefined ? " (assente nell’ultimo documento)" : ""); selI.appendChild(o);
    });
    function drawOne() {
      var n = selI.value, dates = serie.map(function (r) { return r.d; });
      var byD = {}; ipm.filter(function (r) { return r.ipm === n; }).forEach(function (r) { byD[r.d] = r; });
      var pts = dates.map(function (d) { return { x: ts(d), y: byD[d] ? byD[d].presenti : null }; });
      var present = dates.filter(function (d) { return byD[d]; });
      $("#d-ipm-one").textContent = present.length
        ? "Informazioni in database dal " + fmtData(present[0]) + " al " + fmtData(present[present.length - 1])
        : "";
      render("c-ipm-one", {
        type: "line", data: { datasets: [lineDs(n, pts, cat(0))] },
        options: baseOptions({ title: titleDate, scales: function (g, m) { return { x: dateScale(tMin, tMax, g, m), y: yScale(g, m, "presenti", { suggestedMax: 20 }) }; } })
      });
      tableView(cOne, ["Data di riferimento", "Presenti", "Ingressi da inizio anno", "Presenza media"],
        dates.map(function (d) { var r = byD[d]; return [fmtData(d), r ? r.presenti : null, r ? r.ingressi : null, r ? r.media : null]; }));
      $("#n-ipm-one").textContent = "Dove la linea si interrompe, l’istituto non compare nel documento (non ancora attivo, sospeso, o riga omessa).";
    }
    selI.addEventListener("change", drawOne);

    /* download */

    /* selettore del periodo: "tutto" oppure solo l’anno in corso (utile per leggere i dati quindicinali) */
    var segPeriodo = [];
    function setPeriodo(zoom) {
      zoomPeriodo = zoom;
      tMin = zoom ? Date.UTC(ANNO_Q, 0, 1) - 10 * DAY : serie[0].t - 30 * DAY;
      tMax = ultimo.t + (zoom ? 10 : 30) * DAY;
      segPeriodo.forEach(function (s) { Array.prototype.forEach.call(s.children, function (b) { b.setAttribute("aria-pressed", String((b.dataset.v === "anno") === zoom)); }); });
      drawEta(); drawChi(); drawOne();
    }
    ["c-eta", "c-chi", "c-ipm-one"].forEach(function (id) {
      var card = document.getElementById(id), ctl = $(".controls", card);
      if (!ctl) { ctl = document.createElement("div"); ctl.className = "controls"; card.insertBefore(ctl, $(".legend", card) || $(".plot", card)); }
      var s = document.createElement("div"); s.className = "seg"; s.dataset.card = id; ctl.appendChild(s); segPeriodo.push(s);
      seg(s, [{ v: "tutto", label: "Tutto il periodo" }, { v: "anno", label: (ultimo.anno > ANNO_Q ? "Dal " : "Solo ") + ANNO_Q }], "tutto", function (v) { setPeriodo(v === "anno"); });
    });
    function drawAll() { drawPresenze(); drawIngressi(); drawIngNaz(); drawTrasf(); drawEta(); drawChi(); drawDel(); drawConf(); drawOne(); }
    drawAll();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawAll);
    if (window.matchMedia) {
      var mq = matchMedia("(prefers-color-scheme: dark)");
      (mq.addEventListener ? mq.addEventListener.bind(mq, "change") : mq.addListener.bind(mq))(function () { drawAll(); });
    }
  }
})();
