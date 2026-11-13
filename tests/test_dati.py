"""Controlli automatici sui dati del sito e sulla serie storica annuale.

Esegui dalla cartella principale del repository:
    python3 tests/test_dati.py          (oppure:  python3 -m unittest discover -s tests -v)

Cosa verificano:
  - i reati non vengono moltiplicati (una sola riga per reato/nazionalità/genere a ogni data) e le somme tornano;
  - italiani + stranieri = totale, in ogni anno della serie storica;
  - valori di riferimento noti (ingressi 2025 = 1.197, trasferimenti 2025 = 195, ingressi 15 ottobre 2026 = 871, ...);
  - i valori di fine anno dei bollettini coincidono con la serie storica annuale;
  - l'aggiornamento automatico della serie annuale (solo bollettino convalidato, controlli di coerenza, righe base intatte).
I test che hanno bisogno dei file .pdf (cartella data/pdf) o di colonne non ancora presenti nei CSV vengono saltati, non falliti.
"""
import csv
import glob
import os
import shutil
import sys
import tempfile
import unittest
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import serie_annuali as SA  # noqa: E402

DATI = Path(os.environ.get("IPM_DATI", ROOT / "docs" / "data"))
PDF = Path(os.environ.get("IPM_PDF", ROOT / "data" / "pdf"))


