"""Aggiornamento automatico delle serie storiche annuali (ingressi, presenza media, trasferimenti verso adulti).

Le serie 1991-2025 vengono dal report annuale del ministero e restano com'erano (file "base").
Dal 2026 in poi ogni anno viene aggiunto da solo quando il bollettino del 31 dicembre CONVALIDATO supera i controlli:
  - ingressi italiani/stranieri (esclusi i trasferimenti tra istituti): tabella degli ingressi per età, nazionalità e sesso;
  - presenza media giornaliera per nazionalità: tabella "Presenza media giornaliera ... nel periodo dal ... al ...";
  - trasferimenti verso strutture per adulti: riga "A strutture per adulti" della tabella delle uscite.
Finché il bollettino convalidato non c'è, l'anno resta mostrato come dato parziale (preso dai bollettini periodici).
"""
from pathlib import Path

ULTIMO_ANNO_BASE = 2025  # fino a quest'anno le righe dei due file vengono dal report annuale e non si toccano

FILE_STORICA = "serie_storica.csv"
FILE_TRASF = "trasferimenti_adulti.csv"
CAMPI_STORICA = ["anno", "ingressi_italiani", "ingressi_stranieri", "ingressi_totale", "media_italiani", "media_stranieri", "media_totale"]
CAMPI_TRASF = ["anno", "trasferimenti_adulti"]


def righe_da_documenti(validi, anno_base=ULTIMO_ANNO_BASE):
    """Dai documenti validati ricava le righe annuali da aggiungere.
    Restituisce (righe_storica, righe_trasferimenti, problemi): `problemi` è una lista di dict(file, motivo)."""
    storica, trasf, problemi = [], [], []
    for d in sorted(validi):
        doc = validi[d]
        if not d.endswith("-12-31") or doc["anno"] <= anno_base:
            continue
        if "convalid" not in doc["file"].lower():
            continue  # bollettino ancora provvisorio: l'anno resta "parziale" finché non esce quello convalidato
        s, m, anno = doc["serie"], doc.get("_media_naz"), doc["anno"]
        mancanti = [n for n, v in (("ingressi per nazionalità", s.get("ingressi_italiani")),
                                   ("trasferimenti verso adulti", s.get("trasf_adulti")),
                                   ("presenza media per nazionalità", m)) if v is None]
        if mancanti:
            problemi.append(dict(file=doc["file"], motivo=f"serie annuale {anno} non aggiornata: dati non letti o non coerenti ({', '.join(mancanti)})"))
            continue
        # i documenti vecchi (3 colonne) non distinguono i trasferimenti: se i conti non tornano l'anno non viene aggiunto
        ing = s["ingressi_esclusi_trasf"] if s["ingressi_esclusi_trasf"] is not None else s["ingressi_totale"]
        if s["ingressi_italiani"] + s["ingressi_stranieri"] != ing:
            problemi.append(dict(file=doc["file"], motivo=f"serie annuale {anno} non aggiornata: ingressi italiani + stranieri diversi dal totale"))
            continue
        storica.append(dict(anno=anno, ingressi_italiani=s["ingressi_italiani"], ingressi_stranieri=s["ingressi_stranieri"],
                            ingressi_totale=ing, media_italiani=m["italiani"],
                            media_stranieri=m["stranieri"], media_totale=m["totale"]))
        trasf.append(dict(anno=anno, trasferimenti_adulti=s["trasf_adulti"]))
    return storica, trasf, problemi


def _riscrivi(path, campi, nuove, anno_base):
    """Tiene l'intestazione e le righe fino a `anno_base` esattamente come sono, poi aggiunge le nuove."""
    path = Path(path)
    if not path.exists():
        return []
    raw = path.read_bytes().decode("utf-8")
    eol = "\r\n" if "\r\n" in raw else "\n"
    righe = raw.splitlines()
    tenute = [righe[0]] + [r for r in righe[1:] if r.strip() and r.split(",")[0].isdigit() and int(r.split(",")[0]) <= anno_base]
    for r in sorted(nuove, key=lambda x: x["anno"]):
        tenute.append(",".join(str(r[c]) for c in campi))
    nuovo = eol.join(tenute) + eol
    if nuovo != raw:
        path.write_bytes(nuovo.encode("utf-8"))
    return [r["anno"] for r in nuove]


def aggiorna_file(out_dir, storica, trasf, anno_base=ULTIMO_ANNO_BASE):
    """Scrive le righe annuali nei due CSV (idempotente: si può rilanciare ogni giorno). Restituisce gli anni aggiunti."""
    a = _riscrivi(Path(out_dir) / FILE_STORICA, CAMPI_STORICA, storica, anno_base)
    _riscrivi(Path(out_dir) / FILE_TRASF, CAMPI_TRASF, trasf, anno_base)
    return a
