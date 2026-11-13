"""Lettura dei PDF "Minorenni e giovani adulti in carico ai Servizi minorili"
(Dipartimento per la giustizia minorile e di comunità, Ministero della Giustizia),
limitata alle tabelle sugli Istituti penali per i minorenni (IPM).

Principi di progetto
- Le tabelle si riconoscono dal TITOLO, non dal numero (la numerazione cambia nel tempo).
- Ogni documento viene sottoposto a controlli di coerenza (somme, incroci tra tabelle).
- I controlli sui presenti sono "bloccanti" per l'intero documento; quelli sui delitti solo per la
  parte delitti: un errore nei delitti non fa buttare i dati sui presenti.
- Le righe di delitti assenti NON diventano zero: restano "non riportate" (riportato=0, valore vuoto).
"""
import re
import subprocess
from pathlib import Path

MESI = {m: i + 1 for i, m in enumerate(
    "gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre".split())}
NUM_FULL = re.compile(r"\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:,\d+)?")
MARKER_RE = re.compile(r"\s*\(\*+\)")
ETA = ["14-15 anni", "16-17 anni", "18-20 anni", "21-24 anni"]
NAZ = ["italiani", "stranieri", "totale"]
SESSO = ["m", "f", "mf"]
NAZ_SESSO = [(n, s) for n in NAZ for s in SESSO]  # ordine delle 9 colonne delle tabelle
CATEGORIE = {
    "Contro la persona",
    "Contro la famiglia, la moralità pubblica, il buon costume",
    "Contro il patrimonio",
    "Contro l'incolumità pubblica",
    "Contro la fede pubblica",
    "Contro Stato, altre istituzioni, ordine pubblico",
    "Altri delitti",
}
TARGET = {
    "Omicidio volontario consumato": "omicidio_volontario_consumato",
    "Omicidio volontario tentato": "omicidio_volontario_tentato",
    "Violenze sessuali": "violenze_sessuali",
    "Furto": "furto",
    "Rapina": "rapina",
    "Stupefacenti": "stupefacenti",
}


class ParseError(Exception):
    """Il documento non è leggibile con le regole attuali (tabella mancante, formato nuovo...)."""


def parse_num(tok):
    if "," in tok:
        return float(tok.replace(".", "").replace(",", "."))
    return int(tok.replace(".", ""))


def split_row(line):
    """(etichetta, [numeri]) leggendo i numeri dalla coda della riga."""
    toks = line.split()
    nums = []
    while toks and NUM_FULL.fullmatch(toks[-1]):
        nums.append(parse_num(toks.pop()))
    nums.reverse()
    return " ".join(toks), nums


def split_row_pos(line):
    """Come split_row, ma restituisce anche la colonna (posizione finale) di ogni numero."""
    toks = [(m.group(), m.end()) for m in re.finditer(r"\S+", line)]
    nums = []
    while toks and NUM_FULL.fullmatch(toks[-1][0]):
        t, e = toks.pop()
        nums.append((parse_num(t), e))
    nums.reverse()
    return " ".join(t for t, _ in toks), nums


