import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseImportFile, importNoteFile } from '../archiveImport';

const saveNewMock = vi.fn().mockResolvedValue({ localId: 'local-1' });
const syncOneMock = vi.fn().mockResolvedValue(undefined);
const addToQueueMock = vi.fn().mockResolvedValue(undefined);

// S-11/S-43: шпион поверх настоящего mammoth — «бомба отклонена до mammoth» проверяется
// по вызову, а пост-проверку длины результата можно кормить подделкой.
const convertToMarkdownSpy = vi.hoisted(() => vi.fn());
vi.mock('mammoth', async (importOriginal) => {
  // convertToMarkdown is not in mammoth's index.d.ts (deprecated API, still exported).
  const actual = await importOriginal<{ convertToMarkdown: (input: unknown) => Promise<{ value: string }> }>();
  convertToMarkdownSpy.mockImplementation((input: unknown) => actual.convertToMarkdown(input));
  return { ...actual, convertToMarkdown: convertToMarkdownSpy, default: { ...actual, convertToMarkdown: convertToMarkdownSpy } };
});

vi.mock('../../../../core/services/LocalStorageService', () => ({
  LocalStorageService: { saveNew: (...args: unknown[]) => saveNewMock(...args) },
}));

vi.mock('../../../../core/services/SyncService', () => ({
  SyncService: {
    syncOne: (...args: unknown[]) => syncOneMock(...args),
    addToQueue: (...args: unknown[]) => addToQueueMock(...args),
  },
}));

function makeFile(name: string, content: string): File {
  return new File([content], name, { type: 'text/plain' });
}

describe('parseImportFile', () => {
  it('uses the filename (without extension) as the default title', () => {
    const parsed = parseImportFile('My Note.txt', 'hello world');
    expect(parsed.title).toBe('My Note');
    expect(parsed.content).toBe('hello world');
    expect(parsed.tags).toEqual([]);
    expect(parsed.wordCount).toBe(2);
  });

  it('extracts title and tags from YAML frontmatter', () => {
    const raw = '---\ntitle: "Custom Title"\ntags: [one, two, "three"]\n---\nbody text here';
    const parsed = parseImportFile('file.md', raw);
    expect(parsed.title).toBe('Custom Title');
    expect(parsed.tags).toEqual(['one', 'two', 'three']);
    expect(parsed.content).toBe('body text here');
  });

  it('extracts title, date, mood, and tags from legacy # Title format', () => {
    const raw =
      '# Legacy Title\n\n' +
      '**Дата:** 2026-09-07 | **Слов:** 100\n' +
      '**Теги:** #first #second\n' +
      '**Настроение:** happy\n\n' +
      '---\n\n' +
      'Legacy body text';
    const parsed = parseImportFile('export_2026-09-07_Legacy Title.txt', raw);
    expect(parsed.title).toBe('Legacy Title');
    expect(parsed.tags).toEqual(['first', 'second']);
    expect(parsed.mood).toBe('happy');
    expect(parsed.date).toBe('2026-09-07');
    expect(parsed.content).toBe('Legacy body text');
  });
});

