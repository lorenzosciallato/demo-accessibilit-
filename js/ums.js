/* ums.js — TUTTO il JavaScript del progetto, nell'ordine originale dei blocchi.
   Stessa regola del CSS: si modifica alla fonte, non si aggiunge in coda. */

// ====================================================================
// SEZIONE 1 — ex <script id="blocco-anonimo">
// ====================================================================
        // =========================================================================
        // GLOBALS
        // =========================================================================
        let factorsData = {};
        let activeCards = [];
        let initialCards = [];
        let currentCardIndex = 0;
        const STORAGE_KEY = 'una_mano_accessibilita_notes';

        // FIX 1+2 — chiave della lezione corrente (dal parametro ?file=), usata per
        // salvare appunti, evidenziazioni e lavagna SEPARATAMENTE per ogni lezione
        let umsLessonKey = 'default';
        let umsPristineHash = '';
        let umsPersistTimer = null;

        // =========================================================================
        // SINCRONIZZAZIONE CLOUD (tappa 3) — attiva solo se l'utente è connesso.
        // localStorage resta la fonte primaria; il cloud è uno specchio.
        // =========================================================================
        const UMS_API = '';
        const umsGetChiave = () => localStorage.getItem('ums_chiave') || '';
        let umsCloudData = null;      // dati scaricati dal server per questa chiave
        let umsSaveTimer = null;
        let umsPending = {};          // modifiche in attesa di invio: { "kind::id": content }

        // Scarica dal server tutti i dati della chiave e li versa in localStorage,
        // ma solo se il server ha una versione più recente (o se in locale manca).
        async function umsCloudPull() {
            const chiave = umsGetChiave();
            if (!chiave) return;
            try {
                const r = await fetch(UMS_API + '/load', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chiave })
                });
                const d = await r.json();
                if (!d.ok) return;
                umsCloudData = d.dati || [];
                // Prima: la memoria SR va ricostruita da TUTTE le lezioni (non solo la corrente)
                const srDb = {};
                umsCloudData.forEach(row => {
                    if (row.kind !== 'sr') return;
                    let c; try { c = JSON.parse(row.content); } catch (e) { return; }
                    if (c === null) return;      // cancellazione logica
                    srDb[row.item_id] = c;
                });
                if (Object.keys(srDb).length > 0) {
                    try { localStorage.setItem('ums_sr', JSON.stringify(srDb)); } catch (e) {}
                }
                umsCloudData.forEach(row => {
                    // Riportiamo nei localStorage-key nativi del sito i dati di QUESTA lezione
                    if (row.item_id !== umsLessonKey) return;
                    let content;
                    try { content = JSON.parse(row.content); } catch (e) { return; }
                    if (content === null) return;
                    if (row.kind === 'hl') {
                        localStorage.setItem('ums_hl::' + umsLessonKey, JSON.stringify(content));
                    } else if (row.kind === 'notes') {
                        // content = { "0": "...", "1": "..." } per area
                        Object.keys(content).forEach(idx => {
                            localStorage.setItem('una_mano_accessibilita_notes::' + umsLessonKey + '::' + idx, content[idx]);
                        });
                    }
                });
            } catch (e) { /* offline: pazienza, si userà il locale */ }
        }

        // Mette una modifica in coda e programma l'invio (debounce 1.5s)
        function umsCloudQueue(kind, id, content) {
            if (!umsGetChiave()) return;             // non connesso: niente cloud
            umsPending[kind + '::' + id] = { kind, id, content };
            clearTimeout(umsSaveTimer);
            umsSaveTimer = setTimeout(umsCloudFlush, 1500);
        }

        // Invia al server tutto ciò che è in coda
        async function umsCloudFlush() {
            const chiave = umsGetChiave();
            if (!chiave) return;
            const items = Object.values(umsPending);
            if (items.length === 0) return;
            umsPending = {};
            try {
                await fetch(UMS_API + '/save', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chiave, items })
                });
            } catch (e) {
                // rimetto in coda per il prossimo tentativo
                items.forEach(it => { umsPending[it.kind + '::' + it.id] = it; });
            }
        }

        // Registra la visita alla lezione corrente (data/ora)
        function umsCloudVisit() {
            if (!umsGetChiave() || !umsLessonKey || umsLessonKey === 'default') return;
            umsCloudQueue('visit', umsLessonKey, { at: new Date().toISOString() });
        }

        // Invio immediato quando l'utente chiude/cambia scheda (non perde nulla)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') umsCloudFlush();
        });
        window.addEventListener('pagehide', umsCloudFlush);


        // TASK 3 — colore evidenziatore attivo (default giallo)
        let hlActiveColor = '#FFF176';

        // TASK 4 — contatore concetti lavagna
        let wbCount = 0;

        // TASK 5 — dati Il Super Quiz
        let superQuizData = [];

        // =========================================================================
        // TASK 3 — Selezione colore palette
        // =========================================================================
        function hlSetColor(el) {
            document.querySelectorAll('.hl-swatch').forEach(s => s.classList.remove('hl-swatch-active'));
            el.classList.add('hl-swatch-active');
            hlActiveColor = el.dataset.color;
        }

        // =========================================================================
        // TASK 4 — Smart Whiteboard helpers
        // =========================================================================
        // Il banner che copriva la lavagna e' stato tolto: la lavagna adesso e'
        // sempre in vista. Quando e' vuota si accorcia (classe wb-vuota-on) e
        // mostra la riga di invito, cosi' non occupa mezzo schermo per niente.
        function wbSyncVuota() {
            const wb = document.getElementById('smart-whiteboard');
            if (!wb) return;
            const vuota = !wb.querySelector('.wb-row');
            wb.classList.toggle('wb-vuota-on', vuota);
            const riga = document.getElementById('wb-vuota');
            if (riga) riga.style.display = vuota ? '' : 'none';
        }

        function wbMinimize() {
            const wb = document.getElementById('smart-whiteboard');
            if (wb) wb.classList.add('wb-visible');
            wbSyncVuota();
        }

        // FIX 6 — questa funzione veniva chiamata dal pulsante "✕ Rimuovi" ma non esisteva:
        // rimuovere un'evidenziazione con la lavagna ridotta mandava il codice in errore
        function wbUpdateBadge() {
            wbSyncVuota();
        }

        // (rimossa wbToggleExpand: il pulsante "ingrandisci lavagna" non
        //  esiste più nell'HTML — le altezze vivono in css/ums.css, TASK 4)

        // FIX 2 — PERSISTENZA: evidenziazioni + lavagna sopravvivono al refresh.
        // Salva (con debounce) l'HTML del riassuntone evidenziato e le righe della
        // lavagna (testo, colore, nota) in localStorage, con chiave per-lezione.
        function umsHash(str) {
            let h = 0;
            for (let i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
            return String(h);
        }

        function umsPersistState() {
            clearTimeout(umsPersistTimer);
            umsPersistTimer = setTimeout(() => {
                try {
                    const container = document.getElementById('dyn-riassuntone-container');
                    const rows = [];
                    document.querySelectorAll('#wb-body .wb-row').forEach(row => {
                        rows.push({
                            id: row.dataset.hlId,
                            text: row.querySelector('.wb-hl-text').textContent,
                            color: row.dataset.hlColor || '#FFF176',
                            note: row.querySelector('.wb-note-input').value
                        });
                    });
                    const payload = {
                        hash: umsPristineHash,
                        html: container ? container.innerHTML : '',
                        wb: rows
                    };
                    localStorage.setItem('ums_hl::' + umsLessonKey, JSON.stringify(payload));
                    umsCloudQueue('hl', umsLessonKey, payload);
                } catch(e) {}
            }, 400);
        }

        function umsRestoreState() {
            try {
                const raw = localStorage.getItem('ums_hl::' + umsLessonKey);
                if (!raw) return;
                const data = JSON.parse(raw);
                // Se il contenuto della lezione è cambiato, i vecchi salvataggi non sono
                // più affidabili: meglio scartarli che ripristinare evidenziazioni sballate.
                if (data.hash !== umsPristineHash) {
                    localStorage.removeItem('ums_hl::' + umsLessonKey);
                    return;
                }
                const container = document.getElementById('dyn-riassuntone-container');
                if (container && data.html) container.innerHTML = data.html;
                (data.wb || []).forEach(r => {
                    wbAddEntry(r.text, r.color, r.id);
                    const row = document.querySelector(`.wb-row[data-hl-id="${r.id}"]`);
                    if (row && r.note) {
                        const inp = row.querySelector('.wb-note-input');
                        inp.value = r.note;
                        inp.style.height = 'auto';
                        inp.style.height = inp.scrollHeight + 'px';
                    }
                });
                // la lavagna è sempre in vista: qui aggiorno solo lo stato vuoto/pieno
                wbSyncVuota();
            } catch(e) {}
        }

        function wbMaximize() {
            const wb = document.getElementById('smart-whiteboard');
            if (wb) wb.classList.add('wb-visible');
            wbSyncVuota();
        }

        // all'apertura della pagina la lavagna e' gia' in vista, vuota e bassa
        function wbInit() {
            const wb = document.getElementById('smart-whiteboard');
            if (wb) wb.classList.add('wb-visible');
            wbSyncVuota();
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', wbInit);
        } else {
            wbInit();
        }

        function wbScroll(delta) {
            const body = document.getElementById('wb-body');
            body.scrollTop += delta;
        }

        function wbAddEntry(text, color, hlId) {
            const body = document.getElementById('wb-body');
            const row = document.createElement('div');
            row.className = 'wb-row';
            row.dataset.hlId = hlId;
            row.dataset.hlColor = color; // FIX 2 — serve alla persistenza

            const swatch = document.createElement('div');
            swatch.className = 'wb-hl-swatch';
            swatch.style.background = color;

            const hlText = document.createElement('div');
            hlText.className = 'wb-hl-text';
            hlText.style.background = color + '55';
            hlText.textContent = text;

            // Nuovo contenitore per mantenere la freccia graficamente separata dal testo
            const noteContainer = document.createElement('div');
            noteContainer.className = 'wb-note-container';

            const arrow = document.createElement('span');
            arrow.className = 'wb-note-arrow';
            arrow.innerHTML = '&#8627;'; // Freccia a gomito

            const noteInput = document.createElement('textarea');
            noteInput.className = 'wb-note-input';
            noteInput.rows = 1;
            noteInput.placeholder = 'Scrivi i tuoi appunti qui...';
            
            // Magia: auto-espansione della textarea quando si va a capo
            noteInput.addEventListener('input', function() {
                this.style.height = 'auto';
                this.style.height = this.scrollHeight + 'px';
                umsPersistState(); // FIX 2 — salva le note della lavagna
            });

            noteContainer.appendChild(arrow);
            noteContainer.appendChild(noteInput);

            const delBtn = document.createElement('button');
            delBtn.className = 'wb-del-btn';
            delBtn.innerHTML = '&times;';
            delBtn.dataset.hlId = hlId;
            delBtn.addEventListener('click', () => wbDeleteEntry(hlId));

            row.appendChild(swatch);
            row.appendChild(hlText);
            row.appendChild(noteContainer); // Aggiungiamo il contenitore, non più solo l'input
            row.appendChild(delBtn);
            body.appendChild(row);

            wbCount++;

            wbMaximize();

            setTimeout(() => { body.scrollTop = body.scrollHeight; }, 50);

            umsPersistState(); // FIX 2
        }

        function wbDeleteEntry(hlId) {
            const row = document.querySelector(`.wb-row[data-hl-id="${hlId}"]`);
            if (row) row.remove();

            const mark = document.querySelector(`mark[data-hl-id="${hlId}"]`);
            if (mark) {
                const parent = mark.parentNode;
                while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
                parent.removeChild(mark);
            }

            wbCount--;

            wbSyncVuota();
            
            showToast('Concetto rimosso.', 'success');

            umsPersistState(); // FIX 2
        }

        // Costruisce il foglio editoriale (riusato da Stampa E Condividi)
        function wbSheetHTML() {
            

            // UPGRADE — la stampa ora ha lo stile editoriale di Demo Accessibilità
            // (SEMPRE in versione giorno: la notturna consumerebbe troppo inchiostro)
            // Il titolo è su due <span> attaccati ("Sociologia"+"dell'Educazione"):
            // textContent li incolla senza spazio. Unisco i pezzi a mano.
            const tEl = document.getElementById('dyn-title');
            const lessonTitle = tEl
                ? Array.from(tEl.childNodes).map(n => (n.textContent || '').trim()).filter(Boolean).join(' ')
                : 'Lezione Dinamica';
            const printDate = new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

            let printContents = `
                <img src="https://lorenzosciallato.github.io/demo-accessibilit-/img/sfondo-giappone-1600.png"
                     alt="" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.06; z-index: -1;">
                <div style="font-family: 'DM Sans', Arial, sans-serif; padding: 28px 24px; color: #1C1C22; max-width: 780px; margin: 0 auto; -webkit-print-color-adjust: exact; print-color-adjust: exact;">

                    <h1 style="font-family: 'Playfair Display', Georgia, serif; font-size: 30px; font-weight: 700; color: #1A2F4F; margin: 0 0 6px 0; line-height: 1.15;">
                        ${lessonTitle}
                    </h1>
                    <div style="font-size: 12px; color: #918E86; margin-bottom: 14px;">
                        Lavagna Concetti &middot; ${printDate}
                    </div>
                    <div style="border-top: 4px double #1C1C22; margin-bottom: 28px;"></div>
            `;

            // UPGRADE — mappa ogni evidenziazione al suo MACROARGOMENTO e raccoglie
            // le domande di Check Point di ogni macro (SENZA risposte: la stampa
            // diventa uno strumento di autoverifica).
            const secOfHl = {};
            const questionsBySec = {};
            const secOrder = [];
            (function () {
                const cont = document.getElementById('dyn-riassuntone-container');
                if (!cont) return;
                let current = null;
                cont.querySelectorAll('h3, mark.highlighted-text, .cornell-question').forEach(el => {
                    if (el.tagName === 'H3') {
                        current = el.textContent.trim();
                        if (!secOrder.includes(current)) secOrder.push(current);
                        if (!questionsBySec[current]) questionsBySec[current] = [];
                    } else if (el.classList.contains('highlighted-text')) {
                        const id = el.getAttribute('data-hl-id');
                        if (id && current) secOfHl[id] = current;
                    } else if (current) {
                        // FIX — molti JSON hanno come prima "domanda" una semplice
                        // etichetta ("Punto di controllo:" e traduzioni varie): non e'
                        // una domanda e non va stampata. Una vera domanda contiene un
                        // "?" oppure e' una consegna lunga; le etichette brevi che
                        // finiscono con ":" vengono scartate, in qualunque lingua.
                        const qText = el.textContent.trim();
                        const isLabel = !qText.includes('?') && (/[:\uFF1A]\s*$/.test(qText) || qText.length < 25);
                        if (!isLabel) questionsBySec[current].push(qText);
                    }
                });
            })();

            // Raggruppa le righe della lavagna per macroargomento (ordine della lezione)
            const OTHER = 'Altri concetti';
            const groups = {};
            const body = document.getElementById('wb-body');
            body.querySelectorAll('.wb-row').forEach(row => {
                const hlId = row.dataset.hlId;
                const sec = secOfHl[hlId] || OTHER;
                (groups[sec] = groups[sec] || []).push(row);
            });
            const orderedSecs = secOrder.filter(s => groups[s]).concat(groups[OTHER] ? [OTHER] : []);

            let wbPrintIdx = 0;
            orderedSecs.forEach(sec => {
                // intestazione del macroargomento, stile testata di rubrica
                printContents += `
                    <div style="margin: 30px 0 18px; page-break-inside: avoid; break-inside: avoid;">
                        <div style="font-size: 9px; font-weight: 700; letter-spacing: 0.28em; text-transform: uppercase; color: #9A7A3F; margin-bottom: 5px;">Macroargomento</div>
                        <h2 style="font-family: 'Playfair Display', Georgia, serif; font-size: 20px; font-weight: 700; color: #1A2F4F; margin: 0; line-height: 1.3;">${sec}</h2>
                        <div style="width: 44px; border-top: 3px solid #C8A96E; margin-top: 8px;"></div>
                    </div>
                `;

                groups[sec].forEach(row => {
                    const hlText = row.querySelector('.wb-hl-text').textContent;
                    const noteInputVal = row.querySelector('.wb-note-input').value.trim();
                    const color = row.querySelector('.wb-hl-swatch').style.background;
                    const num = String(++wbPrintIdx).padStart(2, '0');

                    // Numero in stile "ch-number" del sito + barra del colore di evidenziazione.
                    // page-break-inside: avoid; impedisce al blocco di spaccarsi a metà pagina!
                    // white-space: pre-wrap; stampa fedelmente gli "a capo" della textarea.
                    printContents += `
                        <div style="display: flex; gap: 16px; margin-bottom: 22px; page-break-inside: avoid; break-inside: avoid;">
                            <div style="font-family: 'Playfair Display', Georgia, serif; font-weight: 700; font-size: 22px; color: #C8A96E; min-width: 34px; line-height: 1.2; text-align: right;">${num}</div>
                            <div style="flex: 1; border-left: 4px solid ${color}; border-bottom: 1px solid #E4E0D6; padding: 2px 0 14px 16px;">
                                <p style="font-family: 'Playfair Display', Georgia, serif; font-weight: 700; font-size: 17px; color: #1A2F4F; margin: 0 0 7px 0; line-height: 1.45;">${hlText}</p>
                                ${noteInputVal ? `<p style="font-size: 13.5px; color: #555149; margin: 0; line-height: 1.65; white-space: pre-wrap;">&#8627; ${noteInputVal}</p>` : ''}
                            </div>
                        </div>
                    `;
                });

                // domande di Check Point del macroargomento, SENZA risposte
                const qs = questionsBySec[sec] || [];
                if (qs.length) {
                    printContents += `
                        <div style="border: 1px solid #E4E0D6; border-left: 3px solid #C8A96E; padding: 14px 18px; margin: 4px 0 8px 50px; page-break-inside: avoid; break-inside: avoid;">
                            <div style="font-size: 9px; font-weight: 700; letter-spacing: 0.24em; text-transform: uppercase; color: #9A7A3F; margin-bottom: 9px;">Check Point &mdash; rispondi senza guardare gli appunti</div>
                            ${qs.map(q => `<p style="font-size: 13px; color: #1C1C22; margin: 0 0 7px 0; line-height: 1.6;">&#9744;&nbsp; ${q}</p>`).join('')}
                        </div>
                    `;
                }
            });

            printContents += `
                    <div style="margin-top: 34px; border-top: 4px double #1C1C22; padding-top: 14px; text-align: center;">
                        <div style="font-family: 'Playfair Display', Georgia, serif; font-weight: 900; font-size: 15px; letter-spacing: -0.02em; color: #1C1C22;">Demo <em style="font-style: italic; color: #1A2F4F;">Accessibilità</em></div>
                        <div style="width: 44px; border-top: 2px solid #C8A96E; margin: 10px auto 0;"></div>
                    </div>
                </div>`;

            return printContents;
        }

        function wbExportPDF() {
            if (wbCount === 0) { showToast('Nessun concetto da esportare.', 'retry'); return; }
            showToast('Apertura finestra di stampa...', 'success');
            const printContents = wbSheetHTML();
            const iframe = document.createElement('iframe');
            iframe.setAttribute('aria-hidden','true'); iframe.setAttribute('title','Stampa');
            iframe.style.position = 'fixed';
            iframe.style.right = '0';
            iframe.style.bottom = '0';
            iframe.style.width = '0';
            iframe.style.height = '0';
            iframe.style.border = 'none';
            document.body.appendChild(iframe);

            const doc = iframe.contentWindow.document;
            doc.open();
            doc.write(`
                <html>
                    <head>
                        <title>Appunti — Demo Accessibilità</title>
                        <link rel="preconnect" href="https://fonts.googleapis.com">
                        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
                        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
                    </head>
                    <body style="margin:0; background:#fff;">${printContents}
                        <scr` + `ipt>window.onload = () => setTimeout(() => window.print(), 450);</scr` + `ipt>
                    </body>
                </html>
            `);
            doc.close();

            setTimeout(() => { document.body.removeChild(iframe); }, 10000);
        }

        // =========================================================================
        // FIX CAPOLETTERA — applicato SOLO alla prima vera lettera del primo
        // paragrafo: salta titoli (h1-h5) e caratteri non alfabetici, cosi' non
        // puo' piu' agganciarsi al numero dell'intestazione di sezione.
        // =========================================================================
        function applyDropCap() {
            const cont = document.getElementById('dyn-riassuntone-container');
            if (!cont || cont.querySelector('.ums-lead')) return;
            const walker = document.createTreeWalker(cont, NodeFilter.SHOW_TEXT, {
                acceptNode: (n) => {
                    if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                    if (n.parentElement && n.parentElement.closest('h1,h2,h3,h4,h5,.cornell-box')) return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                }
            });
            const node = walker.nextNode();
            if (!node) return;
            const m = node.nodeValue.trimStart().match(/^[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF]/);
            if (!m) return; // se il testo non inizia con una lettera, nessun capolettera
            // Sale fino all'elemento figlio diretto del container (il <p> del primo macro)
            let block = node.parentElement;
            while (block && block.parentElement && block.parentElement !== cont) block = block.parentElement;
            if (block && block !== cont && !/^H[1-5]$/.test(block.tagName)) {
                block.classList.add('ums-lead');
            }
        }
        // =========================================================================
        // TASK 2 — Chunking testo riassuntone
        // =========================================================================
        function chunkParagraphs(rawText) {
            // FIX TRADUZIONE — prima il testo era UN solo <p> spezzato da <br><br>:
            // Google Translate ri-segmenta le frasi ATTRAVERSO quei confini e
            // produce parole troncate e "L'" orfani. Ogni blocco di 2 frasi ora
            // diventa un <p> vero: il widget lo traduce come unità indipendente
            // e il testo resta pulito in qualsiasi lingua.
            if (!rawText) return [];
            if (typeof rawText !== 'string') rawText = String(rawText); // dati sporchi nel JSON

            // Se il testo contiene HTML, nessun chunking (per non rompere i tag)
            if (/<[a-z][\s\S]*>/i.test(rawText)) return [rawText];

            let count = 0;
            const marked = rawText.replace(/\.\s+/g, (match) => {
                count++;
                return (count % 2 === 0) ? '.\u0001' : match;
            });
            return marked.split('\u0001').map(s => s.trim()).filter(Boolean);
        }

        // =========================================================================
        // INIT
        // =========================================================================
 document.addEventListener("DOMContentLoaded", async () => {
            // Legge il parametro 'file' dall'URL (es: ?file=materia-esempio/didattica-lezione-7.json)
            const urlParams = new URLSearchParams(window.location.search);
            const nomeFile = urlParams.get('file');

            // Se l'utente non specifica nulla, diamo un default di sicurezza
            const fileDaCaricare = nomeFile
    ? nomeFile
    : null;

if (!fileDaCaricare) {
    document.getElementById('dyn-title').innerText = "Nessuna lezione specificata";
    document.getElementById('dyn-subtitle').textContent = ''; // PUNTO 2 — via lo skeleton
    return;
}

            // FIX 1+2 — identifica la lezione corrente per la persistenza
            umsLessonKey = decodeURIComponent(fileDaCaricare);

            try {
                // decodeURIComponent gestisce correttamente gli slash e gli spazi nel percorso
                const response = await fetch(decodeURIComponent(fileDaCaricare));
                
                if (!response.ok) {
                    const err404 = new Error("File lezione non trovato al percorso: " + fileDaCaricare);
                    err404.umsMancante = (response.status === 404);
                    throw err404;
                }
                
                const data = await response.json();
                
                popolaInterfaccia(data);

                // Aggiorna il titolo della scheda del browser
                const umsTab = umsInfoDaUrl();
                document.title = umsTab.nome
                    ? umsTab.nome + (umsTab.n ? ' \u2014 Lezione ' + umsTab.n : '')
                    : (data.titolo_lezione || "Demo Accessibilità");

                // BLINDATURA GENERALE — da qui in poi sono rifiniture: se una
                // qualsiasi fallisce, la lezione resta comunque leggibile.
                // MAI più "Lezione non disponibile" per colpa di un accessorio.
                try {
                    // FIX 2 — impronta del riassuntone + ripristino evidenziazioni/lavagna
                    const riassCont = document.getElementById('dyn-riassuntone-container');
                    umsPristineHash = umsHash('p2::' + (riassCont ? riassCont.textContent : ''));
                    await umsCloudPull();   // se connesso, porta giù i dati dal server
                    umsRestoreState();
                    umsCloudVisit();        // registra la visita a questa lezione
                    if (typeof srAggiornaBadge === 'function') srAggiornaBadge();
                    umsControllaRipassoInSospeso();
                    applyDropCap(); // FIX capolettera (dopo il restore)
                } catch (e) { console.error('Persistenza/capolettera:', e); }

                try {
                    setupAccordions();
                    initFlashcards(data.flashcards);
                    setupNotesAutoScroll();
                    setupCopyButtons();
                    setupDownloadButtons();
                } catch (e) { console.error('Setup interfaccia:', e); }
            } catch (error) {
                console.error("Errore nel caricamento:", error);

                // LEZIONE MANCANTE (404) — copy "Mannaggia!" + invito al gruppo
                // chat. Ogni ALTRO errore (JSON rotto, rete, ecc.) tiene la
                // diagnostica tecnica: sono casi diversi e vanno detti diversi.
                if (error && error.umsMancante) {
                    const umsM = umsInfoDaUrl();
                    document.getElementById('dyn-title').innerText =
                        umsM.nome || "Lezione in arrivo";
                    document.getElementById('dyn-subtitle').innerText =
                        umsM.n ? 'Lezione ' + umsM.n : '';
                    try {
                        const WA = '';
                        // Grafica tutta in ums.css (.ums404*): cosi' esiste una
                        // versione per telefono e il pulsante non sborda piu'.
                        const box = document.createElement('div');
                        box.className = 'ums404';
                        box.innerHTML =
                            '<div class="ums404-emoji">\uD83D\uDE45</div>' +
                            '<p class="ums404-tit">Mannaggia!</p>' +
                            '<p class="ums404-txt">' +
                            'Non ho il materiale di questa lezione! Se invece tu ce l\u2019hai, ' +
                            'scrivimi: la aggiungiamo insieme!</p>' +
                            '';

                        // Frecce prev/succ: senza, la lezione mancante è un
                        // vicolo cieco. Costruisco gli URL vicini dallo stesso
                        // ?file= e mostro solo le lezioni >= 1.
                        try {
                            const p = new URLSearchParams(location.search).get('file') || '';
                            const dec = decodeURIComponent(p);
                            const mm = dec.match(/(\d+)(\.json)$/i);
                            if (mm) {
                                const curN = parseInt(mm[1], 10);
                                const urlN = (nn) => location.pathname + '?file=' +
                                    encodeURIComponent(dec.replace(/(\d+)(\.json)$/i, nn + '$2'));
                                const nav = document.createElement('div');
                                nav.className = 'ums404-nav';
                                if (curN > 1) {
                                    const a = document.createElement('a');
                                    a.href = urlN(curN - 1);
                                    a.textContent = '\u2039 Lezione ' + (curN - 1);
                                    nav.appendChild(a);
                                }
                                const a2 = document.createElement('a');
                                a2.href = urlN(curN + 1);
                                a2.textContent = 'Lezione ' + (curN + 1) + ' \u203A';
                                nav.appendChild(a2);
                                box.appendChild(nav);
                            }
                        } catch (eNav) {}

                        const card = document.querySelector('.content-card') || document.body;
                        card.appendChild(box);
                        // Sblocca lo splash SENZA 'ums-master-open' (che sposta la
                        // card con translateY e causava l'autoscroll verso il basso):
                        // libero solo lo scroll e riporto la vista in cima.
                        try {
                            document.body.style.position = 'static';
                            document.body.style.overflow = 'auto';
                            document.body.style.height = 'auto';
                            document.body.style.touchAction = 'auto';
                            box.scrollIntoView({ block: 'center', behavior: 'auto' });
                        } catch (eScroll) {}
                    } catch (e2) {}
                } else {
                    // DIAGNOSTICA IN PAGINA — errori veri (non un 404)
                    document.getElementById('dyn-title').innerText = "Lezione non disponibile";
                    document.getElementById('dyn-subtitle').textContent = '';
                    try {
                        const diag = document.createElement('div');
                        diag.style.cssText = 'max-width:640px;margin:0.8rem auto 0;padding:10px 16px;border:1px solid #B4573E;border-radius:8px;font-family:monospace;font-size:0.72rem;line-height:1.6;color:#B4573E;background:rgba(180,87,62,0.06);text-align:left;word-break:break-word;';
                        diag.textContent = '[build v10] ' + (error && error.stack ? error.stack.split('\n').slice(0, 2).join(' \u2014 ') : String(error));
                        const st = document.getElementById('dyn-subtitle');
                        if (st && st.parentNode) st.parentNode.insertBefore(diag, st.nextSibling);
                    } catch (e2) {}
                }
            }

            // ... (il resto del tuo codice init rimane invariato)
            // ----------------------------------------------------------------
            // Highlighter — TASK 3 & TASK 4 integrati
            // ----------------------------------------------------------------
            const highlighterBtn = document.createElement('div');
            highlighterBtn.id = 'floating-highlighter';
            highlighterBtn.innerHTML = '<span class="hl-add"><svg class="ums-ic" aria-hidden="true"><use href="#ic-highlighter"/></svg> Sottolinea</span><span class="hl-remove" id="hl-remove-btn"><svg class="ums-ic" aria-hidden="true"><use href="#ic-x"/></svg> Rimuovi</span>';
            document.body.appendChild(highlighterBtn);

            let currentSelectionRange = null;

            document.addEventListener('mouseup', (e) => {
                const selection = window.getSelection();
                if (highlighterBtn.contains(e.target)) return;

                if (selection.toString().trim().length > 0) {
                    const range = selection.getRangeAt(0);
                    currentSelectionRange = range.cloneRange();
                    const rect = range.getBoundingClientRect();

                    const ancestor = range.commonAncestorContainer;
                    const parentEl = ancestor.nodeType === 3 ? ancestor.parentElement : ancestor;
                    const insideHL = parentEl.closest('.highlighted-text') !== null;

                    var dentroStudio = document.body.classList.contains('ums-studio-aperto');
                    if (dentroStudio) {
                        // nel pop-up (fixed) uso coordinate del viewport
                        highlighterBtn.style.position = 'fixed';
                        highlighterBtn.style.top = `${rect.top - 56}px`;
                        highlighterBtn.style.left = `${rect.left + (rect.width / 2) - 70}px`;
                        highlighterBtn.style.zIndex = '99999995';
                    } else {
                        highlighterBtn.style.position = 'absolute';
                        highlighterBtn.style.top = `${rect.top + window.scrollY - 56}px`;
                        highlighterBtn.style.left = `${rect.left + window.scrollX + (rect.width / 2) - 70}px`;
                        highlighterBtn.style.zIndex = '';
                    }
                    highlighterBtn.style.display = 'flex';

                    const removeBtn = document.getElementById('hl-remove-btn');
                    insideHL ? removeBtn.classList.add('visible') : removeBtn.classList.remove('visible');
                } else {
                    highlighterBtn.style.display = 'none';
                    currentSelectionRange = null;
                }
            });

            highlighterBtn.addEventListener('mousedown', e => e.preventDefault());

            // TASK 3 & 4 — Aggiungi sottolineatura con colore attivo + ID univoco + aggiungi alla lavagna
            highlighterBtn.querySelector('.hl-add').addEventListener('click', () => {
                const selection = window.getSelection();
                if (!selection.rangeCount) return;
                const range = selection.getRangeAt(0);
                const selectedText = range.toString().trim();

                const mark = document.createElement('mark');
                mark.className = 'highlighted-text';
                mark.style.backgroundColor = hlActiveColor;

                // TASK 4: ID univoco
                const hlId = 'hl_' + Date.now();
                mark.setAttribute('data-hl-id', hlId);

                try {
                    range.surroundContents(mark);
                } catch(e) {
                    showToast("Seleziona testo all'interno dello stesso blocco per sottolineare.", "retry");
                    return;
                }
                selection.removeAllRanges();
                highlighterBtn.style.display = 'none';

                // TASK 4: aggiungi alla lavagna
                wbAddEntry(selectedText, hlActiveColor, hlId);
            });

            // Rimuovi sottolineatura + rimuovi dalla lavagna (bidirezionale)
            document.getElementById('hl-remove-btn').addEventListener('click', () => {
                const selection = window.getSelection();
                if (!selection.rangeCount) return;
                const range = selection.getRangeAt(0);
                const ancestor = range.commonAncestorContainer;
                const parentEl = ancestor.nodeType === 3 ? ancestor.parentElement : ancestor;
                const hlEl = parentEl.closest('.highlighted-text');
                if (hlEl) {
                    const hlId = hlEl.getAttribute('data-hl-id');
                    const parent = hlEl.parentNode;
                    while (hlEl.firstChild) parent.insertBefore(hlEl.firstChild, hlEl);
                    parent.removeChild(hlEl);

                    // Rimuovi dalla lavagna se esiste
                    if (hlId) {
                        const wbRow = document.querySelector(`.wb-row[data-hl-id="${hlId}"]`);
                        if (wbRow) {
                            wbRow.remove();
                            wbCount--;
                            wbUpdateBadge();
                        }
                    }
                    showToast("Sottolineatura rimossa.", "success");
                    umsPersistState(); // FIX 2
                }
                selection.removeAllRanges();
                highlighterBtn.style.display = 'none';
            });

            // Language selector placement
            const widget = document.getElementById("custom-lang-selector");
            if (widget) {
                document.querySelector("header").appendChild(widget);
                widget.classList.add("loaded");
            }

            // Hide Google spinner
            const observer = new MutationObserver(mutations => {
                mutations.forEach(mutation => {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1) {
                            const cn = node.className || "";
                            if (typeof cn === 'string' && cn.includes('goog-te-spinner')) {
                                node.style.display = 'none'; node.remove();
                            }
                            // BLINDATURA — il balloon/tooltip di Google Translate viene
                            // rimosso fisicamente appena creato (il CSS da solo può
                            // perdere contro gli stili runtime del widget)
                            if (node.id === 'goog-gt-tt' || (typeof cn === 'string' && (cn.includes('goog-te-balloon') || cn.includes('goog-tooltip')))) {
                                node.remove();
                            }
                        }
                    });
                });
            });
            observer.observe(document.body, { childList: true, subtree: true });

            // Init sezione Pausa
            // Il crucipuzzle usa SOLO le parole chiave della lezione; se la lezione
            // ha poco testo, integra con la lista classica per arrivare a 20 parole.
            wsBaseWords = wsExtractLessonWords();
            if (wsBaseWords.length < 20) {
                for (const w of WS_WORDS.it) {
                    if (wsBaseWords.length >= 20) break;
                    if (!wsBaseWords.includes(w) && w.length <= 11) wsBaseWords.push(w);
                }
            }
            wsCurrentWords = wsBaseWords.slice();
            wsInit();
            lsLoad(); // rubrica "Accadde Oggi"
        });

        // =========================================================================
        // DATA BINDING — TASK 2 integrato nel rendering di macro.testo
        // =========================================================================
        // PUNTO 2 — prepara un media lazy: URL parcheggiato, montaggio all'apertura
        function umsSetMedia(playerId, linkId, url) {
            const player = document.getElementById(playerId);
            const link = document.getElementById(linkId);
            if (!player) return;
            const wrap = player.closest('.video-container');
            const note = wrap && wrap.parentElement ? wrap.parentElement.querySelector('.video-fallback-note') : null;
            if (url) {
                player.dataset.umsSrc = url;
                if (link) link.href = url;
            } else {
                if (wrap) wrap.style.display = 'none';
                if (link) link.style.display = 'none';
                if (note) note.style.display = 'block';
            }
        }

        // ------------------------------------------------------------------
        // TITOLO = MATERIA (Blocco 4) — i titoli-lezione lunghi allungavano
        // l'header fisso fino a coprire i pulsanti. Ora: titolo = nome della
        // materia (stabile e corto), sottotitolo = "Lezione N · argomento".
        // Il nome si ricava dalla cartella nell'URL; la mappa copre le
        // cartelle storiche, le nuove vanno in Title Case da sole (stessa
        // regola del nome.txt della pipeline).
        // ------------------------------------------------------------------
        const UMS_NOMI_MATERIE = { 'antropologia-culturale-mod-a': 'Antropologia Culturale MOD. A' };
        function umsInfoDaUrl() {
            try {
                const f = new URLSearchParams(location.search).get('file') || '';
                const m = f.match(/(?:^|\/)([^\/]+)\/[^\/]*lezione-(\d+)\.json/i) ||
                          f.match(/^([^\/]+)\/[^\/]*lezione-(\d+)\.json/i);
                const cartella = m ? m[1] : '';
                const n = m ? parseInt(m[2], 10) : null;
                const nome = UMS_NOMI_MATERIE[cartella] ||
                    cartella.split('-').map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(' ');
                return { cartella: cartella, n: n, nome: nome };
            } catch (e) { return { cartella: '', n: null, nome: '' }; }
        }

        function popolaInterfaccia(data) {
            const umsInfo = umsInfoDaUrl();
            const umsArgomento = (data.titolo_lezione || '')
                .replace(/^\s*lezione\s*\d+\s*[:.\-\u2013\u2014]?\s*/i, '').trim();
            document.getElementById('dyn-title').innerText =
                umsInfo.nome || data.titolo_lezione || "";
            if (umsInfo.nome) { const _dt = document.getElementById('dyn-title'); _dt.classList.add('notranslate'); _dt.setAttribute('translate', 'no'); }
            document.getElementById('dyn-subtitle').innerText =
                (umsInfo.n ? 'Lezione ' + umsInfo.n + ' \u00B7 ' : '') +
                (umsArgomento || data.sottotitolo || "");

            // --- SEZIONE 01: ORIENTAMENTO (Gestione Annidata) ---
            try { // BLINDATURA
            if (data.orientamento) {
                // Obiettivi
                const objContainer = document.getElementById('dyn-obiettivi');
                objContainer.innerHTML = '';
                (data.orientamento.obiettivi || []).forEach(ob => {
                    const li = document.createElement('li');
                    li.innerText = ob;
                    objContainer.appendChild(li);
                });

                // Concetto Fondamentale
                if (data.orientamento.concetto_fondamentale && data.orientamento.concetto_fondamentale.testo) {
                    const conc = data.orientamento.concetto_fondamentale;
                    const concDiv = document.getElementById('dyn-concetto-fondamentale');
                    concDiv.style.display = 'block';
                    concDiv.innerHTML = `<strong>${conc.titolo}:</strong><br><br>${conc.testo}`;
                }

                // Nota Extra
                if (data.orientamento.nota_extra && data.orientamento.nota_extra.testo) {
                    const nota = data.orientamento.nota_extra;
                    const notaDiv = document.getElementById('dyn-nota-extra');
                    notaDiv.style.display = 'block';
                    notaDiv.innerHTML = `<strong>${nota.titolo}:</strong> ${nota.testo}`;
                }

                // Domande Autovalutazione
                if (data.orientamento.domande_autovalutazione && data.orientamento.domande_autovalutazione.length > 0) {
                    document.getElementById('dyn-domande-container').style.display = 'block';
                    const domContainer = document.getElementById('dyn-domande');
                    domContainer.innerHTML = '';
                    data.orientamento.domande_autovalutazione.forEach(dom => {
                        const li = document.createElement('li');
                        li.innerText = dom;
                        domContainer.appendChild(li);
                    });
                }
            }

            } catch (e) { console.error('Orientamento saltato:', e); }

            // --- PUNTI CHIAVE (Merge visivo) ---
            try { // BLINDATURA
            const factorsContainer = document.getElementById('dyn-punti-chiave');
            factorsContainer.innerHTML = '';
            factorsData = {}; 
            
            (data.punti_chiave || []).forEach((punto) => {
                const key = punto.id;
                factorsData[key] = { 
                    title: punto.titolo_esteso, 
                    body: punto.testo_modale 
                };
                
                const card = document.createElement('div');
                card.className = 'factor-card';
                card.setAttribute('onclick', `openFactor('${key}')`);
                card.innerHTML = `<span class="fc-plus">+</span><strong>${punto.titolo_breve}</strong><small>${punto.sottotitolo}</small>`;
                factorsContainer.appendChild(card);
            });

            } catch (e) { console.error('Punti chiave saltati:', e); }

            // --- RESTO DEI CONTENUTI ---
            // PUNTO 2 — media lazy: l'URL viene parcheggiato in data-ums-src e
            // montato solo all'apertura della sezione (vedi setupAccordions).
            // Se manca, player e link spariscono e la nota appare — solo allora.
            umsSetMedia('dyn-podcast-player', 'dyn-podcast-link', data.podcast_url || null);
            umsSetMedia('dyn-video-player', 'dyn-video-link',
                (data.video_sintesi_url && data.video_sintesi_url !== "PLACEHOLDER_VIDEO") ? data.video_sintesi_url : null);

            // Riassunto
            const riassuntoContainer = document.getElementById('dyn-riassuntone-container');
            riassuntoContainer.innerHTML = '';
            (data.riassuntone || []).forEach(macro => {
                try { // BLINDATURA — un macro malformato viene saltato, non uccide la lezione
                const buf = [];
                buf.push(`<h3>${macro.titolo}</h3>`);
                if (macro.testo) {
                    chunkParagraphs(macro.testo).forEach(chunk => buf.push(`<p>${chunk}</p>`));
                }
                if (macro.check_points && macro.check_points.length > 0) {
                    buf.push(`<div class="cornell-box"><span class="cp-label">Check Point</span>`);
                    macro.check_points.forEach(cp => {
                        buf.push(`<p class="cornell-question">${cp.domanda}</p>`);
                        buf.push(`<p class="cornell-answer">${cp.risposta}</p>`);
                    });
                    buf.push(`</div>`);
                }
                riassuntoContainer.insertAdjacentHTML('beforeend', buf.join(''));
                } catch (e) { console.error('Macro riassuntone saltato:', e); }
            });

            // === FASE 4 (LXD): feedback "Chiaro / Non chiaro" per sezione ===
            try { umsIniettaFeedbackSezioni(); } catch (e) { /* mai rompere la lezione */ }

            // --- ASSISTENTE IA ---
            try { // BLINDATURA
            // TASK 5 — fix: questi campi non venivano mai popolati, restando bloccati su "Caricamento…"
            if (data.assistente_ia) {
                const ia = data.assistente_ia;
                document.getElementById('dyn-ia-nome').innerText = ia.nome || "Assistente IA";
                document.getElementById('dyn-ia-sottotesto').innerText = ia.sottotesto || "";
                const iaLink = document.getElementById('dyn-ia-url');
                if (ia.url) {
                    iaLink.href = ia.url;
                } else {
                    iaLink.href = "#";
                }
            }

            } catch (e) { console.error('Assistente IA saltato:', e); }

            // --- IL SUPER QUIZ ---
            try { renderSuperQuiz(data.il_super_quiz); } catch (e) { console.error('Quiz:', e); }
        }

        // =========================================================================
        // FASE 4 (LXD) — Feedback "Chiaro / Non chiaro" sotto ogni sezione (<h3>)
        // del Riassuntone. Aggregato e anonimo: manda al worker solo lezione +
        // hash del titolo di sezione + tipo. "Una volta per dispositivo" via
        // localStorage. Non tocca il rendering: si aggancia a valle.
        // =========================================================================
        async function umsHashSezione(testo) {
            try {
                const dati = new TextEncoder().encode(String(testo));
                const buf = await crypto.subtle.digest('SHA-256', dati);
                return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
            } catch (e) { return null; }
        }
        function umsFeedbackVotato(lk, h) {
            try { return localStorage.getItem('ums_fb::' + lk + '::' + h) === '1'; } catch (e) { return false; }
        }
        function umsFeedbackSegna(lk, h) {
            try { localStorage.setItem('ums_fb::' + lk + '::' + h, '1'); } catch (e) {}
        }
        async function umsInviaFeedback(sezioneHash, tipo) {
            try {
                await fetch(UMS_API + '/feedback', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ lezione: umsLessonKey, sezione: sezioneHash, tipo: tipo })
                });
            } catch (e) { /* offline: pazienza, è solo una statistica */ }
        }
        async function umsIniettaFeedbackSezioni() {
            const cont = document.getElementById('dyn-riassuntone-container');
            if (!cont) return;
            const titoli = Array.from(cont.querySelectorAll('h3'));
            for (let i = 0; i < titoli.length; i++) {
                const h3 = titoli[i];
                const hash = await umsHashSezione(h3.textContent || '');
                if (!hash) continue;

                // FINE SEZIONE: l'ultimo elemento prima del prossimo <h3>.
                // Partendo dal titolo, avanzo tra i fratelli finché non trovo
                // il titolo successivo; l'elemento prima di quello è la coda
                // della sezione. Se una riga feedback è già lì, salto.
                let ultimo = h3, gia = false;
                let n = h3.nextElementSibling;
                while (n && n.tagName !== 'H3') {
                    if (n.classList && n.classList.contains('ums-fb-row')) { gia = true; break; }
                    ultimo = n;
                    n = n.nextElementSibling;
                }
                if (gia) continue;

                const row = document.createElement('div');
                row.className = 'ums-fb-row notranslate';
                const votato = umsFeedbackVotato(umsLessonKey, hash);

                if (votato) {
                    row.innerHTML = '<span class="ums-fb-done">Grazie del riscontro ✓</span>';
                } else {
                    row.innerHTML =
                        '<span class="ums-fb-q">Questa parte è chiara?</span>' +
                        '<button type="button" class="ums-fb-btn ums-fb-si">Sì</button>' +
                        '<button type="button" class="ums-fb-btn ums-fb-no">No</button>';
                    const chiudi = () => {
                        row.innerHTML = '<span class="ums-fb-done">Grazie del riscontro ✓</span>';
                        umsFeedbackSegna(umsLessonKey, hash);
                    };
                    row.querySelector('.ums-fb-si').addEventListener('click', () => { umsInviaFeedback(hash, 'chiaro'); chiudi(); });
                    row.querySelector('.ums-fb-no').addEventListener('click', () => { umsInviaFeedback(hash, 'non_chiaro'); chiudi(); });
                }
                // in coda alla sezione, dopo l'ultimo elemento del blocco
                ultimo.insertAdjacentElement('afterend', row);
            }
        }

        // =========================================================================
        // TASK 5 — IL SUPER QUIZ
        // =========================================================================
        function renderSuperQuiz(quizArr) {
            const container = document.getElementById('dyn-super-quiz');
            if (!container) return;
            container.innerHTML = '';
            superQuizData = Array.isArray(quizArr) ? quizArr : []; // dati sporchi -> nota, non crash

            if (superQuizData.length === 0) {
                container.innerHTML = '<p class="quiz-empty-note">Quiz non disponibile per questa lezione.</p>';
                return;
            }

            superQuizData.forEach((q, qIdx) => {
                const card = document.createElement('div');
                card.className = 'quiz-card';
                card.id = `quiz-card-${qIdx}`;
                card.dataset.answered = 'false';

                const question = document.createElement('p');
                question.className = 'quiz-question';
                question.innerText = `${qIdx + 1}. ${q.domanda}`;
                card.appendChild(question);

                const optsWrap = document.createElement('div');
                optsWrap.className = 'quiz-options';

                (q.opzioni || []).forEach((opt, oIdx) => {
                    const btn = document.createElement('button');
                    btn.className = 'quiz-option';
                    btn.type = 'button';
                    btn.innerText = opt.testo;
                    btn.addEventListener('click', () => quizAnswer(qIdx, oIdx));
                    optsWrap.appendChild(btn);
                });
                card.appendChild(optsWrap);

                const expl = document.createElement('div');
                expl.className = 'quiz-explanation';
                expl.id = `quiz-expl-${qIdx}`;
                card.appendChild(expl);

                container.appendChild(card);
            });
        }

        function quizAnswer(qIdx, oIdx) {
            const card = document.getElementById(`quiz-card-${qIdx}`);
            if (!card || card.dataset.answered === 'true') return; // blocca click successivi sulla stessa domanda

            card.dataset.answered = 'true';
            const q = superQuizData[qIdx];
            const chosen = q.opzioni[oIdx];
            const allBtns = card.querySelectorAll('.quiz-option');

            allBtns.forEach((b, idx) => {
                b.disabled = true;
                if (idx === oIdx) {
                    b.classList.add(chosen.corretta ? 'quiz-option-correct-pick' : 'quiz-option-incorrect-pick');
                } else if (q.opzioni[idx].corretta) {
                    b.classList.add('quiz-option-reveal-correct');
                }
            });

            const explDiv = document.getElementById(`quiz-expl-${qIdx}`);
            explDiv.className = 'quiz-explanation ' + (chosen.corretta ? 'quiz-explanation-correct' : 'quiz-explanation-incorrect');
            explDiv.style.display = 'block';
            explDiv.innerHTML = `<strong>${chosen.corretta ? '<svg class="ums-ic" aria-hidden="true"><use href="#ic-check"/></svg> Risposta corretta' : '<svg class="ums-ic" aria-hidden="true"><use href="#ic-x"/></svg> Risposta errata'}</strong>${q.spiegazione || chosen.spiegazione || ''}`;
        }

        // =========================================================================
        // MASTER ACCORDION
        // =========================================================================
        function toggleMaster() {
            const btn = document.getElementById('master-toggle-btn');
            const content = document.getElementById('master-content');
            btn.classList.toggle('active');
            content.classList.toggle('open');
            btn.setAttribute('aria-expanded', content.classList.contains('open') ? 'true' : 'false'); // FIX 7
        }

        // =========================================================================
        // CHAPTER ACCORDIONS
        // =========================================================================
        function setupAccordions() {
            const accs = document.querySelectorAll('.accordion-header');
            accs.forEach(acc => {
                acc.setAttribute('aria-expanded', 'false'); // FIX 7 — accessibilità screen reader
                acc.addEventListener('click', function(e) {
                    e.stopPropagation();
                    this.classList.toggle('active');
                    // il titolo può essere avvolto in un <h2> (accessibilità):
                    // il pannello è il fratello dell'involucro, non del bottone
                    const wrap = this.closest('.ums-acc-h');
                    const panel = (wrap || this).nextElementSibling;
                    const icon = this.querySelector('.ch-icon');
                    if (panel.classList.contains('active')) {
                        panel.style.maxHeight = null;
                        panel.classList.remove('active');
                        if (icon) icon.textContent = '+';
                        this.setAttribute('aria-expanded', 'false'); // FIX 7
                    } else {
                        panel.classList.add('active');
                        // PUNTO 2 — monta solo ora gli iframe parcheggiati (lazy)
                        panel.querySelectorAll('iframe[data-ums-src]').forEach(f => {
                            const box = f.closest('.video-container');
                            if (box) {
                                box.classList.add('ums-media-loading');
                                f.addEventListener('load', () => box.classList.remove('ums-media-loading'), { once: true });
                            }
                            f.src = f.getAttribute('data-ums-src');
                            f.removeAttribute('data-ums-src');
                        });
                        panel.style.maxHeight = panel.scrollHeight + 15000 + 'px';
                        if (icon) icon.textContent = '−';
                        this.setAttribute('aria-expanded', 'true'); // FIX 7
                    }
                });
            });
        }

        function closeThisSection(btn) {
            const content = btn.parentElement;
            const header = content.previousElementSibling;
            header.click();
            header.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        // =========================================================================
        // SCROLL PROGRESS
        // =========================================================================
        // PUNTO 9 — scrittura via requestAnimationFrame (max una per frame)
        // + shimmer attivo solo mentre si scorre (classe con timeout breve).
        let umsScrollTick = false, umsShimmerT = null;
        window.onscroll = () => {
            const bar = document.getElementById('scroll-progress-bar');
            if (!umsScrollTick) {
                umsScrollTick = true;
                requestAnimationFrame(() => {
                    const winScroll = document.body.scrollTop || document.documentElement.scrollTop;
                    const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
                    bar.style.width = (height > 0 ? (winScroll / height * 100) : 0) + '%';
                    umsScrollTick = false;
                });
            }
            bar.classList.add('ums-scrolling');
            clearTimeout(umsShimmerT);
            umsShimmerT = setTimeout(() => bar.classList.remove('ums-scrolling'), 200);
        };

        // =========================================================================
        // MODAL — PUNTI CHIAVE
        // =========================================================================
        function openFactor(key) {
            document.getElementById('m-title').innerText = factorsData[key].title;
            document.getElementById('m-body').innerHTML = factorsData[key].body;
            document.getElementById('factor-modal').classList.add('open');
        }
        function closeModalDirect() { document.getElementById('factor-modal').classList.remove('open'); }
        function closeModal(e) { if (e.target.id === 'factor-modal') closeModalDirect(); }

        // =========================================================================
        // SPACED REPETITION (tappa 4)
        // Memoria locale in localStorage 'ums_sr' (+ specchio cloud kind 'sr').
        // Struttura: { "materia/lezione-N": { titolo, materia, cards: {
        //     "<front>": { stato, box, due, front, back } } } }
        // Intervalli raccomandati (giorni) per risposte corrette consecutive.
        // =========================================================================
        // Intervalli in giorni.
        // GIUSTE: la scala classica della spaced repetition — domani, poi 3
        // giorni, 7, 16, 35, 70. E' la stessa che il sito promette nel pop-up
        // "Come funziona il ripasso" (prima il codice partiva da 3 e i due si
        // contraddicevano).
        // SBAGLIATE (= le ostiche): BASTA UNA VOLTA per entrarci, e non se ne
        // esce piu'. L'intervallo non supera mai i 10 giorni, cosi' una carta
        // che ti ha messo in difficolta' torna sempre a galla, anche se poi la
        // indovini dieci volte di fila.
        const SR_INT_SBAGLIATE = [1, 2, 4, 6, 8, 10];
        const SR_INT_GIUSTE    = [1, 3, 7, 16, 35, 70];
        function srTabellaDi(bucket) { return bucket === 'sbagliate' ? SR_INT_SBAGLIATE : SR_INT_GIUSTE; }

        function srCaricaTutto() {
            try { return JSON.parse(localStorage.getItem('ums_sr') || '{}'); } catch (e) { return {}; }
        }
        function srSalvaTutto(db) {
            try { localStorage.setItem('ums_sr', JSON.stringify(db)); } catch (e) {}
            // specchio sul cloud, per lezione, se connesso
            if (typeof umsCloudQueue === 'function') {
                Object.keys(db).forEach(lk => umsCloudQueue('sr', lk, db[lk]));
            }
        }
        function srMateriaDa(lessonKey) {
            // "antropologia-culturale-mod-a/lezione-1.json" -> "materia-esempio"
            return (lessonKey || '').split('/')[0] || 'lezione';
        }
        function srOggi() { return new Date(); }
        function srAddGiorni(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); }

        // Applica SUBITO l'esito di una carta alla memoria SR (salvataggio per-carta).
        // Chiamata direttamente dai pulsanti "La so / Ripasso dopo".
        function srApplicaEsito(front, back, esito, lezione) {
            // "lezione" = mazzo di destinazione. Se assente, è la lezione della
            // pagina corrente (mazzo Dritti al Sodo). Il ripasso dall'hub DEVE
            // passarla: altrimenti ripassando psicologia dentro sociologia gli
            // esiti finirebbero nel mazzo sbagliato, duplicando le carte.
            const lk = lezione || umsLessonKey;
            if (!front || !lk || lk === 'default') return;
            const db = srCaricaTutto();
            if (!db[lk]) db[lk] = { titolo: document.title || lk, materia: srMateriaDa(lk), cards: {} };
            const nuova = !db[lk].cards[front];
            let c = db[lk].cards[front] || { box: 0, front, back };
            c.front = front; c.back = back;
            // CASSETTO: una carta sbagliata anche UNA SOLA VOLTA e' ostica, entra
            // fra le "sbagliate" e non ne esce piu'. Chi non l'ha mai sbagliata
            // resta fra le "giuste". Carte vecchie senza cassetto: lo derivo
            // dall'ultimo esito noto (migrazione morbida, il primo esito non era
            // stato salvato da nessuna parte).
            if (esito !== 'known') c.bucket = 'sbagliate';
            else if (!c.bucket) c.bucket = (nuova ? 'giuste' : ((c.stato || esito) === 'known' ? 'giuste' : 'sbagliate'));
            const TAB = srTabellaDi(c.bucket);
            if (esito === 'known') {
                // usa PRIMA l'intervallo del box corrente, POI avanza
                c.due = srAddGiorni(TAB[Math.min(c.box || 0, TAB.length - 1)]);
                c.box = Math.min((c.box || 0) + 1, TAB.length - 1);
            } else {
                c.box = 0;                     // errore: riparte da capo nel suo cassetto
                c.due = srAddGiorni(TAB[0]);
            }
            c.stato = esito;
            db[lk].cards[front] = c;
            srSalvaTutto(db);
            if (typeof srAggiornaBadge === 'function') srAggiornaBadge();
        }

        // Quando manca la prossima carta dovuta di una lezione (per il countdown)
        function srProssimaScadenza(lk) {
            const db = srCaricaTutto();
            const rec = db[lk]; if (!rec) return null;
            const cards = rec.cards || {};
            let min = null;
            Object.keys(cards).forEach(f => {
                const d = cards[f].due;
                if (d && (min === null || d < min)) min = d;
            });
            return min;
        }

        // Testo umano del countdown ("pronte ora", "tra 3 giorni", "domani")
        function srCountdownTesto(lk) {
            const rec = srCaricaTutto()[lk]; if (!rec) return '';
            const ora = new Date();
            const dovute = Object.values(rec.cards || {}).filter(c => new Date(c.due) <= ora).length;
            if (dovute > 0) return dovute + ' ' + umsT(dovute === 1 ? 'carta pronta ora' : 'carte pronte ora');
            const prossima = srProssimaScadenza(lk);
            if (!prossima) return '';
            const diffMs = new Date(prossima) - ora;
            const giorni = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
            if (giorni <= 0) return umsT('prossimo ripasso a breve');
            if (giorni === 1) return umsT('prossimo ripasso domani');
            return umsT('prossimo ripasso tra') + ' ' + giorni + ' ' + umsT('giorni');
        }

        // Quante carte sono "in scadenza" (due <= adesso) su tutte le lezioni
        function srConteggioDovute() {
            const db = srCaricaTutto();
            const ora = srOggi().toISOString();
            let n = 0;
            Object.keys(db).forEach(lk => {
                const cards = db[lk].cards || {};
                Object.keys(cards).forEach(f => { if ((cards[f].due || '') <= ora) n++; });
            });
            return n;
        }

        // Raggruppa le carte dovute per materia -> lezione
        function srDovutePerLezione() {
            const db = srCaricaTutto();
            const ora = srOggi().toISOString();
            const out = {}; // materia -> [ { lk, titolo, dovute, sbagliate, totale } ]
            Object.keys(db).forEach(lk => {
                const rec = db[lk];
                const cards = rec.cards || {};
                let dovute = 0, sbagliate = 0, totale = 0;
                Object.keys(cards).forEach(f => {
                    totale++;
                    if ((cards[f].due || '') <= ora) dovute++;
                    if ((cards[f].bucket || (cards[f].stato === 'unknown' ? 'sbagliate' : 'giuste')) === 'sbagliate') sbagliate++;   // cassetto permanente (primo esito)
                });
                if (totale === 0) return;
                const mat = rec.materia || srMateriaDa(lk);
                (out[mat] = out[mat] || []).push({ lk, titolo: rec.titolo || lk, dovute, sbagliate, totale });
            });
            return out;
        }

        // ---- UN FALDONE PER MATERIA ----
        // Le chiavi del db restano per-lezione (la sincronizzazione cloud spedisce
        // i mazzi con quella chiave): l'unione in un unico faldone avviene qui.
        // FONTE DEI NOMI: il catalogo 'ums_catalogo' scritto dalla home a ogni
        // caricamento (derivato da `courses`). La mappa qui sotto è solo un
        // fallback di riserva per chi arriva a una lezione senza mai essere
        // passato dalla home su questo dispositivo: NON va più aggiornata.
        const UMS_MATERIA_NOMI = { 'antropologia-culturale-mod-a': 'Antropologia Culturale MOD. A' };
        function umsCatalogoMaterie() {
            try { return JSON.parse(localStorage.getItem('ums_catalogo') || '{}'); } catch (e) { return {}; }
        }
        function umsNomeMateria(slug, fallback) {
            const cat = umsCatalogoMaterie();
            if (cat[slug] && cat[slug].nome) return cat[slug].nome;
            return UMS_MATERIA_NOMI[slug] || fallback || slug;
        }
        function srDovutePerMateria() {
            const db = srCaricaTutto();
            const ora = srOggi().toISOString();
            const out = {}; // slug -> { slug, nome, dovute, sbagliate, totale, lks }
            Object.keys(db).forEach(lk => {
                const rec = db[lk];
                const cards = rec.cards || {};
                let dovute = 0, sbagliate = 0, totale = 0;
                Object.keys(cards).forEach(f => {
                    totale++;
                    if ((cards[f].due || '') <= ora) dovute++;
                    if ((cards[f].bucket || (cards[f].stato === 'unknown' ? 'sbagliate' : 'giuste')) === 'sbagliate') sbagliate++;
                });
                if (totale === 0) return;
                const slug = rec.materia || srMateriaDa(lk);
                const g = out[slug] = out[slug] || { slug, nome: umsNomeMateria(slug, rec.titolo), dovute: 0, sbagliate: 0, totale: 0, lks: [] };
                g.dovute += dovute; g.sbagliate += sbagliate; g.totale += totale;
                g.lks.push(lk);
            });
            return out;
        }
        // Tutte le carte di una materia, ognuna col SUO lk di origine: quando
        // rispondi, l'esito torna nel mazzo giusto (mai duplicare tra lezioni).
        function srCarteDiMateria(slug, soloSbagliate) {
            const db = srCaricaTutto();
            let carte = [];
            Object.keys(db).forEach(lk => {
                const rec = db[lk];
                if ((rec.materia || srMateriaDa(lk)) !== slug) return;
                Object.values(rec.cards || {}).forEach(c => carte.push({ front: c.front, back: c.back, bucket: c.bucket, stato: c.stato, lk }));
            });
            if (soloSbagliate) carte = carte.filter(c => (c.bucket || (c.stato === 'unknown' ? 'sbagliate' : 'giuste')) === 'sbagliate');
            return carte;
        }
        // Countdown aggregato del faldone (tutte le lezioni della materia)
        function srCountdownTestoMateria(lks) {
            const db = srCaricaTutto();
            const ora = new Date();
            let dovute = 0, min = null;
            (lks || []).forEach(lk => {
                const rec = db[lk]; if (!rec) return;
                Object.values(rec.cards || {}).forEach(c => {
                    if (c.due && new Date(c.due) <= ora) dovute++;
                    if (c.due && (min === null || c.due < min)) min = c.due;
                });
            });
            if (dovute > 0) return dovute + ' ' + umsT(dovute === 1 ? 'carta pronta ora' : 'carte pronte ora');
            if (!min) return '';
            const giorni = Math.ceil((new Date(min) - ora) / (1000 * 60 * 60 * 24));
            if (giorni <= 0) return umsT('prossimo ripasso a breve');
            if (giorni === 1) return umsT('prossimo ripasso domani');
            return umsT('prossimo ripasso tra') + ' ' + giorni + ' ' + umsT('giorni');
        }

        // =========================================================================
        // FLASHCARDS
        // =========================================================================
        let fcEsitiSessione = {};   // front -> primo esito dato in questa sessione (quello che conta)
        function initFlashcards(cardsData) {
            if (!cardsData || cardsData.length === 0) return;
            initialCards = cardsData;
            activeCards = [...initialCards];
            currentCardIndex = 0;
            fcEsitiSessione = {};
        }
        function startFlashcards() {
            document.getElementById('fc-start-screen').style.display = 'none';
            document.getElementById('fc-game-screen').style.display = 'block';
            updateCardDisplay();
        }
        function updateCardDisplay() {
            const deck = document.getElementById('flashcard-deck');
            const winScreen = document.getElementById('win-screen');
            const counter = document.getElementById('fc-counter');
            if (activeCards.length === 0) {
                document.getElementById('fc-game-screen').style.display = 'none';
                winScreen.style.display = 'flex';
                return;
            } else { winScreen.style.display = 'none'; }
            if (currentCardIndex >= activeCards.length) currentCardIndex = 0;
            if (currentCardIndex < 0) currentCardIndex = activeCards.length - 1;
            const card = activeCards[currentCardIndex];
            counter.dataset.umsOrig = 'Carte da studiare'; counter.dataset.umsSuffix = ': ' + activeCards.length;
            counter.innerText = (window.umsFcT ? window.umsFcT('Carte da studiare') : 'Carte da studiare') + ': ' + activeCards.length;
            deck.style.opacity = '0.5';
            setTimeout(() => {
                var _fF = document.getElementById('fc-front-text'), _fB = document.getElementById('fc-back-text');
                _fF.dataset.umsOrig = card.front; _fB.dataset.umsOrig = card.back;
                _fF.innerText = window.umsFcT ? window.umsFcT(card.front) : card.front;
                _fB.innerText = window.umsFcT ? window.umsFcT(card.back) : card.back;
                document.getElementById('fc-back-text').scrollTop = 0;
                deck.classList.remove('flipped');
                deck.style.opacity = '1';
                fcPreparaRisposta();
                fcAdattaAltezza();
            }, 200);
        }
        // Su PC la risposta lunga era illeggibile: qualunque clic dentro il testo
        // rigirava la carta, quindi trascinare la barra di scorrimento o
        // selezionare una frase era impossibile. Ora il testo della risposta e'
        // una zona franca: per girare si clicca la cornice attorno alla carta.
        function handleWrapperClick(e) {
            if (window.innerWidth <= 900) return;
            if (e && e.target && e.target.closest && e.target.closest('#fc-back-text')) return;
            const sel = window.getSelection && window.getSelection();
            if (sel && String(sel).trim().length) return;
            toggleFlip();
        }

        // La carta cresce fino a contenere la risposta invece di tagliarla.
        // Sotto i 440px resta com'era; sopra, si allunga fino al 72% dello
        // schermo. Solo su PC: su telefono la risposta ha gia' il suo pannello.
        function fcAdattaAltezza() {
            const wrap = document.getElementById('flashcard-deck');
            const p = document.getElementById('fc-back-text');
            if (!wrap || !p) return;
            if (window.innerWidth <= 900) { wrap.style.height = ''; return; }
            const prima = p.style.maxHeight;
            p.style.maxHeight = 'none';
            const naturale = p.scrollHeight;
            p.style.maxHeight = prima;
            const cornice = 88;                 // padding della faccia + respiro
            const minima = 440;
            const massima = Math.max(minima, Math.round(window.innerHeight * 0.72));
            wrap.style.height = Math.min(massima, Math.max(minima, naturale + cornice)) + 'px';
        }

        // La rotellina del mouse dentro una faccia ruotata in 3D spesso non
        // scorre: la gestiamo a mano, e fermiamo l'evento solo finche' c'e'
        // ancora testo da scorrere (altrimenti la pagina resterebbe bloccata).
        function fcPreparaRisposta() {
            const p = document.getElementById('fc-back-text');
            if (!p || p.dataset.umsScroll === '1') return;
            p.dataset.umsScroll = '1';
            p.addEventListener('wheel', function (ev) {
                const giu = ev.deltaY > 0;
                const spazio = giu
                    ? p.scrollTop + p.clientHeight < p.scrollHeight - 1
                    : p.scrollTop > 0;
                if (!spazio) return;
                p.scrollTop += ev.deltaY;
                ev.preventDefault();
                ev.stopPropagation();
            }, { passive: false });
            p.addEventListener('click', function (ev) { ev.stopPropagation(); });
        }

        window.addEventListener('resize', function () {
            clearTimeout(window.__umsFcResize);
            window.__umsFcResize = setTimeout(fcAdattaAltezza, 150);
        });
        function forceFlip(e) {
            if (e) e.stopPropagation();
            if (window.innerWidth <= 900) {
                const card = activeCards[currentCardIndex];
                document.getElementById('fc-mobile-body').innerHTML = card.back;
                document.getElementById('fc-mobile-modal').style.display = 'flex';
                // il pannello resta nel DOM tra un'apertura e l'altra e si
                // ricordava lo scroll precedente: la risposta riparte dall'inizio
                const box = document.querySelector('.fc-mobile-content');
                if (box) box.scrollTop = 0;
            } else { toggleFlip(); }
        }
        function closeMobileAnswerPopup() { document.getElementById('fc-mobile-modal').style.display = 'none'; }
        function toggleFlip() { document.getElementById('flashcard-deck').classList.toggle('flipped'); }
        function navCard(direction) {
            currentCardIndex += direction;
            if (currentCardIndex < 0) currentCardIndex = activeCards.length - 1;
            if (currentCardIndex >= activeCards.length) currentCardIndex = 0;
            updateCardDisplay();
        }
        function markKnown() {
            showToast("Grande! Continua così.", "success");
            const _c = activeCards[currentCardIndex];
            if (_c) {
                const _fe = document.getElementById('fc-front-text');
                const _be = document.getElementById('fc-back-text');
                const _f = ((_fe && _fe.textContent) || '').trim() || _c.front;
                const _b = ((_be && _be.textContent) || '').trim() || _c.back;
                if (!fcEsitiSessione[_f]) { fcEsitiSessione[_f] = 'known'; srApplicaEsito(_f, _b, 'known'); }
            }
            activeCards.splice(currentCardIndex, 1);
            if (currentCardIndex >= activeCards.length) currentCardIndex = 0;
            setTimeout(() => { document.getElementById('flashcard-deck').classList.remove('flipped'); updateCardDisplay(); }, 500);
        }
        function markUnknown() {
            showToast("Nessun problema, la rivedremo dopo.", "retry");
            const _c0 = activeCards[currentCardIndex];
            if (_c0) {
                const _fe0 = document.getElementById('fc-front-text');
                const _be0 = document.getElementById('fc-back-text');
                const _f0 = ((_fe0 && _fe0.textContent) || '').trim() || _c0.front;
                const _b0 = ((_be0 && _be0.textContent) || '').trim() || _c0.back;
                if (!fcEsitiSessione[_f0]) { fcEsitiSessione[_f0] = 'unknown'; srApplicaEsito(_f0, _b0, 'unknown'); }
            }
            const c = activeCards.splice(currentCardIndex, 1)[0];
            activeCards.push(c);
            if (currentCardIndex >= activeCards.length) currentCardIndex = 0;
            setTimeout(() => { document.getElementById('flashcard-deck').classList.remove('flipped'); updateCardDisplay(); }, 500);
        }
        function resetDeck() {
            activeCards = [...initialCards];
            currentCardIndex = 0;
            fcEsitiSessione = {};
            document.getElementById('win-screen').style.display = 'none';
            document.getElementById('fc-start-screen').style.display = 'block';
            document.getElementById('fc-game-screen').style.display = 'none';
        }

        // Avvia un ripasso mirato (chiamato dall'hub) riusando il mazzo in pagina.
        window.startReviewWith = function (carte) {
            if (!carte || carte.length === 0) return;
            fcEsitiSessione = {};
            activeCards = carte.map(c => ({ front: c.front, back: c.back }));
            initialCards = [...activeCards];
            currentCardIndex = 0;
            // porta l'utente alla sezione flashcard e mostra il gioco
            const sec = document.getElementById('fc-start-screen');
            if (sec) {
                const acc = sec.closest('.accordion-item');
                if (acc) {
                    const content = acc.querySelector('.accordion-content');
                    if (content && content.style) content.style.maxHeight = content.scrollHeight + 2000 + 'px';
                    acc.classList.add('active');
                }
            }
            document.getElementById('fc-start-screen').style.display = 'none';
            document.getElementById('win-screen').style.display = 'none';
            document.getElementById('fc-game-screen').style.display = 'block';
            updateCardDisplay();
            try { document.getElementById('fc-game-screen').scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
        };

        // Se arrivo in questa lezione da "Ripassa" dell'hub della home, apro il
        // POP-UP di ripasso (lo stesso del pulsante "Ripasso" della nav) già
        // puntato sul mazzo richiesto. PRIMA veniva usato startReviewWith(), il
        // flusso inline dentro l'accordion: ma la lezione arriva CHIUSA (dietro
        // "INIZIA"), quindi il gioco partiva in una sezione invisibile e
        // l'utente si trovava davanti una pagina muta. Mai più.
        function umsControllaRipassoInSospeso() {
            let target = null;
            try { target = JSON.parse(sessionStorage.getItem('ums_review_target') || 'null'); } catch (e) {}
            if (!target) return;
            sessionStorage.removeItem('ums_review_target');
            // Target per MATERIA (nuovo) o per lezione (legacy): in entrambi i
            // casi si ripassa il FALDONE intero della materia.
            const mat = target.mat || (target.lk ? ((target.lk || '').split('/')[0] || null) : null);
            if (!mat) return;
            const carte = (typeof srCarteDiMateria === 'function') ? srCarteDiMateria(mat, !!target.soloSbagliate) : [];
            if (carte.length === 0) {
                // Niente silenzio: dico all'utente cosa è successo.
                if (typeof showToast === 'function') showToast('Nessuna flashcard salvata su questo dispositivo per questa materia. Provale qui e verranno salvate.', 'retry');
                return;
            }
            // Avvio robusto: se il pop-up non è ancora pronto, ritento.
            let tentativi = 0;
            const avvia = () => {
                if (typeof window.umsApriHubRipasso === 'function') {
                    window.umsApriHubRipasso(mat, !!target.soloSbagliate);
                } else if (tentativi++ < 20) {
                    setTimeout(avvia, 300);
                }
            };
            setTimeout(avvia, 400);
        }

        // =========================================================================
        // TOAST
        // =========================================================================
        function showToast(message, type) {
            const container = document.getElementById('toast-container');
            const toast = document.createElement('div');
            toast.className = `toast toast-${type}`;
            toast.textContent = umsT(message); // i18n — i toast parlano la lingua della pagina
            container.appendChild(toast);
            void toast.offsetWidth;
            toast.classList.add('show');
            setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 2200);
        }

        // =========================================================================
        // NOTES
        // =========================================================================
        function setupCopyButtons() {
            document.querySelectorAll('.copy-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const area = this.closest('.notes-widget').querySelector('.notes-area');
                    const text = area.value;
                    if (!text.trim()) { showToast('Scrivi prima qualcosa!', 'retry'); return; }
                    const fallback = () => {
                        const ta = document.createElement('textarea');
                        ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
                        document.body.appendChild(ta); ta.select();
                        try { document.execCommand('copy'); showToast('Appunti copiati!', 'success'); }
                        catch(err) { showToast('Errore nella copia.', 'retry'); }
                        document.body.removeChild(ta);
                    };
                    if (navigator.clipboard && window.isSecureContext) {
                        navigator.clipboard.writeText(text).then(() => showToast('Appunti copiati!', 'success')).catch(fallback);
                    } else { fallback(); }
                });
            });
        }
        function setupDownloadButtons() {
            document.querySelectorAll('.download-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const area = this.closest('.notes-widget').querySelector('.notes-area');
                    if (!area.value.trim()) { showToast('Scrivi prima qualcosa!', 'retry'); return; }
                    const blob = new Blob([area.value], { type: 'text/plain;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = 'appunti_lezione.txt'; a.style.display = 'none';
                    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                    showToast('Appunti scaricati!', 'success');
                });
            });
        }
        function setupNotesAutoScroll() {
            // FIX 1 — prima TUTTE le textarea condividevano la stessa chiave localStorage
            // (scrivere in una sovrascriveva le altre, e gli appunti "migravano" tra lezioni).
            // Ora la chiave è unica per lezione E per area.
            document.querySelectorAll('.notes-area').forEach((area, idx) => {
                const areaKey = STORAGE_KEY + '::' + umsLessonKey + '::' + idx;
                const saved = localStorage.getItem(areaKey);
                if (saved) area.value = saved;
                area.addEventListener('input', function() {
                    try { localStorage.setItem(areaKey, this.value); } catch(e) {}
                    try {
                        // raccolgo tutte le aree della lezione in un unico oggetto { idx: testo }
                        const tutte = {};
                        document.querySelectorAll('.notes-area').forEach((a, i) => { tutte[i] = a.value; });
                        umsCloudQueue('notes', umsLessonKey, tutte);
                    } catch(e) {}
                });
                area.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') requestAnimationFrame(() => { this.scrollTop = this.scrollHeight; });
                });
            });
        }

        // =========================================================================
        // MINI WORD SEARCH — SEZIONE 06 PAUSA
        // =========================================================================
        const WS_WORDS = {
            it: [
                'CASA','SOLE','MARE','GATTO','PANE','LUPO','MELA','TESTA','TRENO','LIBRO',
                'FIUME','STELLA','NOTTE','BICI','AMICO','ROSA','ORTICA','ZUZZURELLONE',
                'QUISQUILIA','BORBOTTIO','SCIVOLONE','COCCOBELLO','SGANGHERATO','FARFUGLIARE',
                'BRONTOLARE','PACIOCCHETTO','BIRICHINO','SGHEMBO','CIONDOLARE','BISLACCO'
            ],
            en: [
                'HOUSE','SUN','WATER','FIRE','MOON','STAR','LOVE','BOOK','RIVER','WORLD',
                'SUMMER','GARDEN','OCEAN','BREAD','COFFEE','TABLE','YELLOW','GREEN','WHITE',
                'FLABBERGAST','GOBBLEDYGOOK','BAMBOOZLE','KERFUFFLE','BROUHAHA',
                'HULLABALOO','NINCOMPOOP','BUMBLEBEE','SNUGGLEPOT','WHIPPERSNAPPER'
            ]
        };

        // UPGRADE PAUSA — stato: un solo set di parole (quelle della lezione),
        // tradotto via API quando l'utente cambia lingua; Sudoku come gioco alternativo.
        let wsBaseWords = [];      // parole della lezione in italiano (top 20)
        let wsCurrentWords = [];   // parole nella lingua corrente della pagina
        let pausaLang = 'it';
        let pausaGame = 'words';
        let wsRenderedLang = 'it'; // lingua con cui è stata generata l'ultima griglia
        const PAUSA_NONLATIN = new Set(['bg', 'el', 'zh-CN', 'ar', 'hi', 'ru', 'ja']);

        let wsSize = 12;
        let wsGrid = [];
        let wsActiveWords = [];
        let wsFoundCount = 0;
        let wsDragging = false;
        let wsStartIdx = -1;
        let wsSelection = [];

        function pausaSetGame(game) {
            pausaGame = game;
            [['words', 'ws-btn-words', 'ws-game'],
             ['sudoku', 'ws-btn-sudoku', 'sd-game'],
             ['sol', 'ws-btn-sol', 'sol-game']].forEach(([g, btnId, panelId]) => {
                const btn = document.getElementById(btnId);
                const panel = document.getElementById(panelId);
                if (btn) btn.classList.toggle('active', game === g);
                if (panel) panel.style.display = game === g ? 'block' : 'none';
            });
            if (game === 'sudoku' && !sdReady) sdNewGame();
            if (game === 'sol' && !solReady) solNewGame();
            // FIX — lingua cambiata mentre si era su un altro gioco: griglia da rifare
            if (game === 'words' && wsRenderedLang !== pausaLang) wsNewGame();
        }

        // =========================================================================
        // MOTORE i18n — perche' non il widget: Google Translate traduce SOLO cio'
        // che entra nel viewport, quindi ignorava sia la vecchia "banca parole"
        // fuori schermo sia i toast (vivono 3 secondi). Qui, al cambio lingua,
        // UNA chiamata batch all'endpoint di Google costruisce un dizionario per
        // TUTTE le stringhe dinamiche: toast, stati dei giochi e parole del
        // crucipuzzle. Gli elementi coinvolti sono notranslate: li gestiamo noi.
        // Se la rete fallisce, tutto resta in italiano senza errori.
        // =========================================================================
        const UMS_STRINGS = [
            'Per usare il ripasso serve la tua chiave: accedendo, ogni flashcard che provi si salva e te la riproponiamo al momento giusto, su qualsiasi dispositivo. Bastano due tocchi, ed è gratis.',
            'Accedi ora',
            'Da ripassare',
            'Nessuna carta in scadenza oggi — ottimo!',
            'carte da ripassare oggi',
            'carta da ripassare oggi',
            'Come funziona il ripasso?',
            'Nascondi spiegazione',
            'Il ripasso a intervalli (spaced repetition) è il metodo di studio più efficace mai misurato. L\'idea è semplice: invece di rileggere tutto insieme, rivedi ogni concetto poco prima di dimenticarlo.',
            'Ogni volta che segni una carta come “La so”, la rivedrai più in là nel tempo (dopo 1 giorno, poi 3, 7, 16, 35...). Se invece la sbagli, torna presto. Così le cose che sai già non ti fanno perdere tempo, e quelle difficili le fissi davvero.',
            'Bastano pochi minuti al giorno per ricordare a lungo termine, con molta meno fatica del ripasso “tutto in una volta”.',
            'Non hai ancora salvato nessun ripasso.',
            'Prova le flashcard di una lezione: ogni risposta si salva da sola.',
            'da ripassare',
            'totali',
            'Ripassa tutte',
            'Solo sbagliate',
            'Elimina questo mazzo',
            'Eliminare il ripasso di',
            'Le carte non ti verranno più riproposte.',
            'carta pronta ora',
            'carte pronte ora',
            'prossimo ripasso domani',
            'prossimo ripasso a breve',
            'prossimo ripasso tra',
            'giorni',
            'Rimaste:',
            'Mostra la risposta',
            'Torna all\'elenco',
            'Ripasso dopo',
            'La so!',
            'Ripasso completato!',
            'Hai ripassato',
            'carta',
            'carte',
            'Ti riproporremo quelle giuste più in là, e quelle sbagliate molto presto.',
            'Concetto rimosso.',
            'Nessun concetto da esportare.',
            'Apertura finestra di stampa...',
            "Seleziona testo all'interno dello stesso blocco per sottolineare.",
            'Sottolineatura rimossa.',
            'Grande! Continua così.',
            'Nessun problema, la rivedremo dopo.',
            'Scrivi prima qualcosa!',
            'Appunti copiati!',
            'Errore nella copia.',
            'Appunti scaricati!',
            'Trascina o tocca per selezionare le lettere.',
            'Trovate:',
            'Tocca una casella vuota e scegli un numero.',
            'Griglia completa, ma ci sono conflitti: correggi le caselle in terracotta.',
            'Mazzo rigirato.',
            'Tocca il mazzo per pescare, trascina le carte per spostarle.'
        ];
        let umsDict = {};

        // Pulisce le parole per la griglia: maiuscole, senza accenti, solo A-Z, 4-11 lettere
        function wsSanitizeWords(arr) {
            const out = arr.map(w =>
                String(w).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z]/g, '')
            );
            return [...new Set(out.filter(w => w.length >= 4 && w.length <= 11))];
        }

        function umsT(s) {
            return umsDict[s] || s;
        }
        window.umsT = umsT;
        window.umsIsItalian = function () { return Object.keys(umsDict).length === 0; };

        async function umsBuildDict(lang) {
            umsDict = {};
            if (lang === 'it') return;
            const strings = UMS_STRINGS.concat(wsBaseWords.map(w => w.toLowerCase()));
            // A BLOCCHI: una singola richiesta con troppe frasi supera il limite
            // di lunghezza dell'URL e fallisce in silenzio (dizionario vuoto =
            // toast e sezioni in italiano). Blocchi da ~1400 caratteri.
            const blocchi = [];
            let cur = [], len = 0;
            for (const s of strings) {
                if (len + s.length > 1400 && cur.length) { blocchi.push(cur); cur = []; len = 0; }
                cur.push(s); len += s.length + 1;
            }
            if (cur.length) blocchi.push(cur);
            for (const blocco of blocchi) {
                const q = encodeURIComponent(blocco.join('\n'));
                const res = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=it&tl=' + encodeURIComponent(lang) + '&dt=t&q=' + q);
                if (!res.ok) throw new Error('translate http ' + res.status);
                const data = await res.json();
                const out = (data[0] || []).map(seg => seg[0]).join('').split('\n');
                if (out.length !== blocco.length) throw new Error('translate: righe disallineate');
                blocco.forEach((s, i) => { umsDict[s] = (out[i] || '').trim() || s; });
            }
            console.log('[UMS i18n] dizionario pronto per', lang, '(' + strings.length + ' voci)');
        }

        async function pausaOnLanguageChange(lang) {
            pausaLang = lang;
            const wordsBtn = document.getElementById('ws-btn-words');
            if (PAUSA_NONLATIN.has(lang)) {
                // niente crucipuzzle per alfabeti non latini: Sudoku e Solitario
                // funzionano ovunque (numeri e carte sono universali)
                if (pausaGame === 'words') pausaSetGame('sudoku');
                if (wordsBtn) wordsBtn.style.display = 'none';
            } else if (wordsBtn) {
                wordsBtn.style.display = '';
            }

            try { await umsBuildDict(lang); }
            catch (e) { console.error('[UMS i18n] traduzione non disponibile:', e); umsDict = {}; }
            // FLASHCARD — il widget non traduce il testo che le carte riscrivono: lo faccio io
            try { if (window.umsFcPrecarica) window.umsFcPrecarica(lang); } catch (e) {}
            try {
                var _gs = document.getElementById('fc-game-screen');
                if (_gs && _gs.style.display !== 'none' && typeof updateCardDisplay === 'function') updateCardDisplay();
            } catch (e) {}

            // parole del crucipuzzle nella nuova lingua
            if (lang === 'it') {
                wsCurrentWords = wsBaseWords.slice();
            } else {
                const clean = wsSanitizeWords(wsBaseWords.map(w => umsDict[w.toLowerCase()] || ''));
                if (clean.length >= 5) wsCurrentWords = clean;
            }
            if (pausaGame === 'words' && !PAUSA_NONLATIN.has(lang)) wsNewGame();

            // stati a video riallineati alla nuova lingua
            const wsSt = document.getElementById('ws-status');
            if (wsSt) wsSt.innerText = umsT('Trascina o tocca per selezionare le lettere.');
            if (pausaGame === 'sudoku' && typeof sdRefresh === 'function' && sdReady) sdRefresh();
            const solSt = document.getElementById('sol-status');
            if (solSt) solSt.innerText = umsT('Tocca il mazzo per pescare, trascina le carte per spostarle.');
        }

        // Estrae le parole piu' rilevanti dal testo della lezione.
        // Rilevanza = frequenza x lunghezza (i termini tecnici sono lunghi e ripetuti),
        // dopo aver filtrato le parole "vuote" della lingua italiana.
        function wsExtractLessonWords() {
            const cont = document.getElementById('dyn-riassuntone-container');
            const title = document.getElementById('dyn-title');
            const src = (cont ? cont.textContent : '') + ' ' + (title ? title.textContent : '');
            const stop = new Set(['ANCHE','COME','DELLA','DELLE','DELLO','DEGLI','SONO','ESSERE','QUESTO','QUESTA','QUESTI','QUESTE','QUELLO','QUELLA','QUELLE','QUELLI','NELLA','NELLE','NELLO','SULLA','SULLE','SULLO','DALLA','DALLE','PERCHE','QUANDO','ALLORA','INFATTI','INOLTRE','TUTTAVIA','QUINDI','DUNQUE','OGNI','TUTTI','TUTTE','TUTTO','TUTTA','MOLTO','MOLTI','MOLTE','MENO','VIENE','VENGONO','PUO','POSSONO','POSSIAMO','DEVE','DEVONO','FANNO','STATO','STATA','STATI','STATE','AVERE','HANNO','ABBIAMO','ALTRO','ALTRA','ALTRI','ALTRE','PROPRIO','PROPRIA','ATTRAVERSO','SECONDO','MENTRE','ANCORA','SEMPRE','PRIMA','DOPO','CONTRO','VERSO','SENZA','ALCUNI','ALCUNE','CIOE','OVVERO','ESEMPIO','PARTE','MODO','CASO','FATTO','COSA','COSE','ANNI','ANNO','SOLO','STESSO','STESSA','LORO','NOSTRO','NOSTRA','QUALE','QUALI','INVECE','OSSIA','TRAMITE','PRESSO','DENTRO','FUORI','SOPRA','SOTTO','GRAZIE','PUNTO','LIVELLO']);
            const freq = {};
            src.toUpperCase()
               .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // À -> A, È -> E ecc.
               .replace(/[^A-Z]+/g, ' ')
               .split(' ')
               .forEach(w => {
                   if (w.length < 5 || w.length > 11) return; // deve entrare nella griglia 12x12
                   if (stop.has(w)) return;
                   freq[w] = (freq[w] || 0) + 1;
               });
            return Object.keys(freq)
                .sort((a, b) => (freq[b] * b.length) - (freq[a] * a.length))
                .slice(0, 20);
        }

        function wsInit() {
            wsNewGame();
        }

        function wsNewGame() {
            document.getElementById('ws-win-msg').style.display = 'none';
            document.getElementById('ws-status').innerText = umsT('Trascina o tocca per selezionare le lettere.');

            wsRenderedLang = pausaLang; // FIX — per rigenerare se si torna qui dopo un cambio lingua
            const source = wsCurrentWords.length >= 5 ? wsCurrentWords : WS_WORDS.it;
            const pool = [...source].sort(() => 0.5 - Math.random()).slice(0, 5);
            wsActiveWords = pool;
            wsFoundCount = 0;

            wsGrid = Array(wsSize).fill(0).map(() => Array(wsSize).fill(''));

            const dirs = [[0,1],[1,0],[1,1],[0,-1],[-1,0],[-1,-1],[1,-1],[-1,1]];
            const abc = pausaLang === 'it' ? 'ABCDEFGHILMNOPQRSTUVZ' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

            for (const word of wsActiveWords) {
                let placed = false, attempts = 0;
                while (!placed && attempts++ < 300) {
                    const d = dirs[Math.floor(Math.random() * dirs.length)];
                    const r = Math.floor(Math.random() * wsSize);
                    const c = Math.floor(Math.random() * wsSize);
                    let fits = true;
                    for (let i = 0; i < word.length; i++) {
                        const nr = r + d[0]*i, nc = c + d[1]*i;
                        if (nr < 0 || nr >= wsSize || nc < 0 || nc >= wsSize) { fits = false; break; }
                        if (wsGrid[nr][nc] !== '' && wsGrid[nr][nc] !== word[i]) { fits = false; break; }
                    }
                    if (fits) {
                        for (let i = 0; i < word.length; i++) wsGrid[r + d[0]*i][c + d[1]*i] = word[i];
                        placed = true;
                    }
                }
            }

            for (let r = 0; r < wsSize; r++)
                for (let c = 0; c < wsSize; c++)
                    if (wsGrid[r][c] === '') wsGrid[r][c] = abc[Math.floor(Math.random() * abc.length)];

            wsRender();
        }

        function wsRender() {
            const gridEl = document.getElementById('ws-grid');
            gridEl.style.gridTemplateColumns = `repeat(${wsSize}, 1fr)`;

            let html = '';
            for (let i = 0; i < wsSize * wsSize; i++) {
                const r = Math.floor(i / wsSize), c = i % wsSize;
                html += `<div class="ws-cell" data-idx="${i}">${wsGrid[r][c]}</div>`;
            }
            gridEl.innerHTML = html;

            const listEl = document.getElementById('ws-word-list');
            listEl.innerHTML = wsActiveWords.map(w =>
                `<div class="ws-word-tag" id="wstag-${w}">${w}</div>`
            ).join('');

            wsSetupEvents();
        }

        function wsSetupEvents() {
            const cells = document.querySelectorAll('.ws-cell');

            const getCell = (e) => {
                const x = e.touches ? e.touches[0].clientX : e.clientX;
                const y = e.touches ? e.touches[0].clientY : e.clientY;
                return document.elementFromPoint(x, y)?.closest('.ws-cell');
            };

            const wsHl = (s, e) => {
                cells.forEach(c => { if (!c.classList.contains('ws-found')) c.classList.remove('ws-sel'); });
                wsSelection = [];
                const r1 = Math.floor(s / wsSize), c1 = s % wsSize;
                const r2 = Math.floor(e / wsSize), c2 = e % wsSize;
                const dr = r2 - r1, dc = c2 - c1;
                const steps = Math.max(Math.abs(dr), Math.abs(dc));
                if (steps === 0) { cells[s].classList.add('ws-sel'); wsSelection.push(cells[s]); return; }
                if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) return;
                const stepR = dr / steps, stepC = dc / steps;
                for (let i = 0; i <= steps; i++) {
                    const idx = (r1 + stepR * i) * wsSize + (c1 + stepC * i);
                    if (cells[idx]) { cells[idx].classList.add('ws-sel'); wsSelection.push(cells[idx]); }
                }
            };

            const wsStart = (e) => {
                const cell = getCell(e); if (!cell) return;
                wsDragging = true;
                wsStartIdx = parseInt(cell.dataset.idx);
                wsHl(wsStartIdx, wsStartIdx);
            };

            const wsMove = (e) => {
                if (!wsDragging) return;
                const cell = getCell(e); if (cell) wsHl(wsStartIdx, parseInt(cell.dataset.idx));
            };

            const wsEnd = () => {
                if (!wsDragging) return;
                wsDragging = false;
                const str = wsSelection.map(c => c.innerText).join('');
                const rev = str.split('').reverse().join('');
                const found = wsActiveWords.find(w => w === str || w === rev);
                if (found) {
                    wsSelection.forEach(c => { c.classList.remove('ws-sel'); c.classList.add('ws-found'); });
                    const tag = document.getElementById('wstag-' + found);
                    if (tag && !tag.classList.contains('ws-done')) {
                        tag.classList.add('ws-done');
                        wsFoundCount++;
                        document.getElementById('ws-status').innerText = umsT('Trovate:') + ` ${wsFoundCount} / ${wsActiveWords.length}`;
                        if (wsFoundCount === wsActiveWords.length) {
                            setTimeout(() => {
                                document.getElementById('ws-win-msg').style.display = 'block';
                            }, 400);
                        }
                    }
                } else {
                    cells.forEach(c => { if (!c.classList.contains('ws-found')) c.classList.remove('ws-sel'); });
                }
                wsSelection = [];
            };

            const gridEl = document.getElementById('ws-grid');
            gridEl.onmousedown = wsStart;
            window.addEventListener('mousemove', wsMove);
            window.addEventListener('mouseup', wsEnd);
            gridEl.ontouchstart = (e) => { if (e.target.closest('.ws-cell')) e.preventDefault(); wsStart(e); };
            window.addEventListener('touchmove', wsMove, { passive: false });
            window.addEventListener('touchend', wsEnd);
        }

        // =========================================================================
        // UPGRADE — SUDOKU
        // Generatore con backtracking randomizzato + verifica di UNICITA' della
        // soluzione: ogni cella viene svuotata solo se lo schema resta risolvibile
        // in un solo modo. Tre livelli: gli indizi di partenza determinano la
        // difficolta' (facile 40, medio 32, difficile 26).
        // =========================================================================
        let sdSolution = [], sdPuzzle = [], sdUser = [], sdSel = -1;
        let sdDiff = 'facile', sdReady = false;
        const SD_CLUES = { facile: 40, medio: 32, difficile: 26 };

        function sdShuffleArr(a) {
            for (let i = a.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [a[i], a[j]] = [a[j], a[i]];
            }
            return a;
        }
        function sdFindEmpty(g) {
            for (let i = 0; i < 81; i++) if (g[i] === 0) return i;
            return -1;
        }
        function sdOk(g, i, v) {
            const r = Math.floor(i / 9), c = i % 9;
            for (let k = 0; k < 9; k++) {
                if (g[r * 9 + k] === v || g[k * 9 + c] === v) return false;
            }
            const br = r - r % 3, bc = c - c % 3;
            for (let rr = br; rr < br + 3; rr++)
                for (let cc = bc; cc < bc + 3; cc++)
                    if (g[rr * 9 + cc] === v) return false;
            return true;
        }
        function sdFill(g) {
            const i = sdFindEmpty(g);
            if (i < 0) return true;
            for (const v of sdShuffleArr([1,2,3,4,5,6,7,8,9])) {
                if (sdOk(g, i, v)) {
                    g[i] = v;
                    if (sdFill(g)) return true;
                    g[i] = 0;
                }
            }
            return false;
        }
        function sdCountSolutions(g, limit) {
            const i = sdFindEmpty(g);
            if (i < 0) return 1;
            let n = 0;
            for (let v = 1; v <= 9 && n < limit; v++) {
                if (sdOk(g, i, v)) {
                    g[i] = v;
                    n += sdCountSolutions(g, limit - n);
                    g[i] = 0;
                }
            }
            return n;
        }
        function sdMakePuzzle(clues) {
            const solution = Array(81).fill(0);
            sdFill(solution);
            const puzzle = solution.slice();
            const target = 81 - clues;
            let removed = 0;
            for (const i of sdShuffleArr([...Array(81).keys()])) {
                if (removed >= target) break;
                const bak = puzzle[i];
                puzzle[i] = 0;
                if (sdCountSolutions(puzzle.slice(), 2) !== 1) {
                    puzzle[i] = bak; // toglierla renderebbe la soluzione ambigua
                } else {
                    removed++;
                }
            }
            return { puzzle, solution };
        }

        function sdSetDiff(d) {
            sdDiff = d;
            ['facile','medio','difficile'].forEach(k =>
                document.getElementById('sd-btn-' + k).classList.toggle('active', k === d));
            sdNewGame();
        }

        function sdNewGame() {
            const { puzzle, solution } = sdMakePuzzle(SD_CLUES[sdDiff]);
            sdPuzzle = puzzle;
            sdSolution = solution;
            sdUser = puzzle.slice();
            sdSel = -1;
            sdReady = true;
            document.getElementById('sd-win-msg').style.display = 'none';
            document.getElementById('sd-status').innerText = umsT('Tocca una casella vuota e scegli un numero.');
            sdRenderPad();
            sdRender();
        }

        function sdRender() {
            const gridEl = document.getElementById('sd-grid');
            let html = '';
            for (let i = 0; i < 81; i++) {
                const fixed = sdPuzzle[i] !== 0;
                const v = sdUser[i];
                html += `<div class="sd-cell${fixed ? ' sd-fixed' : ''}" data-idx="${i}">${v !== 0 ? v : ''}</div>`;
            }
            gridEl.innerHTML = html;
            gridEl.querySelectorAll('.sd-cell').forEach(cell => {
                cell.addEventListener('click', () => sdSelect(parseInt(cell.dataset.idx)));
            });
            sdRefresh();
        }

        function sdRenderPad() {
            const pad = document.getElementById('sd-pad');
            if (pad.childElementCount) return;
            let html = '';
            for (let v = 1; v <= 9; v++) html += `<button type="button" onclick="sdInput(${v})">${v}</button>`;
            html += '<button type="button" onclick="sdInput(0)" aria-label="Cancella"><svg class="ums-ic" aria-hidden="true"><use href="#ic-x"/></svg></button>';
            pad.innerHTML = html;
        }

        function sdSelect(i) {
            sdSel = i;
            sdRefresh();
        }

        function sdInput(v) {
            if (sdSel < 0 || sdPuzzle[sdSel] !== 0) return;
            sdUser[sdSel] = v;
            const cell = document.querySelector(`.sd-cell[data-idx="${sdSel}"]`);
            if (cell) cell.textContent = v !== 0 ? v : '';
            sdRefresh();
        }

        // Trova le celle in conflitto (numero duplicato in riga, colonna o riquadro)
        function sdConflicts() {
            const bad = new Set();
            const groups = [];
            for (let r = 0; r < 9; r++) groups.push([...Array(9).keys()].map(c => r * 9 + c));
            for (let c = 0; c < 9; c++) groups.push([...Array(9).keys()].map(r => r * 9 + c));
            for (let br = 0; br < 9; br += 3)
                for (let bc = 0; bc < 9; bc += 3) {
                    const g = [];
                    for (let r = br; r < br + 3; r++)
                        for (let c = bc; c < bc + 3; c++) g.push(r * 9 + c);
                    groups.push(g);
                }
            for (const g of groups) {
                const seen = {};
                for (const i of g) {
                    const v = sdUser[i];
                    if (v === 0) continue;
                    if (seen[v] !== undefined) { bad.add(i); bad.add(seen[v]); }
                    else seen[v] = i;
                }
            }
            return bad;
        }

        function sdRefresh() {
            // UPGRADE — niente correzione in tempo reale: segnalare l'errore a ogni
            // mossa invitava a tirare a indovinare. Si gioca liberi; il controllo
            // scatta SOLO quando la griglia e' completa.
            const filled = sdUser.every(v => v !== 0);
            const bad = filled ? sdConflicts() : new Set();
            document.querySelectorAll('.sd-cell').forEach(cell => {
                const i = parseInt(cell.dataset.idx);
                cell.classList.toggle('sd-sel', i === sdSel);
                cell.classList.toggle('sd-err', bad.has(i) && sdPuzzle[i] === 0);
            });
            if (!filled) {
                document.getElementById('sd-status').innerText = umsT('Tocca una casella vuota e scegli un numero.');
                return;
            }
            if (bad.size === 0) {
                // griglia completa e senza conflitti = soluzione valida (ed e' unica)
                document.getElementById('sd-status').innerText = '';
                setTimeout(() => {
                    document.getElementById('sd-win-msg').style.display = 'block';
                }, 300);
            } else {
                document.getElementById('sd-status').innerText = umsT('Griglia completa, ma ci sono conflitti: correggi le caselle in terracotta.');
            }
        }

        // Tastiera fisica: numeri, canc, frecce
        document.addEventListener('keydown', (e) => {
            const sdGame = document.getElementById('sd-game');
            if (!sdGame || sdGame.style.display === 'none') return;
            const ae = document.activeElement;
            if (ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT')) return;
            if (e.key >= '1' && e.key <= '9') { sdInput(parseInt(e.key)); e.preventDefault(); }
            else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') { sdInput(0); e.preventDefault(); }
            else if (e.key.startsWith('Arrow') && sdSel >= 0) {
                const delta = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 }[e.key];
                const next = sdSel + delta;
                if (next >= 0 && next < 81) { sdSel = next; sdRefresh(); }
                e.preventDefault();
            }
        });

        // =========================================================================
        // UPGRADE — SOLITARIO (variante a seme unico)
        // Sul tavolo si impilano carte decrescenti dello STESSO seme; basi per
        // seme dall'Asso al Re; mazzo con rigiro. Drag con clone + elementFromPoint
        // (mouse e touch), destinazione valida illuminata d'oro.
        // =========================================================================
        const SOL_VALS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
        const SOL_SUITS = ['\u2665','\u2666','\u2663','\u2660'];
        let solDeck = [], solReady = false;
        let solDragEl = null, solClone = null, solStartX = 0, solStartY = 0, solLastHl = null;

        function solOffset() { return window.innerWidth < 560 ? 13 : 22; }

        function solNewGame() {
            solReady = true;
            solDeck = [];
            document.getElementById('sol-win-msg').style.display = 'none';
            document.getElementById('sol-status').innerText = umsT('Tocca il mazzo per pescare, trascina le carte per spostarle.');
            document.querySelectorAll('#sol-board .sol-pile').forEach(p => {
                p.innerHTML = p.classList.contains('sol-found') ? p.dataset.suit : '';
            });
            for (const s of SOL_SUITS) {
                for (const v of SOL_VALS) {
                    solDeck.push({ s, v, r: SOL_VALS.indexOf(v) + 1, c: (s === '\u2665' || s === '\u2666') ? 'red' : 'black' });
                }
            }
            solDeck.sort(() => Math.random() - 0.5);
            const off = solOffset();
            for (let i = 1; i <= 7; i++) {
                const p = document.getElementById('sol-t' + i);
                for (let j = 0; j < i; j++) {
                    const card = solCardEl(solDeck.pop(), j === i - 1);
                    card.style.top = (j * off) + 'px';
                    p.appendChild(card);
                }
            }
            solStockFace();
            const stock = document.getElementById('sol-stock');
            stock.onclick = solStockClick;
        }

        function solCardEl(data, up) {
            const div = document.createElement('div');
            div.className = 'sol-card ' + (up ? 'sol-' + data.c : 'sol-hidden');
            div.dataset.r = data.r;
            div.dataset.s = data.s;
            div.dataset.c = data.c;
            div.dataset.v = data.v;
            if (up) div.innerHTML = '<span class="sol-v">' + data.v + '</span><span class="sol-s">' + data.s + '</span>';
            if (up) solBindDrag(div);
            return div;
        }

        function solBindDrag(el) {
            el.addEventListener('mousedown', solStartDrag);
            el.addEventListener('touchstart', solStartDrag, { passive: false });
        }

        function solStockFace() {
            const stock = document.getElementById('sol-stock');
            stock.querySelectorAll('.sol-card, .sol-redeal').forEach(e => e.remove());
            if (solDeck.length > 0) {
                const back = document.createElement('div');
                back.className = 'sol-card sol-hidden';
                back.style.top = '0';
                stock.appendChild(back);
            } else {
                const re = document.createElement('div');
                re.className = 'sol-redeal';
                re.innerHTML = '<svg class="ums-ic" aria-hidden="true"><use href="#ic-rotate"/></svg>'; // PUNTO 5
                stock.appendChild(re);
            }
        }

        function solStockClick() {
            const waste = document.getElementById('sol-waste');
            if (solDeck.length === 0) {
                if (waste.querySelectorAll('.sol-card').length > 0) {
                    Array.from(waste.querySelectorAll('.sol-card')).reverse().forEach(c => {
                        solDeck.push({ s: c.dataset.s, v: c.dataset.v, r: parseInt(c.dataset.r), c: c.dataset.c });
                        c.remove();
                    });
                    showToast('Mazzo rigirato.', 'success');
                    solStockFace();
                }
                return;
            }
            const data = solDeck.pop();
            const card = solCardEl(data, true);
            card.style.top = '0';
            waste.appendChild(card);
            solStockFace();
        }

        function solIsValid(cardEl, pile, stackLen) {
            const cards = pile.querySelectorAll('.sol-card');
            const top = cards.length ? cards[cards.length - 1] : null;
            if (pile.classList.contains('sol-tab')) {
                if (!top) return true; // colonna vuota: qualsiasi carta
                if (top.classList.contains('sol-hidden')) return false;
                return cardEl.dataset.s === top.dataset.s &&
                       parseInt(cardEl.dataset.r) === parseInt(top.dataset.r) - 1;
            }
            if (pile.classList.contains('sol-found')) {
                if (stackLen > 1) return false;
                if (cardEl.dataset.s !== pile.dataset.suit) return false;
                if (!top) return parseInt(cardEl.dataset.r) === 1;
                return parseInt(cardEl.dataset.r) === parseInt(top.dataset.r) + 1;
            }
            return false;
        }

        function solStack(fromEl) {
            const stack = [fromEl];
            let next = fromEl.nextElementSibling;
            while (next) {
                if (next.classList && next.classList.contains('sol-card')) stack.push(next);
                next = next.nextElementSibling;
            }
            return stack;
        }

        function solStartDrag(e) {
            const target = e.target.closest('.sol-card');
            if (!target || target.classList.contains('sol-hidden')) return;
            const parent = target.parentElement;
            if (parent.id === 'sol-stock') return;
            if (parent.id === 'sol-waste') {
                const cards = parent.querySelectorAll('.sol-card');
                if (target !== cards[cards.length - 1]) return;
            }
            e.preventDefault();
            solDragEl = target;
            solStartX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
            solStartY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;

            const stack = solStack(target);
            const rect = target.getBoundingClientRect();
            const off = solOffset();
            solClone = document.createElement('div');
            solClone.id = 'sol-clone';
            solClone.style.left = rect.left + 'px';
            solClone.style.top = rect.top + 'px';
            solClone.style.width = rect.width + 'px';
            stack.forEach((c, i) => {
                const copy = c.cloneNode(true);
                copy.style.top = (i * off) + 'px';
                copy.style.width = rect.width + 'px';
                solClone.appendChild(copy);
                c.style.opacity = '0';
            });
            document.body.appendChild(solClone);

            document.addEventListener('mousemove', solMoveDrag);
            document.addEventListener('touchmove', solMoveDrag, { passive: false });
            document.addEventListener('mouseup', solEndDrag);
            document.addEventListener('touchend', solEndDrag);
        }

        function solMoveDrag(e) {
            if (!solClone) return;
            e.preventDefault();
            const x = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
            const y = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
            solClone.style.transform = 'translate(' + (x - solStartX) + 'px, ' + (y - solStartY) + 'px)';

            const below = document.elementFromPoint(x, y);
            const pile = below ? below.closest('#sol-board .sol-pile') : null;
            if (solLastHl && solLastHl !== pile) { solLastHl.classList.remove('sol-valid'); solLastHl = null; }
            if (pile && solIsValid(solDragEl, pile, solStack(solDragEl).length)) {
                pile.classList.add('sol-valid');
                solLastHl = pile;
            }
        }

        function solEndDrag(e) {
            if (!solDragEl) return;
            document.querySelectorAll('.sol-valid').forEach(el => el.classList.remove('sol-valid'));
            solLastHl = null;
            document.removeEventListener('mousemove', solMoveDrag);
            document.removeEventListener('touchmove', solMoveDrag);
            document.removeEventListener('mouseup', solEndDrag);
            document.removeEventListener('touchend', solEndDrag);

            const x = e.type.includes('touch') ? e.changedTouches[0].clientX : e.clientX;
            const y = e.type.includes('touch') ? e.changedTouches[0].clientY : e.clientY;
            const below = document.elementFromPoint(x, y);
            const pile = below ? below.closest('#sol-board .sol-pile') : null;
            const stack = solStack(solDragEl);

            if (pile && solIsValid(solDragEl, pile, stack.length)) {
                solMoveStack(stack, pile, solDragEl.parentElement);
            } else {
                stack.forEach(c => { c.style.opacity = '1'; });
            }
            if (solClone) solClone.remove();
            solClone = null;
            solDragEl = null;
        }

        function solMoveStack(stack, target, source) {
            const off = solOffset();
            const base = target.classList.contains('sol-tab') ? target.querySelectorAll('.sol-card').length * off : 0;
            stack.forEach((c, i) => {
                c.style.opacity = '1';
                c.style.top = (base + i * off) + 'px';
                target.appendChild(c);
            });
            // scopri l'ultima carta rimasta nella colonna di partenza
            if (source.classList.contains('sol-tab')) {
                const rest = source.querySelectorAll('.sol-card');
                const last = rest.length ? rest[rest.length - 1] : null;
                if (last && last.classList.contains('sol-hidden')) {
                    last.classList.remove('sol-hidden');
                    last.classList.add('sol-' + last.dataset.c);
                    last.innerHTML = '<span class="sol-v">' + last.dataset.v + '</span><span class="sol-s">' + last.dataset.s + '</span>';
                    solBindDrag(last);
                }
            }
            if (document.querySelectorAll('#sol-board .sol-found .sol-card').length === 52) {
                document.getElementById('sol-status').innerText = '';
                setTimeout(() => { document.getElementById('sol-win-msg').style.display = 'block'; }, 300);
            }
        }

        // =========================================================================
        // UPGRADE — "ACCADDE OGGI"
        // Rubrica dinamica dall'API "on this day" di Wikipedia Italia (CORS aperto,
        // nessuna chiave), con TUTTE le categorie: in evidenza, eventi, nascite,
        // scomparse e ricorrenze. Ogni fatto ha "Scopri di piu'": apre il riassunto
        // dell'articolo NEL modale del sito, con link alla voce completa.
        // Riserva curata su culture/giochi/feste del mondo se la rete non risponde.
        // Il testo NON e' notranslate: viene tradotto insieme alla pagina.
        // =========================================================================
        const LS_CURATED = [
            "Il Sudoku moderno e' esploso in Giappone negli anni Ottanta, ma le sue radici affondano nei quadrati latini studiati dal matematico Eulero nel Settecento.",
            "Durante la festa di Holi, in India, milioni di persone si lanciano polveri colorate per celebrare l'arrivo della primavera e la vittoria del bene sul male.",
            "Il Go, nato in Cina piu' di 2.500 anni fa, e' considerato il gioco da tavolo piu' antico ancora praticato nella sua forma originale.",
            "Alla Tomatina di Bunol, in Spagna, ogni agosto migliaia di persone combattono una battaglia a colpi di pomodori maturi: oltre cento tonnellate in un'ora.",
            "Nell'antica Roma 'abbandonare le noci' significava diventare adulti: le noci erano il giocattolo piu' diffuso tra i bambini.",
            "Il primo cruciverba della storia apparve nel 1913 sul New York World, inventato dal giornalista Arthur Wynne.",
            "In Mongolia si gioca ancora con gli shagai, ossicini di pecora usati da secoli come dadi e pedine.",
            "Gli scacchi nacquero in India con il nome di chaturanga, 'le quattro divisioni dell'esercito': fanteria, cavalleria, elefanti e carri.",
            "In Corea del Sud il capodanno lunare, il Seollal, si festeggia indossando l'abito tradizionale hanbok e giocando in famiglia allo yut nori.",
            "Il Carnevale di Venezia nel Settecento durava cosi' tanto che, tra proroghe e feste, occupava diversi mesi dell'anno."
        ];
        const LS_LABELS = {
            selected: 'In evidenza',
            events:   'Evento',
            births:   'Nato oggi',
            deaths:   'Scomparso oggi',
            holidays: 'Ricorrenza'
        };
        let lsItems = [];
        let lsShown = [];
        let lsDataDiOggi = ''; // "mm/dd" con cui è stata pescata la rubrica

        async function lsLoad() {
            try {
                const d = new Date();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                lsDataDiOggi = mm + '/' + dd;
                // data nell'intestazione dell'almanacco ("12 luglio")
                const dataEl = document.getElementById('ls-data');
                if (dataEl) { try { dataEl.textContent = d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }); } catch (e) {} }
                // cache:no-store — niente risposte vecchie da cache o service worker:
                // "Accadde Oggi" deve pescare OGGI, non il giorno del primo caricamento
                const res = await fetch(`https://it.wikipedia.org/api/rest_v1/feed/onthisday/all/${mm}/${dd}`, { cache: 'no-store' });
                if (res.ok) {
                    const j = await res.json();
                    Object.keys(LS_LABELS).forEach(cat => {
                        (j[cat] || []).forEach(e => {
                            if (!e.text || e.text.length < 25 || e.text.length > 200) return;
                            const pg = (e.pages && e.pages[0]) || null;
                            lsItems.push({
                                label: LS_LABELS[cat],
                                anno: e.year ? String(e.year) : '',
                                text: e.text,
                                title: pg ? ((pg.titles && (pg.titles.normalized || pg.titles.display)) || pg.title || '') : '',
                                extract: pg ? (pg.extract || '') : '',
                                thumb: (pg && pg.thumbnail) ? pg.thumbnail.source : '',
                                url: (pg && pg.content_urls && pg.content_urls.desktop) ? pg.content_urls.desktop.page : ''
                            });
                        });
                    });
                }
            } catch (e) { /* offline o API ko: si usa la riserva curata */ }
            lsShuffle();
        }

        // Se la pagina resta viva oltre la mezzanotte, o il telefono la
        // ripristina giorni dopo (schede "congelate" di Android/iOS), la
        // rubrica veniva mostrata col giorno del primo caricamento. Qui,
        // ogni volta che la pagina torna in vista, si controlla la data:
        // se è cambiata, si ripesca tutto.
        function lsControllaGiorno() {
            const d = new Date();
            const oggi = String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
            if (lsDataDiOggi && oggi !== lsDataDiOggi) {
                lsItems = [];
                lsLoad();
            }
        }
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) lsControllaGiorno();
        });
        window.addEventListener('pageshow', lsControllaGiorno);

        function lsShuffle() {
            const list = document.getElementById('losapevi-list');
            if (!list) return;
            list.innerHTML = '';
            if (lsItems.length >= 3) {
                // pesca 3 fatti privilegiando categorie DIVERSE
                const mixed = [...lsItems].sort(() => 0.5 - Math.random());
                const usedLabels = new Set();
                lsShown = [];
                for (const it of mixed) {
                    if (lsShown.length >= 3) break;
                    if (usedLabels.has(it.label)) continue;
                    usedLabels.add(it.label);
                    lsShown.push(it);
                }
                for (const it of mixed) {
                    if (lsShown.length >= 3) break;
                    if (!lsShown.includes(it)) lsShown.push(it);
                }
            } else {
                lsShown = [...LS_CURATED].sort(() => 0.5 - Math.random()).slice(0, 3)
                    .map(t => ({ label: 'Curiosita\u0300 dal mondo', anno: '', text: t, url: '' }));
            }
            lsShown.forEach((it, idx) => {
                const art = document.createElement('article');
                art.className = 'ls-item';
                const anno = document.createElement('div');
                anno.className = 'ls-anno' + (it.anno ? '' : ' ls-anno-vuoto');
                anno.textContent = it.anno || '\u2727';
                anno.setAttribute('aria-hidden', it.anno ? 'false' : 'true');
                const corpo = document.createElement('div');
                corpo.className = 'ls-corpo';
                const lab = document.createElement('span');
                lab.className = 'ls-label';
                lab.textContent = it.label;
                const p = document.createElement('p');
                p.className = 'ls-testo';
                p.textContent = it.text;
                corpo.appendChild(lab);
                corpo.appendChild(p);
                if (it.url) {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'ls-more';
                    btn.textContent = 'Scopri di piu\u0300';
                    btn.addEventListener('click', () => lsOpenArticle(idx));
                    corpo.appendChild(btn);
                }
                art.appendChild(anno);
                art.appendChild(corpo);
                list.appendChild(art);
            });
        }

        // Apre la voce Wikipedia NEL modale del sito (stesso stile). Il riassunto
        // breve compare subito; in background viene caricata l'INTERA sezione
        // introduttiva della voce (Action API, CORS aperto) per una lettura
        // piu' lunga e godibile. Se la rete non risponde, resta il riassunto.
        async function lsOpenArticle(idx) {
            const it = lsShown[idx];
            if (!it) return;
            document.getElementById('m-title').innerText = it.title || 'Accadde Oggi';
            const body = document.getElementById('m-body');
            body.innerHTML = '';
            if (it.thumb) {
                const img = document.createElement('img');
                img.src = it.thumb;
                img.alt = '';
                img.style.cssText = 'width:100%; max-height:260px; object-fit:cover; border-radius:8px; margin-bottom:1.1rem;';
                body.appendChild(img);
            }
            const holder = document.createElement('div');
            const p = document.createElement('p');
            p.textContent = it.extract || it.text;
            p.style.cssText = 'line-height:1.85; margin-bottom:0.9rem;';
            holder.appendChild(p);
            body.appendChild(holder);
            if (it.url) {
                const a = document.createElement('a');
                a.href = it.url;
                a.target = '_blank';
                a.rel = 'noopener';
                a.className = 'btn-ia';
                a.style.cssText = 'display:inline-block; margin-top:1.1rem;';
                a.textContent = 'Leggi la voce completa su Wikipedia \u2197';
                body.appendChild(a);
            }
            document.getElementById('factor-modal').classList.add('open');

            // caricamento dell'introduzione completa (di solito 2-4 paragrafi)
            if (it.title) {
                try {
                    const res = await fetch('https://it.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&origin=*&titles=' + encodeURIComponent(it.title));
                    if (res.ok) {
                        const j = await res.json();
                        const pages = (j.query && j.query.pages) ? Object.values(j.query.pages) : [];
                        const full = (pages.length && pages[0].extract) ? pages[0].extract.trim() : '';
                        // sostituisce solo se e' davvero piu' ricco del riassunto breve
                        if (full && full.length > ((it.extract || '').length + 80)) {
                            holder.innerHTML = '';
                            full.split(/\n+/).forEach(par => {
                                const t = par.trim();
                                if (!t) return;
                                const pp = document.createElement('p');
                                pp.textContent = t;
                                pp.style.cssText = 'line-height:1.85; margin-bottom:0.9rem;';
                                holder.appendChild(pp);
                            });
                        }
                    }
                } catch (e) { /* rete ko: resta il riassunto breve */ }
            }
        }


    

// ====================================================================
// SEZIONE 2 — ex <script id="blocco-anonimo">
// ====================================================================
        const langLabels = {
            'it':'Lingua','en':'Language','fr':'Langue','de':'Sprache','es':'Idioma',
            'bg':'Език','pl':'Język','el':'Γλώσσα','lt':'Kalba','da':'Sprog',
            'pt':'Língua','zh-CN':'语言','ar':'اللغة','hi':'भाषा','ru':'Язык','ja':'日本語'
        };
        function googleTranslateElementInit() {
            new google.translate.TranslateElement({
                pageLanguage: 'it',
                includedLanguages: 'en,it,fr,de,es,bg,pl,el,lt,da,pt,zh-CN,ar,hi,ru,ja',
                autoDisplay: false
            }, 'google_translate_element');
        }
        function toggleLangMenu() {
            const menu = document.getElementById('lang-options-menu');
            const arrow = document.getElementById('lang-arrow');
            menu.classList.toggle('show');
            arrow.classList.toggle('ums-open', menu.classList.contains('show')); // PUNTO 5 — ruota il chevron
        }
        function triggerTranslation(lang, btnElement) {
            const loadingDiv = document.getElementById('lang-loading');
            const menu = document.getElementById('lang-options-menu');
            const toggleBtn = document.getElementById('lang-toggle-btn');
            const labelSpan = document.getElementById('lang-label');
            const disclaimer = document.getElementById('translation-disclaimer');
            labelSpan.innerHTML = '<svg class="ums-ic" aria-hidden="true"><use href="#ic-globe"/></svg> ' + (langLabels[lang] || 'Language');
            loadingDiv.style.display = 'block';
            menu.classList.remove('show');
            toggleBtn.style.display = 'none';
            document.querySelectorAll('.lang-options button').forEach(b => b.classList.remove('active-lang'));
            btnElement.classList.add('active-lang');
            const selectField = document.querySelector('select.goog-te-combo');
            if (selectField) { selectField.value = lang; selectField.dispatchEvent(new Event('change', { bubbles: true })); }
            if (window.pausaOnLanguageChange) window.pausaOnLanguageChange(lang); // UPGRADE — traduce anche i giochi
            if (disclaimer) disclaimer.style.display = lang !== 'it' ? 'block' : 'none';
            // PUNTO 2 — spinner onesto: si spegne quando il widget applica davvero
            // la traduzione (segnale dall'osservatore sotto), sblocco di sicurezza a 3s.
            const fine = () => {
                if (fine.fatto) return;
                fine.fatto = true;
                window.umsLangDone = null;
                loadingDiv.style.display = 'none';
                toggleBtn.style.display = 'block';
                document.getElementById('lang-arrow').classList.remove('ums-open'); // PUNTO 5
            };
            window.umsLangDone = () => setTimeout(fine, 300);
            setTimeout(fine, 3000);
        }
        // PUNTO 2 — segnale reale di fine traduzione: Google cambia lang/class su <html>
        if ('MutationObserver' in window) {
            new MutationObserver(() => {
                if (window.umsLangDone) { const f = window.umsLangDone; window.umsLangDone = null; f(); }
            }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang', 'class'] });
        }
    

// ====================================================================
// SEZIONE 3 — ex <script id="blocco-anonimo">
// ====================================================================
        (function () {
            const NIGHT_KEY = 'ums_night_mode';
            const toggleBtn = document.getElementById('night-toggle');

            function applyNightMode(on) {
                document.body.classList.toggle('night-mode', on);
                toggleBtn.innerHTML = on ? '<svg class="ums-ic" aria-hidden="true"><use href="#ic-sun"/></svg>' : '<svg class="ums-ic" aria-hidden="true"><use href="#ic-moon"/></svg>';
                toggleBtn.setAttribute('aria-label', on ? 'Attiva modalità giorno' : 'Attiva modalità notte');
            }

            // Sincronizza icona con lo stato applicato dallo script iniziale
            applyNightMode(document.body.classList.contains('night-mode'));

            toggleBtn.addEventListener('click', () => {
                const on = !document.body.classList.contains('night-mode');
                applyNightMode(on);
                try { localStorage.setItem(NIGHT_KEY, on ? '1' : '0'); } catch (e) {}
            });
        })();
    

// ====================================================================
// SEZIONE 4 — ex <script id="ums-touch-highlighter">
// ====================================================================
        // ================================================================
        // SOTTOLINEATURA TOUCH — BLOCCO ADDITIVO
        // Il codice originale mostra il pulsante "Sottolinea" solo su
        // mouseup: da telefono e tablet la selezione col dito non genera
        // quell'evento in modo affidabile. Qui si aggiunge:
        //  1) un ascoltatore su selectionchange (con debounce) che
        //     posiziona lo stesso pulsante quando la selezione touch
        //     si stabilizza;
        //  2) la gestione del tap sul pulsante (touchend + preventDefault:
        //     senza, il tocco cancellerebbe la selezione prima del click).
        // Nessuna funzione originale viene toccata: si riusano i suoi
        // stessi elementi e listener via .click() programmatico.
        // ================================================================
        (function () {
            // 2) Tap sul pulsante flottante: blocca la perdita di selezione e delega al click originale
            document.addEventListener('touchend', function (e) {
                const target = e.target && e.target.closest
                    ? e.target.closest('#floating-highlighter .hl-add, #floating-highlighter .hl-remove')
                    : null;
                if (target) {
                    e.preventDefault();
                    target.click();
                }
            }, { passive: false });

            // 1) Selezione touch: quando si stabilizza, posiziona il pulsante come farebbe il mouseup
            let selTimer = null;
            document.addEventListener('selectionchange', function () {
                clearTimeout(selTimer);
                selTimer = setTimeout(function () {
                    const btn = document.getElementById('floating-highlighter');
                    if (!btn) return; // il pulsante viene creato dopo il caricamento dei dati

                    const sel = window.getSelection();
                    if (!sel || sel.rangeCount === 0 || sel.toString().trim().length === 0) {
                        btn.style.display = 'none';
                        return;
                    }

                    const range = sel.getRangeAt(0);
                    const rect = range.getBoundingClientRect();
                    if (!rect || (rect.width === 0 && rect.height === 0)) return;

                    const ancestor = range.commonAncestorContainer;
                    const parentEl = ancestor.nodeType === 3 ? ancestor.parentElement : ancestor;
                    if (!parentEl || parentEl.closest('#floating-highlighter')) return;
                    // solo testo della lezione: niente pulsante quando si seleziona dentro input/textarea
                    if (parentEl.closest('textarea, input')) return;

                    const insideHL = parentEl.closest('.highlighted-text') !== null;

                    // nel pop-up Studia il contenitore è fixed e la pagina non
                    // scorre: uso le coordinate del viewport (niente scrollY),
                    // altrimenti il pulsante finiva fuori schermo e "spariva".
                    var dentroStudio = document.body.classList.contains('ums-studio-aperto');
                    if (dentroStudio) {
                        btn.style.position = 'fixed';
                        btn.style.zIndex = '99999995';
                        btn.style.top = (rect.top - 56) + 'px';
                        btn.style.left = Math.max(8, rect.left + (rect.width / 2) - 70) + 'px';
                    } else {
                        btn.style.position = 'absolute';
                        btn.style.zIndex = '';
                        btn.style.top = (rect.top + window.scrollY - 56) + 'px';
                        btn.style.left = Math.max(8, rect.left + window.scrollX + (rect.width / 2) - 70) + 'px';
                    }
                    btn.style.display = 'flex';

                    const removeBtn = document.getElementById('hl-remove-btn');
                    if (removeBtn) {
                        insideHL ? removeBtn.classList.add('visible') : removeBtn.classList.remove('visible');
                    }
                }, 280);
            });
        })();
    

// ====================================================================
// SEZIONE 5 — ex <script id="ums-topbar-script">
// ====================================================================
        // ================================================================
        // TOP-BAR DA SCROLL — BLOCCO ADDITIVO
        // Superato l'header, appare una barra sfocata con il brand piccolo
        // in alto a sinistra, come la home in modalita' app. Cliccando il
        // brand si torna in cima alla lezione.
        // ================================================================
        (function () {
            const bar = document.createElement('div');
            bar.id = 'ums-topbar';
            bar.innerHTML = '<div class="ums-brandmark notranslate" translate="no" role="button" tabindex="0" aria-label="Torna a inizio pagina">Demo <em>Accessibilità</em></div>';
            document.body.appendChild(bar);

            const goHome = () => { window.location.href = 'index.html'; };
            const mark = bar.firstElementChild;
            mark.setAttribute('aria-label', 'Torna alla Home');
            mark.addEventListener('click', goHome);
            mark.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHome(); } });

            const headerEl = document.querySelector('header');
            if (!headerEl || !('IntersectionObserver' in window)) return;
            const io = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    bar.classList.toggle('visible', !entry.isIntersecting);
                });
            }, { threshold: 0, rootMargin: '-60px 0px 0px 0px' });
            io.observe(headerEl);
        })();

        // ================================================================
        // CARD TRASPARENTE — BLOCCO ADDITIVO
        // Finché la lezione è chiusa, il pulsante "Inizia" resta nudo
        // sullo sfondo (come nella home); la card bianca compare solo
        // quando le sezioni si aprono. Si aggancia DOPO il toggleMaster
        // originale, che resta intatto.
        // ================================================================
        (function () {
            const btn = document.getElementById('master-toggle-btn');
            const content = document.getElementById('master-content');
            if (!btn || !content) return;
            const sync = () => document.body.classList.toggle('ums-master-open', content.classList.contains('open'));
            btn.addEventListener('click', () => requestAnimationFrame(sync));
            sync();

            // ANTI-AUTOSCROLL: aprendo "Inizia", l'espansione delle sezioni o un
            // focus faceva saltare la pagina in fondo ai disclaimer. Il salto è
            // automatico e immediato: per pochi frame subito dopo l'apertura
            // rimetto su la vista SOLO se è schizzata in basso da sola. Qualsiasi
            // tuo gesto di scroll disattiva subito il guard: non ti tolgo mai il
            // controllo della pagina.
            btn.addEventListener('click', function () {
                // se sta CHIUDENDO, non faccio nulla
                if (btn.getAttribute('aria-expanded') === 'true') return;
                var y = window.scrollY;
                var scroller = document.scrollingElement || document.documentElement;
                var attivo = true;
                function stop() { attivo = false; }
                window.addEventListener('wheel', stop, { once: true, passive: true, capture: true });
                window.addEventListener('touchstart', stop, { once: true, passive: true, capture: true });
                window.addEventListener('keydown', stop, { once: true, capture: true });
                var frame = 0;
                (function tieniFermo() {
                    if (!attivo) return;
                    if (window.scrollY > y + 120) { window.scrollTo(0, y); scroller.scrollTop = y; }
                    if (++frame < 30) requestAnimationFrame(tieniFermo);   // ~0,5s al massimo
                })();
            });
        })();
    

