# Excel (cartella e repository «excel», prima «foglio»)

## Cos'è
Foglio di calcolo nel browser chiamato «Excel»: celle, formule in italiano (engine.js), più fogli, formati; apre e scarica .xlsx (ExcelJS, xlsx-io.js).
Scrivendo «=» compare l'elenco delle funzioni, filtrato man mano per iniziale (Tab/Invio/clic per inserire, frecce per scegliere, Esc per chiudere); dentro una funzione compare la sua sintassi con l'argomento attuale evidenziato.
Si usa anche come app per Mac (cartella `mac/`: `./mac/build.sh` crea e installa Excel.app in Applicazioni, Apple Silicon). Identificativo `it.foglio.calcolo`, ponte JS `window.foglio` e nome `FoglioFinestra` restano così apposta (dati e posizione finestra).
Le chiavi di salvataggio nel browser restano `foglio.cartella` e `foglio.preferenze` (non cambiarle: si perderebbero i dati salvati).

## Dove sta online
Repository: https://github.com/nemesiMark/excel (ramo `main`, pubblico).
Online con GitHub Pages: https://nemesimark.github.io/excel/ (si aggiorna a ogni push su main).
Compare tra i lavori del sito Nemesi Web (~/Desktop/Sites/nemesiWeb).

## Come si prova in locale
Basta aprire `index.html` nel browser (doppio clic), oppure `python3 -m http.server 8000` nella cartella.
Test automatici (motore formule, suggerimenti, salvataggio/apertura .xlsx): `node --test test/` — devono passare tutti prima di ogni commit.

## Struttura
- `index.html`, `style.css`, `app.js` — interfaccia e logica
- `vendor/` — librerie in copia locale
- `test/` — test con Node (`engine.test.js`, `xlsx.test.js`)
- `mac/` — involucro Swift/WebKit per l'app Mac (`mac/build/` escluso da git)

## Regole di lavoro
- Testi in italiano.
- Commit solo su richiesta; «g» = commit e push su `origin main` (prima `node --test test/`).
- Ogni funzione nuova del motore va aggiunta anche in `FUNCTION_HELP` e `FUNCTION_SYNTAX` (il test lo controlla).
