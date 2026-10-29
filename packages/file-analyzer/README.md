# File analyzer interno e server MCP

Il package contiene l'analizzatore interno di Logicle e un server MCP stdio
compilato dal sorgente locale. Non richiede l'immagine esterna
`ghcr.io/logicleai/mcp-file-analyzer`.

Il server MCP offre un equivalente funzionale per analisi, estrazione e anteprime.
I nomi dei tool e gli argomenti definiti qui sono il suo contratto: non si assume
compatibilità con il precedente binario, del quale non sono presenti i sorgenti.

## Tool disponibili

| Tool                   | Argomenti                                                                              | Risultato                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `analyze_file`         | `file_id`                                                                              | Metadati del file: tipo, dimensioni, pagine o fogli, disponibilità del testo  |
| `extract_text`         | `file_id`, `max_chars` (default 20.000, massimo 200.000)                               | Testo con conteggio originale e indicatore `truncated`                        |
| `extract_text` con OCR | In aggiunta `ocr: true`, `first_page` (default 1), `page_count` (default 1, massimo 5) | OCR italiano/inglese delle pagine richieste                                   |
| `render_preview`       | `file_id`, `page` (default 1), `size` (default 1.200, massimo 1.600)                   | Un'immagine PNG nella risposta MCP, salvata da Logicle come allegato del tool |

I numeri di pagina partono da 1. Le immagini supportano solo pagina 1.
Le dimensioni delle anteprime sono in pixel, mantenendo le proporzioni.

L'estrazione nativa supporta PDF, DOCX, PPTX, XLS/XLSX e file testuali. Per documenti
Office precedenti e ODF, la conversione PDF con LibreOffice fornisce un percorso
aggiuntivo di estrazione; il testo estratto non ricostruisce il layout originale.
Le immagini e i PDF scansionati richiedono OCR esplicito per ottenere testo.
Le anteprime supportano immagini, PDF, Word, PowerPoint, Excel e ODF.

Non sono forniti download da URL, letture di percorsi arbitrari, modifiche ai file
sorgente o esecuzione di comandi scelti dal modello.

## Accesso agli allegati

Il modello passa esclusivamente un ID file Logicle. Il processo chiede i byte al
backend attraverso il canale privato FD 3 usando il protocollo già implementato
in `apps/backend/lib/tools/mcp/file-bridge.ts`. Il backend applica i permessi
utente e restituisce il contenuto dallo storage, inclusa la decifratura necessaria.
Il server MCP non legge direttamente il database o la directory degli upload e
non dispone di un fallback su filesystem o rete quando l'accesso viene negato.

La scoperta dei tool funziona anche senza FD 3; le chiamate che leggono file
richiedono il trasporto sandbox di conversazione. Il processo va quindi
configurato con `sandbox.mode: conversation`, come nell'esempio esistente.
Le anteprime sono restituite nella specifica risposta MCP, anziché in una coda
di artefatti condivisa: anche chiamate concorrenti mantengono il proprio risultato.

I file ricevuti hanno un limite di 50 MiB. Le anteprime hanno un limite di 10 MiB.
Le conversioni usano directory temporanee private, nomi di input fissi e un profilo
LibreOffice distinto per chiamata; le directory vengono eliminate a conclusione
dell'operazione, anche in caso di errore gestito. I subprocessi hanno timeout di
60 secondi ciascuno. Le chiamate al bridge hanno timeout di 30 secondi e quelle
ai tool sono serializzate nel singolo processo. I limiti non sostituiscono le
restrizioni di risorse e rete del container.

## Build separata e immagine GHCR

Il server è compilato separatamente dal backend. Dalla root del repository:

```sh
pnpm exec tsup --config tsup.file-analyzer.config.js
node dist-file-analyzer/mcp-file-analyzer.mjs --help
```

Il bundle è un singolo modulo `.mjs`; Sharp resta una dipendenza nativa esterna.
Lo script `scripts/stage-runtime.mjs` prepara un runtime autonomo copiando Sharp
e le sue dipendenze già installate dal lockfile, senza symlink al checkout.
Non aggiunge librerie e non risolve nuove versioni dal registry.