// ====================================================================
// SEZIONE 6 — ex <script id="ums-lesson-nav-script">
// ====================================================================
        (function () {
            // Chiave = cartella nel ?file= (primo pezzo prima dello slash).
            // 
            // NUMERO LEZIONI: prima dal catalogo 'ums_catalogo' che la home
            // scrive a ogni caricamento (fonte: `courses` — si auto-aggiorna
            // quando aggiungi materie o lezioni). La mappa qui sotto è solo un
            // fallback di riserva: NON va più aggiornata a mano.
            const UMS_LEZIONI_PER_CORSO = { 'antropologia-culturale-mod-a': 1 };

            const params = new URLSearchParams(window.location.search);
            const fileParam = params.get('file');
            if (!fileParam) return;

            const decoded = decodeURIComponent(fileParam);
            const folder = decoded.split('/')[0];
            let total = null;
            try {
                const cat = JSON.parse(localStorage.getItem('ums_catalogo') || '{}');
                if (cat[folder] && cat[folder].n > 0) total = cat[folder].n;
            } catch (e) {}
            if (!total) total = UMS_LEZIONI_PER_CORSO[folder];
            if (!total) return;

            const slash = decoded.lastIndexOf('/');
            const dir   = slash >= 0 ? decoded.slice(0, slash + 1) : '';
            const base  = slash >= 0 ? decoded.slice(slash + 1) : decoded;
            const match = base.match(/(\d+)(\.json)$/i);
            if (!match) return;

            const currentN = parseInt(match[1], 10);

            function urlForLesson(n) {
                const newBase = base.replace(/(\d+)(\.json)$/i, n + '$2');
                return window.location.pathname + '?file=' + dir + newBase;
            }

            function makeBtn(n, direction) {
                const exists = n >= 1 && n <= total;
                const isNext = direction === 'next';
                if (!exists) {
                    // segnaposto invisibile: "LEZIONE X" resta centrato
                    const ghost = document.createElement('span');
                    ghost.className = 'ums-nav-ghost';
                    ghost.setAttribute('aria-hidden', 'true');
                    return ghost;
                }
                const a = document.createElement('a');
                a.className = 'ums-nav-btn ' + (isNext ? 'ums-nav-next' : 'ums-nav-prev');
                a.href = urlForLesson(n);
                a.setAttribute('aria-label', isNext ? 'Lezione successiva' : 'Lezione precedente');
                a.setAttribute('title', 'Lezione ' + n);
                a.innerHTML = '<svg class="ums-ic" aria-hidden="true"><use href="#ic-chevron-' + (isNext ? 'right' : 'left') + '"/></svg>'; // PUNTO 5
                return a;
            }

            // Le freccette avvolgono il sottotitolo "LEZIONE X": il div
            // originale #dyn-subtitle viene spostato dentro una riga flex
            // (l'id resta intatto, il data-binding continua a funzionare).
            const subtitle = document.getElementById('dyn-subtitle');
            if (!subtitle || !subtitle.parentNode) return;
            const row = document.createElement('div');
            row.className = 'ums-subtitle-row';
            subtitle.parentNode.insertBefore(row, subtitle);
            row.appendChild(makeBtn(currentN - 1, 'prev'));
            row.appendChild(subtitle);
            row.appendChild(makeBtn(currentN + 1, 'next'));
        })();
    

