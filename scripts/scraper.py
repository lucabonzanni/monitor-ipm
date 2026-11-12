"""Recupero dei PDF "Minorenni e giovani adulti in carico ai Servizi minorili" dal sito del Ministero.

Come funziona
1. scorre le pagine dell'elenco delle statistiche (giustizia.it/giustizia/page/it/statistiche?page=N);
2. tiene solo le voci il cui titolo contiene "Minorenni e giovani adulti in carico ai Servizi minorili";
3. apre la scheda di ciascuna (…mg_1_14_1.page?contentId=SST…), trova il link al PDF e lo scarica;
4. registra tutto in data/fonti.csv, così al giorno dopo non riscarica nulla.

Nota: il sito non è stato provato dal vivo al momento della scrittura (dal luogo in cui è stato scritto
non era raggiungibile). Il codice è tollerante ma, se il Ministero cambia la struttura delle pagine,
solleva ScraperError con un messaggio esplicito invece di fallire in silenzio.
"""
import csv
import hashlib
import re
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse, unquote

import requests
from bs4 import BeautifulSoup

BASE = "https://www.giustizia.it"
LIST_URL = BASE + "/giustizia/page/it/statistiche"
TITOLO = "minorenni e giovani adulti in carico ai servizi minorili"
HEADERS = {"User-Agent": "monitor-ipm/1.0 (progetto di data journalism; lettura di documenti pubblici)"}
PAUSA = 1.5  # secondi tra una richiesta e l'altra: non vogliamo pesare sul sito
MESI = {m: i + 1 for i, m in enumerate(
    "gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre".split())}
FONTI_COLS = ["content_id", "titolo", "data_titolo", "url_scheda", "url_pdf", "file", "md5", "scaricato_il"]


class ScraperError(Exception):
    pass


def _get(session, url, tries=3, **kw):
    last = None
    for k in range(tries):
        try:
            r = session.get(url, timeout=40, **kw)
            if r.status_code == 200:
                return r
            last = f"HTTP {r.status_code}"
            if r.status_code in (403, 404, 410):
                break
        except requests.RequestException as e:
            last = str(e)
        time.sleep(2 * (k + 1))
    raise ScraperError(f"impossibile leggere {url}: {last}")


def norm(s):
    return re.sub(r"\s+", " ", s or "").strip()


def data_da_titolo(titolo):
    m = re.search(r"(\d{1,2})\s+([a-zà]+)\s+(\d{4})", titolo.lower())
    if m and m.group(2) in MESI:
        return f"{int(m.group(3)):04d}-{MESI[m.group(2)]:02d}-{int(m.group(1)):02d}"
    m = re.search(r"(\d{1,2})[./](\d{1,2})[./](\d{4})", titolo)
    if m:
        return f"{int(m.group(3)):04d}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return ""


def parse_elenco(html):
    """-> (voci, n_pagine) dove voci = [(content_id, titolo, url_scheda)] solo per il nostro rapporto."""
    soup = BeautifulSoup(html, "html.parser")
    voci, visti = [], set()
    for a in soup.find_all("a", href=True):
        m = re.search(r"contentId=(SST\d+)", a["href"])
        if not m or m.group(1) in visti:
            continue
        titolo = norm(a.get_text(" ")) or norm(a.get("title", ""))
        if TITOLO not in titolo.lower():
            # a volte il testo del link è generico ("Leggi"): il titolo sta nel contenitore
            nodo = a
            for _ in range(3):
                nodo = nodo.parent
                if nodo is None:
                    break
                n_link = len({re.search(r"contentId=(SST\d+)", x["href"]).group(1)
                              for x in nodo.find_all("a", href=True) if re.search(r"contentId=SST\d+", x["href"])})
                if n_link == 1 and TITOLO in norm(nodo.get_text(" ")).lower():
                    titolo = norm(nodo.get_text(" "))
                    break
        if TITOLO in titolo.lower():
            visti.add(m.group(1))
            voci.append((m.group(1), titolo, urljoin(BASE, a["href"])))
    m = re.search(r"Pagina\s+\d+\s+di\s+(\d+)", norm(soup.get_text(" ")))
    return voci, (int(m.group(1)) if m else None)


