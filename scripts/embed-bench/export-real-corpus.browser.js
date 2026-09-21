// Paste this whole file into the browser DevTools console while logged in
// on https://justwriting.ru, then run: await exportRealCorpus()
//
// Reads your OWN already-decrypted local IndexedDB (aiEmbeddings + documents
// stores) — nothing here is sent anywhere. It reconstructs corpus.json's
// shape ([{id, text}]) from real notes, one entry per note (a note's stored
// chunk texts are joined back together — this compares retrieval at the
// note level, which is also what you'll be judging relevance at).
//
// It downloads a file — save it as scripts/embed-bench/corpus.json locally.
// That path is already gitignored (scripts/embed-bench/*.json): never commit it.
//
// It also prints an id -> title list to the console so you can write
// queries.json by hand afterward (real queries + which note ids are relevant
// to each — see README.md in this folder for the format and the "don't let
// the answer literally contain the query's words" rule).
async function exportRealCorpus() {
  const authKey = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k));
  if (!authKey) { console.error('Не нашёл сессию Supabase — вы точно вошли в аккаунт?'); return; }
  const session = JSON.parse(localStorage.getItem(authKey));
  const uid = session?.user?.id ?? session?.currentSession?.user?.id;
  if (!uid) { console.error('Не нашёл uid в сессии.'); return; }

  const dbName = `justwriting-local-${uid}`;
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const getAll = (storeName) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const embeddings = await getAll('aiEmbeddings');
  const documents = await getAll('documents');
  const titleById = Object.fromEntries(documents.map(d => [d.id, d.title || '(без названия)']));

  const withChunks = embeddings.filter(e => e.chunkTexts && e.chunkTexts.length > 0);
  const corpus = withChunks.map(e => ({ id: e.documentId, text: e.chunkTexts.join('\n\n') }));

  console.log(`Заметок с сохранёнными текстами чанков: ${corpus.length} из ${embeddings.length} проиндексированных.`);
  console.log('id -> заголовок (для выбора запросов и разметки rel в queries.json):');
  console.table(corpus.map(c => ({ id: c.id, title: titleById[c.id] ?? '?', chars: c.text.length })));

  const blob = new Blob([JSON.stringify(corpus, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'corpus.json';
  a.click();
  console.log('Скачан corpus.json — положите в scripts/embed-bench/corpus.json (уже в .gitignore).');
}
