# Monitor IPM

Dashboard pubblica e gratuita sugli istituti penali per minorenni (IPM) italiani, costruita leggendo i PDF
"Minorenni e giovani adulti in carico ai Servizi minorili" del Ministero della Giustizia
(<https://www.giustizia.it/giustizia/it/mg_1_14.page>).

Il sito è la cartella `docs/` (pubblicata con GitHub Pages). Un'automazione (GitHub Actions) controlla ogni giorno se è uscito un PDF
nuovo; se sì lo scarica, lo legge, controlla che i numeri siano coerenti e aggiorna i grafici.
**Non è in tempo reale**: i PDF escono circa due volte al mese, con circa tre settimane di ritardo sulla data di riferimento.

## Cosa c'è dentro

| Cartella / file | A cosa serve |
|---|---|
| `data/pdf/` | archivio dei PDF scaricati (non toccare a mano, salvo il caso "manuale" sotto) |
| `data/fonti.csv` | registro: quale PDF è stato scaricato, da quale pagina, quando |
| `scripts/ipm_parser.py` | legge un PDF e controlla la coerenza interna dei numeri |
| `scripts/scraper.py` | trova e scarica i PDF dal sito del Ministero |
| `scripts/serie_annuali.py` | a fine anno aggiunge da solo l'anno concluso alle serie storiche annuali (vedi sotto) |
| `scripts/aggiorna.py` | coordina tutto e scrive i CSV |
| `docs/` | il sito: `index.html`, `app.js`, `style.css`, `anteprima.png` (immagine per i social), `vendor/` (Chart.js) e `data/` (i CSV) |
| `tests/` | prova dello scaricatore su un sito simulato (`test_scraper_simulato.py`) e controlli sui dati (`test_dati.py`) |
| `.github/workflows/aggiorna.yml` | l'automazione quotidiana |

## Controlli di qualità

Ogni PDF deve superare, prima di entrare nei dati: somma dei presenti per istituto = totale; ingressi per istituto = totale;
tabella per età coerente con quella per istituto; nazionalità e sesso coerenti con i totali; reati per categoria = totale reati.
Se un controllo fallisce il documento **non** entra nei dati: finisce in `docs/data/controlli.csv` e in cima alla dashboard compare un avviso.

## Serie storiche annuali (aggiornamento automatico a fine anno)

Le serie 1991-2025 su ingressi, presenza media giornaliera e trasferimenti verso strutture per adulti (`docs/data/serie_storica.csv`,
`docs/data/trasferimenti_adulti.csv`) vengono dal report annuale del Ministero e **non vengono mai toccate**. Dal 2026 ogni anno si aggiunge da solo
quando esce il bollettino del 31 dicembre con i dati **convalidati** (nel nome del file compare "convalidat"), purché superi i controlli:
ingressi italiani + stranieri = totale; presenza media per nazionalità coerente con il totale; trasferimenti verso adulti presenti.
Se un controllo fallisce l'anno non viene aggiunto e compare un avviso (`PROBLEMA:` nell'esecuzione). Finché il bollettino convalidato non esce
l'anno in corso resta un dato parziale. Se i bollettini del nuovo anno arrivano prima della serie annuale appare in cima alla pagina un avviso.

## Prove automatiche

    python3 tests/test_dati.py
    python3 tests/test_scraper_simulato.py

`test_dati.py` controlla, tra l'altro, che i reati non vengano moltiplicati, che italiani + stranieri = totale, i valori di riferimento
(ingressi 2025 = 1.197, trasferimenti 2025 = 195, ingressi al 15 ottobre 2026 = 871) e che l'aggiornamento di fine anno funzioni.
Se cambia la cifra di un riferimento perché la fonte è stata rettificata, il test va aggiornato a mano di proposito.

## Come leggere l'esito dell'automazione

Su GitHub: scheda **Actions** del repository → ultima esecuzione "Aggiorna dati IPM".

- Spunta verde: tutto ok (anche se non c'erano PDF nuovi).
- Croce rossa: lo script ha segnalato un problema. Aprire l'esecuzione, cliccare sul passo "Scarica i PDF nuovi e ricalcola i dati" e leggere le ultime righe:
  - `ERRORE SITO`: il sito del Ministero non risponde o ha cambiato struttura. Le pagine già pubblicate restano com'erano.
  - `PROBLEMA: <file>`: quel PDF non supera i controlli (può essere un refuso del Ministero). Vedere `docs/data/controlli.csv`.

GitHub invia di norma una mail quando un'esecuzione programmata fallisce.

## Se il sito del Ministero blocca GitHub (piano B manuale)

Se l'errore è sempre `ERRORE SITO`/403, il Ministero potrebbe bloccare gli indirizzi dei server GitHub. In quel caso:

1. Scaricare il PDF a mano dalla pagina del Ministero.
2. Nel repository: `data/pdf/` → **Add file → Upload files** → trascinare il PDF → **Commit changes**.
3. Actions → "Aggiorna dati IPM" → **Run workflow**: lo script rilegge tutti i PDF presenti e aggiorna i CSV.

## Due avvertenze sull'automazione

- GitHub **disattiva le esecuzioni programmate dopo 60 giorni senza attività** nel repository. Gli aggiornamenti dei dati contano come attività
  solo se avvengono su `main`; se per due mesi non uscissero PDF, controllare nella scheda Actions che il flusso sia ancora attivo (pulsante "Enable workflow").
- Le esecuzioni programmate possono partire con ritardo o saltare qualche giorno: non è un errore del progetto.

## Limiti noti

- Solo IPM (niente centri di prima accoglienza, comunità, misure di comunità).
- Le tabelle sulla posizione giuridica non sono ancora lette (seconda fase).
- I reati sono conteggiati come reati, non come persone; le righe sotto soglia possono mancare nei PDF e vengono mostrate come "non riportato", non come zero.
- I PDF hanno cambiato impaginazione nel tempo (ad es. dal 31/12/2024 compaiono gli ingressi esclusi i trasferimenti): il lettore riconosce le tabelle dal titolo,
  non dal numero, ma un nuovo cambio di formato può richiedere un ritocco.

## Provarlo sul proprio computer (facoltativo)

Servono Python 3 e `pdftotext` (pacchetto poppler).

```
pip install -r requirements.txt
python scripts/aggiorna.py --no-scrape      # rilegge i PDF già in data/pdf, senza andare sul sito
python -m http.server --directory docs 8000 # poi aprire http://localhost:8000
```

## Domande da fare al Ministero (statistiche.dgmc@giustizia.it)

- Cosa comprende esattamente "mista senza definitivo" e come si raccordano le categorie di posizione giuridica prima e dopo il 2024?
- Sono disponibili serie storiche precedenti al 2020 nello stesso formato?
- Sotto quale soglia le righe dei reati vengono omesse dalle tabelle?
