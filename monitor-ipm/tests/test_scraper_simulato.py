"""Prova dello scraper su un finto sito del Ministero (server locale), senza toccare il sito vero.
Esegui:  python3 tests/test_scraper_simulato.py
"""
import shutil
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import scraper as S  # noqa: E402

PDF_ESISTENTE = ROOT / "data" / "pdf" / "Analisi_Servizi_minorili_15102026_G.pdf"
PDF_NUOVO = ROOT / "data" / "pdf" / "Analisi_Servizi_minorili_30.09.2026G.pdf"

ELENCO = {
    1: """<html><body><div>Pagina 1 di 3</div>
      <ul>
       <li><a href="/giustizia/it/mg_1_14_1.page?contentId=SST900002">Minorenni e giovani adulti in carico ai Servizi minorili - 30 settembre 2026 - Dati provvisori</a></li>
       <li><a href="/giustizia/it/mg_1_14_1.page?contentId=SST900001">Minorenni e giovani adulti in carico ai Servizi minorili - 15 ottobre 2026 - dati provvisori</a></li>
       <li><a href="/giustizia/it/mg_1_14_1.page?contentId=SST111111">Altra statistica sui minorenni 2026</a></li>
      </ul></body></html>""",
    2: """<html><body><div>Pagina 2 di 3</div>
      <div class="item"><h3>Minorenni e giovani adulti in carico ai Servizi minorili - 15 settembre 2026</h3>
         <a href="/giustizia/it/mg_1_14_1.page?contentId=SST900003">Leggi</a></div></body></html>""",
    3: "<html><body><div>Pagina 3 di 3</div><p>niente</p></body></html>",
}
SCHEDE = {
    "SST900001": '<html><a href="/giustizia/cms/documents/Analisi_Servizi_minorili_15102026_G.pdf">PDF</a></html>',
    "SST900002": '<html><a href="/giustizia/cms/documents/Analisi_Servizi_minorili_30.09.2026G.pdf?x=1">PDF</a></html>',
    "SST900003": "<html><p>scheda senza allegato</p></html>",
}


class H(BaseHTTPRequestHandler):
    modalita = "ok"

    def log_message(self, *a):
        pass

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if H.modalita == "bloccato":
            self.send_response(403); self.end_headers(); return
        if u.path.endswith("/statistiche"):
            body = ELENCO.get(int(q.get("page", ["1"])[0]), "").encode()
            self.send_response(200); self.send_header("Content-Type", "text/html"); self.end_headers(); self.wfile.write(body); return
        if "mg_1_14_1.page" in u.path:
            body = SCHEDE.get(q["contentId"][0], "").encode()
            self.send_response(200); self.send_header("Content-Type", "text/html"); self.end_headers(); self.wfile.write(body); return
        if u.path.endswith("15102026_G.pdf"):
            data = PDF_ESISTENTE.read_bytes()
        elif u.path.endswith("30.09.2026G.pdf"):
            data = PDF_NUOVO.read_bytes()
        else:
            self.send_response(404); self.end_headers(); return
        self.send_response(200); self.send_header("Content-Type", "application/pdf"); self.end_headers(); self.wfile.write(data)


def main():
    srv = HTTPServer(("127.0.0.1", 0), H)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    S.BASE = f"http://127.0.0.1:{port}"
    S.LIST_URL = S.BASE + "/giustizia/page/it/statistiche"
    S.PAUSA = 0
    log = []
    tmp = Path(tempfile.mkdtemp())
    pdf_dir, reg = tmp / "pdf", tmp / "fonti.csv"
    pdf_dir.mkdir()
    shutil.copy(PDF_ESISTENTE, pdf_dir / "gia_presente_con_altro_nome.pdf")  # stesso contenuto, nome diverso

    # 1) controllo quotidiano: legge 3 pagine, trova 3 voci (una col titolo fuori dal link), scarica solo la nuova
    nuovi = S.aggiorna_archivio(pdf_dir, reg, pagine_max=3, log=log.append)
    assert nuovi == ["Analisi_Servizi_minorili_30.09.2026G.pdf"], nuovi
    righe = S.leggi_registro(reg)
    ids = {r["content_id"] for r in righe}
    assert ids == {"SST900001", "SST900002"}, ids  # SST900003 non ha PDF -> non registrata; SST111111 non pertinente
    assert any("già presente" in l for l in log), log
    assert any("nessun PDF" in l for l in log), log
    d = {r["content_id"]: r["data_titolo"] for r in righe}
    assert d["SST900002"] == "2026-09-30" and d["SST900001"] == "2026-10-15", d

    # 2) seconda esecuzione: nulla di nuovo, nessun errore
    log.clear()
    nuovi = S.aggiorna_archivio(pdf_dir, reg, pagine_max=3, log=log.append)
    assert nuovi == [], nuovi

    # 3) sito che blocca: errore esplicito
    H.modalita = "bloccato"
    try:
        S.aggiorna_archivio(pdf_dir, reg, pagine_max=3, log=log.append)
        raise SystemExit("ERRORE: doveva fallire")
    except S.ScraperError as e:
        assert "403" in str(e), e
    # 4) pagina con struttura cambiata: nessun contentId -> errore esplicito
    H.modalita = "ok"
    ELENCO[1] = "<html><body>Pagina 1 di 3 <p>layout nuovo</p></body></html>"
    try:
        S.aggiorna_archivio(pdf_dir, reg, pagine_max=3, log=log.append)
        raise SystemExit("ERRORE: doveva fallire")
    except S.ScraperError as e:
        assert "struttura" in str(e), e
    srv.shutdown()
    shutil.rmtree(tmp)
    print("test scraper simulato: TUTTO OK")


if __name__ == "__main__":
    main()