// ====================================================================
// SEZIONE 7 — ex <script id="ums-inav-script">
// ====================================================================
        (function () {
            const IG_URL = '';
            const WA_URL = '';
            const HOME_URL = 'index.html';
            const AVATAR = '';
            const API = '';

            const WA_SVG = '';

            const getChiave   = () => localStorage.getItem('ums_chiave') || '';
            const setChiaveLS = (k) => localStorage.setItem('ums_chiave', k);
            const clearChiave = () => localStorage.removeItem('ums_chiave');

            const nav = document.createElement('nav');
            nav.id = 'ums-insta-nav';
            nav.setAttribute('aria-label', 'Navigazione principale');
            nav.innerHTML =
                '<a class="ums-inav-item" href="' + HOME_URL + '" title="Home" aria-label="Torna alla Home">' +
                    '<svg class="ums-ic" aria-hidden="true"><use href="#ic-home"/></svg>' +
                '</a>' +
                '<div class="ums-inav-item" id="ums-inav-lang">' +
                    '<span class="ums-inav-placeholder" aria-hidden="true">' +
                        '<svg class="ums-ic"><use href="#ic-globe"/></svg>' +
                        '<span class="ums-inav-label">Lingua</span>' +
                    '</span>' +
                '</div>' +
                '<button class="ums-inav-item ums-login-btn" id="ums-inav-login" type="button" title="Accedi" aria-label="Accedi" aria-haspopup="dialog">' +
                '<span class="ums-login-q" aria-hidden="true">?</span>' +
                    '<svg class="ums-ic" aria-hidden="true"><use href="#ic-login"/></svg>' +
                    '<span class="ums-inav-label" id="ums-login-label">Accedi</span>' +
                '</button>' +
                '<button class="ums-inav-item ums-fc-btn" id="ums-inav-fc" type="button" title="Flashcard da ripassare" aria-label="Flashcard da ripassare" aria-haspopup="dialog">' +
                    '<svg class="ums-ic" aria-hidden="true"><use href="#ic-cards"/></svg>' +
                    '<span class="ums-fc-badge" id="ums-fc-badge" hidden>0</span>' +
                    '<span class="ums-inav-label">Ripasso</span>' +
                '</button>';
            document.body.appendChild(nav);

            // Trapianto del selettore lingua originale (logica intatta).
            const langSlot = document.getElementById('ums-inav-lang');
            const claimLangSelector = () => {
                const s = document.getElementById('custom-lang-selector');
                if (!s || !langSlot) return;
                if (s.parentElement !== langSlot) langSlot.appendChild(s);
                const menu = document.getElementById('lang-options-menu');
                if (menu && menu.parentElement !== document.body) {
                    menu.classList.add('ums-lang-portal');
                    document.body.appendChild(menu);
                }
                const ph = langSlot.querySelector('.ums-inav-placeholder');
                if (ph) ph.classList.toggle('ums-hidden', s.classList.contains('loaded'));
            };
            claimLangSelector();
            const headerEl2 = document.querySelector('header');
            if (headerEl2 && 'MutationObserver' in window) {
                new MutationObserver(claimLangSelector).observe(headerEl2, { childList: true });
            }
            const selEl = document.getElementById('custom-lang-selector');
            if (selEl && 'MutationObserver' in window) {
                new MutationObserver(claimLangSelector).observe(selEl, { attributes: true, attributeFilter: ['class'] });
            }

            // ---------- Popup ACCESSO ----------
            const overlay = document.createElement('div');
            overlay.id = 'ums-access-overlay';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.setAttribute('aria-label', 'Accesso');
            overlay.innerHTML =
                '<div class="ums-access-card">' +
                    '<button class="ums-access-close" type="button" aria-label="Chiudi">&#10005;</button>' +
                    '<div class="ums-access-logo notranslate" translate="no">' +
                        '<span class="ums-logo-l1">Demo</span>' +
                        '<span class="ums-logo-l2">Accessibilità</span>' +
                        '<div class="ums-logo-tag"><span>Il tuo compagno di studi</span></div>' +
                    '</div>' +
                    '<div id="ums-access-out">' +
                        '<h3 class="ums-access-h">Salva i tuoi progressi</h3>' +
                        '<p class="ums-access-p">Con l\'accesso tutto ci&ograve; che fai su <span class="notranslate" translate="no">Demo Accessibilità</span> resta tuo: le lezioni che segui, gli appunti che scrivi, le sottolineature e le flashcard che ripassi. Li ritrovi ogni volta che torni, anche da un altro dispositivo. Nessuna email, nessuna password, nessun dato personale: ti basta una chiave.</p>' +
                        '<div class="ums-access-block" id="ums-choice">' +
                            '<button class="ums-access-btn primary" id="ums-scegli-ho" type="button">Ho gi&agrave; la mia chiave</button>' +
                            '<div style="height:10px"></div>' +
                            '<button class="ums-access-btn" id="ums-scegli-primo" type="button">&Egrave; la mia prima volta qui</button>' +
                        '</div>' +
                        '<div class="ums-access-block" id="ums-view-login" hidden>' +
                            '<p class="ums-access-lbl">Inserisci la tua chiave</p>' +
                            '<input id="ums-input-chiave" class="ums-access-input" type="text" placeholder="ESEMPIO123" autocomplete="off" spellcheck="false">' +
                            '<button class="ums-access-btn primary" id="ums-accedi" type="button">Accedi</button>' +
                            '<p class="ums-access-msg" id="ums-login-msg"></p>' +
                            '<button class="ums-switch" id="ums-to-genera" type="button">Non ho mai avuto una chiave</button>' +
                        '</div>' +
                        '<div class="ums-access-block" id="ums-view-genera" hidden>' +
                            '<p class="ums-nb">&#9888;&#65039; Genera una chiave solo se non ne hai mai avuta una. Se in passato ne avevi gi&agrave; creata una, usa quella: una chiave nuova parte da zero e i tuoi vecchi appunti non la seguiranno.</p>' +
                            '<button class="ums-access-btn primary" id="ums-genera" type="button">S&igrave;, &egrave; la mia prima volta: genera</button>' +
                            '<p class="ums-access-msg" id="ums-genera-msg"></p>' +
                            '<div id="ums-chiave-box" class="ums-chiave-box" hidden>' +
                                '<div class="ums-chiave-val" id="ums-chiave-val"></div>' +
                                '<button class="ums-copy" id="ums-copy" type="button">Copia</button>' +
                                '<p class="ums-nb">&#9888;&#65039; Questa &egrave; la tua chiave, ed &egrave; unica e irripetibile. Scrivila e conservala subito &mdash; nelle note del telefono, su un foglio, dove preferisci. &Egrave; l\'unico modo per ritrovare i tuoi appunti: non &egrave; legata a nessuna email, quindi se la perdi non pu&ograve; essere recuperata.</p>' +
                                '<button class="ums-access-btn primary" id="ums-conferma" type="button">Ho salvato la chiave, entra</button>' +
                            '</div>' +
                            '<button class="ums-switch" id="ums-to-login" type="button">In realt&agrave; ho gi&agrave; una chiave</button>' +
                        '</div>' +
                    '</div>' +
                    '<div id="ums-access-in" hidden>' +
                        '<h3 class="ums-access-h">Sei connesso</h3>' +
                        '<p class="ums-access-p">I tuoi progressi vengono salvati con questa chiave:</p>' +
                        '<div class="ums-chiave-val" id="ums-chiave-mine"></div>' +
                        '<p class="ums-nb">Conservala con cura: &egrave; ci&ograve; che ti serve per ritrovare i tuoi appunti da qualsiasi dispositivo.</p>' +
                        '<button class="ums-access-btn" id="ums-esci" type="button">Esci</button>' +
                    '</div>' +
                '</div>';
            document.body.appendChild(overlay);

            const loginBtn   = document.getElementById('ums-inav-login');
            const loginLabel = document.getElementById('ums-login-label');
            const closeBtn   = overlay.querySelector('.ums-access-close');
            const outView    = document.getElementById('ums-access-out');
            const inView     = document.getElementById('ums-access-in');

            function refreshState() {
                const k = getChiave();
                if (k) {
                    loginBtn.classList.add('is-in'); loginBtn.classList.remove('is-out');
                    loginLabel.textContent = 'Accesso';
                    loginBtn.title = 'Sei connesso'; loginBtn.setAttribute('aria-label', 'Sei connesso');
                    document.getElementById('ums-chiave-mine').textContent = k;
                    outView.hidden = true; inView.hidden = false;
                } else {
                    loginBtn.classList.add('is-out'); loginBtn.classList.remove('is-in');
                    loginLabel.textContent = 'Accedi';
                    loginBtn.title = 'Accedi'; loginBtn.setAttribute('aria-label', 'Accedi');
                    outView.hidden = false; inView.hidden = true;
                }
            }
            refreshState();
            if (window.umsWaBadge) window.umsWaBadge();

            const choiceView  = document.getElementById('ums-choice');
            const loginView2  = document.getElementById('ums-view-login');
            const generaView  = document.getElementById('ums-view-genera');
            const resetOut = () => { choiceView.hidden = false; loginView2.hidden = true; generaView.hidden = true; };
            document.getElementById('ums-scegli-ho').addEventListener('click', () => { choiceView.hidden = true; loginView2.hidden = false; });
            document.getElementById('ums-scegli-primo').addEventListener('click', () => { choiceView.hidden = true; generaView.hidden = false; });
            document.getElementById('ums-to-genera').addEventListener('click', () => { loginView2.hidden = true; generaView.hidden = false; });
            document.getElementById('ums-to-login').addEventListener('click', () => { generaView.hidden = true; loginView2.hidden = false; });
            const open  = () => { resetOut(); overlay.classList.add('show'); document.body.classList.add('ums-noscroll'); closeBtn.focus(); };
            const close = () => { overlay.classList.remove('show'); document.body.classList.remove('ums-noscroll'); loginBtn.focus(); };
            loginBtn.addEventListener('click', open);
            closeBtn.addEventListener('click', close);
            overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('show')) close(); });

            let chiaveGenerata = '';
            const generaBtn = document.getElementById('ums-genera');
            const chiaveBox = document.getElementById('ums-chiave-box');
            const chiaveVal = document.getElementById('ums-chiave-val');
            generaBtn.addEventListener('click', async () => {
                const gMsg = document.getElementById('ums-genera-msg');
                gMsg.textContent = ''; gMsg.className = 'ums-access-msg';
                generaBtn.disabled = true; generaBtn.textContent = 'Genero\u2026';
                try {
                    const r = await fetch(API + '/create', { method: 'POST' });
                    const d = await r.json();
                    if (d.chiave) {
                        chiaveGenerata = d.chiave;
                        chiaveVal.textContent = d.chiave;
                        chiaveBox.hidden = false;
                        generaBtn.hidden = true;
                    } else if (r.status === 429) {
                        gMsg.textContent = 'Hai gi\u00e0 creato diverse chiavi oggi. Quasi sicuramente ne hai una: cercala dove l\u2019avevi salvata e usa \u201cHo gi\u00e0 la mia chiave\u201d.';
                        gMsg.className = 'ums-access-msg err';
                        generaBtn.textContent = 'S\u00ec, \u00e8 la mia prima volta: genera';
                        generaBtn.disabled = false;
                    } else {
                        gMsg.textContent = 'Errore, riprova.';
                        gMsg.className = 'ums-access-msg err';
                        generaBtn.textContent = 'S\u00ec, \u00e8 la mia prima volta: genera';
                        generaBtn.disabled = false;
                    }
                } catch (e) {
                    gMsg.textContent = 'Errore di connessione, riprova.';
                    gMsg.className = 'ums-access-msg err';
                    generaBtn.textContent = 'S\u00ec, \u00e8 la mia prima volta: genera';
                    generaBtn.disabled = false;
                }
            });

            const copyBtn = document.getElementById('ums-copy');
            copyBtn.addEventListener('click', () => {
                if (!chiaveGenerata) return;
                navigator.clipboard.writeText(chiaveGenerata).then(() => {
                    copyBtn.textContent = 'Copiata \u2713';
                    setTimeout(() => { copyBtn.textContent = 'Copia'; }, 1500);
                }).catch(() => {});
            });

            document.getElementById('ums-conferma').addEventListener('click', () => {
                if (chiaveGenerata) { setChiaveLS(chiaveGenerata); refreshState(); }
            });

            const accediBtn   = document.getElementById('ums-accedi');
            const inputChiave = document.getElementById('ums-input-chiave');
            const loginMsg    = document.getElementById('ums-login-msg');
            accediBtn.addEventListener('click', async () => {
                const chiave = (inputChiave.value || '').toUpperCase().replace(/[\s-]/g, '');
                if (!chiave) { loginMsg.textContent = 'Scrivi la tua chiave.'; loginMsg.className = 'ums-access-msg err'; return; }
                accediBtn.disabled = true; loginMsg.textContent = 'Controllo\u2026'; loginMsg.className = 'ums-access-msg';
                try {
                    const r = await fetch(API + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chiave }) });
                    const d = await r.json();
                    if (d.valida) { setChiaveLS(chiave); refreshState(); loginMsg.textContent = ''; }
                    else { loginMsg.textContent = 'Chiave non trovata. Controlla di averla scritta bene.'; loginMsg.className = 'ums-access-msg err'; }
                } catch (e) { loginMsg.textContent = 'Errore di connessione, riprova.'; loginMsg.className = 'ums-access-msg err'; }
                accediBtn.disabled = false;
            });
            inputChiave.addEventListener('keydown', (e) => { if (e.key === 'Enter') accediBtn.click(); });

            document.getElementById('ums-esci').addEventListener('click', () => { clearChiave(); refreshState(); });

            // ============ HUB RIPASSO FLASHCARD (tappa 4) ============
            const fcOverlay = document.createElement('div');
            fcOverlay.id = 'ums-fc-overlay';
            fcOverlay.setAttribute('role', 'dialog');
            fcOverlay.setAttribute('aria-modal', 'true');
            fcOverlay.setAttribute('aria-label', 'Ripasso flashcard');
            fcOverlay.innerHTML =
                '<div class="ums-fc-card">' +
                    '<button class="ums-fc-close" type="button" aria-label="Chiudi">&#10005;</button>' +
                    '<div class="ums-bmc-logo notranslate" translate="no"><span class="l1">Demo</span><span class="l2">Accessibilità</span></div>' +
                    '<div class="ums-bmc-tag"><span>Il tuo compagno di studi</span></div>' +
                    '<div class="ums-fc-title">Da ripassare</div>' +
                    '<div class="ums-fc-sub" id="ums-fc-sub"></div>' +
                    '<div class="ums-notif-row" id="ums-notif-row" hidden>' +
                        '<button class="ums-notif-btn" id="ums-notif-btn" type="button"><svg class="ums-ic" aria-hidden="true"><use href="#ic-bell"/></svg> Avvisami quando ho un ripasso</button>' +
                        '<span class="ums-notif-ok" id="ums-notif-msg" hidden></span>' +
                    '</div>' +
                    
                    '<button class="ums-fc-how" id="ums-fc-how" type="button">Come funziona il ripasso?</button>' +
                    '<div class="ums-fc-howbox" id="ums-fc-howbox" hidden>' +
                        '<p>Il <b>ripasso a intervalli</b> (spaced repetition) &egrave; il metodo di studio pi&ugrave; efficace mai misurato. L\'idea &egrave; semplice: invece di rileggere tutto insieme, rivedi ogni concetto <b>poco prima di dimenticarlo</b>.</p>' +
                        '<p>Ogni volta che segni una carta come <b>&ldquo;La so&rdquo;</b>, la rivedrai pi&ugrave; in l&agrave; nel tempo (dopo 1 giorno, poi 3, 7, 16, 35...). Se invece la sbagli, torna presto. Cos&igrave; le cose che sai gi&agrave; non ti fanno perdere tempo, e quelle difficili le fissi davvero.</p>' +
                        '<p>Bastano pochi minuti al giorno per ricordare a lungo termine, con molta meno fatica del ripasso &ldquo;tutto in una volta&rdquo;.</p>' +
                    '</div>' +
                    '<div id="ums-fc-gate" hidden>' +
                        '<p id="ums-fc-gate-text"></p>' +
                        '<button class="ums-access-btn primary" id="ums-fc-login" type="button"></button>' +
                    '</div>' +
                    '<div id="ums-fc-list"></div>' +
                    '<div id="ums-review-stage">' +
                        '<div class="urv-top">' +
                            '<button class="urv-back" id="urv-back" type="button"><svg class="ums-ic" aria-hidden="true"><use href="#ic-x"/></svg> Torna all\'elenco</button>' +
                            '<span class="urv-count" id="urv-count"></span>' +
                        '</div>' +
                        '<div class="urv-wrapper" id="urv-wrapper">' +
                            '<div class="urv-face"><h2 id="urv-front-text"></h2></div>' +
                        '</div>' +
                        '<button class="urv-reveal" id="urv-reveal" type="button">Mostra la risposta</button>' +
                        '<div class="urv-answer" id="urv-answer" hidden><p id="urv-back-text"></p></div>' +
                        '<div class="urv-actions" id="urv-actions" hidden>' +
                            '<button class="urv-btn no" id="urv-no" type="button">Ripasso dopo</button>' +
                            '<button class="urv-btn si" id="urv-si" type="button">La so!</button>' +
                        '</div>' +
                        '<div class="urv-done" id="urv-done" hidden>' +
                            '<h3>Ripasso completato!</h3>' +
                            '<p id="urv-done-text"></p>' +
                            '<button class="ums-fc-run primary" id="urv-done-back" type="button">Torna all\'elenco</button>' +
                        '</div>' +
                    '</div>' +
                    '</div>';
            document.body.appendChild(fcOverlay);


            const fcBtn = document.getElementById('ums-inav-fc');
            const fcBadge = document.getElementById('ums-fc-badge');
            const fcClose = fcOverlay.querySelector('.ums-fc-close');
            const fcList = document.getElementById('ums-fc-list');
            const fcSub = document.getElementById('ums-fc-sub');

            window.srAggiornaBadge = function () {
                if (typeof srConteggioDovute !== 'function') return;
                const n = srConteggioDovute();
                // Stile social: "!" bianco su pallino rosso; il numero resta nel tooltip e nell'hub
                if (n > 0) {
                    fcBadge.textContent = '!';
                    fcBadge.title = n + (n === 1 ? ' carta da ripassare' : ' carte da ripassare');
                    fcBadge.hidden = false;
                } else { fcBadge.hidden = true; }
            };

            // ---- PROMEMORIA RIPASSO — v2: PWA + notifiche push (fasi 2/3) ----
            if ('serviceWorker' in navigator) { try { navigator.serviceWorker.register('sw.js'); } catch (e) {} }
            const PUSH_API = '';
            const VAPID_PUBLIC = 'BHjqsvdBP-RMbECYw0ZWApfxaEMECbjVmNUFmDSNoE3DYVXe8j1xnlrCBu8fIN8vI-YiBTm9YAhcJpe-pXVTaBg';
            const NOTIF_ICONA = 'icons/icon-192.png';
            function umsB64aArray(b64) {
                const pad = '='.repeat((4 - b64.length % 4) % 4);
                const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
                const arr = new Uint8Array(raw.length);
                for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
                return arr;
            }
            function umsProssimaScadenza() {
                try {
                    const db = JSON.parse(localStorage.getItem('ums_sr') || '{}');
                    let min = null;
                    Object.keys(db).forEach(function (lk) {
                        const c = (db[lk] && db[lk].cards) || {};
                        Object.keys(c).forEach(function (f) {
                            const d = c[f].due;
                            if (d && (!min || d < min)) min = d;
                        });
                    });
                    return min;
                } catch (e) { return null; }
            }
            function umsMostraNotifica(corpo) {
                const opz = { body: corpo, icon: NOTIF_ICONA, tag: 'ums-ripasso' };
                const ripiego = function () { try { new Notification('Demo Accessibilità', opz); } catch (e) {} };
                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.getRegistration().then(function (reg) {
                        if (reg && reg.showNotification) { reg.showNotification('Demo Accessibilità', opz); }
                        else { ripiego(); }
                    }).catch(ripiego);
                } else { ripiego(); }
            }
            function umsPushSync(sub) {
                fetch(PUSH_API + '/aggiorna', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ endpoint: sub.endpoint, prossima: umsProssimaScadenza() })
                }).catch(function () {});
            }
            function umsIscriviPush() {
                if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
                navigator.serviceWorker.ready.then(function (reg) {
                    return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: umsB64aArray(VAPID_PUBLIC) });
                }).then(function (sub) {
                    fetch(PUSH_API + '/iscrivi', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sub: sub.toJSON(), chiave: localStorage.getItem('ums_chiave') || '', prossima: umsProssimaScadenza() })
                    }).catch(function () {});
                }).catch(function () { /* push non supportate qui: restano le notifiche all'apertura */ });
            }
            function umsNotifRender() {
                const row = document.getElementById('ums-notif-row');
                if (!row) return;
                if (!('Notification' in window)) { row.hidden = true; return; }
                const btn = document.getElementById('ums-notif-btn');
                const msg = document.getElementById('ums-notif-msg');
                row.hidden = false;
                if (Notification.permission === 'granted') {
                    btn.hidden = true; msg.hidden = false;
                    msg.textContent = 'Promemoria attivi su questo dispositivo';
                } else if (Notification.permission === 'denied') {
                    btn.hidden = true; msg.hidden = false;
                    msg.textContent = 'Notifiche bloccate: riattivale dalle impostazioni del sito';
                } else { btn.hidden = false; msg.hidden = true; }
            }
            function umsNotificaDovute(forza) {
                if (!('Notification' in window) || Notification.permission !== 'granted') return;
                if (typeof srConteggioDovute !== 'function') return;
                const n = srConteggioDovute();
                if (n <= 0) return;
                const oggi = new Date().toDateString();
                try { if (!forza && localStorage.getItem('ums_notif_giorno') === oggi) return; } catch (e) {}
                umsMostraNotifica(n === 1 ? 'Hai 1 carta da ripassare oggi. Due minuti e sei a posto.'
                                          : 'Hai ' + n + ' carte da ripassare oggi. Due minuti e sei a posto.');
                try { localStorage.setItem('ums_notif_giorno', oggi); } catch (e) {}
            }
            const notifBtn = document.getElementById('ums-notif-btn');
            if (notifBtn) notifBtn.addEventListener('click', function () {
                Notification.requestPermission().then(function () {
                    umsNotifRender();
                    umsNotificaDovute(true);
                    if (Notification.permission === 'granted') umsIscriviPush();
                });
            });
            if (fcBtn) fcBtn.addEventListener('click', umsNotifRender);
            setTimeout(function () {
                umsNotificaDovute(false);
                // se i promemoria sono attivi, tieni aggiornato il server sulla prossima scadenza
                if ('Notification' in window && Notification.permission === 'granted'
                    && 'serviceWorker' in navigator && 'PushManager' in window) {
                    navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); })
                        .then(function (sub) { if (sub) umsPushSync(sub); else umsIscriviPush(); })
                        .catch(function () {});
                }
            }, 1500);


            // ============ SCHEDE (le tue sottolineature e i tuoi appunti) ============
            // Una "scheda" non si costruisce da zero: e' la Lavagna di una lezione,
            // gia' scritta dallo studente mentre studiava (localStorage ums_hl::<lk>).
            // Qui le tiro fuori dalla lezione e le rendo leggibili tutte insieme.
            let umsHubModo = 'flashcard';

            function schLeggiTutte() {
                const out = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i) || '';
                    if (k.indexOf('ums_hl::') !== 0) continue;
                    const lk = k.slice(8);
                    let dati = null;
                    try { dati = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) {}
                    const righe = (dati && Array.isArray(dati.wb) ? dati.wb : [])
                        .filter(r => r && r.text);
                    if (!righe.length) continue;
                    const slug = (lk.split('/')[0]) || 'lezione';
                    const num = (lk.match(/lezione-(\d+)/) || [])[1] || '';
                    const dbSr = (typeof srCaricaTutto === 'function') ? srCaricaTutto() : {};
                    const titolo = (dbSr[lk] && dbSr[lk].titolo) || '';
                    out.push({
                        lk, slug, num, titolo, righe,
                        nomeMateria: (typeof umsNomeMateria === 'function') ? umsNomeMateria(slug, titolo) : slug
                    });
                }
                out.sort((a, b) => a.nomeMateria.localeCompare(b.nomeMateria) || (parseInt(a.num || 0) - parseInt(b.num || 0)));
                return out;
            }

            function schGruppi() {
                const g = {};
                schLeggiTutte().forEach(s => {
                    (g[s.slug] = g[s.slug] || { slug: s.slug, nome: s.nomeMateria, schede: [] }).schede.push(s);
                });
                return Object.values(g);
            }

            // Da che lezione viene questa scheda: SEMPRE scritto, in ogni foglio.
            function schProvenienza(s) {
                return s.nomeMateria + (s.num ? ' \u00b7 ' + T('Lezione') + ' ' + s.num : '');
            }

            // LETTORE — un foglio alla volta, si scorre come le foto di un social.
            function schApriLettore(schede, partenza) {
                if (!schede || !schede.length) return;
                let ov = document.getElementById('ums-sch-viewer');
                if (ov) ov.remove();
                ov = document.createElement('div');
                ov.id = 'ums-sch-viewer';
                ov.setAttribute('role', 'dialog');
                ov.setAttribute('aria-modal', 'true');
                ov.setAttribute('aria-label', T('Le mie schede'));

                const fogli = schede.map((s, i) => {
                    const righe = s.righe.map(r => {
                        const nota = r.note ? '<p class="sch-nota">' + schEsc(r.note) + '</p>' : '';
                        return '<li class="sch-riga">' +
                               '<span class="sch-pallino" style="background:' + schEsc(r.color || '#FFF176') + '"></span>' +
                               '<div><p class="sch-testo">' + schEsc(r.text) + '</p>' + nota + '</div>' +
                               '</li>';
                    }).join('');
                    return '<article class="sch-foglio" tabindex="-1">' +
                               '<div class="sch-testata">' +
                                   '<span class="sch-da">' + schEsc(schProvenienza(s)) + '</span>' +
                                   '<span class="sch-pag">' + (i + 1) + ' / ' + schede.length + '</span>' +
                               '</div>' +
                               (s.titolo ? '<h2 class="sch-titolo">' + schEsc(s.titolo) + '</h2>' : '') +
                               '<ul class="sch-righe">' + righe + '</ul>' +
                               (i < schede.length - 1 ? '<div class="sch-giu" aria-hidden="true">\u2304</div>' : '') +
                           '</article>';
                }).join('');

                ov.innerHTML =
                    '<div class="sch-barra">' +
                        '<button class="sch-print" type="button" aria-label="' + T('Stampa') + '">' +
                            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/></svg>' +
                            '<span>' + T('Stampa') + '</span>' +
                        '</button>' +
                        '<button class="sch-x" type="button" aria-label="' + T('Chiudi') + '">&#10005;</button>' +
                    '</div>' +
                    '<div class="sch-scroll" id="sch-scroll">' + fogli + '</div>';
                document.body.appendChild(ov);
                document.body.classList.add('ums-noscroll');

                function chiudi() {
                    ov.remove();
                    document.body.classList.remove('ums-noscroll');
                    document.removeEventListener('keydown', tasti);
                }
                function tasti(e) { if (e.key === 'Escape') chiudi(); }
                ov.querySelector('.sch-x').addEventListener('click', chiudi);
                // Stampa SOLO il foglio che si ha davanti in quel momento:
                // se sto leggendo la Lezione 3, deve uscire la Lezione 3.
                function schFoglioInVista() {
                    var box = ov.querySelector('#sch-scroll');
                    if (!box) return 0;
                    var figli = Array.prototype.slice.call(box.children);
                    var vicino = 0, minimo = Infinity;
                    for (var i = 0; i < figli.length; i++) {
                        var d = Math.abs(figli[i].offsetTop - box.scrollTop);
                        if (d < minimo) { minimo = d; vicino = i; }
                    }
                    return vicino;
                }
                ov.querySelector('.sch-print').addEventListener('click', function () {
                    var i = schFoglioInVista();
                    if (schede[i]) schStampa([schede[i]], '');
                });
                document.addEventListener('keydown', tasti);

                const scroll = ov.querySelector('#sch-scroll');
                const q = Math.max(0, Math.min(partenza || 0, schede.length - 1));
                if (q > 0) {
                    const target = scroll.children[q];
                    if (target) scroll.scrollTop = target.offsetTop;
                }
                requestAnimationFrame(() => { ov.classList.add('on'); });
            }

            // STAMPA — usa ESATTAMENTE il foglio della Lavagna (wbSheetHTML):
            // stesso sfondo, stessa testata, stessa numerazione col numero oro,
            // stessa barra del colore di evidenziazione, stesso piede.
            // Unica differenza: i dati arrivano da localStorage invece che dal
            // DOM della lezione, e la provenienza e' sempre scritta in testata.
            function schFoglioHTML(s, primo) {
                var printDate = new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
                var sotto = 'Lavagna Concetti';
                if (s.num) sotto += ' \u00b7 ' + T('Lezione') + ' ' + s.num;
                if (s.titolo) sotto += ' \u00b7 ' + schEsc(s.titolo);
                sotto += ' \u00b7 ' + printDate;

                var out = '<div style="' + (primo ? '' : 'page-break-before: always; break-before: page;') + '">' +
                    '<h1 style="font-family: \'Playfair Display\', Georgia, serif; font-size: 30px; font-weight: 700; color: #1A2F4F; margin: 0 0 6px 0; line-height: 1.15;">' +
                        schEsc(s.nomeMateria) +
                    '</h1>' +
                    '<div style="font-size: 12px; color: #918E86; margin-bottom: 14px;">' + sotto + '</div>' +
                    '<div style="border-top: 4px double #1C1C22; margin-bottom: 28px;"></div>';

                var n = 0;
                s.righe.forEach(function (r) {
                    var num = String(++n);
                    if (num.length < 2) num = '0' + num;
                    var colore = schEsc(r.color || '#FFF176');
                    out += '<div style="display: flex; gap: 16px; margin-bottom: 22px; page-break-inside: avoid; break-inside: avoid;">' +
                            '<div style="font-family: \'Playfair Display\', Georgia, serif; font-weight: 700; font-size: 22px; color: #C8A96E; min-width: 34px; line-height: 1.2; text-align: right;">' + num + '</div>' +
                            '<div style="flex: 1; border-left: 4px solid ' + colore + '; border-bottom: 1px solid #E4E0D6; padding: 2px 0 14px 16px;">' +
                                '<p style="font-family: \'Playfair Display\', Georgia, serif; font-weight: 700; font-size: 17px; color: #1A2F4F; margin: 0 0 7px 0; line-height: 1.45;">' + schEsc(r.text) + '</p>' +
                                (r.note ? '<p style="font-size: 13.5px; color: #555149; margin: 0; line-height: 1.65; white-space: pre-wrap;">&#8627; ' + schEsc(r.note) + '</p>' : '') +
                            '</div>' +
                        '</div>';
                });

                return out + '</div>';
            }

            function schStampa(schede, titoloMateria) {
                if (!schede || !schede.length) return;

                var printContents =
                    '<img src="https://lorenzosciallato.github.io/demo-accessibilit-/img/sfondo-giappone-1600.png"' +
                    ' alt="" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.06; z-index: -1;">' +
                    '<div style="font-family: \'DM Sans\', Arial, sans-serif; padding: 28px 24px; color: #1C1C22; max-width: 780px; margin: 0 auto; -webkit-print-color-adjust: exact; print-color-adjust: exact;">';

                schede.forEach(function (s, i) { printContents += schFoglioHTML(s, i === 0); });

                printContents +=
                    '<div style="margin-top: 34px; border-top: 4px double #1C1C22; padding-top: 14px; text-align: center;">' +
                        '<div style="font-family: \'Playfair Display\', Georgia, serif; font-weight: 900; font-size: 15px; letter-spacing: -0.02em; color: #1C1C22;">Demo <em style="font-style: italic; color: #1A2F4F;">Accessibilità</em></div>' +
                        '<div style="width: 44px; border-top: 2px solid #C8A96E; margin: 10px auto 0;"></div>' +
                    '</div>' +
                    '</div>';

                var ifr = document.createElement('iframe');
                ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:none';
                ifr.setAttribute('aria-hidden','true'); ifr.setAttribute('title','Stampa');
                document.body.appendChild(ifr);
                var doc = ifr.contentWindow.document;
                doc.open();
                doc.write(
                    '<html><head><title>' + schEsc(titoloMateria || T('Le mie schede')) + ' \u2014 Demo Accessibilità</title>' +
                    '<link rel="preconnect" href="https://fonts.googleapis.com">' +
                    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
                    '<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">' +
                    '</head><body style="margin:0; background:#fff;">' + printContents +
                    '<scr' + 'ipt>window.onload = function(){ setTimeout(function(){ window.print(); }, 450); };</scr' + 'ipt>' +
                    '</body></html>'
                );
                doc.close();
                setTimeout(function () { try { document.body.removeChild(ifr); } catch (e) {} }, 20000);
            }

            function schEsc(s) {
                return String(s == null ? '' : s)
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;');
            }

            // INTERRUTTORE Flashcard / Schede in cima all'hub
            function schMontaToggle() {
                let bar = document.getElementById('ums-hub-modo');
                if (!bar) {
                    bar = document.createElement('div');
                    bar.id = 'ums-hub-modo';
                    bar.innerHTML =
                        '<button type="button" data-modo="flashcard"></button>' +
                        '<button type="button" data-modo="schede"></button>';
                    fcList.parentNode.insertBefore(bar, fcList);
                    bar.querySelectorAll('button').forEach(b => {
                        b.addEventListener('click', () => {
                            umsHubModo = b.getAttribute('data-modo');
                            fcRenderHub();
                        });
                    });
                }
                const nSchede = schLeggiTutte().length;
                bar.querySelector('[data-modo="flashcard"]').textContent = T('Flashcard');
                bar.querySelector('[data-modo="schede"]').textContent = T('Schede') + (nSchede ? ' (' + nSchede + ')' : '');
                bar.querySelectorAll('button').forEach(b => {
                    b.classList.toggle('on', b.getAttribute('data-modo') === umsHubModo);
                });
            }

            function schRenderHub() {
                // Le schede si salvano e si sincronizzano come le flashcard:
                // senza chiave non si usano (stesso cancello del ripasso).
                const gate = document.getElementById('ums-fc-gate');
                const connesso = !!getChiave();
                if (gate) gate.hidden = connesso;
                fcList.innerHTML = '';
                if (!connesso) {
                    fcSub.textContent = '';
                    document.getElementById('ums-fc-gate-text').textContent = T('Per usare le schede serve la tua chiave: accedendo, le tue sottolineature e i tuoi appunti si salvano e ti seguono su qualsiasi dispositivo. Bastano due tocchi, ed è gratis.');
                    document.getElementById('ums-fc-login').textContent = T('Accedi ora');
                    return;
                }
                const gruppi = schGruppi();
                if (!gruppi.length) {
                    fcSub.textContent = '';
                    fcList.innerHTML = '<div class="ums-fc-empty">' + T('Non hai ancora nessuna scheda.') + '<br>' +
                        T('Sottolinea una frase nel Riassuntone: finisce sulla Lavagna e diventa una scheda.') + '</div>';
                    return;
                }
                const tot = gruppi.reduce((n, g) => n + g.schede.length, 0);
                fcSub.textContent = tot + ' ' + T(tot === 1 ? 'scheda dai tuoi appunti' : 'schede dai tuoi appunti');

                gruppi.forEach(g => {
                    const box = document.createElement('div');
                    box.className = 'ums-fc-lezione';
                    const chips = g.schede.map((s, i) =>
                        '<button class="sch-chip" type="button" data-i="' + i + '">' +
                        (s.num ? T('Lezione') + ' ' + s.num : schEsc(s.titolo || s.lk)) +
                        ' <span class="sch-chip-n">' + s.righe.length + '</span></button>'
                    ).join('');
                    box.innerHTML =
                        '<div class="ums-fc-lez-top">' +
                            '<div>' +
                                '<div class="ums-fc-lez-nome"></div>' +
                                '<div class="ums-fc-lez-conta">' + g.schede.length + ' ' +
                                    T(g.schede.length === 1 ? 'scheda' : 'schede') + '</div>' +
                            '</div>' +
                        '</div>' +
                        '<div class="sch-chips">' + chips + '</div>' +
                        '<div class="ums-fc-actions">' +
                            '<button class="ums-fc-run primary sch-tutte" type="button">' +
                                T('Leggi tutte') + ' (' + g.schede.length + ')</button>' +
                            '<button class="ums-fc-run sch-stampa-tutte" type="button">' +
                                T('Stampa tutte') + '</button>' +
                        '</div>';
                    box.querySelector('.ums-fc-lez-nome').textContent = g.nome;
                    box.querySelector('.sch-tutte').addEventListener('click', () => schApriLettore(g.schede, 0));
                    box.querySelector('.sch-stampa-tutte').addEventListener('click', () => schStampa(g.schede, g.nome));
                    box.querySelectorAll('.sch-chip').forEach(ch => {
                        ch.addEventListener('click', () => schApriLettore(g.schede, parseInt(ch.getAttribute('data-i'), 10)));
                    });
                    fcList.appendChild(box);
                });
            }

            function fcRenderHub() {
                schMontaToggle();
                if (umsHubModo === 'schede') { schRenderHub(); return; }
                // Senza accesso la sezione non salva né sincronizza: cancello con invito
                const gate = document.getElementById('ums-fc-gate');
                const connesso = !!getChiave();
                if (gate) gate.hidden = connesso;
                if (!connesso) {
                    fcList.innerHTML = '';
                    fcSub.textContent = '';
                    document.getElementById('ums-fc-gate-text').textContent = T('Per usare il ripasso serve la tua chiave: accedendo, ogni flashcard che provi si salva e te la riproponiamo al momento giusto, su qualsiasi dispositivo. Bastano due tocchi, ed è gratis.');
                    document.getElementById('ums-fc-login').textContent = T('Accedi ora');
                    return;
                }
                const gruppi = (typeof srDovutePerMateria === 'function') ? Object.values(srDovutePerMateria()) : [];
                fcList.innerHTML = '';
                let totDovute = 0;
                gruppi.forEach(g => totDovute += g.dovute);
                if (gruppi.length === 0) {
                    fcSub.textContent = '';
                    fcList.innerHTML = '<div class="ums-fc-empty">' + T('Non hai ancora salvato nessun ripasso.') + '<br>' + T('Prova le flashcard di una lezione: ogni risposta si salva da sola.') + '</div>';
                    return;
                }
                fcSub.textContent = totDovute > 0 ? (totDovute + ' ' + T(totDovute === 1 ? 'carta da ripassare oggi' : 'carte da ripassare oggi')) : T('Nessuna carta in scadenza oggi — ottimo!');
                gruppi.forEach(g => {
                    const box = document.createElement('div');
                    box.className = 'ums-fc-lezione';
                    box.innerHTML =
                        '<div class="ums-fc-lez-top">' +
                            '<div>' +
                                '<div class="ums-fc-lez-nome"></div>' +
                                '<div class="ums-fc-lez-conta">' + g.dovute + ' ' + T('da ripassare') + ' \u00b7 ' + g.totale + ' ' + T('totali') + '</div>' +
                                '<div class="ums-fc-count">' + (typeof srCountdownTestoMateria === 'function' ? srCountdownTestoMateria(g.lks) : '') + '</div>' +
                            '</div>' +
                            '<button class="ums-fc-del" type="button" title="' + T('Elimina questo mazzo') + '" aria-label="' + T('Elimina questo mazzo') + '"><svg class="ums-ic" aria-hidden="true"><use href="#ic-x"/></svg></button>' +
                        '</div>' +
                        '<div class="ums-fc-actions">' +
                            '<button class="ums-fc-run primary run-all" type="button">' + T('Ripassa tutte') + ' (' + g.totale + ')</button>' +
                            '<button class="ums-fc-run wrong run-wrong" type="button"' + (g.sbagliate === 0 ? ' disabled' : '') + '>' + T('Solo sbagliate') + ' (' + g.sbagliate + ')</button>' +
                        '</div>';
                    box.querySelector('.ums-fc-lez-nome').textContent = g.nome;
                    box.querySelector('.run-all').addEventListener('click', () => fcAvviaRipassoMateria(g.slug, false));
                    box.querySelector('.run-wrong').addEventListener('click', () => { if (g.sbagliate > 0) fcAvviaRipassoMateria(g.slug, true); });
                    box.querySelector('.ums-fc-del').addEventListener('click', () => fcEliminaMateria(g.slug, g.nome, g.lks));
                    fcList.appendChild(box);
                });
            }

            function fcEliminaMateria(slug, nome, lks) {
                // PUNTO 2 — via il confirm() nativo: pop-up brandizzato stile Accedi
                umsConfirm({
                    title: T('Eliminare il ripasso di') + ' "' + nome + '"?',
                    message: T('Le carte non ti verranno più riproposte.'),
                    okText: T('Elimina'),
                    cancelText: T('Annulla'),
                    danger: true
                }).then(conferma => {
                    if (!conferma) return;
                    const db = (typeof srCaricaTutto === 'function') ? srCaricaTutto() : {};
                    (lks || []).forEach(lk => {
                        delete db[lk];
                        // rimuovo anche dal cloud (contenuto nullo = cancellazione logica)
                        if (typeof umsCloudQueue === 'function') umsCloudQueue('sr', lk, null);
                    });
                    if (typeof srSalvaTutto === 'function') srSalvaTutto(db);
                    fcRenderHub();
                    if (typeof srAggiornaBadge === 'function') srAggiornaBadge();
                });
            }

            // Avvia un ripasso: se siamo GIA' nella lezione lk usa il mazzo in pagina,
            // altrimenti apre la lezione con un parametro che fa partire il ripasso.
            // ---- Motore del mini-mazzo DENTRO il pop-up ----
            let urvCoda = [];       // carte ancora da vedere in questa sessione
            let urvLk = null;       // lezione in ripasso
            let urvVisti = {};      // front -> true : già dato il PRIMO esito (quello che conta)
            let urvTot = 0, urvFatte = 0;
            let urvIntroPending = false;   // true solo all'avvio di una sessione: la PRIMA carta entra "scartocciandosi"
            const T = (s) => (window.umsT ? window.umsT(s) : s);
            const stage = document.getElementById('ums-review-stage');
            const urvWrap = document.getElementById('urv-wrapper');
            const urvFront = document.getElementById('urv-front-text');
            const urvBack = document.getElementById('urv-back-text');
            const urvActions = document.getElementById('urv-actions');
            const urvHint = document.getElementById('urv-hint');
            const urvCount = document.getElementById('urv-count');
            const urvDone = document.getElementById('urv-done');
            const urvDoneText = document.getElementById('urv-done-text');

            function fcAvviaRipasso(lk, soloSbagliate) {
                const db = (typeof srCaricaTutto === 'function') ? srCaricaTutto() : {};
                const rec = db[lk]; if (!rec) return;
                let carte = Object.values(rec.cards || {});
                if (soloSbagliate) carte = carte.filter(c => (c.bucket || (c.stato === 'unknown' ? 'sbagliate' : 'giuste')) === 'sbagliate');
                fcLanciaSessione(carte.map(c => ({ front: c.front, back: c.back, lk })), lk);
            }
            window.fcAvviaRipasso = fcAvviaRipasso;

            // Ripasso dell'intero FALDONE di una materia: unisce le carte di
            // tutte le lezioni, ognuna col suo lk di origine, così ogni esito
            // torna nel mazzo giusto (niente duplicati tra lezioni).
            function fcAvviaRipassoMateria(slug, soloSbagliate) {
                const carte = (typeof srCarteDiMateria === 'function') ? srCarteDiMateria(slug, soloSbagliate) : [];
                fcLanciaSessione(carte.map(c => ({ front: c.front, back: c.back, lk: c.lk })), null);
            }
            window.fcAvviaRipassoMateria = fcAvviaRipassoMateria;

            function fcLanciaSessione(coda, lk) {
                if (!coda || coda.length === 0) return;
                urvLk = lk;
                urvCoda = coda;
                urvVisti = {};
                urvTot = urvCoda.length; urvFatte = 0;
                urvIntroPending = true;   // la prima carta si "scartoccia"
                fcList.style.display = 'none';
                const how = document.getElementById('ums-fc-how'); if (how) how.style.display = 'none';
                const gate = document.getElementById('ums-fc-gate'); if (gate) gate.hidden = true;
                fcSub.style.display = 'none';
                urvDone.hidden = true;
                stage.classList.add('on');
                urvMostra();
            }

            const urvAnswer = document.getElementById('urv-answer');
            const urvReveal = document.getElementById('urv-reveal');
            function urvMostra() {
                if (urvCoda.length === 0) { urvFine(); return; }
                const card = urvCoda[0];
                urvActions.hidden = true;
                urvAnswer.hidden = true;
                urvReveal.style.display = 'block';
                urvCount.textContent = T('Rimaste:') + ' ' + urvCoda.length;
                // Solo la PRIMA carta della sessione entra con lo scartocciamento;
                // le successive si susseguono spedite come sempre.
                const conIntro = urvIntroPending; urvIntroPending = false;
                const riduci = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                if (conIntro && !riduci) {
                    urvIntroAvvia(card);
                } else {
                    urvFront.textContent = card.front;
                }
                urvBack.textContent = card.back;
                // riporto in cima il pop-up per la carta nuova
                const cardEl = fcOverlay.querySelector('.ums-fc-card');
                if (cardEl) cardEl.scrollTop = 0;
            }

            // ---- Intro "gratta e vinci" (prima carta della sessione) ----
            let urvRafId = null;

            function urvIntroParole(testo) {
                urvFront.textContent = '';
                const parole = String(testo || '').split(/\s+/).filter(Boolean);
                parole.forEach((p, i) => {
                    const s = document.createElement('span');
                    s.className = 'urv-w';
                    s.textContent = p;
                    // la domanda arriva DOPO che l'immagine è rimasta nuda un attimo
                    // (~2.65s), poi una parola ogni 70ms (tetto a +0.9s: le domande
                    // lunghe non devono trascinarsi)
                    s.style.setProperty('--d', (2.65 + Math.min(i * 0.07, 0.9)).toFixed(2) + 's');
                    urvFront.appendChild(s);
                    urvFront.appendChild(document.createTextNode(' '));
                });
            }

            function urvIntroPulisci() {
                if (urvRafId) { cancelAnimationFrame(urvRafId); urvRafId = null; }
                stage.classList.remove('intro');
                const cv = urvWrap.querySelector('.urv-scratch'); if (cv) cv.remove();
                const face = urvWrap.querySelector('.urv-face'); if (face) face.classList.remove('scratchin');
            }

            // Dipinge la patina argentata del gratta e vinci
            function urvDipingiPatina(ctx, W, H) {
                const g = ctx.createLinearGradient(0, 0, W, H);
                g.addColorStop(0, '#CDCDD3'); g.addColorStop(.45, '#F0F0F3');
                g.addColorStop(.55, '#C3C3CA'); g.addColorStop(1, '#DEDEE3');
                ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
                for (let i = 0; i < 150; i++) {   // puntinato metallico
                    ctx.fillStyle = Math.random() < .5 ? 'rgba(255,255,255,.35)' : 'rgba(90,90,100,.12)';
                    ctx.beginPath();
                    ctx.arc(Math.random() * W, Math.random() * H, Math.random() * 1.6 + .4, 0, 7);
                    ctx.fill();
                }
            }

            // Genera i passi del grattamento: tratti ondulati che attraversano la
            // carta (come pollici veri) + qualche chiazza sparsa, tutto irregolare
            function urvPassiGrattamento(W, H) {
                const passi = [];
                const tratti = 6;
                for (let t = 0; t < tratti; t++) {
                    const daSinistra = t % 2 === 0;
                    let y = H * (0.06 + 0.175 * t) + (Math.random() - .5) * H * 0.07;
                    const onda = 8 + Math.random() * 14;
                    const freq = 0.02 + Math.random() * 0.025;
                    const fase = Math.random() * 6.28;
                    for (let x = -20; x <= W + 20; x += 6) {
                        const px = daSinistra ? x : W - x;
                        const py = y + Math.sin(px * freq + fase) * onda + (Math.random() - .5) * 5;
                        passi.push({ x: px, y: py, r: 14 + Math.random() * 10 });
                    }
                    if (t < tratti - 1) {   // chiazza tra un tratto e l'altro
                        const cx = Math.random() * W, cy = Math.random() * H;
                        for (let k = 0; k < 7; k++) {
                            passi.push({ x: cx + (Math.random() - .5) * 46, y: cy + (Math.random() - .5) * 34, r: 15 + Math.random() * 12 });
                        }
                    }
                }
                return passi;
            }

            function urvIntroAvvia(card) {
                urvIntroPulisci();                 // mai due intro sovrapposte
                stage.classList.add('intro');
                urvIntroParole(card.front);        // la domanda aspetta il suo turno (delay CSS)
                const face = urvWrap.querySelector('.urv-face');
                if (!face) { urvFront.textContent = card.front; stage.classList.remove('intro'); return; }
                face.classList.add('scratchin');
                const rect = face.getBoundingClientRect();
                const W = Math.max(1, rect.width), H = Math.max(1, rect.height);
                const cv = document.createElement('canvas');
                cv.className = 'urv-scratch';
                const dpr = Math.min(window.devicePixelRatio || 1, 2);
                cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
                cv.style.width = '100%'; cv.style.height = '100%';
                const ctx = cv.getContext('2d');
                if (!ctx) { urvFront.textContent = card.front; stage.classList.remove('intro'); return; }
                ctx.scale(dpr, dpr);
                urvDipingiPatina(ctx, W, H);
                face.appendChild(cv);
                const passi = urvPassiGrattamento(W, H);
                // Il grattamento: parte dopo il pop della carta, dura ~1.55s,
                // deciso all'inizio e dolce alla fine (easeOutQuad)
                const avvio = performance.now() + 350;
                const durata = 1550;
                let idx = 0;
                ctx.globalCompositeOperation = 'destination-out';
                const frame = (now) => {
                    if (!cv.parentNode) { urvRafId = null; return; }
                    const t = Math.min(1, Math.max(0, (now - avvio) / durata));
                    const facile = 1 - Math.pow(1 - t, 2);
                    const target = Math.floor(facile * passi.length);
                    while (idx < target) {
                        const p = passi[idx++];
                        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
                    }
                    if (t < 1) {
                        urvRafId = requestAnimationFrame(frame);
                    } else {
                        urvRafId = null;
                        cv.classList.add('done');   // il residuo di patina si dissolve
                        setTimeout(() => { if (cv.parentNode) cv.remove(); }, 450);
                    }
                };
                urvRafId = requestAnimationFrame(frame);
                setTimeout(() => { if (stage.classList.contains('on')) stage.classList.remove('intro'); }, 3700);
            }
            function urvRivela() {
                if (urvWrap.querySelector('.urv-scratch')) return;   // niente spoiler finché c'è la patina
                urvAnswer.hidden = false;
                urvActions.hidden = false;
                urvReveal.style.display = 'none';
            }
            function urvRispondi(esito) {
                const card = urvCoda.shift();
                // Il PRIMO esito su questa carta è quello che conta per lo spaced repetition
                if (!urvVisti[card.front]) {
                    urvVisti[card.front] = true;
                    urvFatte++;
                    // ogni carta torna nel mazzo della SUA lezione di origine
                    if (typeof srApplicaEsito === 'function') srApplicaEsito(card.front, card.back, esito, card.lk || urvLk);
                }
                // Se sbagliata, torna in coda per rivederla in questa sessione (non riconta)
                if (esito === 'unknown') urvCoda.push(card);
                urvMostra();
            }
            function urvFine() {
                urvActions.hidden = true;
                urvAnswer.hidden = true;
                urvReveal.style.display = 'none';
                urvWrap.parentElement && (urvWrap.style.display = 'none');
                urvDone.hidden = false;
                urvDoneText.textContent = T('Hai ripassato') + ' ' + urvTot + ' ' + T(urvTot === 1 ? 'carta' : 'carte') + '. ' + T('Ti riproporremo quelle giuste più in là, e quelle sbagliate molto presto.');
                if (typeof srAggiornaBadge === 'function') srAggiornaBadge();
            }
            function urvChiudiStage() {
                urvIntroPulisci();   // se si chiude a metà scartocciamento, niente residui
                stage.classList.remove('on');
                urvWrap.style.display = '';
                urvDone.hidden = true;
                fcList.style.display = '';
                fcSub.style.display = '';
                const how = document.getElementById('ums-fc-how'); if (how) how.style.display = '';
                fcRenderHub();
            }
            urvReveal.addEventListener('click', urvRivela);
            urvWrap.addEventListener('click', urvRivela); // anche toccando la carta
            document.getElementById('urv-si').addEventListener('click', (e) => { e.stopPropagation(); urvRispondi('known'); });
            document.getElementById('urv-no').addEventListener('click', (e) => { e.stopPropagation(); urvRispondi('unknown'); });
            document.getElementById('urv-back').addEventListener('click', urvChiudiStage);
            document.getElementById('urv-done-back').addEventListener('click', urvChiudiStage);

            const fcHow = document.getElementById('ums-fc-how');
            const fcHowBox = document.getElementById('ums-fc-howbox');
            if (fcHow && fcHowBox) fcHow.addEventListener('click', () => {
                fcHowBox.hidden = !fcHowBox.hidden;
                fcHow.textContent = fcHowBox.hidden ? T('Come funziona il ripasso?') : T('Nascondi spiegazione');
            });
            const FC_HOW_PLAIN = [
                'Il ripasso a intervalli (spaced repetition) è il metodo di studio più efficace mai misurato. L\'idea è semplice: invece di rileggere tutto insieme, rivedi ogni concetto poco prima di dimenticarlo.',
                'Ogni volta che segni una carta come “La so”, la rivedrai più in là nel tempo (dopo 1 giorno, poi 3, 7, 16, 35...). Se invece la sbagli, torna presto. Così le cose che sai già non ti fanno perdere tempo, e quelle difficili le fissi davvero.',
                'Bastano pochi minuti al giorno per ricordare a lungo termine, con molta meno fatica del ripasso “tutto in una volta”.'
            ];
            let fcHowHtmlOrig = null;
            function fcApplicaTraduzioni() {
                fcOverlay.querySelector('.ums-fc-title').textContent = T('Da ripassare');
                const how = document.getElementById('ums-fc-how');
                if (how) how.textContent = (fcHowBox && !fcHowBox.hidden) ? T('Nascondi spiegazione') : T('Come funziona il ripasso?');
                const ps = fcHowBox ? fcHowBox.querySelectorAll('p') : [];
                if (ps.length && !fcHowHtmlOrig) fcHowHtmlOrig = Array.from(ps).map(el => el.innerHTML);
                const italiano = (typeof window.umsIsItalian === 'function') ? window.umsIsItalian() : true;
                ps.forEach((el, i) => {
                    if (italiano && fcHowHtmlOrig) el.innerHTML = fcHowHtmlOrig[i];
                    else el.textContent = T(FC_HOW_PLAIN[i] || '');
                });
                const rev = document.getElementById('urv-reveal');
                if (rev) rev.textContent = T('Mostra la risposta');
                const bNo = document.getElementById('urv-no'); if (bNo) bNo.textContent = T('Ripasso dopo');
                const bSi = document.getElementById('urv-si'); if (bSi) bSi.textContent = T('La so!');
                const bBack = document.getElementById('urv-back');
                if (bBack) bBack.innerHTML = '<svg class="ums-ic" aria-hidden="true"><use href="#ic-x"/></svg> ' + T("Torna all'elenco");
                const dTitle = urvDone ? urvDone.querySelector('h3') : null;
                if (dTitle) dTitle.textContent = T('Ripasso completato!');
                const dBack = document.getElementById('urv-done-back');
                if (dBack) dBack.textContent = T("Torna all'elenco");
            }
            const fcOpen = () => {
                document.body.classList.add('ums-noscroll');
                fcApplicaTraduzioni(); fcRenderHub();
                fcOverlay.classList.add('show'); fcClose.focus();
            };
            // Apertura programmatica dell'hub: usata dall'arrivo da "Ripassa"
            // della home. Apre il POP-UP (stessa esperienza del pulsante Ripasso)
            // e, se richiesto, fa partire subito il FALDONE della materia indicata.
            window.umsApriHubRipasso = function (mat, soloSbagliate) {
                fcOpen();
                if (mat) fcAvviaRipassoMateria(mat, !!soloSbagliate);
            };
            const fcCloseFn = () => { if (stage.classList.contains('on')) urvChiudiStage(); fcOverlay.classList.remove('show'); document.body.classList.remove('ums-noscroll'); fcBtn.focus(); };
            document.getElementById('ums-fc-login').addEventListener('click', () => { fcCloseFn(); open(); });
            fcBtn.addEventListener('click', fcOpen);
            fcClose.addEventListener('click', fcCloseFn);
            fcOverlay.addEventListener('click', (e) => { if (e.target === fcOverlay) fcCloseFn(); });
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && fcOverlay.classList.contains('show')) fcCloseFn(); });

            if (typeof srAggiornaBadge === 'function') srAggiornaBadge();
        })();
    