def parse_scheda(html, url_scheda):
    soup = BeautifulSoup(html, "html.parser")
    pdfs = []
    for a in soup.find_all("a", href=True):
        h = a["href"]
        if re.search(r"\.pdf(\?|#|$)", h, re.I):
            pdfs.append(urljoin(url_scheda, h))
    if not pdfs:
        return None
    for p in pdfs:
        if "servizi_minorili" in unquote(p).lower():
            return p
    return pdfs[0]


def leggi_registro(path):
    path = Path(path)
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def scrivi_registro(path, rows):
    rows = sorted(rows, key=lambda r: (r.get("data_titolo") or "", r["content_id"]))
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=FONTI_COLS)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in FONTI_COLS})


def aggiorna_archivio(pdf_dir, registro_path, pagine_max=3, backfill=False, log=print, session=None):
    """Scarica i PDF nuovi. Restituisce l'elenco dei file scaricati.
    pagine_max: quante pagine dell'elenco leggere nel controllo quotidiano; con backfill=True le legge tutte."""
    pdf_dir = Path(pdf_dir)
    pdf_dir.mkdir(parents=True, exist_ok=True)
    s = session or requests.Session()
    s.headers.update(HEADERS)
    registro = leggi_registro(registro_path)
    noti = {r["content_id"] for r in registro}
    md5_noti = {hashlib.md5(p.read_bytes()).hexdigest() for p in pdf_dir.glob("*.pdf")}
    scaricati = []

    r = _get(s, LIST_URL, params={"page": 1})
    voci, n_pagine = parse_elenco(r.text)
    n_link_sst = len(re.findall(r"contentId=SST\d+", r.text))
    if n_link_sst == 0:
        raise ScraperError("la pagina dell'elenco non contiene link alle schede (contentId=SST…): "
                           "il sito ha cambiato struttura oppure ha bloccato l'accesso")
    ultima = (n_pagine or 50) if backfill else min(pagine_max, n_pagine or pagine_max)
    tutte = list(voci)
    for p in range(2, ultima + 1):
        time.sleep(PAUSA)
        rp = _get(s, LIST_URL, params={"page": p})
        v, _ = parse_elenco(rp.text)
        tutte.extend(v)
    log(f"elenco letto: {ultima} pagine, {len(tutte)} voci del rapporto IPM/Servizi minorili trovate")
    if not tutte:
        raise ScraperError("nessuna voce 'Minorenni e giovani adulti in carico ai Servizi minorili' trovata nell'elenco: "
                           "titolo cambiato o struttura diversa")

    for cid, titolo, url_scheda in tutte:
        if cid in noti:
            continue
        time.sleep(PAUSA)
        rs = _get(s, url_scheda)
        url_pdf = parse_scheda(rs.text, url_scheda)
        if not url_pdf:
            log(f"ATTENZIONE: nessun PDF nella scheda {cid} ({titolo})")
            continue
        time.sleep(PAUSA)
        rp = _get(s, url_pdf)
        if not rp.content.startswith(b"%PDF"):
            log(f"ATTENZIONE: {url_pdf} non è un PDF")
            continue
        md5 = hashlib.md5(rp.content).hexdigest()
        nome = re.sub(r"[^A-Za-z0-9._-]", "_", Path(unquote(urlparse(url_pdf).path)).name) or f"{cid}.pdf"
        if md5 in md5_noti:
            log(f"già presente (stesso contenuto): {nome}")
            file_registrato = ""
        else:
            dest = pdf_dir / nome
            if dest.exists():
                dest = pdf_dir / f"{cid}_{nome}"
            dest.write_bytes(rp.content)
            md5_noti.add(md5)
            scaricati.append(dest.name)
            file_registrato = dest.name
            log(f"scaricato: {dest.name}")
        registro.append(dict(content_id=cid, titolo=titolo, data_titolo=data_da_titolo(titolo), url_scheda=url_scheda,
                             url_pdf=url_pdf, file=file_registrato, md5=md5,
                             scaricato_il=time.strftime("%Y-%m-%d", time.gmtime())))
        noti.add(cid)
        scrivi_registro(registro_path, registro)
    if registro:
        scrivi_registro(registro_path, registro)
    return scaricati
