#!/usr/bin/env python3
"""Aggiorna il monitor IPM: scarica i PDF nuovi, li legge, controlla i numeri e rigenera i CSV del sito.

Uso (dalla cartella principale del repository):
    python scripts/aggiorna.py                 # controllo quotidiano (prime 3 pagine dell'elenco)
    python scripts/aggiorna.py --backfill      # scorre TUTTO l'archivio (la prima volta)
    python scripts/aggiorna.py --no-scrape     # non va sul sito: rilegge solo i PDF già in data/pdf

Codici di uscita (il workflow di GitHub segnala come "fallito" qualunque codice diverso da 0 e ti manda una mail):
    0  tutto regolare
    2  problema con il sito del Ministero (accesso bloccato o pagine cambiate)
    3  almeno un documento è stato escluso perché non supera i controlli o non è leggibile
"""
import argparse
import csv
import hashlib
import json
import sys
import time
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ipm_parser as P  # noqa: E402
import scraper as S  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PDF_DIR = ROOT / "data" / "pdf"
REGISTRO = ROOT / "data" / "fonti.csv"
OUT = ROOT / "docs" / "data"


def scrivi_csv(path, rows, campi=None):
    rows = list(rows)
    if not rows and not campi:
        return
    campi = campi or list(rows[0].keys())
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=campi)
        w.writeheader()
        w.writerows(rows)


def costruisci(log=print):
    """Legge tutti i PDF in data/pdf e scrive i CSV in docs/data. Restituisce (n_inclusi, esclusi)."""
    OUT.mkdir(parents=True, exist_ok=True)
    esclusi, documenti, tutti_controlli = [], [], []
    validi = {}  # data_rif -> doc
    visti_md5 = {}
    for p in sorted(PDF_DIR.glob("*.pdf")):
        md5 = hashlib.md5(p.read_bytes()).hexdigest()
        if md5 in visti_md5:
            documenti.append(dict(file=p.name, data_rif="", formato="", stato="duplicato", nota=f"identico a {visti_md5[md5]}"))
            continue
        visti_md5[md5] = p.name
        try:
            doc = P.parse_pdf(p)
        except P.ParseError as e:
            esclusi.append(dict(file=p.name, motivo=f"non leggibile: {e}"))
            documenti.append(dict(file=p.name, data_rif="", formato="", stato="escluso", nota=str(e)))
            continue
        except Exception as e:  # errore imprevisto: non deve fermare gli altri documenti
            esclusi.append(dict(file=p.name, motivo=f"errore imprevisto: {e!r}"))
            documenti.append(dict(file=p.name, data_rif="", formato="", stato="escluso", nota=repr(e)))
            traceback.print_exc()
            continue
        for gruppo, nome, ok, det in doc["checks"]:
            tutti_controlli.append(dict(data_rif=doc["data_rif"], file=p.name, gruppo=gruppo, controllo=nome,
                                        esito="OK" if ok else "FALLITO", dettaglio=det))
        ok_pres = all(ok for g, _, ok, _ in doc["checks"] if g == "presenti")
        ok_del = all(ok for g, _, ok, _ in doc["checks"] if g == "delitti")
        doc["ok_presenti"], doc["ok_delitti"] = ok_pres, ok_del
        if not ok_pres:
            motivo = "; ".join(f"{n} ({d})" for g, n, ok, d in doc["checks"] if g == "presenti" and not ok)
            esclusi.append(dict(file=p.name, motivo=f"controlli sui presenti falliti: {motivo}"))
            documenti.append(dict(file=p.name, data_rif=doc["data_rif"], formato=doc["formato"], stato="escluso", nota=motivo))
            continue
        if not ok_del:
            motivo = "; ".join(f"{n} ({d})" for g, n, ok, d in doc["checks"] if g == "delitti" and not ok)
            esclusi.append(dict(file=p.name, motivo=f"delitti esclusi, presenti inclusi: {motivo}"))
        d = doc["data_rif"]
        if d in validi:  # due file con la stessa data di riferimento: tengo il "convalidato", altrimenti l'ultimo
            vecchio = validi[d]
            nuovo_conv = "convalid" in p.name.lower()
            vecchio_conv = "convalid" in vecchio["file"].lower()
            tieni_nuovo = (nuovo_conv and not vecchio_conv) or (nuovo_conv == vecchio_conv)
            perso = vecchio if tieni_nuovo else doc
            tenuto = doc if tieni_nuovo else vecchio
            if perso["serie"] == tenuto["serie"]:
                log(f"  doppione (stessi dati) scartato: {perso['file']}")  # innocuo: non è un problema
            else:  # stessa data ma numeri diversi (rettifica?): va guardato a mano
                esclusi.append(dict(file=perso["file"], motivo=f"stessa data di riferimento ({d}) di {tenuto['file']} ma con numeri diversi: scartato"))
            documenti.append(dict(file=perso["file"], data_rif=d, formato=perso["formato"], stato="scartato",
                                  nota="stessa data di riferimento di un altro file"))
            if not tieni_nuovo:
                continue
        validi[d] = doc

    date = sorted(validi)
    serie, presenze, eta, ns, dl_full, dl_target = [], [], [], [], [], []
    for d in date:
        doc = validi[d]
        serie.append(doc["serie"])
        presenze += doc["presenze_ipm"]
        eta += doc["ipm_eta"]
        ns += doc["naz_sesso_eta"]
        if doc["ok_delitti"] and "_delitti_raw" in doc:
            f, t = P.delitti_rows(doc)
            dl_full += f
            dl_target += t
        documenti.append(dict(file=doc["file"], data_rif=d, formato=doc["formato"], stato="incluso",
                              nota="" if doc["ok_delitti"] else "delitti esclusi"))
    scrivi_csv(OUT / "serie_nazionale.csv", serie)
    scrivi_csv(OUT / "presenze_ipm.csv", presenze)
    scrivi_csv(OUT / "ipm_eta.csv", eta)
    scrivi_csv(OUT / "nazionalita_sesso_eta.csv", ns)
    scrivi_csv(OUT / "delitti_selezionati.csv", dl_target)
    scrivi_csv(OUT / "delitti_completo.csv", dl_full)
    scrivi_csv(OUT / "controlli.csv", tutti_controlli)
    documenti.sort(key=lambda r: (r["data_rif"], r["file"]))
    scrivi_csv(OUT / "documenti.csv", documenti, ["data_rif", "file", "formato", "stato", "nota"])
    return date, esclusi