// ====================================================================
// SEZIONE 8 — ex <script id="ums-brand-title-script">
// ====================================================================
        (function () {
            const t = document.getElementById('dyn-title');
            if (!t) return;

            const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

            const format = () => {
                // già formattato → non toccare (evita loop con l'observer
                // e lascia in pace Google Translate che muta i nodi interni)
                if (t.firstElementChild && t.firstElementChild.classList.contains('ums-title-l1')) return;
                const txt = t.textContent.replace(/\s+/g, ' ').trim();
                if (!txt) return;

                // Punto di taglio: nomi corti → prima parola (STORIA /
                // dell'Educazione); titoli lunghi (es. nomi di lezione)
                // → spazio più vicino al centro, righe bilanciate.
                let cut = txt.indexOf(' ');
                if (cut >= 0 && txt.length > 26) {
                    const mid = txt.length / 2;
                    let best = -1, bestDist = Infinity;
                    for (let j = txt.indexOf(' '); j !== -1; j = txt.indexOf(' ', j + 1)) {
                        const dist = Math.abs(j - mid);
                        if (dist < bestDist) { bestDist = dist; best = j; }
                    }
                    cut = best;
                }

                if (cut < 0) {
                    t.innerHTML = '<span class="ums-title-l1">' + esc(txt) + '</span>';
                } else {
                    t.innerHTML =
                        '<span class="ums-title-l1">' + esc(txt.slice(0, cut)) + '</span>' +
                        '<span class="ums-title-l2">' + esc(txt.slice(cut + 1)) + '</span>';
                }
            };

            format(); // stato iniziale ("Caricamento…")
            if ('MutationObserver' in window) {
                new MutationObserver(format).observe(t, { childList: true, characterData: true, subtree: true });
            }
        })();
    

