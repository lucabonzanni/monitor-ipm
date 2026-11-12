/* Monitor Ipm – dashboard. Nessuna dipendenza oltre a Chart.js (vendor/). */
(function () {
  "use strict";

  var MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
  var MESI_LUNGHI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
  var DOY_MESI = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
  var NF = new Intl.NumberFormat("it-IT", { useGrouping: "always" });
  var NF1 = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1, useGrouping: "always" });

  var FONT = '"Plex Sans", -apple-system, "Segoe UI", Roboto, sans-serif';
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

  /* ---------- main ---------- */
  Promise.all([
    fetch("data/stato.json", { cache: "no-cache" }).then(function (r) { return r.json(); }),
    load("serie_nazionale.csv"), load("presenze_ipm.csv"), load("delitti_selezionati.csv"), load("documenti.csv"),
    load("capienze.csv").catch(function () { return []; })
  ]).then(function (res) { start(res[0], res[1], res[2], res[3], res[4], res[5]); })
    .catch(function (e) {
      var s = $("#stamp"); s.textContent = "";
      var d = document.createElement("div"); d.className = "err";
      d.textContent = "Impossibile caricare i dati: " + e.message;
      s.appendChild(d);
    });

  function start(stato, serieRaw, ipmRaw, delRaw, docs, capRaw) {
    var serie = sortBy(serieRaw, "data_rif").map(function (r) {
      var o = { d: r.data_rif, anno: +r.anno, t: ts(r.data_rif) };
      ["presenti", "ingressi_totale", "ingressi_esclusi_trasf", "trasferimenti", "presenza_media_giornaliera",
        "eta_14_15", "eta_16_17", "eta_18_20", "eta_21_24", "italiani_m", "italiani_f", "stranieri_m", "stranieri_f"]
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

    /* testata */
    var st = $("#stamp"); st.textContent = "";
    [["Dati riferiti al ", fmtData(stato.ultimo_dato_riferito_al)], ["Ultima verifica del sito: ", fmtData(stato.verificato_il)]]
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
    function kpi(label, value, notes, conf) {
      var k = document.createElement("div"); k.className = "kpi";
      var l = document.createElement("div"); l.className = "label"; l.textContent = label; k.appendChild(l);
      var v = document.createElement("div"); v.className = "value"; v.textContent = value; k.appendChild(v);
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

    ["c-presenze", "c-ingressi", "c-eta", "c-chi", "c-delitti", "c-ipm-conf", "c-ipm-one"].forEach(function (id) { wireTableBtn(document.getElementById(id)); });

    var ultimoPerAnno = {};
    serie.forEach(function (r) { ultimoPerAnno[r.anno] = r.d; });
    var anniDel = Object.keys(ultimoPerAnno).map(Number).sort();
    var tMin = serie[0].t - 30 * DAY, tMax = ultimo.t + 30 * DAY;
    var titleDate = function (it) { return fmtTs(it.parsed.x); };

    /* 1. presenze */
    function drawPresenze() {
      var pts = serie.map(function (r) { return { x: r.t, y: r.presenti }; });
      render("c-presenze", {
        type: "line", data: { datasets: [lineDs("Presenti", pts, cat(0))] },
        options: baseOptions({
          title: titleDate,
          scales: function (g, m) { return { x: dateScale(tMin, tMax, g, m), y: yScale(g, m, "presenti", { suggestedMax: 650 }) }; }
        })
      });
      tableView(document.getElementById("c-presenze"), ["Data di riferimento", "Presenti"], serie.map(function (r) { return [fmtData(r.d), r.presenti]; }));
    }

    /* 2. ingressi cumulati da inizio anno: una barra per anno */
    var cIng = document.getElementById("c-ingressi"), stIng = { misura: "ingressi_totale" };
    function drawIngressi() {
      var k = stIng.misura, righe = {};
      serie.forEach(function (r) { righe[r.d] = r; });
      var rows = anniDel.map(function (a) { var r = righe[ultimoPerAnno[a]]; return { a: a, d: r.d, v: r[k], corrente: a === ultimo.anno }; });
      $("#d-ingressi").textContent = "Totale degli ingressi di ciascun anno, dal " + rows[0].a + " al " + (rows.length > 1 ? rows[rows.length - 2].a : rows[0].a) + ", e dato parziale del " + ultimo.anno + " al " + fmtData(ultimo.d);
      var cClosed = cat(0), cCur = cat(1);
      legend(cIng, [{ label: "Anno concluso", color: cClosed }, { label: "Anno in corso (dato parziale)", color: cCur }]);
      render("c-ingressi", {
        type: "bar",
        data: {
          labels: rows.map(function (r) { var p = r.d.split("-"); return r.corrente ? [String(r.a), "parziale, al " + (+p[2]) + " " + MESI_LUNGHI[+p[1] - 1]] : String(r.a); }),
          datasets: [{
            label: "Ingressi", data: rows.map(function (r) { return r.v; }),
            backgroundColor: rows.map(function (r) { return r.corrente ? cCur : cClosed; }),
            borderWidth: 0, borderRadius: 4, borderSkipped: "bottom", maxBarThickness: 44
          }]
        },
        options: (function () {
          var o = baseOptions({
            mode: "index", vAxis: "y", nullText: "non disponibile",
            title: function (it) { return "Anno " + rows[it.dataIndex].a + " · dati al " + fmtData(rows[it.dataIndex].d); },
            scales: function (g, m) {
              return { x: { grid: { display: false }, border: { color: g }, ticks: { color: m, maxRotation: 0, autoSkip: false } }, y: yScale(g, m, "ingressi nell’anno", {}) };
            }
          });
          o.layout.padding.top = 22; o.plugins.barLabels = { on: true };
          return o;
        })()
      });
      tableView(cIng, ["Anno", "Dati al", "Ingressi nell’anno"], rows.map(function (r) { return [String(r.a), fmtData(r.d), r.v]; }));
      $("#n-ingressi").textContent = k === "ingressi_esclusi_trasf"
        ? "Gli ingressi esclusi i trasferimenti sono pubblicati solo dai documenti del 31 dicembre 2024 in poi."
        : "Il totale comprende i trasferimenti tra istituti. Il dato dell’anno in corso è parziale e arriva fino alla data indicata.";
    }
    seg($('[data-ctl="misura"]', cIng), [{ v: "ingressi_totale", label: "Totale" }, { v: "ingressi_esclusi_trasf", label: "Esclusi trasferimenti" }], stIng.misura,
      function (v) { stIng.misura = v; drawIngressi(); });

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
    seg($('[data-ctl="modo"]', cEta), [{ v: "ass", label: "Numeri" }, { v: "pct", label: "% sul totale" }], "ass", function (v) { stEta.modo = v; drawEta(); });

    /* 4. nazionalità / genere */
    var cChi = document.getElementById("c-chi"), stChi = { dim: "naz", modo: "ass" };
    function drawChi() {
      var pct = stChi.dim && stChi.modo === "pct";
      var defs = stChi.dim === "naz"
        ? [["Italiani", function (r) { return r.italiani_m + r.italiani_f; }], ["Stranieri", function (r) { return r.stranieri_m + r.stranieri_f; }]]
        : [["Maschi", function (r) { return r.italiani_m + r.stranieri_m; }], ["Femmine", function (r) { return r.italiani_f + r.stranieri_f; }]];
      var rows = serie.filter(function (r) { return r.italiani_m !== null; });
      var tot = function (r) { return r.italiani_m + r.italiani_f + r.stranieri_m + r.stranieri_f; };
      var ds = defs.map(function (d, i) {
        return lineDs(d[0], rows.map(function (r) { return { x: r.t, y: pct ? 100 * d[1](r) / tot(r) : d[1](r) }; }), cat(i));
      });
      legend(cChi, ds.map(function (d) { return { label: d.label, color: d.borderColor }; }));
      render("c-chi", {
        type: "line", data: { datasets: ds },
        options: baseOptions({
          endLabels: true, title: titleDate, fmt: pct ? function (v) { return NF1.format(v) + "%"; } : null,
          scales: function (g, m) {
            return { x: dateScale(tMin, tMax, g, m), y: yScale(g, m, pct ? "% dei presenti" : "presenti", pct ? { max: 100, ticks: { color: m, callback: function (v) { return v + "%"; } } } : {}) };
          }
        })
      });
      tableView(cChi, ["Data di riferimento"].concat(defs.map(function (d) { return d[0] + (pct ? " (%)" : ""); })),
        rows.map(function (r) { return [fmtData(r.d)].concat(defs.map(function (d) { return pct ? Math.round(1000 * d[1](r) / tot(r)) / 10 : d[1](r); })); }));
    }
    seg($('[data-ctl="dim"]', cChi), [{ v: "naz", label: "Nazionalità" }, { v: "sesso", label: "Genere" }], "naz", function (v) { stChi.dim = v; drawChi(); });
    seg($('[data-ctl="modo"]', cChi), [{ v: "ass", label: "Numeri" }, { v: "pct", label: "% sul totale" }], "ass", function (v) { stChi.modo = v; drawChi(); });

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
              return { x: { grid: { display: false }, border: { color: g }, ticks: { color: m, maxRotation: 0 } }, y: yScale(g, m, "reati degli ingressi", {}) };
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
      $("#n-delitti").textContent = nr.length
        ? "Anni senza dato (reato non riportato nel file .pdf, quindi non necessariamente zero): " + nr.join(", ") + "."
        : "I valori sono i reati per cui è avvenuto l’ingresso, non le persone.";
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
      tMin = zoom ? Date.UTC(ultimo.anno, 0, 1) - 10 * DAY : serie[0].t - 30 * DAY;
      tMax = ultimo.t + (zoom ? 10 : 30) * DAY;
      segPeriodo.forEach(function (s) { Array.prototype.forEach.call(s.children, function (b) { b.setAttribute("aria-pressed", String((b.dataset.v === "anno") === zoom)); }); });
      drawPresenze(); drawEta(); drawChi(); drawOne();
    }
    ["c-presenze", "c-eta", "c-chi", "c-ipm-one"].forEach(function (id) {
      var card = document.getElementById(id), ctl = $(".controls", card);
      if (!ctl) { ctl = document.createElement("div"); ctl.className = "controls"; card.insertBefore(ctl, $(".legend", card) || $(".plot", card)); }
      var s = document.createElement("div"); s.className = "seg"; ctl.appendChild(s); segPeriodo.push(s);
      seg(s, [{ v: "tutto", label: "Tutto il periodo" }, { v: "anno", label: "Solo " + ultimo.anno }], "tutto", function (v) { setPeriodo(v === "anno"); });
    });
    function drawAll() { drawPresenze(); drawIngressi(); drawEta(); drawChi(); drawDel(); drawConf(); drawOne(); }
    drawAll();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawAll);
    if (window.matchMedia) {
      var mq = matchMedia("(prefers-color-scheme: dark)");
      (mq.addEventListener ? mq.addEventListener.bind(mq, "change") : mq.addListener.bind(mq))(function () { drawAll(); });
    }
  }
})();