def scrivi_stato(date, esclusi, nota_sito=""):
    stato = dict(
        verificato_il=time.strftime("%Y-%m-%d", time.gmtime()),
        ultimo_dato_riferito_al=date[-1] if date else None,
        primo_dato_riferito_al=date[0] if date else None,
        documenti_inclusi=len(date),
        documenti_con_problemi=esclusi,
        nota_sito=nota_sito,
    )
    (OUT / "stato.json").write_text(json.dumps(stato, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backfill", action="store_true", help="legge tutte le pagine dell'archivio")
    ap.add_argument("--no-scrape", action="store_true", help="non va sul sito: rilegge solo i PDF locali")
    ap.add_argument("--pages", type=int, default=3, help="pagine dell'elenco nel controllo quotidiano")
    a = ap.parse_args()

    codice, nota_sito = 0, ""
    if not a.no_scrape:
        try:
            nuovi = S.aggiorna_archivio(PDF_DIR, REGISTRO, pagine_max=a.pages, backfill=a.backfill)
            print(f"PDF nuovi scaricati: {len(nuovi)}")
        except S.ScraperError as e:
            print(f"ERRORE SITO: {e}")
            nota_sito = f"ultimo controllo del sito non riuscito: {e}"
            codice = 2
    date, esclusi = costruisci()
    scrivi_stato(date, esclusi, nota_sito)
    print(f"documenti inclusi: {len(date)}  ({date[0] if date else '-'} → {date[-1] if date else '-'})")
    for e in esclusi:
        print(f"  PROBLEMA: {e['file']}: {e['motivo']}")
    if esclusi and codice == 0:
        codice = 3
    sys.exit(codice)


if __name__ == "__main__":
    main()