// ====================================================================
// SEZIONE 9 — ex <script id="ums-fixups-script">
// ====================================================================
        (function () {
            // 1) Porta il disclaimer nel body (dentro l'header fisso ne
            //    gonfiava l'altezza al cambio lingua) e aggiungi la ✕.
            const disc = document.getElementById('translation-disclaimer');
            if (disc && disc.parentElement !== document.body) {
                document.body.appendChild(disc);
                const x = document.createElement('button');
                x.className = 'ums-disc-x';
                x.type = 'button';
                x.setAttribute('aria-label', 'Chiudi avviso traduzione');
                x.innerHTML = '&#10005;';
                x.addEventListener('click', () => disc.classList.add('ums-dismissed'));
                disc.appendChild(x);
            }

            // 2) Esc chiude il modale Wikipedia/Accadde Oggi
            document.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape') return;
                const m = document.getElementById('factor-modal');
                if (m && m.classList.contains('open')) m.classList.remove('open');
            });
        })();
    

// ====================================================================
// SEZIONE 10 — ex <script id="ums-confirm-script">
// ====================================================================
        (function () {
            const ov = document.createElement('div');
            ov.id = 'ums-confirm-overlay';
            ov.setAttribute('role', 'alertdialog');
            ov.setAttribute('aria-modal', 'true');
            ov.innerHTML =
                '<div class="ums-access-card ums-confirm-card">' +
                    '<div class="ums-access-logo notranslate" translate="no">' +
                        '<span class="ums-logo-l1">Demo</span>' +
                        '<span class="ums-logo-l2">Accessibilità</span>' +
                    '</div>' +
                    '<h3 class="ums-access-h" id="ums-confirm-title"></h3>' +
                    '<p class="ums-access-p" id="ums-confirm-msg"></p>' +
                    '<button class="ums-access-btn primary" id="ums-confirm-ok" type="button"></button>' +
                    '<div style="height:10px"></div>' +
                    '<button class="ums-access-btn" id="ums-confirm-cancel" type="button"></button>' +
                '</div>';
            document.body.appendChild(ov);
            const t = document.getElementById('ums-confirm-title');
            const m = document.getElementById('ums-confirm-msg');
            const ok = document.getElementById('ums-confirm-ok');
            const no = document.getElementById('ums-confirm-cancel');
            let risolvi = null;
            function chiudi(esito) {
                ov.classList.remove('show');
                document.removeEventListener('keydown', suEsc);
                if (risolvi) { const r = risolvi; risolvi = null; r(esito); }
            }
            function suEsc(e) { if (e.key === 'Escape') chiudi(false); }
            ok.addEventListener('click', () => chiudi(true));
            no.addEventListener('click', () => chiudi(false));
            ov.addEventListener('click', (e) => { if (e.target === ov) chiudi(false); });
            window.umsConfirm = function (opz) {
                opz = opz || {};
                t.textContent = opz.title || 'Sei sicuro?';
                m.textContent = opz.message || '';
                m.style.display = opz.message ? '' : 'none';
                ok.textContent = opz.okText || 'Conferma';
                no.textContent = opz.cancelText || 'Annulla';
                ok.classList.toggle('danger', !!opz.danger);
                ov.classList.add('show');
                document.addEventListener('keydown', suEsc);
                try { no.focus(); } catch (e) {}
                return new Promise(res => { risolvi = res; });
            };
        })();
    