`packages/file-analyzer/Dockerfile` costruisce l'immagine con Node 24, il launcher
`/mcp-file-analyzer` e il runtime in `/opt/logicle-file-analyzer`. Include Poppler,
LibreOffice e Tesseract con lingue `ita+eng`. Prima dell'esportazione verifica
l'help, un'operazione PNG con Sharp e la presenza delle utility native per ogni
architettura target. Il launcher usa un percorso assoluto e funziona anche
quando Logicle cambia la directory di lavoro nel sandbox di conversazione.

Il workflow **Build and publish MCP file analyzer** pubblica nello stesso package
GHCR dell'app, `ghcr.io/brucekhetta/logicle`, per `linux/amd64` e `linux/arm64`:

- la CI ordinaria usa `mcp-file-analyzer-sha-<commit completo>`;
- l'avvio manuale aggiunge il tag `mcp-file-analyzer-<version>`, ad esempio
  `mcp-file-analyzer-1.0.0`;
- i tag applicativi e `latest` non vengono assegnati dal workflow dell'analyzer.

Il Dockerfile principale mantiene lo stage `FROM ... AS file-analyzer` e copia
launcher e runtime dall'immagine pubblicata. Il default è
`ghcr.io/brucekhetta/logicle:mcp-file-analyzer-1.0.0`. **Prima di usarlo localmente,
pubblica questa versione tramite il workflow manuale**: la modifica dei file non
crea automaticamente il tag sul registry. Serve rendere il package leggibile
all'utente che esegue il pull, oppure abilitarne la visibilità pubblica su GHCR.

La CI e la release applicativa passano `FILE_ANALYZER_IMAGE` con il digest
prodotto dalla stessa esecuzione, così smoke test e pubblicazione dell'app usano
la medesima immagine dell'analyzer. Non dipendono dal tag manuale di default.
Per nuovi contenuti usa una nuova versione; rieseguire manualmente una versione
esistente può riassegnarne il tag. I digest restano i riferimenti esatti delle
build già verificate.

Per sviluppo locale, senza immagine, il comando stdio resta:

```sh
node --import=tsx packages/file-analyzer/src/mcp/cli.ts
```

I log vanno su stderr; stdout è riservato al protocollo MCP, tranne `--help`.
L'opzione `-help`, usata dal controllo CI esistente, è supportata.

## Provisioning e test

Il provisioning è in [examples/provisioning/mcp-file-analyzer.yaml](../../examples/provisioning/mcp-file-analyzer.yaml).
Per il Compose di test è presente anche il tool nel provisioning di `tools/testing`:
aggiungilo ai tool di un assistente con un modello che supporta le funzioni.
Il backend Mock Echo consente di provare l'app ma non sceglie autonomamente i tool.

```sh
pnpm exec vitest run packages/file-analyzer/__tests__ \
  apps/backend/lib/tools/mcp/__tests__/file-bridge.test.ts \
  __tests__/toolOutputNormalization.test.ts
pnpm run check-types
```

I test verificano PDF e spreadsheet sintetici, ridimensionamento di immagini,
framing binario, rifiuto dei percorsi, limiti, autorizzazione nel backend e una
connessione stdio reale con FD 3. I test dei comandi Office/OCR simulano le utility
native per controllare gli argomenti, i timeout e la pulizia dei file temporanei;
non dimostrano la qualità del rendering/OCR reale nel container.

La pipeline verifica anche la risoluzione dei tag e il packaging nativo:

```sh
node --test .github/scripts/file-analyzer-image.test.mjs \
  packages/file-analyzer/scripts/stage-runtime.test.mjs
```

La validazione locale non pubblica immagini né avvia workflow. Il runtime host
è Node 25.6.0; i bundle e le immagini sono configurati per Node 24.
Le prove reali Linux/amd64 e Linux/arm64 sono eseguite dalla pipeline Docker;
finché questa non viene avviata, rimangono da confermare nel runner.

Per il nuovo packaging sono stati verificati localmente 15 test Node (versioni
release, tag analyzer e runtime Sharp), il controllo tipi e la build separata.
Il payload preparato è stato avviato su stdio/FD 3 con discovery, estrazione
TXT/PDF/DOCX/XLSX, anteprima PNG e accesso negato, impedendo i caricamenti CommonJS
esterni al payload. YAML, collegamenti tra workflow, permessi ereditati, passaggio
dei digest e sintassi shell sono stati controllati localmente. Nessun workflow
GitHub, build Docker o push GHCR è stato eseguito durante questa preparazione.
