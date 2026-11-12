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
    rows = []
    for l in body:
        label, nums = split_row(l)
        if len(nums) == 5 and label:
            rows.append(dict(ipm=norm_ipm(label), by_eta=dict(zip(ETA, nums[:4])), totale=nums[4]))
            if label.startswith("Totale"):
                break
    return rows


def parse_naz_sesso(body):
    out = {}
    for l in body:
        label, nums = split_row(l)
        if len(nums) == 9 and (label in ETA or label == "Totale"):
            out[label] = nums
    return out


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