// ====================================================================
// SEZIONE 11 — ex <script id="ums-sostieni-script">
// ====================================================================
    (function () {
        // ⚠️ CONTROLLA: dev'essere il tuo indirizzo Buy Me a Coffee.
        const BMC_UTENTE = '';
        const BMC_MEMBERSHIP = '' + BMC_UTENTE + '/membership';
        const T = function (x) { return (window.umsT ? window.umsT(x) : x); };

        const SCRITTE = ['Sostieni il progetto'];
        const btn = document.getElementById('ums-sostieni');
        const label = document.getElementById('ums-sostieni-label');

        // Larghezza fissa: è la SCRITTA che si adatta al pulsante, non viceversa.
        const FONT_MAX = 0.82, FONT_MIN = 0.60;
        function adattaScritta() {
            if (!btn || !label) return;
            const st = getComputedStyle(btn);
            const disponibile = btn.clientWidth
                - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight) - 17 - 10 - 2;
            let fs = FONT_MAX;
            label.style.fontSize = fs + 'rem';
            while (label.scrollWidth > disponibile && fs > FONT_MIN) {
                fs = Math.round((fs - 0.01) * 100) / 100;
                label.style.fontSize = fs + 'rem';
            }
            label.style.letterSpacing = (fs < 0.72) ? '.06em' : '.12em';
        }

        if (btn && label) {
            let i = Math.floor(Math.random() * SCRITTE.length);
            label.textContent = T(SCRITTE[i]);
            adattaScritta();
            if (document.fonts && document.fonts.ready) document.fonts.ready.then(adattaScritta);
            window.addEventListener('resize', adattaScritta);
            // Niente rotazione: una frase a caso per apertura, e resta quella.
        }

        const ov = document.createElement('div');
        ov.id = 'ums-bmc-overlay';
        ov.setAttribute('role', 'dialog');
        ov.setAttribute('aria-modal', 'true');
        ov.setAttribute('aria-label', 'Sostieni Demo Accessibilità');
        ov.innerHTML =
            '<div class="ums-bmc-card">' +
                '<button class="ums-bmc-close" type="button" aria-label="Chiudi">&#10005;</button>' +
                '<div class="ums-bmc-logo notranslate" translate="no">' +
                    '<span class="l1">Demo</span><span class="l2">Accessibilità</span>' +
                '</div>' +
                '<div class="ums-bmc-tag"><span>Il tuo compagno di studi</span></div>' +
                '<p class="ums-bmc-intro">Questo sito &egrave; <b>gratis</b>, e lo rester&agrave;: nessuna lezione dietro un abbonamento, niente riservato a chi paga. Chi sostiene <b>non compra un vantaggio</b> &mdash; tiene acceso il sito e, dalla seconda fascia in su, manda una parte della quota a <b>Still I Rise</b>, che apre scuole per bambini profughi e vulnerabili <a class="ums-sir-link" href="https://www.stillirise.org/" target="_blank" rel="noopener"><b>dove la scuola non c\'&egrave;</b></a>.</p>' +
                '<button class="ums-tier" type="button">' +
                    '<span class="ums-tier-top"><span class="ums-tier-nome">Un caff&egrave; al mese</span><span class="ums-tier-prezzo">1 &euro; / mese</span></span>' +
                    '<span class="ums-tier-desc">Copre le spese vive: dominio, server, le ore passate a scrivere lezioni e codice. Nulla di pi&ugrave;.</span>' +
                '</button>' +
                '<button class="ums-tier consigliato" type="button">' +
                    '<span class="ums-tier-badge">Il pi&ugrave; scelto</span>' +
                    '<span class="ums-tier-top"><span class="ums-tier-nome">Sostenitore</span><span class="ums-tier-prezzo">5 &euro; / mese</span></span>' +
                    '<span class="ums-tier-desc">Il <b>30%</b> va a Still I Rise. Mentre studi tu, studia anche chi questo diritto non ce l\'ha. Il corrispettivo di una colazione al mese.</span>' +
                '</button>' +
                '<button class="ums-tier" type="button">' +
                    '<span class="ums-tier-top"><span class="ums-tier-nome">Diritto allo studio</span><span class="ums-tier-prezzo">10 &euro; / mese</span></span>' +
                    '<span class="ums-tier-desc">Il <b>50%</b> va a Still I Rise. Non sblocchi niente: qui &egrave; gi&agrave; tutto gratis. <b>Sblocchi che lo sia anche altrove.</b></span>' +
                '</button>' +
                '<p class="ums-bmc-nota">Il pagamento avviene su Buy Me a Coffee, che si apre in una nuova scheda: la lezione resta aperta qui. Puoi disdire quando vuoi, con un clic.</p>' +
            '</div>';
        document.body.appendChild(ov);

        // ---- INTRO COL GATTO: piccolo al centro, cresce, nuvoletta col cuore,
        //      poi la carta dell'abbonamento. Un clic salta subito alla carta. ----
        // 4 gatti, ognuno con la posizione del muso (in %) per ancorare la
        // nuvoletta col cuore. musoX/musoY = centro del muso; codaRot = angolo
        // della codina del fumetto (verso il muso).
        const GATTI = [
            { uri:'img/gatto1.webp', musoX:56, musoY:25 },
            { uri:'img/gatto2.webp', musoX:20, musoY:44 },
            { uri:'img/gatto3.webp', musoX:60, musoY:18 },
            { uri:'img/gatto4.webp', musoX:50, musoY:16 }
        ];
        // stile dell'intro iniettato QUI dal js: un file solo porta tutto,
        // così non può mai succedere che il codice ci sia e lo stile no.
        if (!document.getElementById('ums-bmc-gatto-style')) {
            var stG = document.createElement('style');
            stG.id = 'ums-bmc-gatto-style';
            stG.textContent = "#ums-bmc-overlay .ums-bmc-gatto{ display:none; }\n#ums-bmc-overlay.gatto-in .ums-bmc-gatto{ display:flex; align-items:center; justify-content:center; position:absolute; inset:0; cursor:pointer; z-index:2; }\n#ums-bmc-overlay.gatto-in .ums-bmc-card{ display:none !important; }\n.ums-bmc-gatto .gatto-wrap{ position:relative; }\n.ums-bmc-gatto img{ display:block; user-select:none; -webkit-user-drag:none; filter: drop-shadow(0 20px 44px rgba(0,0,0,.38)); max-height:74vh; max-width:86vw; width:auto; height:auto; }\n/* gatto invisibile mentre l'immagine si carica: niente lampi */\n.ums-bmc-gatto.gatto-carica{ opacity:0; }\n/* le animazioni partono con 'gatto-anima' (messa dal JS quando il gatto è pronto) */\n.ums-bmc-gatto.gatto-anima .gatto-wrap{ animation: umsGattoCresce 2.2s cubic-bezier(.22,.9,.3,1) both; transform-origin:center center; }\n@keyframes umsGattoCresce{ from{ transform:scale(.12); opacity:0; } 25%{ opacity:1; } to{ transform:scale(1); opacity:1; } }\n.gatto-fumetto{ position:absolute; left:var(--muso-x,50%); top:var(--muso-y,20%); width:76px; height:64px; background:#fff; border-radius:50%;\n  display:flex; align-items:center; justify-content:center; box-shadow:0 8px 22px rgba(0,0,0,.28);\n  opacity:0; transform:translate(-50%,-135%) scale(0); transform-origin:30% 130%; }\n.gatto-fumetto::after{ content:''; position:absolute; bottom:-10px; left:50%; margin-left:-8px; width:0; height:0;\n  border:10px solid transparent; border-top-color:#fff; border-bottom:0; }\n.ums-bmc-gatto.gatto-anima .gatto-fumetto{ animation: umsFumettoPop .5s cubic-bezier(.34,1.56,.64,1) 2.35s both; }\n@keyframes umsFumettoPop{ from{ opacity:0; transform:translate(-50%,-135%) scale(0);} to{ opacity:1; transform:translate(-50%,-135%) scale(1);} }\n.gatto-fumetto svg{ width:30px; height:auto; display:block; }\n.ums-bmc-gatto.gatto-anima .gatto-fumetto svg{ animation: umsCuoreBatte 1.1s ease-in-out 2.95s infinite; }\n@keyframes umsCuoreBatte{ 0%,100%{ transform:scale(1);} 50%{ transform:scale(1.22);} }\n@media (max-width:480px){ .gatto-fumetto{ width:60px; height:50px; } .gatto-fumetto svg{ width:24px; } }\n@media (prefers-reduced-motion: reduce){ .ums-bmc-gatto.gatto-anima .gatto-wrap, .ums-bmc-gatto.gatto-anima .gatto-fumetto, .gatto-fumetto svg{ animation:none !important; opacity:1; transform:translate(-50%,-135%); } }";
            document.head.appendChild(stG);
        }
        const gattoBox = document.createElement('div');
        gattoBox.className = 'ums-bmc-gatto';
        gattoBox.innerHTML =
            '<div class="gatto-wrap">' +
                '<img alt="" draggable="false">' +
                '<div class="gatto-fumetto" aria-hidden="true">' +
                    '<svg viewBox="0 0 32 29"><path d="M23.6 0c-3.4 0-6.4 2.2-7.6 5.3C14.8 2.2 11.8 0 8.4 0 3.8 0 0 3.8 0 8.4c0 9.3 16 20.6 16 20.6s16-11.3 16-20.6C32 3.8 28.2 0 23.6 0z" fill="#e0245e"/></svg>' +
                '</div>' +
            '</div>';
        ov.appendChild(gattoBox);
        const gattoImg = gattoBox.querySelector('img');
        let gattoOk = null;           // null = non ancora provato, true/false dopo
        let timerCard = null;
        const vaiAllaCard = function () {
            clearTimeout(timerCard); timerCard = null;
            ov.classList.remove('gatto-in');
            gattoBox.classList.remove('gatto-anima', 'gatto-carica');
            try { ov.querySelector('.ums-bmc-close').focus(); } catch (e) {}
        };
        gattoBox.addEventListener('click', vaiAllaCard);

        const chiudi = function () {
            clearTimeout(timerCard); timerCard = null;
            ov.classList.remove('show', 'gatto-in');
            gattoBox.classList.remove('gatto-anima', 'gatto-carica');
            document.body.classList.remove('ums-noscroll');
            document.removeEventListener('keydown', suEsc);
            if (btn) btn.focus();
        };
        const suEsc = function (e) { if (e.key === 'Escape') chiudi(); };
        var fumetto = gattoBox.querySelector('.gatto-fumetto');
        const partiIntro = function () {
            // riavvio le animazioni CSS SENZA togliere 'gatto-in' (che nasconde la
            // scheda): tolgo/rimetto una classe solo sul gatto, così la scheda non
            // ricompare mai per errore. 'gatto-in' resta sempre attivo qui.
            ov.classList.add('gatto-in');
            gattoBox.classList.remove('gatto-anima');
            void gattoBox.offsetWidth;            // forza il reflow → l'animazione riparte
            gattoBox.classList.add('gatto-anima');
            clearTimeout(timerCard);
            timerCard = setTimeout(vaiAllaCard, 4400);
        };
        const apri = function () {
            ov.classList.add('show');
            document.body.classList.add('ums-noscroll');
            document.addEventListener('keydown', suEsc);
            var riduci = false;
            try { riduci = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
            // il gatto fa parte del pop-up: quando il pop-up si apre, c'è sempre
            // (la rarità "1 volta su 4" è gestita da chi apre il pop-up, non qui)
            if (riduci || gattoOk === false) {
                ov.classList.remove('gatto-in');
                ov.querySelector('.ums-bmc-close').focus();
                return;
            }
            // scelgo un gatto A CASO e ancoro la nuvoletta al SUO muso
            var g = GATTI[Math.floor(Math.random() * GATTI.length)];
            fumetto.style.setProperty('--muso-x', g.musoX + '%');
            fumetto.style.setProperty('--muso-y', g.musoY + '%');
            // NASCONDO SUBITO la scheda: metto già 'gatto-in' prima ancora di
            // caricare l'immagine, così non c'è nessun lampo della scheda mentre
            // il gatto arriva. Il gatto è invisibile finché l'immagine non è pronta.
            ov.classList.add('gatto-in');
            gattoBox.classList.add('gatto-carica');   // gatto nascosto durante il caricamento
            gattoImg.onload = function () {
                gattoOk = true;
                gattoBox.classList.remove('gatto-carica');
                partiIntro();
            };
            gattoImg.onerror = function () { gattoOk = false; vaiAllaCard(); };
            gattoImg.src = g.uri;
            if (gattoImg.complete && gattoImg.naturalWidth) {
                gattoOk = true;
                gattoBox.classList.remove('gatto-carica');
                partiIntro();
            }
        };
        if (btn) btn.addEventListener('click', apri);
        ov.querySelector('.ums-bmc-close').addEventListener('click', chiudi);
        ov.addEventListener('click', function (e) { if (e.target === ov) chiudi(); });
        ov.querySelectorAll('.ums-tier').forEach(function (t) {
            t.addEventListener('click', function () {
                window.open(BMC_MEMBERSHIP, '_blank', 'noopener');
                chiudi();
            });
        });
        window.umsApriSostegno = function () {};
    })();
    