def leggi(nome):
    p = DATI / nome
    if not p.exists():
        raise unittest.SkipTest(f"{nome} non trovato in {DATI}")
    with open(p, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def intero(v):
    return None if v in ("", None) else int(float(v))


class TestSerieStorica(unittest.TestCase):
    def test_italiani_piu_stranieri_uguale_totale(self):
        for r in leggi("serie_storica.csv"):
            self.assertEqual(int(r["ingressi_italiani"]) + int(r["ingressi_stranieri"]), int(r["ingressi_totale"]), f"ingressi {r['anno']}")
            # le medie sono arrotondate: la somma può differire di 1
            self.assertLessEqual(abs(int(r["media_italiani"]) + int(r["media_stranieri"]) - int(r["media_totale"])), 1, f"media {r['anno']}")

    def test_anni_consecutivi_senza_buchi(self):
        anni = [int(r["anno"]) for r in leggi("serie_storica.csv")]
        self.assertEqual(anni[0], 1991)
        self.assertEqual(anni, list(range(anni[0], anni[-1] + 1)))
        anni_t = [int(r["anno"]) for r in leggi("trasferimenti_adulti.csv")]
        self.assertEqual(anni_t[0], 2011)
        self.assertEqual(anni_t, list(range(2011, anni_t[-1] + 1)))

    def test_valori_di_riferimento(self):
        s = {int(r["anno"]): r for r in leggi("serie_storica.csv")}
        t = {int(r["anno"]): int(r["trasferimenti_adulti"]) for r in leggi("trasferimenti_adulti.csv")}
        self.assertEqual(int(s[2025]["ingressi_totale"]), 1197)
        self.assertEqual(int(s[2025]["media_totale"]), 588)
        self.assertEqual(int(s[1994]["media_totale"]), 617)
        self.assertEqual(min(int(r["media_totale"]) for r in s.values()), 320)
        self.assertEqual(t[2025], 195)
        self.assertEqual(t[2021], 60)  # citati nel testo della pagina


class TestSerieNazionale(unittest.TestCase):
    def test_valori_di_riferimento_15_ottobre_2026(self):
        r = next((x for x in leggi("serie_nazionale.csv") if x["data_rif"] == "2026-10-15"), None)
        if r is None:
            self.skipTest("documento del 15 ottobre 2026 non presente")
        self.assertEqual(intero(r["presenti"]), 563)
        self.assertEqual(intero(r["ingressi_totale"]), 1311)
        self.assertEqual(intero(r["ingressi_esclusi_trasf"]), 871)
        self.assertEqual(intero(r["trasferimenti"]), 440)
        self.assertEqual(float(r["presenza_media_giornaliera"]), 569.0)
        if r.get("trasf_adulti") not in (None, ""):
            self.assertEqual(intero(r["trasf_adulti"]), 140)
        if r.get("ingressi_italiani") not in (None, ""):
            self.assertEqual(intero(r["ingressi_italiani"]), 514)
            self.assertEqual(intero(r["ingressi_stranieri"]), 357)

    def test_esclusi_piu_trasferimenti_uguale_totale(self):
        for r in leggi("serie_nazionale.csv"):
            if r["ingressi_esclusi_trasf"] != "":
                self.assertEqual(intero(r["ingressi_esclusi_trasf"]) + intero(r["trasferimenti"]), intero(r["ingressi_totale"]), r["data_rif"])

    def test_ingressi_per_nazionalita_sommano_al_totale(self):
        for r in leggi("serie_nazionale.csv"):
            if r.get("ingressi_italiani") not in (None, "") and r["ingressi_esclusi_trasf"] != "":
                self.assertEqual(intero(r["ingressi_italiani"]) + intero(r["ingressi_stranieri"]), intero(r["ingressi_esclusi_trasf"]), r["data_rif"])

    def test_fine_anno_coincide_con_serie_storica(self):
        """I bollettini del 31 dicembre devono riprodurre la serie annuale (ingressi, trasferimenti, presenza media)."""
        s = {int(r["anno"]): r for r in leggi("serie_storica.csv")}
        t = {int(r["anno"]): int(r["trasferimenti_adulti"]) for r in leggi("trasferimenti_adulti.csv")}
        controllati = 0
        for r in leggi("serie_nazionale.csv"):
            if not r["data_rif"].endswith("-12-31"):
                continue
            a = int(r["anno"])
            if a not in s:
                continue
            if abs(float(r["presenza_media_giornaliera"]) - int(s[a]["media_totale"])) > 0.5:
                self.fail(f"{a}: presenza media {r['presenza_media_giornaliera']} contro {s[a]['media_totale']}")
            if r.get("trasf_adulti") not in (None, "") and a in t:
                self.assertEqual(intero(r["trasf_adulti"]), t[a], f"trasferimenti {a}")
            # dal 2024 i documenti distinguono gli ingressi esclusi i trasferimenti
            if r["ingressi_esclusi_trasf"] != "" and a >= 2024:
                self.assertEqual(intero(r["ingressi_esclusi_trasf"]), int(s[a]["ingressi_totale"]), f"ingressi {a}")
            controllati += 1
        self.assertGreater(controllati, 0)


class TestDelitti(unittest.TestCase):
    def test_una_sola_riga_per_reato_nazionalita_genere(self):
        """Il file ha 9 righe per reato e per data (it/str/totale x m/f/mf): sommarle tutte moltiplicherebbe i numeri."""
        c = Counter()
        for r in leggi("delitti_selezionati.csv"):
            c[(r["data_rif"], r["delitto"])] += 1
        self.assertTrue(c)
        self.assertEqual(set(c.values()), {9})

    def test_somme_coerenti(self):
        d = defaultdict(dict)
        for r in leggi("delitti_selezionati.csv"):
            if r["riportato"] == "1":
                d[(r["data_rif"], r["delitto"])][(r["nazionalita"], r["sesso"])] = int(r["delitti"])
        self.assertTrue(d)
        for k, v in d.items():
            self.assertEqual(v[("italiani", "mf")] + v[("stranieri", "mf")], v[("totale", "mf")], k)
            self.assertEqual(v[("totale", "m")] + v[("totale", "f")], v[("totale", "mf")], k)

    def test_valori_citati_nel_testo_della_pagina(self):
        """Cifre scritte a mano nel testo della sezione "Reati" (bollettini del 31 dicembre, totale)."""
        d = {}
        for r in leggi("delitti_selezionati.csv"):
            if r["nazionalita"] == "totale" and r["sesso"] == "mf" and r["riportato"] == "1" and r["data_rif"].endswith("-12-31"):
                d[(r["delitto"], int(r["anno"]))] = int(r["delitti"])
        attesi = {("rapina", 2020): 406, ("rapina", 2025): 674, ("rapina", 2022): 749,
                  ("stupefacenti", 2020): 127, ("stupefacenti", 2025): 260,
                  ("furto", 2020): 367, ("furto", 2025): 293,
                  ("omicidio_volontario_tentato", 2020): 23, ("omicidio_volontario_tentato", 2025): 65}
        for k, v in attesi.items():
            if k not in d:
                self.skipTest("anni 2020-2025 non tutti presenti nel file")
            self.assertEqual(d[k], v, k)


def doc_finto(data, file, ita=647, str_=550, esclusi=1197, trasf=195, media=(312, 276, 588), pm=587.8):
    return {"data_rif": data, "anno": int(data[:4]), "file": file,
            "serie": {"ingressi_italiani": ita, "ingressi_stranieri": str_, "ingressi_esclusi_trasf": esclusi, "ingressi_totale": esclusi,
                      "trasf_adulti": trasf, "presenza_media_giornaliera": pm},
            "_media_naz": None if media is None else {"italiani": media[0], "stranieri": media[1], "totale": media[2]}}


class TestAggiornamentoSerieAnnuale(unittest.TestCase):
    def test_bollettino_convalidato_aggiunge_l_anno(self):
        s, t, p = SA.righe_da_documenti({"2026-12-31": doc_finto("2026-12-31", "Analisi_31.12.2026_dati_convalidati.pdf")})
        self.assertEqual(p, [])
        self.assertEqual(s, [dict(anno=2026, ingressi_italiani=647, ingressi_stranieri=550, ingressi_totale=1197,
                                  media_italiani=312, media_stranieri=276, media_totale=588)])
        self.assertEqual(t, [dict(anno=2026, trasferimenti_adulti=195)])

    def test_bollettino_provvisorio_non_chiude_l_anno(self):
        s, t, p = SA.righe_da_documenti({"2026-12-31": doc_finto("2026-12-31", "Analisi_31.12.2026_G.pdf")})
        self.assertEqual((s, t, p), ([], [], []))

    def test_documenti_che_non_sono_di_fine_anno_o_sono_nel_periodo_base_si_ignorano(self):
        validi = {"2026-10-15": doc_finto("2026-10-15", "Analisi_15.10.2026_convalidato.pdf"),
                  "2025-12-31": doc_finto("2025-12-31", "Analisi_31.12.2025_convalidati.pdf")}
        self.assertEqual(SA.righe_da_documenti(validi), ([], [], []))

    def test_dati_incoerenti_non_vengono_aggiunti_e_sono_segnalati(self):
        validi = {"2026-12-31": doc_finto("2026-12-31", "Analisi_31.12.2026_convalidati.pdf", ita=600)}  # 600 + 550 != 1197
        s, t, p = SA.righe_da_documenti(validi)
        self.assertEqual((s, t), ([], []))
        self.assertEqual(len(p), 1)
        self.assertIn("2026", p[0]["motivo"])

    def test_dato_mancante_non_viene_aggiunto_e_e_segnalato(self):
        validi = {"2026-12-31": doc_finto("2026-12-31", "Analisi_31.12.2026_convalidati.pdf", media=None)}
        s, t, p = SA.righe_da_documenti(validi)
        self.assertEqual((s, t), ([], []))
        self.assertIn("presenza media", p[0]["motivo"])

    def test_scrittura_idempotente_e_righe_base_intatte(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            base_s = "anno,ingressi_italiani,ingressi_stranieri,ingressi_totale,media_italiani,media_stranieri,media_totale\r\n2024,624,634,1258,283,273,556\r\n2025,647,550,1197,312,276,588\r\n"
            base_t = "anno,trasferimenti_adulti\r\n2024,189\r\n2025,195\r\n"
            (tmp / "serie_storica.csv").write_bytes(base_s.encode())
            (tmp / "trasferimenti_adulti.csv").write_bytes(base_t.encode())
            s, t, _ = SA.righe_da_documenti({"2026-12-31": doc_finto("2026-12-31", "Analisi_31.12.2026_convalidati.pdf")})
            for _ in range(2):  # lanciato due volte: stesso risultato
                self.assertEqual(SA.aggiorna_file(tmp, s, t), [2026])
            testo = (tmp / "serie_storica.csv").read_bytes().decode()
            self.assertTrue(testo.startswith(base_s))  # le righe fino al 2025 sono identiche, byte per byte
            self.assertEqual(testo[len(base_s):], "2026,647,550,1197,312,276,588\r\n")
            self.assertEqual((tmp / "trasferimenti_adulti.csv").read_bytes().decode(), base_t + "2026,195\r\n")
            # se il bollettino sparisce l'anno aggiunto sparisce: le righe base restano
            SA.aggiorna_file(tmp, [], [])
            self.assertEqual((tmp / "serie_storica.csv").read_bytes().decode(), base_s)
        finally:
            shutil.rmtree(tmp)

    def test_il_parser_ricostruisce_le_righe_2024_e_2025_dai_pdf(self):
        """Con i vecchi bollettini convalidati le righe ricavate dal PDF coincidono con la serie annuale ufficiale."""
        trovati = {}
        for y in (2024, 2025):
            f = [x for x in glob.glob(str(PDF / f"*31.12.{y}*")) if "convalid" in x.lower()]
            if not f:
                self.skipTest(f"bollettino convalidato del 31 dicembre {y} non trovato in {PDF}")
            import ipm_parser as P
            d = P.parse_pdf(f[0])
            trovati[d["data_rif"]] = d
        s, t, p = SA.righe_da_documenti(trovati, anno_base=2023)
        self.assertEqual(p, [])
        base = {int(r["anno"]): r for r in leggi("serie_storica.csv")}
        base_t = {int(r["anno"]): r for r in leggi("trasferimenti_adulti.csv")}
        self.assertEqual([r["anno"] for r in s], [2024, 2025])
        for r in s:
            for k, v in r.items():
                self.assertEqual(str(v), base[r["anno"]][k], f"{r['anno']} {k}")
        for r in t:
            self.assertEqual(str(r["trasferimenti_adulti"]), base_t[r["anno"]]["trasferimenti_adulti"])


class TestPagina(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")

    def test_ogni_grafico_ha_la_fonte(self):
        import re
        card = len(re.findall(r'<article class="card"', self.html))
        fonti = len(re.findall(r'class="fonte"', self.html))
        self.assertEqual(card, fonti)

    def test_i_link_dell_indice_puntano_a_sezioni_esistenti(self):
        import re
        for href in re.findall(r'<nav class="topnav".*?</nav>', self.html, re.S)[0].split('href="#')[1:]:
            ident = href.split('"')[0]
            self.assertIn(f'id="{ident}"', self.html, ident)

    def test_niente_apostrofi_dritti_nel_testo_visibile(self):
        import re
        corpo = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", self.html, flags=re.S)
        testo = re.sub(r"<[^>]+>", " ", corpo)
        self.assertNotIn("'", testo)
        self.assertNotIn('"', testo)  # solo virgolette ad angolo “ ” nel testo


if __name__ == "__main__":
    unittest.main(verbosity=2)