describe('importNoteFile', () => {
  beforeEach(() => {
    saveNewMock.mockClear();
    syncOneMock.mockClear();
    addToQueueMock.mockClear();
    convertToMarkdownSpy.mockClear();
  });

  it('rejects unsupported file extensions without saving', async () => {
    const file = makeFile('image.png', 'binary');
    const result = await importNoteFile(file, 'user-1', true);
    expect(result.success).toBe(false);
    expect(saveNewMock).not.toHaveBeenCalled();
  });

  // Regression: imports used to call LocalStorageService.saveNew directly and
  // stop there, bypassing the cloud-sync step every other save path gets from
  // cleanupDraftsAfterSave. Imported notes ended up local-only forever.
  it('syncs the imported note to the cloud for signed-in users', async () => {
    const file = makeFile('note.txt', 'some content');
    const result = await importNoteFile(file, 'user-1', true);

    expect(result.success).toBe(true);
    expect(saveNewMock).toHaveBeenCalledWith('user-1', expect.objectContaining({ title: 'note', content: 'some content' }));
    expect(addToQueueMock).toHaveBeenCalledWith('local-1', 'user-1');
    expect(syncOneMock).toHaveBeenCalledWith('user-1', 'local-1');
  });

  it('queues the note for retry if the initial cloud sync fails', async () => {
    syncOneMock.mockRejectedValueOnce(new Error('offline'));
    const file = makeFile('note.txt', 'some content');
    await importNoteFile(file, 'user-1', true);

    // syncOne is fire-and-forget; flush microtasks so its rejection handler runs.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(addToQueueMock).toHaveBeenCalledWith('local-1', 'user-1');
  });

  it('does not attempt cloud sync for guests', async () => {
    const file = makeFile('note.txt', 'some content');
    await importNoteFile(file, 'guest-id', false);

    expect(saveNewMock).toHaveBeenCalled();
    expect(syncOneMock).not.toHaveBeenCalled();
  });

  it('L-1: imports note exported by 0.8.39 with Russian header preserving original date', async () => {
    const legacyExportContent = `# Заголовок заметки

**Дата:** 5 сентября 2026 г.
**Теги:** #мысли
**Слов:** 10 · 1 мин

Текст заметки из старой версии.`;
    const file = makeFile('test-0.8.39.md', legacyExportContent);
    const result = await importNoteFile(file, 'user-1', false);

    expect(result.success).toBe(true);
    expect(result.dateUnreadable).toBeFalsy();

    const savedPayload = saveNewMock.mock.calls[saveNewMock.mock.calls.length - 1]![1];
    expect(savedPayload.sessionStartedAt).toBeInstanceOf(Date);
    expect(savedPayload.sessionStartedAt.getFullYear()).toBe(2026);
    expect(savedPayload.sessionStartedAt.getMonth()).toBe(8); // September is 8 (0-indexed)
    expect(savedPayload.sessionStartedAt.getDate()).toBe(5);
    // D-4: дата файла должна доходить до самого документа, а не только до версии.
    expect(savedPayload.documentDate).toEqual(savedPayload.sessionStartedAt);
  });

  it('L-1: file with genuinely unreadable date imports and reports dateUnreadable', async () => {
    const unreadableDateContent = `# Заголовок

**Дата:** нечитаемая строка даты
**Теги:** #тест

Текст заметки.`;
    const file = makeFile('unreadable-date.md', unreadableDateContent);
    const result = await importNoteFile(file, 'user-1', false);

    expect(result.success).toBe(true);
    expect(result.dateUnreadable).toBe(true);

    const savedPayload = saveNewMock.mock.calls[saveNewMock.mock.calls.length - 1]![1];
    expect(savedPayload.sessionStartedAt).toBeInstanceOf(Date);
  });

  async function makeDocx(body: string, compression: 'DEFLATE' | 'STORE' = 'STORE'): Promise<ArrayBuffer> {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${body}</w:t></w:r></w:p></w:body></w:document>`);
    return zip.generateAsync({ type: 'arraybuffer', compression });
  }

  // 55 MB of repeated text, ~1000:1 under DEFLATE; built once (promise cached, so a timed-out
  // first test does not make the next one deflate 55 MB again). Deflating 55 MB takes ~0.5 s idle
  // and > 5 s under CI/parallel-agent load, hence the explicit 30 s timeout on the bomb tests.
  let bombBuf: Promise<ArrayBuffer> | undefined;
  function makeBomb(): Promise<ArrayBuffer> {
    bombBuf ??= makeDocx('A'.repeat(55 * 1024 * 1024), 'DEFLATE');
    return bombBuf;
  }
  const BOMB_TEST_TIMEOUT_MS = 30_000;

  function docxFile(buf: ArrayBuffer, name: string): File {
    return new File([buf], name, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  async function importFails(file: File): Promise<boolean> {
    try {
      const res = await importNoteFile(file, 'user-1', false);
      return !res.success;
    } catch {
      return true;
    }
  }

  // S-43: rewrite uncompressedSize in the local (PK\x03\x04, +22) and central (PK\x01\x02, +24)
  // headers of the named entry; JSZip trusts the central directory on load.
  function lieAboutUncompressedSize(buf: ArrayBuffer, entryName: string, claimed: number): ArrayBuffer {
    const out = new Uint8Array(buf.slice(0));
    const view = new DataView(out.buffer);
    const nameBytes = new TextEncoder().encode(entryName);
    let patched = 0;
    for (let i = 0; i + 4 <= out.length; i++) {
      if (out[i] !== 0x50 || out[i + 1] !== 0x4b) continue;
      const local = out[i + 2] === 0x03 && out[i + 3] === 0x04;
      const central = out[i + 2] === 0x01 && out[i + 3] === 0x02;
      if (!local && !central) continue;
      const sizeOff = local ? 22 : 24;
      const nameLenOff = local ? 26 : 28;
      const nameOff = local ? 30 : 46;
      const nameLen = view.getUint16(i + nameLenOff, true);
      if (nameLen !== nameBytes.length) continue;
      if (!nameBytes.every((b, k) => out[i + nameOff + k] === b)) continue;
      view.setUint32(i + sizeOff, claimed, true);
      patched++;
    }
    expect(patched).toBe(2);
    return out.buffer;
  }

  it('S-11: rejects an honest docx bomb (headers say 55MB) before mammoth and before saveNew', async () => {
    const file = docxFile(await makeBomb(), 'bomb.docx');

    expect(await importFails(file)).toBe(true);
    expect(convertToMarkdownSpy).not.toHaveBeenCalled();
    expect(saveNewMock).not.toHaveBeenCalled();
  }, BOMB_TEST_TIMEOUT_MS);

  it('S-43: rejects a docx bomb whose zip headers claim 1000 bytes uncompressed, without calling mammoth', async () => {
    const lying = lieAboutUncompressedSize(await makeBomb(), 'word/document.xml', 1000);
    const file = docxFile(lying, 'liar.docx');

    expect(await importFails(file)).toBe(true);
    expect(convertToMarkdownSpy).not.toHaveBeenCalled();
    expect(saveNewMock).not.toHaveBeenCalled();
  }, BOMB_TEST_TIMEOUT_MS);

  // S-60 (S-43): предел — на архив целиком, не на запись: три записи по 20 МБ
  // поодиночке проходят под 50 МБ, вместе — нет.
  it('S-60: rejects an archive whose entries each fit under the cap but sum over 50 MB, before mammoth', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document/>');
    for (const name of ['word/media/a.bin', 'word/media/b.bin', 'word/media/c.bin']) zip.file(name, 'A'.repeat(20 * 1024 * 1024));
    const file = docxFile(await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' }), 'three-parts.docx');

    expect(await importFails(file)).toBe(true);
    expect(convertToMarkdownSpy).not.toHaveBeenCalled();
    expect(saveNewMock).not.toHaveBeenCalled();
  }, BOMB_TEST_TIMEOUT_MS);

  // S-60 (S-43): после превышения предела поток ставится на паузу — иначе
  // бомба распаковывается до конца в память, хотя импорт уже отклонён.
  // Пауза действует с шагом в один сжатый кусок (16 КБ на входе — до ~16 МБ на
  // выходе у «бомбы»), поэтому бомба здесь вдвое больше предела: без паузы
  // распаковываются все 120 МБ, с паузой — чуть больше 50.
  it('S-60: inflating stops right after the cap is crossed instead of running to the end of the bomb', async () => {
    const JSZip = (await import('jszip')).default;
    const bigBomb = await makeDocx('A'.repeat(120 * 1024 * 1024), 'DEFLATE');
    const probe = await JSZip.loadAsync(bigBomb);
    const proto = Object.getPrototypeOf(probe.file('word/document.xml')!) as { internalStream: (type: string) => { on: (ev: string, cb: (c: Uint8Array) => void) => unknown } };
    const original = proto.internalStream;
    let streamed = 0;
    const spy = vi.spyOn(proto, 'internalStream').mockImplementation(function (this: unknown, type: string) {
      const stream = original.call(this, type);
      stream.on('data', (chunk: Uint8Array) => { streamed += chunk.length; });
      return stream;
    });
    try {
      expect(await importFails(docxFile(bigBomb, 'big-bomb.docx'))).toBe(true);
      await new Promise(r => setTimeout(r, 1_500));
      expect(streamed, `распаковано ${Math.round(streamed / 1024 / 1024)} МБ после отказа`).toBeLessThan(100 * 1024 * 1024);
      expect(streamed).toBeGreaterThan(50 * 1024 * 1024);
    } finally {
      spy.mockRestore();
    }
  }, BOMB_TEST_TIMEOUT_MS);

  it('S-11: rejects a docx whose mammoth output exceeds 10M characters without saving', async () => {
    convertToMarkdownSpy.mockResolvedValueOnce({ value: 'A'.repeat(10_000_001), messages: [] });
    const file = docxFile(await makeDocx('small'), 'huge-output.docx');

    expect(await importFails(file)).toBe(true);
    expect(convertToMarkdownSpy).toHaveBeenCalledTimes(1);
    expect(saveNewMock).not.toHaveBeenCalled();
  });

  it('S-11: imports normal docx file', async () => {
    const file = docxFile(await makeDocx('Hello normal docx'), 'normal.docx');

    const res = await importNoteFile(file, 'user-1', false);
    expect(res.success).toBe(true);
    expect(saveNewMock).toHaveBeenCalledWith('user-1', expect.objectContaining({ content: expect.stringContaining('Hello normal docx') }));
  });

  it('clamps tags to <= 10 of <= 50 chars, and title/mood to <= 500 chars (S-19)', async () => {
    const hugeTags = Array.from({ length: 50 }, (_, i) => `tag_${i}_${'a'.repeat(200)}`);
    const hugeTitle = 't'.repeat(3000);
    const hugeMood = 'настроение_'.repeat(150);
    const { serializeNoteMarkdown } = await import('../../../../core/services/noteFormat');
    const content = serializeNoteMarkdown({
      title: hugeTitle,
      tags: hugeTags,
      mood: hugeMood,
      content: 'body text',
    });

    const file = makeFile('huge.md', content);
    const result = await importNoteFile(file, 'user-1', true);
    expect(result.success).toBe(true);

    expect(saveNewMock).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        title: expect.any(String),
        tags: expect.any(Array),
        mood: expect.any(String),
      }),
    );

    const savedDoc = saveNewMock.mock.calls[0]![1] as { tags: string[]; title: string; mood: string };
    expect(savedDoc.tags.length).toBeLessThanOrEqual(10);
    for (const tag of savedDoc.tags) {
      expect(tag.length).toBeLessThanOrEqual(50);
    }
    expect(savedDoc.title.length).toBeLessThanOrEqual(500);
    expect(savedDoc.mood.length).toBeLessThanOrEqual(500);
  });

  // S-44.6: 500 символов CJK = 1500 байт UTF-8 → base64(iv + ct + tag) = 2040 символов
  // > documents_title_check ≤ 2000 (0013) → вечный 23514 при каждой синхронизации.
  it('S-44.6: clamps a 500-char CJK title/mood so the encrypted value fits documents_title_check (≤ 2000)', async () => {
    const cjk = '漢'.repeat(500);
    const { serializeNoteMarkdown } = await import('../../../../core/services/noteFormat');
    const content = serializeNoteMarkdown({ title: cjk, tags: [], mood: cjk, content: 'body text' });

    const result = await importNoteFile(makeFile('cjk.md', content), 'user-1', true);
    expect(result.success).toBe(true);

    const savedDoc = saveNewMock.mock.calls[0]![1] as { title: string; mood: string };
    expect(new TextEncoder().encode(savedDoc.title).length).toBeLessThanOrEqual(1450);
    expect(new TextEncoder().encode(savedDoc.mood).length).toBeLessThanOrEqual(1450);
    expect(savedDoc.title).toMatch(/^漢+$/); // no split code point / U+FFFD

    // Through the real title ciphertext path (DocumentService → maybeEncrypt → encryptContent).
    const { encryptContent } = await import('../../../../core/crypto/encrypt');
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    expect((await encryptContent(savedDoc.title, key)).length).toBeLessThanOrEqual(2000);
    expect((await encryptContent(savedDoc.mood, key)).length).toBeLessThanOrEqual(2000);
  });
});