// ====================================================================
// SEZIONE 12 — ex <script id="ums-ritocchi-script">
// ====================================================================
    (function () {
        // La lavagna si apre da sola alla prima sottolineatura
        const orig = window.wbAddEntry;
        if (typeof orig === 'function') {
            window.wbAddEntry = function (t, c, id) {
                const r = orig(t, c, id);
                try { wbMaximize(); } catch (e) {}
                return r;
            };
        }

        // Chip "Lavagna": compare quando la lavagna è aperta ma fuori schermo
        const wb = document.getElementById('smart-whiteboard');
        if (!wb || !('IntersectionObserver' in window)) return;
        const chip = document.createElement('button');
        chip.id = 'ums-wb-chip';
        chip.type = 'button';
        chip.setAttribute('aria-label', 'Vai alla Lavagna Concetti');
        chip.innerHTML = '<svg class="ums-ic" aria-hidden="true"><use href="#ic-pen"/></svg> ' + (window.umsT ? window.umsT('Lavagna') : 'Lavagna');
        document.body.appendChild(chip);
        chip.addEventListener('click', function () {
            wb.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        let inVista = false;
        const pannello = wb.closest('.accordion-content');
        function aggiorna() {
            const lezioneAperta = document.body.classList.contains('ums-master-open');
            const sezioneAperta = pannello ? pannello.classList.contains('active') : false;
            const haConcetti = !!wb.querySelector('.wb-row');
            chip.classList.toggle('show',
                lezioneAperta && sezioneAperta && haConcetti && !inVista);
        }
        new IntersectionObserver(function (voci) {
            inVista = voci[0].isIntersecting;
            aggiorna();
        }, { threshold: 0.05 }).observe(wb);
        new MutationObserver(aggiorna).observe(wb, { attributes: true, attributeFilter: ['class'] });
        const corpoWb = document.getElementById('wb-body');
        if (corpoWb) new MutationObserver(aggiorna).observe(corpoWb, { childList: true });
        if (pannello) new MutationObserver(aggiorna).observe(pannello, { attributes: true, attributeFilter: ['class'] });
        new MutationObserver(aggiorna).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    })();

    // ---- GIOCA A SCHERMO INTERO (mobile) ----
    // Il pannello del gioco viene SPOSTATO (non clonato) dentro l'overlay:
    // listener, stato della partita e traduzioni restano vivi. Alla chiusura
    // torna esattamente da dove è partito, con la partita in corso.
    (function () {
        const NOMI = { words: 'Cerca le Parole', sudoku: 'Sudoku', sol: 'Solitario' };
        const PANNELLI = { words: 'ws-game', sudoku: 'sd-game', sol: 'sol-game' };
        const T = function (x) { return (window.umsT ? window.umsT(x) : x); };

        const ov = document.createElement('div');
        ov.id = 'ums-game-overlay';
        ov.innerHTML =
            '<div class="ums-game-top">' +
                '<span class="ums-game-titolo" id="ums-game-titolo"></span>' +
                '<button class="ums-game-close" type="button" aria-label="Chiudi il gioco">&#10005;</button>' +
            '</div>' +
            '<div class="ums-game-body" id="ums-game-body"></div>';
        document.body.appendChild(ov);
        const corpo = document.getElementById('ums-game-body');
        const titolo = document.getElementById('ums-game-titolo');
        let segnaposto = null, pannelloAperto = null;

        window.umsGiocaApri = function (gioco) {
            const pannello = document.getElementById(PANNELLI[gioco]);
            if (!pannello) return;
            if (typeof pausaSetGame === 'function') pausaSetGame(gioco); // inizializza la partita se serve
            segnaposto = document.createComment('ums-gioco');
            pannello.parentNode.insertBefore(segnaposto, pannello);
            corpo.appendChild(pannello);
            pannelloAperto = pannello;
            titolo.textContent = T(NOMI[gioco]);
            document.body.classList.add('ums-game-open');
            corpo.scrollTop = 0;
        };
        function chiudi() {
            if (pannelloAperto && segnaposto && segnaposto.parentNode) {
                segnaposto.parentNode.insertBefore(pannelloAperto, segnaposto);
                segnaposto.remove();
            }
            pannelloAperto = null; segnaposto = null;
            document.body.classList.remove('ums-game-open');
        }
        ov.querySelector('.ums-game-close').addEventListener('click', chiudi);
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && document.body.classList.contains('ums-game-open')) chiudi();
        });
    })();
    

// ====================================================================
// SEZIONE 13 — ex <script id="blocco-anonimo">
// ====================================================================
    // KEN BURNS (variante VI) — su touch, il tocco attiva/disattiva
    // lo zoom lento e il velo (equivalente dell'hover su desktop).
    // Delega sull'intero documento: copre anche le card create dinamicamente.
    (function () {
        document.addEventListener('touchstart', function (e) {
            var el = e.target.closest('[data-kenburns], .flashcard-wrapper, .urv-wrapper');
            if (el) el.classList.toggle('kb-hover');
        }, { passive: true });
    })();
    