def riempi_celle_vuote(rows, ncol):
    """Nei PDF una cella a zero può essere lasciata vuota. Le righe con meno numeri del previsto vengono
    completate (con 0) allineando ogni numero alla colonna più vicina, ricavata dalle righe complete.
    Si procede solo se le colonne di riferimento esistono e l'attribuzione è univoca; altrimenti la riga
    viene scartata (e i controlli di somma segnaleranno il problema)."""
    full = [[e for _, e in nums] for _, nums in rows if len(nums) == ncol]
    ref = None
    if full:
        ref = [sorted(col)[len(col) // 2] for col in zip(*full)]
    out = []
    for label, nums in rows:
        if len(nums) == ncol:
            out.append((label, [v for v, _ in nums]))
        elif ref and ncol - 2 <= len(nums) < ncol:
            cols = []
            for _, e in nums:
                d = [abs(e - r) for r in ref]
                cols.append(d.index(min(d)))
            if len(set(cols)) == len(cols) and cols == sorted(cols) and max(abs(e - ref[c]) for (_, e), c in zip(nums, cols)) <= 3:
                vals = [0] * ncol
                for (v, _), c in zip(nums, cols):
                    vals[c] = v
                out.append((label, vals))
    return out


def norm_ipm(label):
    label = MARKER_RE.sub("", label).strip()
    label = re.sub(r"\s*\([A-Z]{2}\)$", "", label)  # (MS), (NA), (BN), (CT), (CA)
    return label.strip()


def pdf_text(path):
    try:
        out = subprocess.run(["pdftotext", "-layout", str(path), "-"], capture_output=True, text=True, check=True).stdout
    except subprocess.CalledProcessError as e:
        raise ParseError(f"il file non è un PDF leggibile ({(e.stderr or '').strip()[:80]})")
    return out.replace("\f", "\n")


def find_tables(text):
    lines = text.splitlines()
    heads = []
    for i, l in enumerate(lines):
        m = re.match(r"^\s*Tabella\s+(\d+[a-z]?)\s*[–-]\s*(.*)$", l)
        if m:
            nxt = lines[i + 1].strip() if i + 1 < len(lines) else ""
            heads.append((i, m.group(1), (m.group(2) + " " + nxt).strip()))
    tables = {}
    for k, (i, num, title) in enumerate(heads):
        end = heads[k + 1][0] if k + 1 < len(heads) else len(lines)
        body = lines[i:end]
        kind = None
        if "Ingressi e presenze negli Istituti penali" in title:
            kind = "ipm_sede"
        elif "Detenuti presenti negli IPM" in title and "secondo la sede" in title:
            kind = "ipm_eta"
        elif "Detenuti presenti negli IPM" in title and "nazionalità" in title:
            kind = "naz_sesso"
        elif "Delitti a carico" in title and "Istituti penali" in title:
            kind = "delitti"
        elif "Uscite dagli Istituti penali" in title:
            kind = "uscite"
        elif re.search(r"Ingressi negli Istituti penali per i minorenni secondo l.et", title):
            kind = "ingressi_ns"
        elif "Presenza media giornaliera negli Istituti penali per i minorenni" in title:
            kind = "media_naz"
        if kind and kind not in tables:
            tables[kind] = {"num": num, "title": title, "body": body}
    return tables


def doc_date(tables):
    t = tables["naz_sesso"]
    m = re.search(r"alla data del (\d{1,2})\s+(\w+)\s+(\d{4})", t["title"])
    if not m or m.group(2).lower() not in MESI:
        raise ParseError("data di riferimento non trovata nel titolo della tabella su età/nazionalità/sesso")
    return f"{int(m.group(3)):04d}-{MESI[m.group(2).lower()]:02d}-{int(m.group(1)):02d}"


# ---------- singole tabelle ----------

def parse_ipm_sede(body):
    cands = [l for l in body if l.strip().startswith("Totale") and len(split_row(l)[1]) >= 3]
    if not cands:
        raise ParseError("riga Totale non trovata nella tabella ingressi/presenze per IPM")
    ncol = len(split_row(cands[0])[1])
    if ncol not in (3, 5):
        raise ParseError(f"tabella ingressi/presenze con {ncol} colonne numeriche (attese 3 o 5): formato nuovo")
    rows = []
    for l in body:
        label, nums = split_row(l)
        if len(nums) != ncol or not label:
            continue
        if ncol == 3:
            ing_tot, pm, pres = nums
            rows.append(dict(ipm=norm_ipm(label), ing_esclusi=None, trasf=None, ing_tot=ing_tot, pm=pm, presenti=pres))
        else:
            esc, tr, tot, pm, pres = nums
            rows.append(dict(ipm=norm_ipm(label), ing_esclusi=esc, trasf=tr, ing_tot=tot, pm=pm, presenti=pres))
        if label.startswith("Totale"):
            break
    return ("vecchio_3col" if ncol == 3 else "nuovo_5col"), rows


def parse_ipm_eta(body):
    cand = []
    for l in body:
        label, nums = split_row_pos(l)
        if label and len(nums) >= 3 and not label.startswith(("Tabella", "IPM")):
            cand.append((label, nums))
    rows = []
    for label, nums in riempi_celle_vuote(cand, 5):
        rows.append(dict(ipm=norm_ipm(label), by_eta=dict(zip(ETA, nums[:4])), totale=nums[4]))
        if label.startswith("Totale"):
            break
    return rows


def parse_naz_sesso(body):
    cand = []
    for l in body:
        label, nums = split_row_pos(l)
        if (label in ETA or label == "Totale") and len(nums) >= 7:
            cand.append((label, nums))
    return {label: nums for label, nums in riempi_celle_vuote(cand, 9)}


def parse_trasf_adulti(body):
    """Riga "A strutture per adulti" della tabella delle uscite dagli Ipm (dato cumulato da inizio anno).
    Restituisce le 9 colonne (it m/f/mf, str m/f/mf, tot m/f/mf) oppure None se la riga non c'è."""
    for l in body:
        if l.strip().startswith("A strutture per adulti"):
            label, nums = split_row(l)
            if label == "A strutture per adulti" and len(nums) == 9:
                return nums
    return None


def parse_ingressi_ns(body):
    """Riga "Totale" della tabella ingressi per età, nazionalità e sesso (cumulato da inizio anno, esclusi i trasferimenti).
    Restituisce le 9 colonne oppure None."""
    for l in body:
        if l.strip().startswith("Totale"):
            label, nums = split_row(l)
            if label == "Totale" and len(nums) == 9:
                return nums
    return None


def parse_media_naz(body, anno):
    """Riga dell'anno corrente della tabella "Presenza media giornaliera negli Istituti penali per i minorenni nel periodo
    dal ... al ..., secondo la nazionalità e il sesso" (presente nei bollettini annuali). Restituisce le 9 colonne
    (italiani m/f/mf, stranieri m/f/mf, totale m/f/mf) oppure None se la riga dell'anno non c'è."""
    for l in body:
        label, nums = split_row(l)
        if not label and len(nums) == 10 and nums[0] == anno:
            return nums[1:]
    return None


def parse_delitti(body):
    out = []
    buf = None
    for l in body[1:]:
        if l.strip().startswith("La tabella riporta"):
            break
        label, nums = split_row(l)
        if len(nums) == 9 and not label and buf:
            label, buf = buf, None  # nome su due righe con i numeri in mezzo (es. 2020)
        if len(nums) == 9 and label:
            if buf and label[0].islower():
                label = buf + " " + label
            label = re.sub(r"^di cui:\s*", "", label).strip()
            if label.startswith("Contro la famiglia"):
                label = "Contro la famiglia, la moralità pubblica, il buon costume"
            livello = "categoria" if label in CATEGORIE else ("totale" if label.startswith("Totale") else "dettaglio")
            out.append((label, livello, nums))
            buf = None
        elif not nums and l.strip() and not l.strip().startswith(("Italiani", "DELITTI", "m ", "(")):
            buf = l.strip()
    return out


# ---------- documento intero ----------

def parse_pdf(path):
    """Restituisce un dict con i dati del documento e l'elenco dei controlli.
    Solleva ParseError se mancano le tabelle essenziali."""
    text = pdf_text(path)
    tabs = find_tables(text)
    for need in ("ipm_sede", "ipm_eta", "naz_sesso"):
        if need not in tabs:
            raise ParseError(f"tabella non trovata: {need}")
    data = doc_date(tabs)
    anno = int(data[:4])
    fmt, sede = parse_ipm_sede(tabs["ipm_sede"]["body"])
    eta = parse_ipm_eta(tabs["ipm_eta"]["body"])
    ns = parse_naz_sesso(tabs["naz_sesso"]["body"])
    if "Totale" not in ns or any(f not in ns for f in ETA):
        raise ParseError("tabella età/nazionalità/sesso incompleta")

    checks = []  # (gruppo, nome, ok, dettaglio)  gruppo: "presenti" | "delitti"

    def chk(gruppo, nome, ok, dettaglio=""):
        checks.append((gruppo, nome, bool(ok), dettaglio))

    tot = next((r for r in sede if r["ipm"] == "Totale"), None)
    ipm_rows = [r for r in sede if r["ipm"] != "Totale"]
    if tot is None or not ipm_rows:
        raise ParseError("tabella ingressi/presenze per IPM senza righe o senza totale")
    e_tot = next((r for r in eta if r["ipm"] == "Totale"), None)
    e_rows = [r for r in eta if r["ipm"] != "Totale"]
    if e_tot is None or not e_rows:
        raise ParseError("tabella presenti per IPM e età senza righe o senza totale")

    chk("presenti", "tab IPM: somma presenti = Totale", sum(r["presenti"] for r in ipm_rows) == tot["presenti"],
        f'{sum(r["presenti"] for r in ipm_rows)} vs {tot["presenti"]}')
    chk("presenti", "tab IPM: somma ingressi = Totale", sum(r["ing_tot"] for r in ipm_rows) == tot["ing_tot"],
        f'{sum(r["ing_tot"] for r in ipm_rows)} vs {tot["ing_tot"]}')
    if fmt == "nuovo_5col":
        bad = [r["ipm"] for r in ipm_rows if r["ing_esclusi"] + r["trasf"] != r["ing_tot"]]
        chk("presenti", "tab IPM: esclusi + trasferimenti = totale (per IPM)", not bad, ",".join(bad))
        chk("presenti", "tab IPM: esclusi + trasferimenti = totale (Totale)", tot["ing_esclusi"] + tot["trasf"] == tot["ing_tot"])
    bad = [r["ipm"] for r in e_rows if sum(r["by_eta"].values()) != r["totale"]]
    chk("presenti", "tab età: somma fasce = totale riga", not bad, ",".join(bad))
    chk("presenti", "tab età: somma righe = Totale", sum(r["totale"] for r in e_rows) == e_tot["totale"])
    p20 = {r["ipm"]: r["presenti"] for r in ipm_rows}
    mism = [f'{r["ipm"]}: {r["totale"]} vs {p20.get(r["ipm"])}' for r in e_rows if p20.get(r["ipm"]) != r["totale"]]
    chk("presenti", "presenti per età = presenti per IPM (per istituto)", not mism, "; ".join(mism))
    chk("presenti", "presenti per età = presenti per IPM (totale)", e_tot["totale"] == tot["presenti"])
    chk("presenti", "IPM con presenti ma senza riga nella tab età",
        not [k for k, v in p20.items() if v and k not in {r["ipm"] for r in e_rows}])
    t = ns["Totale"]
    chk("presenti", "tab nazionalità/sesso: Totale = presenti", t[8] == e_tot["totale"], f'{t[8]} vs {e_tot["totale"]}')
    chk("presenti", "tab nazionalità/sesso: coerenza m+f e it+st",
        all(v[0] + v[3] == v[6] and v[1] + v[4] == v[7] and v[2] + v[5] == v[8] and v[0] + v[1] == v[2]
            and v[3] + v[4] == v[5] and v[6] + v[7] == v[8] for v in ns.values()))
    chk("presenti", "tab nazionalità/sesso: somma fasce = Totale", all(sum(ns[f][i] for f in ETA) == t[i] for i in range(9)))
    chk("presenti", "tab nazionalità/sesso per fascia = tab età per fascia",
        all(ns[f][8] == e_tot["by_eta"][f] for f in ETA))

    out = dict(data_rif=data, anno=anno, formato=fmt, file=Path(path).name, checks=checks,
               presenze_ipm=[], ipm_eta=[], naz_sesso_eta=[], delitti=[], delitti_target=[], serie=None,
               tabelle={k: v["num"] for k, v in tabs.items()})
    for r in ipm_rows:
        out["presenze_ipm"].append(dict(data_rif=data, anno=anno, ipm=r["ipm"], ingressi_esclusi_trasf=r["ing_esclusi"],
                                        trasferimenti_da_altro_ipm=r["trasf"], ingressi_totale=r["ing_tot"],
                                        presenza_media_giornaliera=r["pm"], presenti=r["presenti"]))
    for r in e_rows:
        for f, v in r["by_eta"].items():
            out["ipm_eta"].append(dict(data_rif=data, ipm=r["ipm"], fascia_eta=f, presenti=v))
    for f in ETA:
        for i, (n, s) in enumerate(NAZ_SESSO):
            out["naz_sesso_eta"].append(dict(data_rif=data, fascia_eta=f, nazionalita=n, sesso=s, presenti=ns[f][i]))
    out["serie"] = dict(
        data_rif=data, anno=anno, presenti=tot["presenti"], ingressi_totale=tot["ing_tot"],
        ingressi_esclusi_trasf=tot["ing_esclusi"], trasferimenti=tot["trasf"], presenza_media_giornaliera=tot["pm"],
        eta_14_15=ns["14-15 anni"][8], eta_16_17=ns["16-17 anni"][8], eta_18_20=ns["18-20 anni"][8], eta_21_24=ns["21-24 anni"][8],
        italiani_m=t[0], italiani_f=t[1], stranieri_m=t[3], stranieri_f=t[4])

    # ---- trasferimenti verso strutture per adulti (opzionale: non blocca il documento se manca)
    out["serie"]["trasf_adulti"] = None
    if "uscite" in tabs:
        ta = parse_trasf_adulti(tabs["uscite"]["body"])
        if ta is not None:
            ok = (ta[0] + ta[3] == ta[6] and ta[1] + ta[4] == ta[7] and ta[2] + ta[5] == ta[8]
                  and ta[0] + ta[1] == ta[2] and ta[3] + ta[4] == ta[5] and ta[6] + ta[7] == ta[8])
            chk("trasf_adulti", "uscite: riga 'A strutture per adulti' coerente (m+f, it+st)", ok, str(ta))
            if ok:
                out["serie"]["trasf_adulti"] = ta[8]

    # ---- ingressi per nazionalità (opzionale: non blocca il documento se manca)
    out["serie"]["ingressi_italiani"] = out["serie"]["ingressi_stranieri"] = None
    if "ingressi_ns" in tabs:
        ig = parse_ingressi_ns(tabs["ingressi_ns"]["body"])
        if ig is not None:
            ok = (ig[0] + ig[3] == ig[6] and ig[1] + ig[4] == ig[7] and ig[2] + ig[5] == ig[8]
                  and ig[0] + ig[1] == ig[2] and ig[3] + ig[4] == ig[5] and ig[6] + ig[7] == ig[8]
                  and (tot["ing_esclusi"] is None or ig[8] == tot["ing_esclusi"]))
            chk("ingressi_naz", "ingressi per nazionalità: coerenza m+f, it+st e totale = ingressi esclusi i trasferimenti", ok, str(ig))
            if ok:
                out["serie"]["ingressi_italiani"], out["serie"]["ingressi_stranieri"] = ig[2], ig[5]

    # ---- presenza media per nazionalità (opzionale: serve ad aggiornare la serie storica annuale a fine anno)
    out["_media_naz"] = None
    if "media_naz" in tabs:
        mn = parse_media_naz(tabs["media_naz"]["body"], anno)
        if mn is not None:
            # medie arrotondate: le somme possono differire di 1 (es. 2022: 178 + 7 = 185, ma la tabella riporta 184)
            q = lambda a, b: abs(a - b) <= 1  # noqa: E731
            ok = (q(mn[0] + mn[3], mn[6]) and q(mn[1] + mn[4], mn[7]) and q(mn[2] + mn[5], mn[8])
                  and q(mn[0] + mn[1], mn[2]) and q(mn[3] + mn[4], mn[5]) and q(mn[6] + mn[7], mn[8])
                  and abs(mn[8] - tot["pm"]) <= 0.5)
            chk("media_naz", "presenza media per nazionalità: coerenza m+f, it+st e totale = presenza media del Totale", ok, str(mn))
            if ok:
                out["_media_naz"] = dict(italiani=mn[2], stranieri=mn[5], totale=mn[8])

    # ---- delitti (parte separata)
    if "delitti" in tabs:
        dl = parse_delitti(tabs["delitti"]["body"])
        cats = [v for (l, liv, v) in dl if liv == "categoria"]
        totd = next((v for (l, liv, v) in dl if liv == "totale"), None)
        chk("delitti", "delitti: tabella con righe", bool(dl) and totd is not None)
        if totd:
            chk("delitti", "delitti: somma categorie = Totale DELITTI", all(sum(c[i] for c in cats) == totd[i] for i in range(9)),
                str([(i, sum(c[i] for c in cats), totd[i]) for i in range(9) if sum(c[i] for c in cats) != totd[i]]))
            ok_mf = all(v[0] + v[3] == v[6] and v[1] + v[4] == v[7] and v[0] + v[1] == v[2] and v[3] + v[4] == v[5] for (_, _, v) in dl)
            chk("delitti", "delitti: coerenza m+f e it+st (tutte le righe)", ok_mf)
        out["_delitti_raw"] = dl
    else:
        chk("delitti", "delitti: tabella presente", False, "tabella non trovata")
    return out


def delitti_rows(doc):
    """Righe 'delitti' e 'delitti_target' di un documento già validato."""
    data, anno = doc["data_rif"], doc["anno"]
    dl = doc.get("_delitti_raw", [])
    full, target = [], []
    for label, liv, v in dl:
        for i, (n, s) in enumerate(NAZ_SESSO):
            full.append(dict(data_rif=data, anno=anno, delitto=label, livello=liv, nazionalita=n, sesso=s, delitti=v[i]))
    for lab, key in TARGET.items():
        row = next((v for (l, liv, v) in dl if l == lab), None)
        for i, (n, s) in enumerate(NAZ_SESSO):
            target.append(dict(data_rif=data, anno=anno, delitto=key, nazionalita=n, sesso=s,
                               riportato=int(row is not None), delitti=("" if row is None else row[i])))
    return full, target