// ====================================================================
// SEZIONE 14 — ex <script id="ums-hub-ritocchi-script">
// ====================================================================
    (function () {
        // Tap sulla topbar = torna in cima. Il titolo migrato è un elemento
        // FISSO che sta sopra la barra: i click atterrano su di lui, non su
        // #ums-topbar — quindi a lezione aperta ascoltiamo anche l'header.
        document.addEventListener('click', function (e) {
            var sopra = e.target.closest('#ums-topbar') ||
                (document.body.classList.contains('ums-master-open') && e.target.closest('header'));
            if (!sopra || e.target.closest('button, a, input, select')) return;
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        // ---- pop-up "Come si gioca" (brandizzato, logo centrato) ----
        var T = function (x) { return (window.umsT ? window.umsT(x) : x); };
        var INFO = {
            sudoku: {
                nome: 'Sudoku',
                testo: "Riempi la griglia in modo che ogni riga, ogni colonna e ogni riquadro 3\u00d73 contengano tutti i numeri da 1 a 9, senza ripetizioni. I numeri in grassetto sono gli indizi fissi di partenza: tocca una casella vuota e scegli un numero dal tastierino (o dalla tastiera fisica). Durante la partita nessun aiuto: quando avrai riempito l'ultima casella, il gioco ti dir\u00e0 se la soluzione \u00e8 corretta oppure evidenzier\u00e0 in terracotta le caselle in conflitto da correggere. Non serve indovinare: ogni schema ha una sola soluzione, raggiungibile con la logica."
            },
            sol: {
                nome: 'Solitario',
                testo: "L'obiettivo \u00e8 portare tutte le carte nelle quattro basi in alto, una per seme, in ordine crescente dall'Asso al Re. Sulle sette colonne del tavolo le carte si impilano in ordine decrescente e dello stesso seme; una colonna vuota accetta qualsiasi carta. Tocca il mazzo in alto a sinistra per pescare una carta; quando il mazzo finisce, un altro tocco lo rigira. Le carte coperte si scoprono da sole quando restano in cima alla loro colonna. Trascina una carta, o una pila gi\u00e0 ordinata, sulla destinazione: se la mossa \u00e8 valida, la casella si illumina d'oro."
            }
        };
        var ov = document.createElement('div');
        ov.id = 'ums-info-overlay';
        ov.setAttribute('role', 'dialog');
        ov.setAttribute('aria-modal', 'true');
        ov.innerHTML =
            '<div class="ums-bmc-card">' +
                '<button class="ums-bmc-close" type="button" aria-label="Chiudi">&#10005;</button>' +
                '<div class="ums-bmc-logo notranslate" translate="no"><span class="l1">Demo</span><span class="l2">Accessibilità</span></div>' +
                '<div class="ums-bmc-tag"><span>Il tuo compagno di studi</span></div>' +
                '<div class="ums-info-titolo" id="ums-info-titolo"></div>' +
                '<p class="ums-bmc-intro" id="ums-info-testo"></p>' +
            '</div>';
        document.body.appendChild(ov);
        var chiudi = function () {
            ov.classList.remove('show');
            document.removeEventListener('keydown', suEsc);
        };
        var suEsc = function (e) { if (e.key === 'Escape') chiudi(); };
        window.umsInfoApri = function (gioco) {
            var info = INFO[gioco];
            if (!info) return;
            document.getElementById('ums-info-titolo').textContent = T('Come si gioca') + ' \u2014 ' + T(info.nome);
            document.getElementById('ums-info-testo').textContent = T(info.testo);
            ov.classList.add('show');
            document.addEventListener('keydown', suEsc);
            ov.querySelector('.ums-bmc-close').focus();
        };
        ov.querySelector('.ums-bmc-close').addEventListener('click', chiudi);
        ov.addEventListener('click', function (e) { if (e.target === ov) chiudi(); });
    })();

/* ====================================================================
   PALLINO "1" SUL GRUPPO CHAT — solo per chi non ha la chiave.
   L'icona e' gia' un link al gruppo: un clic e ci sei.
   ==================================================================== */
(function () {
    function aggiorna() {
        var b = document.getElementById('ums-wa-badge');
        if (!b) return;
        var dentro = false;
        try { dentro = !!localStorage.getItem('ums_chiave'); } catch (e) {}
        b.hidden = dentro;
    }
    window.umsWaBadge = aggiorna;
    function avvia() { aggiorna(); setTimeout(aggiorna, 600); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia);
    else avvia();
    window.addEventListener('storage', aggiorna);
})();

// ====================================================================
// SEZIONE 17 — LETTURA FACILITATA ("Leggi meglio", pensata per DSA)
// Un pulsante "Aa" fisso sopra quello della notte. Acceso → classe
// ums-facile sul body (tutto il resto lo fa ums.css, SEZIONE 17).
// La scelta si ricorda come la modalità notte. Nessuna funzione
// esistente viene toccata: il blocco è additivo.
// ====================================================================
// CONTRASTO ELEVATO — ripristina la scelta salvata e, se l'utente ha
// impostato "più contrasto" nel sistema, lo attiva da solo. Non tocca
// nulla per chi non ne ha bisogno.
// ====================================================================
(function () {
    function applicaContrasto(on) {
        document.body.classList.toggle('ums-contrasto', on);
    }
    var salvato = null;
    try { salvato = localStorage.getItem('ums_contrasto'); } catch (e) {}
    if (salvato === '1') {
        applicaContrasto(true);
    } else if (salvato === null) {
        // nessuna scelta esplicita: seguo la preferenza del sistema operativo
        try {
            if (window.matchMedia && window.matchMedia('(prefers-contrast: more)').matches) {
                applicaContrasto(true);
            }
        } catch (e) {}
    }
})();

// ====================================================================
(function () {
    var CHIAVE = 'ums_lettura_facile';
    var FONT_ID = 'ums-font-facile';
    var FONT_URL = 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400;1,700&display=swap';

    function caricaFont() {
        if (document.getElementById(FONT_ID)) return;
        var l = document.createElement('link');
        l.id = FONT_ID; l.rel = 'stylesheet'; l.href = FONT_URL;
        document.head.appendChild(l);
    }

    function applica(on, btn) {
        document.body.classList.toggle('ums-facile', on);
        if (on) caricaFont();
        if (btn) {
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            btn.setAttribute('aria-label', on ? 'Disattiva lettura facilitata' : 'Attiva lettura facilitata');
            btn.title = on ? 'Lettura facilitata: accesa' : 'Leggi meglio (lettura facilitata)';
        }
        // la carta di Dritti al Sodo cambia forma: riallinea l'altezza
        try { if (typeof fcAdattaAltezza === 'function') fcAdattaAltezza(); } catch (e) {}
    }

    function avvia() {
        if (document.getElementById('ums-facile-btn')) return;
        var btn = document.createElement('button');
        btn.id = 'ums-facile-btn';
        btn.type = 'button';
        btn.textContent = 'Aa';
        btn.classList.add('notranslate'); btn.setAttribute('translate', 'no');   // per Google "Aa" era un automobile club
        document.body.appendChild(btn);

        var salvato = false;
        try { salvato = localStorage.getItem(CHIAVE) === '1'; } catch (e) {}
        applica(salvato, btn);

        btn.addEventListener('click', function () {
            var on = !document.body.classList.contains('ums-facile');
            applica(on, btn);
            try { localStorage.setItem(CHIAVE, on ? '1' : '0'); } catch (e) {}
        });

        // Su telefono il pulsante "gira" apre normalmente la risposta in un
        // pannello a parte. In lettura facilitata la risposta compare invece
        // sotto la domanda: intercettiamo il tocco prima del gestore originale
        // e giriamo la carta come su PC. A modalità spenta non succede nulla.
        document.addEventListener('click', function (e) {
            if (!document.body.classList.contains('ums-facile')) return;
            var b = e.target && e.target.closest ? e.target.closest('.btn-flip-mobile') : null;
            if (!b) return;
            e.stopPropagation(); e.stopImmediatePropagation(); e.preventDefault();
            var deck = document.getElementById('flashcard-deck');
            if (deck) deck.classList.toggle('flipped');
        }, true);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia);
    else avvia();
})();


// ====================================================================
// SEZIONE 18 — UN PARAGRAFO ALLA VOLTA (riassuntone, con "Aa" acceso)
// Mostra un solo blocco del riassuntone (titolo, paragrafo o check point);
// tutto il resto è nascosto — come il lettore "Ascolta il riassuntone".
// Si avanza con Avanti/Indietro o con ← → (↑ ↓ restano liberi per
// scorrere la pagina), Esc esce. Nessuna misura geometrica: solo una
// classe che nasconde. Blocco additivo: non tocca funzioni esistenti.
// ====================================================================
(function () {
    var TUT_KEY = 'ums_paragrafo_tutorial_visto';
    var attiva = false, idx = 0;
    var btn, nav, tut, contatore;

    function cont() { return document.getElementById('dyn-riassuntone-container'); }

    // i blocchi che si possono "sfogliare": figli diretti con del testo, niente slide/figure
    function blocchi() {
        var c = cont(); if (!c) return [];
        var out = [];
        for (var i = 0; i < c.children.length; i++) {
            var el = c.children[i];
            var tag = el.tagName;
            if (tag === 'FIGURE' || tag === 'IMG' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'BUTTON') continue;
            if (!el.textContent || !el.textContent.trim()) continue;
            if (el.querySelector && el.querySelector('img, figure') && !el.querySelector('p, li')) continue;
            out.push(el);
        }
        return out;
    }

    function applica(scorri) {
        var c = cont(); if (!c) return;
        var bl = blocchi();
        if (!bl.length) return;
        if (idx >= bl.length) idx = bl.length - 1;
        if (idx < 0) idx = 0;
        var cur = bl[idx];
        // il titolo del macroargomento resta visibile sopra il paragrafo
        var titolo = null;
        for (var k = idx; k >= 0; k--) { if (bl[k].tagName === 'H3') { titolo = bl[k]; break; } }
        for (var i = 0; i < c.children.length; i++) {
            var el = c.children[i];
            var vis = (el === cur || el === titolo);
            el.classList.toggle('ums-para-nascosto', !vis);
        }
        if (contatore) contatore.textContent = (idx + 1) + ' / ' + bl.length;
        if (nav) {
            nav.querySelector('.ums-para-prev').disabled = (idx === 0);
            nav.querySelector('.ums-para-next').disabled = (idx === bl.length - 1);
        }
        if (scorri) {
            // niente scatti: si scorre SOLO se l'inizio del paragrafo non è
            // già comodo in vista, e lo si porta sotto la barra in alto —
            // mai a filo schermo (dove finirebbe nascosto dalla barra)
            try {
                var anc = (titolo || cur);
                var r = anc.getBoundingClientRect();
                var barra = document.getElementById('ums-topbar');
                var sopra = (barra ? barra.offsetHeight : 64) + 26;
                if (r.top < sopra - 8 || r.top > window.innerHeight * 0.45) {
                    window.scrollTo({ top: r.top + window.scrollY - sopra, behavior: 'smooth' });
                }
            } catch (e) {}
        }
    }

    function primoVisibile() {
        var bl = blocchi();
        for (var i = 0; i < bl.length; i++) {
            var r = bl[i].getBoundingClientRect();
            if (r.bottom > 80 && r.top < window.innerHeight * 0.7) return i;
        }
        return 0;
    }

    function accendi() {
        if (!blocchi().length) return;
        attiva = true; idx = primoVisibile();
        document.body.classList.add('ums-para-on');
        btn.setAttribute('aria-pressed', 'true');
        if (nav) nav.style.display = 'flex';
        applica(true);
    }
    function spegni() {
        attiva = false;
        document.body.classList.remove('ums-para-on');
        var c = cont();
        if (c) for (var i = 0; i < c.children.length; i++) c.children[i].classList.remove('ums-para-nascosto');
        if (btn) btn.setAttribute('aria-pressed', 'false');
        if (nav) nav.style.display = 'none';
    }
    function vai(d) {
        if (!attiva) return;
        var n = blocchi().length;
        var nuovo = Math.min(n - 1, Math.max(0, idx + d));
        if (nuovo === idx) return;
        idx = nuovo; applica(true);
    }

    // ---- tutorial ----
    function apriTutorial(poi) {
        tut.classList.add('aperto'); tut.dataset.poi = poi ? '1' : '0';
        var ok = tut.querySelector('.ums-riga-tut-ok'); if (ok) ok.focus();
    }
    function chiudiTutorial() {
        tut.classList.remove('aperto');
        try { localStorage.setItem(TUT_KEY, '1'); } catch (e) {}
        if (tut.dataset.poi === '1') accendi();
        tut.dataset.poi = '0';
    }

    function costruisci() {
        var c = cont(); if (!c || !c.parentNode) return;
        if (document.getElementById('ums-para-btn')) return;

        btn = document.createElement('button');
        btn.id = 'ums-para-btn'; btn.type = 'button';
        btn.setAttribute('aria-pressed', 'false');
        btn.innerHTML = '<span>Un paragrafo alla volta</span><span class="ums-para-help" title="Come funziona" aria-label="Come funziona">?</span>';
        c.parentNode.insertBefore(btn, c);

        nav = document.createElement('div');
        nav.id = 'ums-para-nav'; nav.style.display = 'none';
        nav.innerHTML =
            '<button type="button" class="ums-para-prev">&larr; Indietro</button>' +
            '<span class="ums-para-conta"></span>' +
            '<button type="button" class="ums-para-next">Avanti &rarr;</button>';
        contatore = nav.querySelector('.ums-para-conta');
        if (c.nextSibling) c.parentNode.insertBefore(nav, c.nextSibling); else c.parentNode.appendChild(nav);

        tut = document.createElement('div');
        tut.id = 'ums-para-tut'; tut.setAttribute('role', 'dialog'); tut.setAttribute('aria-modal', 'true');
        tut.innerHTML =
            '<div class="ums-riga-tut-card">' +
            '<h3>Un paragrafo alla volta</h3>' +
            '<ol>' +
            '<li>Vedi un solo paragrafo. Gli altri sono nascosti.</li>' +
            '<li>Premi <kbd>Avanti</kbd> (o la freccia <kbd>&rarr;</kbd>) per leggere il paragrafo dopo.</li>' +
            '<li>Premi <kbd>Indietro</kbd> (o la freccia <kbd>&larr;</kbd>) per tornare a quello prima.</li>' +
            '<li>Premi di nuovo il pulsante, o <kbd>Esc</kbd>, per vedere tutto il testo.</li>' +
            '</ol>' +
            '<button type="button" class="ums-riga-tut-ok">Ho capito</button>' +
            '</div>';
        document.body.appendChild(tut);
        tut.querySelector('.ums-riga-tut-ok').addEventListener('click', chiudiTutorial);
        tut.addEventListener('click', function (e) { if (e.target === tut) chiudiTutorial(); });

        btn.addEventListener('click', function (e) {
            if (e.target.closest('.ums-para-help')) { apriTutorial(false); return; }
            if (attiva) { spegni(); return; }
            var visto = false;
            try { visto = localStorage.getItem(TUT_KEY) === '1'; } catch (err) {}
            if (!visto) apriTutorial(true); else accendi();
        });
        nav.querySelector('.ums-para-prev').addEventListener('click', function () { vai(-1); });
        nav.querySelector('.ums-para-next').addEventListener('click', function () { vai(1); });

        document.addEventListener('keydown', function (e) {
            if (tut.classList.contains('aperto')) {
                if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); chiudiTutorial(); }
                return;
            }
            if (!attiva) return;
            var t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            // se un pop-up è aperto (slide ingrandita, mappa, sostegno, mappa
            // per l'esame, punti chiave) o il lettore vocale sta leggendo,
            // le frecce restano a loro: niente conflitti
            if (document.querySelector('.ums-slide-lb.on, #ums-mappa-overlay.show, #ums-bmc-overlay.show, #ums-esame-overlay.show, #factor-modal.open')) return;
            if (document.body.classList.contains('ums-read-on')) return;
            // ← → cambiano paragrafo; ↑ ↓ restano liberi per scorrere la pagina
            if (e.key === 'ArrowRight') { e.preventDefault(); vai(1); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); vai(-1); }
            else if (e.key === 'Escape') { spegni(); }
        });

        if ('MutationObserver' in window) {
            // (rimosso il vincolo che spegneva "un paragrafo" quando Aa era spento:
            //  ora la funzione è indipendente dalla lettura facilitata)
            // il riassuntone viene riscritto (cambio vista / lezione) → riapplica sullo stesso numero
            new MutationObserver(function (ms) {
                if (!attiva) return;
                for (var i = 0; i < ms.length; i++) {
                    if (ms[i].type === 'childList') {
                        clearTimeout(window.__umsParaT);
                        window.__umsParaT = setTimeout(function () { applica(false); }, 120);
                        return;
                    }
                }
            }).observe(c, { childList: true });
            // SINCRONIA col lettore "Ascolta il riassuntone": se sono accesi
            // INSIEME, le frecce comandano il lettore (che è più in primo
            // piano) e il paragrafo visibile LO SEGUE: il blocco evidenziato
            // dal lettore (.ums-lb-cur) diventa il paragrafo mostrato.
            new MutationObserver(function () {
                if (!attiva || !document.body.classList.contains('ums-read-on')) return;
                var cur = c.querySelector('.ums-lb-cur');
                if (!cur) return;
                while (cur.parentNode && cur.parentNode !== c) cur = cur.parentNode; // figlio diretto
                var bl = blocchi();
                var k = bl.indexOf(cur);
                if (k >= 0 && k !== idx) { idx = k; applica(true); }
            }).observe(c, { attributes: true, attributeFilter: ['class'], subtree: true });
        }
    }

    function avvia() {
        costruisci();
        if (!document.getElementById('ums-para-btn')) setTimeout(costruisci, 1500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia);
    else avvia();
})();


// ====================================================================
// SEZIONE 19 — ACCESSIBILITÀ INVISIBILE (annunci per screen reader)
// Una "voce di servizio" (aria-live) che legge l'esito del quiz a chi
// usa uno screen reader. Nessun cambiamento visibile, nessuna funzione
// esistente toccata: il blocco ascolta i clic e annuncia dopo.
// ====================================================================
(function () {
    var live;
    function assicuraLive() {
        if (live) return live;
        live = document.createElement('div');
        live.id = 'ums-annuncio';
        live.className = 'ums-sr-only';
        live.setAttribute('aria-live', 'polite');
        live.setAttribute('role', 'status');
        document.body.appendChild(live);
        return live;
    }
    function annuncia(msg) {
        var l = assicuraLive();
        l.textContent = '';                    // reset: due esiti uguali di fila vanno riletti
        setTimeout(function () { l.textContent = msg; }, 50);
    }
    // Esc chiude il pop-up dei Punti Chiave (prima si chiudeva solo col mouse)
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        var m = document.getElementById('factor-modal');
        if (m && m.classList.contains('open')) m.classList.remove('open');
    });
    document.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('.quiz-option') : null;
        if (!b) return;
        // il gestore originale colora i pulsanti e mostra la spiegazione:
        // aspettiamo un attimo e leggiamo il risultato già pronto
        setTimeout(function () {
            var card = b.closest('.quiz-card, [id^="quiz-card-"]') || b.parentNode.parentNode;
            if (!card) return;
            var expl = card.querySelector('.quiz-explanation');
            if (expl && expl.textContent && expl.textContent.trim()) {
                annuncia(expl.textContent.trim());
            }
        }, 120);
    }, true);
})();


// ====================================================================
// SEZIONE 20 — INVITO AL SOSTEGNO (apre il pannello del caffè)
// Dopo 15 s dall'apertura della lezione mostra DIRETTAMENTE il pannello
// "Tienimi acceso" con le tre fasce e i prezzi (window.umsApriSostegno,
// SEZIONE 11): nessuna card intermedia, nessun doppione. Per ora a OGNI
// apertura (fase di prova: SEMPRE=true); poi 1 su UNA_SU. Additivo.
// ====================================================================
(function () {
    var SEMPRE = false;       // fase di prova finita: pop-up NON a ogni apertura
    var UNA_SU = 1e9;           // il pop-up (con gatto) compare 1 volta su 4
    var RITARDO_MS = 15000;
    var CONT_KEY = 'ums_aiuto_contatore';

    function tocca() {
        if (SEMPRE) return true;
        var n = 0;
        try { n = parseInt(localStorage.getItem(CONT_KEY) || '0', 10) || 0; } catch (e) {}
        n++;
        try { localStorage.setItem(CONT_KEY, String(n)); } catch (e) {}
        return n % UNA_SU === 0;
    }
    function mostra() {
        var ov = document.getElementById('ums-bmc-overlay');
        if (ov && ov.classList.contains('show')) return;   // già aperto a mano
        if (typeof window.umsApriSostegno === 'function') window.umsApriSostegno();
    }
    function avvia() {
        if (!tocca()) return;
        setTimeout(mostra, RITARDO_MS);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia);
    else avvia();
})();


// ====================================================================
// SEZIONE 21 — NAVIGAZIONE DA TASTIERA (standard, robusta)
// Problema risolto: prima il Tab entrava DENTRO le sezioni chiuse (Copia,
// note, Stampa...), servivano decine di Tab e Invio apriva "tutt'altro".
// Ora: ciò che sta in una sezione CHIUSA è tolto dal giro del Tab. Il Tab
// salta di titolo in titolo (01, 02, 03...); Invio/Spazio apre/chiude quella
// sezione; quando è aperta il suo contenuto entra nel giro; Maiusc+Tab
// torna indietro (comportamento nativo del browser). Niente scorciatoie
// strane. Additivo: non cambia le funzioni esistenti.
// ====================================================================
(function () {
    var TUT_KEY = 'ums_tastiera_tutorial_visto';
    var primoTab = true;

    // ---- 1) togli dal Tab tutto ciò che è dentro una sezione CHIUSA ----
    // (accordion-content senza .active, e master-content senza .active).
    // Si ripassa a ogni apertura/chiusura, così il giro del Tab resta pulito.
    function elementiFocalizzabili(root) {
        return root.querySelectorAll(
            'a[href], button, input, textarea, select, [tabindex], [contenteditable="true"]'
        );
    }
    function aggiornaTabIndex() {
        // pannello "Inizia": stato logico dal bottone (aria-expanded), non
        // dalla classe .active che cambia a metà animazione
        var masterBtn = document.getElementById('master-toggle-btn');
        var masterChiuso = masterBtn && masterBtn.getAttribute('aria-expanded') !== 'true';

        document.querySelectorAll('.accordion-content').forEach(function (panel) {
            var chiuso = !panel.classList.contains('active');
            elementiFocalizzabili(panel).forEach(function (el) {
                if (chiuso) {
                    if (el.getAttribute('data-ums-ti') === null) {
                        // salvo l'eventuale tabindex originale una volta sola
                        el.setAttribute('data-ums-ti', el.hasAttribute('tabindex') ? el.getAttribute('tabindex') : 'auto');
                    }
                    el.setAttribute('tabindex', '-1');
                } else {
                    var orig = el.getAttribute('data-ums-ti');
                    if (orig !== null) {
                        if (orig === 'auto') el.removeAttribute('tabindex');
                        else el.setAttribute('tabindex', orig);
                        el.removeAttribute('data-ums-ti');
                    }
                }
            });
        });

        // se il pannello Inizia è chiuso, anche i titoli di sezione sono
        // fuori vista → li tolgo dal Tab; quando è aperto tornano
        document.querySelectorAll('.accordion-header').forEach(function (h) {
            if (masterChiuso) h.setAttribute('tabindex', '-1');
            else h.removeAttribute('tabindex');
        });
    }

    // ripassa dopo ogni clic (apre/chiude sezioni) e all'avvio
    document.addEventListener('click', function () { setTimeout(aggiornaTabIndex, 60); }, true);
    if ('MutationObserver' in window) {
        var mc = document.getElementById('master-content') || document.body;
        new MutationObserver(function () { clearTimeout(window.__umsTi); window.__umsTi = setTimeout(aggiornaTabIndex, 60); })
            .observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
    }
    setTimeout(aggiornaTabIndex, 800);
    setTimeout(aggiornaTabIndex, 2000);

    // ---- 2) Invio/Spazio sul titolo apre/chiude la sezione ----
    // (i titoli sono <button>: Invio è nativo; aggiungo Spazio, che di
    //  default scrollerebbe, e prevengo il doppio-toggle.)
    document.addEventListener('keydown', function (e) {
        if (e.key !== ' ' && e.key !== 'Spacebar') return;
        var h = e.target && e.target.closest ? e.target.closest('.accordion-header, .master-header') : null;
        if (!h) return;
        e.preventDefault();
        h.click();
    }, true);

    // ---- 3) pop-up istruzioni UNA VOLTA SOLA + primo Tab apre la sezione 01 ----
    function giaVisto() { try { return localStorage.getItem(TUT_KEY) === '1'; } catch (e) { return false; } }
    function segnaVisto() { try { localStorage.setItem(TUT_KEY, '1'); } catch (e) {} }
    function mostraPopUnaVolta() {
        if (giaVisto()) return;
        segnaVisto();
        var pop = document.createElement('div');
        pop.id = 'ums-tasti-pop';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', 'Come navigare con la tastiera');
        pop.innerHTML =
            '<div class="ums-tasti-card">' +
                '<p class="ums-tasti-tit">Navigare con la tastiera</p>' +
                '<ul>' +
                    '<li><kbd>Tab</kbd> va alla sezione successiva. <kbd>Maiusc</kbd>+<kbd>Tab</kbd> torna indietro.</li>' +
                    '<li><kbd>Invio</kbd> o <kbd>Spazio</kbd> apre o chiude la sezione.</li>' +
                    '<li><kbd>&uarr;</kbd> <kbd>&darr;</kbd> scorrono la pagina.</li>' +
                    '<li><kbd>Esc</kbd> chiude i pop-up.</li>' +
                '</ul>' +
                '<button type="button" class="ums-tasti-ok">Ho capito</button>' +
            '</div>';
        document.body.appendChild(pop);
        pop.classList.add('su');
        pop.querySelector('.ums-tasti-ok').addEventListener('click', function () {
            pop.classList.remove('su'); if (pop.parentNode) pop.parentNode.removeChild(pop);
        });
        var suEsc = function (ev) { if (ev.key === 'Escape') { if (pop.parentNode) pop.parentNode.removeChild(pop); document.removeEventListener('keydown', suEsc); } };
        document.addEventListener('keydown', suEsc);
    }
    function apriPrimaSezione() {
        var master = document.getElementById('master-toggle-btn');
        var content = document.getElementById('master-content');
        if (master && content && !content.classList.contains('active') &&
            master.getAttribute('aria-expanded') !== 'true') {
            master.click();
        }
        setTimeout(function () {
            aggiornaTabIndex();
            var h = document.querySelector('.accordion-header');
            if (!h) return;
            var panel = h.closest('.ums-acc-h') ? h.closest('.ums-acc-h').nextElementSibling : h.nextElementSibling;
            if (panel && !panel.classList.contains('active')) h.click();
            setTimeout(function () { aggiornaTabIndex(); try { h.focus({preventScroll:true}); } catch (e) { try{h.focus();}catch(_){} } }, 120);
        }, 260);
    }
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Tab' && primoTab) {
            primoTab = false;
            mostraPopUnaVolta();
            apriPrimaSezione();
            e.preventDefault();     // il primo Tab atterra sulla sezione 01
        }
    }, true);
    document.addEventListener('mousedown', function () { primoTab = true; }, true);

    // ---- 4) Dritti al Sodo: carta girabile da tastiera ----
    function preparaCarta() {
        var deck = document.getElementById('flashcard-deck');
        if (!deck || deck.dataset.umsKbd === '1') return;
        deck.dataset.umsKbd = '1';
        deck.setAttribute('tabindex', '0');
        deck.setAttribute('role', 'button');
        deck.setAttribute('aria-label', 'Carta: premi Invio o Spazio per girarla');
        deck.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                if (typeof forceFlip === 'function') forceFlip(e);
                else if (typeof toggleFlip === 'function') toggleFlip();
                else deck.click();
            }
        });
    }
    document.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('.btn-start')) setTimeout(preparaCarta, 300);
    });
    setTimeout(preparaCarta, 2000);
})();


// ====================================================================
// TRADUZIONE DI CARTE, CONTATORE E TITOLI DELLE SEZIONI — additivo.
// Il traduttore di Google traduce la pagina all'inizio, ma non il testo che
// il sito riscrive dopo (carte, contatore) e salta certi titoli ("Dritti al
// Sodo"). Qui questi testi li traduce il sito con lo stesso servizio, con
// memoria: compaiono subito e vengono aggiornati appena pronti. Gli elementi
// coinvolti sono esclusi dal traduttore di Google (niente doppie traduzioni).
// In italiano non fa nulla.
// ====================================================================
(function () {
    var cache = {};      // lingua -> { testo italiano: traduzione }
    var lingua = 'it';
    var inCorso = {};

    async function traduci(testo, lang) {
        var res = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=it&tl=' +
            encodeURIComponent(lang) + '&dt=t&q=' + encodeURIComponent(testo));
        if (!res.ok) throw new Error('translate http ' + res.status);
        var data = await res.json();
        return (data[0] || []).map(function (seg) { return seg[0]; }).join('');
    }
    function applica(testo, tr) {
        document.querySelectorAll('[data-ums-orig]').forEach(function (el) {
            if (el.dataset.umsOrig === testo) el.innerText = tr + (el.dataset.umsSuffix || '');
        });
    }
    function chiedi(testo, lang) {
        var d = cache[lang] || (cache[lang] = {});
        var k = lang + '\u0000' + testo;
        if (inCorso[k]) return inCorso[k];
        inCorso[k] = traduci(testo, lang).then(function (tr) {
            d[testo] = tr || testo;
            if (lingua === lang) applica(testo, d[testo]);
            return d[testo];
        }).catch(function () { return testo; }).finally(function () { delete inCorso[k]; });
        return inCorso[k];
    }
    function fcT(testo) {
        if (lingua === 'it' || !testo) return testo;
        var d = cache[lingua] || (cache[lingua] = {});
        if (d[testo]) return d[testo];
        chiedi(testo, lingua);
        return testo;
    }
    function fissi() {   // testi fissi da tradurre: titoli delle sezioni + contatore
        var out = ['Carte da studiare'];
        document.querySelectorAll('.ch-eyebrow, .ch-title').forEach(function (el) {
            if (!el.dataset.umsOrig) el.dataset.umsOrig = (el.textContent || '').trim();
            if (el.dataset.umsOrig && out.indexOf(el.dataset.umsOrig) < 0) out.push(el.dataset.umsOrig);
        });
        return out;
    }
    async function precarica(lang) {
        lingua = lang;
        if (lang === 'it') {
            document.querySelectorAll('[data-ums-orig]').forEach(function (el) {
                el.innerText = el.dataset.umsOrig + (el.dataset.umsSuffix || '');
            });
            return;
        }
        var d = cache[lang] || (cache[lang] = {});
        var testi = fissi();
        try { if (typeof initialCards !== 'undefined' && Array.isArray(initialCards)) {
            initialCards.forEach(function (c) { [c.front, c.back].forEach(function (t) { if (t && testi.indexOf(t) < 0) testi.push(t); }); });
        } } catch (e) {}
        testi.forEach(function (t) { if (d[t]) applica(t, d[t]); });      // già in memoria: subito
        testi = testi.filter(function (t) { return !d[t]; });
        for (var i = 0; i < testi.length; i += 4) {
            if (lingua !== lang) return;
            await Promise.all(testi.slice(i, i + 4).map(function (t) { return chiedi(t, lang); }));
        }
    }
    function tieniFuoriGoogle() {
        var sel = '#fc-front-text, #fc-back-text, #fc-counter, .ch-eyebrow, .ch-title';
        document.querySelectorAll(sel).forEach(function (el) {
            el.classList.add('notranslate'); el.setAttribute('translate', 'no');
        });
        fissi();
    }
    tieniFuoriGoogle();
    document.addEventListener('DOMContentLoaded', tieniFuoriGoogle);
    window.umsFcT = fcT;
    window.umsFcPrecarica = precarica;
})();
