import React, { useState, useEffect, useCallback } from 'react';
import { Database, Loader2, Trash2 } from 'lucide-react';
import { getLocalDb } from '../../../core/storage/localDb';
import { DocumentService } from '../../../core/services/DocumentService';
import { VersionService } from '../../../core/services/VersionService';
import { AdminUserService } from '../../admin/services/AdminUserService';
import { cn } from '../../../core/utils/utils';
import { useToast } from '../../../shared/components/Toast';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { Input } from '../../../shared/components/Input';

const LOCAL_TABLES = [
  { name: 'documents', label: 'documents (Заметки)' },
  { name: 'versions', label: 'versions (Версии)' },
  { name: 'aiSummaries', label: 'aiSummaries (AI Саммари)' },
  { name: 'aiDialogues', label: 'aiDialogues (AI Диалоги)' },
  { name: 'aiPersonas', label: 'aiPersonas (AI Персоны)' },
  { name: 'syncQueue', label: 'syncQueue (Очередь выгрузки)' },
  { name: 'drafts', label: 'drafts (Черновики)' },
  { name: 'pending_sessions', label: 'pending_sessions (Неотправленные)' },
  { name: 'profile', label: 'profile (Локальный профиль)' },
];

const FIRESTORE_TABLES = [
  { name: 'users', label: 'users (Профили Firestore)' },
  { name: 'user_documents', label: 'documents (Мои доки Cloud)' },
  { name: 'user_versions', label: 'versions (Мои версии Cloud)' },
];

interface DatabaseExplorerProps {
  userId: string;
}

type DBSource = 'local' | 'firestore';
type RecordType = Record<string, unknown>;

export function DatabaseExplorer({ userId }: DatabaseExplorerProps) {
  const [source, setSource] = useState<DBSource>('local');
  const [selectedTable, setSelectedTable] = useState<string>('documents');
  const [records, setRecords] = useState<RecordType[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<RecordType | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const { showToast } = useToast();

  const tables = source === 'local' ? LOCAL_TABLES : FIRESTORE_TABLES;

  useEffect(() => {
    if (source === 'local') {
      if (!LOCAL_TABLES.some(t => t.name === selectedTable)) {
        setSelectedTable('documents');
      }
    } else {
      if (!FIRESTORE_TABLES.some(t => t.name === selectedTable)) {
        setSelectedTable('users');
      }
    }
    setSelectedRecord(null);
  }, [source, selectedTable]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (source === 'local') {
        const db = await getLocalDb();
        const data = await db.getAll(selectedTable as 'documents');
        setRecords(data as unknown as RecordType[]);
      } else {
        if (selectedTable === 'users') {
          const data = await AdminUserService.getUsers(150);
          setRecords(data as unknown as RecordType[]);
        } else if (selectedTable === 'user_documents') {
          const data = await DocumentService.getUserDocuments(userId);
          setRecords(data as unknown as RecordType[]);
        } else if (selectedTable === 'user_versions') {
          const docs = await DocumentService.getUserDocuments(userId);
          const allVersions: RecordType[] = [];
          for (const doc of docs) {
            const vers = await VersionService.getVersions(userId, doc.id);
            allVersions.push(...vers.map(v => ({ ...v, docTitle: doc.title } as unknown as RecordType)));
          }
          setRecords(allVersions);
        }
      }
    } catch (e) {
      console.error(e);
      showToast('Не удалось загрузить данные таблиц', 'error');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [source, selectedTable, userId, showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleDeleteRecord = async (record: RecordType) => {
    if (!window.confirm('Вы уверены, что хотите безвозвратно удалить эту запись из базы данных?')) return;
    try {
      if (source === 'local') {
        const db = await getLocalDb();
        let key: string | number = record.id as string;
        if (selectedTable === 'aiSummaries') key = record.documentId as string;
        if (selectedTable === 'profile') key = record.guestId as string;
        if (selectedTable === 'drafts') key = record.userId as string;
        if (selectedTable === 'pending_sessions') key = record.id as number;
        
        const looseDb = db as unknown as { delete: (store: string, key: string | number) => Promise<void> };
        await looseDb.delete(selectedTable, key);
        showToast('Запись удалена из IndexedDB', 'success');
      } else {
        if (selectedTable === 'user_documents') {
          await DocumentService.deleteDocument(userId, record.id as string);
          showToast('Документ удален из Firestore', 'success');
        } else {
          showToast('Удаление для этой коллекции не поддерживается клиентом', 'error');
          return;
        }
      }
      setSelectedRecord(null);
      await loadData();
    } catch (e) {
      console.error(e);
      showToast('Ошибка при удалении записи', 'error');
    }
  };

  const filteredRecords = records.filter(r => {
    const query = searchQuery.toLowerCase();
    if (!query) return true;
    try {
      const jsonStr = JSON.stringify(r).toLowerCase();
      return jsonStr.includes(query);
    } catch {
      return false;
    }
  });

  const getRecordTitle = (r: RecordType) => {
    if (r == null) return 'Пустая запись';
    
    const id = typeof r.id === 'string' ? r.id : typeof r.id === 'number' ? String(r.id) : '';
    const title = typeof r.title === 'string' ? r.title : '';
    const documentId = typeof r.documentId === 'string' ? r.documentId : '';
    const nickname = typeof r.nickname === 'string' ? r.nickname : '';
    const email = typeof r.email === 'string' ? r.email : '';
    const docTitle = typeof r.docTitle === 'string' ? r.docTitle : '';
    const version = typeof r.version === 'number' || typeof r.version === 'string' ? String(r.version) : '';
    const tone = typeof r.tone === 'string' ? r.tone : '';
    const name = typeof r.name === 'string' ? r.name : '';
    const emoji = typeof r.emoji === 'string' ? r.emoji : '';
    const type = typeof r.type === 'string' ? r.type : '';
    const personaName = typeof r.personaName === 'string' ? r.personaName : '';

    if (selectedTable === 'users') {
      return `${nickname || 'Пользователь'} (${email || 'Без почты'})`;
    }
    if (selectedTable === 'documents' || selectedTable === 'user_documents') {
      return title || `Заметка ${id.slice(0, 8) || 'без ID'}`;
    }
    if (selectedTable === 'versions' || selectedTable === 'user_versions') {
      return `${docTitle || documentId.slice(0, 8) || 'Без названия'} - v${version || '?'}`;
    }
    if (selectedTable === 'aiSummaries') {
      return `Саммари: ${documentId.slice(0, 8) || 'без ID'} (${tone || 'без тона'})`;
    }
    if (selectedTable === 'aiDialogues') {
      return title || `Диалог: ${personaName || 'без имени'}`;
    }
    if (selectedTable === 'aiPersonas') {
      return `${emoji || '👤'} ${name || 'Персонаж'}`;
    }
    if (selectedTable === 'syncQueue') {
      return `Очередь: ${type || 'запись'} ${documentId.slice(0, 8) || 'без ID'}`;
    }
    if (selectedTable === 'drafts') {
      return `Черновик: ${title || 'Без названия'}`;
    }
    
    if (id) return id;
    try {
      return JSON.stringify(r).slice(0, 30);
    } catch {
      return 'Запись';
    }
  };

  const getRecordId = (r: RecordType) => {
    if (r == null) return 'Нет ID';
    const id = typeof r.id === 'string' || typeof r.id === 'number' ? String(r.id) : '';
    const documentId = typeof r.documentId === 'string' ? r.documentId : '';
    const guestId = typeof r.guestId === 'string' ? r.guestId : '';
    const userId = typeof r.userId === 'string' ? r.userId : '';
    return id || documentId || guestId || userId || 'Нет ID';
  };

  return (
    <div className="flex flex-col md:flex-row gap-6 min-h-[500px]">
      
      {/* Left Column */}
      <div className="w-full md:w-1/3 space-y-4">
        
        {/* Source Switcher */}
        <div className="flex gap-1 p-1 bg-surface-base/10 rounded-xl border border-border-subtle text-[11px] font-bold">
          <Button
            onClick={() => setSource('local')}
            className={cn(
              "flex-1 py-1.5 rounded-lg transition-all duration-200",
              source === 'local' ? "bg-surface-base/20 text-text-main shadow-sm" : "text-text-main/50 hover:text-text-main"
            )}
          >
            Локальная БД (IndexedDB)
          </Button>
          <Button
            onClick={() => setSource('firestore')}
            className={cn(
              "flex-1 py-1.5 rounded-lg transition-all duration-200",
              source === 'firestore' ? "bg-surface-base/20 text-text-main shadow-sm" : "text-text-main/50 hover:text-text-main"
            )}
          >
            Firestore
          </Button>
        </div>

        {/* Dropdown */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase font-bold text-text-main/40 tracking-wider">Таблица / Коллекция</label>
          <select
            value={selectedTable}
            onChange={(e) => setSelectedTable(e.target.value)}
            className="w-full px-3 py-2 rounded-xl bg-surface-base/5 border border-border-subtle text-xs text-text-main outline-none focus:ring-1 focus:ring-brand-soft/30"
          >
            {tables.map(t => (
              <option key={t.name} value={t.name} className="bg-surface-card text-text-main text-xs">
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* Search */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase font-bold text-text-main/40 tracking-wider">Поиск по тексту</label>
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Фильтр по содержимому..."
            className="px-3 py-2 text-xs rounded-xl bg-surface-base/5 border border-border-subtle text-text-main outline-none placeholder:text-text-main/30"
          />
        </div>

        {/* Record lists */}
        <div className="rounded-xl border border-border-subtle bg-surface-card/10 overflow-hidden max-h-[380px] overflow-y-auto divide-y divide-border-subtle/30">
          {loading ? (
            <div className="p-8 text-center text-xs text-text-main/40">
              <Loader2 size={16} className="animate-spin mx-auto mb-2 text-brand-soft" />
              Загрузка данных...
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="p-8 text-center text-xs text-text-main/30">Записи отсутствуют</div>
          ) : (
            filteredRecords.map((r, idx) => {
              const id = getRecordId(r);
              const isSelected = selectedRecord === r;
              return (
                <Button
                  key={`${id}-${idx}`}
                  onClick={() => setSelectedRecord(r)}
                  className={cn(
                    "w-full text-left px-4 py-2.5 text-xs transition-colors flex flex-col gap-0.5",
                    isSelected ? "bg-brand-soft/10 text-brand-soft" : "hover:bg-text-main/[0.01] text-text-main/70"
                  )}
                >
                  <span className="font-semibold truncate">{getRecordTitle(r)}</span>
                  <span className="text-[9px] font-mono text-text-main/30 truncate">{id}</span>
                </Button>
              );
            })
          )}
        </div>
      </div>

      {/* Right Column (Details) */}
      <div className="flex-1 space-y-4">
        {selectedRecord ? (
          <div className="p-5 rounded-2xl border border-border-subtle bg-surface-base/5 space-y-4">
            
            {/* Header info */}
            <div className="flex items-start justify-between gap-4 border-b border-border-subtle/50 pb-4">
              <div className="min-w-0">
                <span className="text-[9px] uppercase font-bold text-text-main/40 tracking-wider">Детали записи ({selectedTable})</span>
                <h4 className="text-sm font-bold text-text-main truncate mt-1">{getRecordTitle(selectedRecord)}</h4>
                <p className="text-[10px] font-mono text-text-main/30 mt-0.5 break-all">ID: {getRecordId(selectedRecord)}</p>
              </div>
              <IconButton
                onClick={() => void handleDeleteRecord(selectedRecord)}
                className="p-2 rounded-lg border border-accent-danger/20 text-accent-danger hover:bg-accent-danger/10 transition-colors shrink-0"
                label="Удалить документ"
                icon={<Trash2 size={14} />}
              />
            </div>

            {/* Preformatted JSON block */}
            <div className="space-y-1.5">
              <span className="text-[10px] uppercase font-bold text-text-main/40 tracking-wider">Значения всех полей (Raw JSON)</span>
              <pre className="p-4 rounded-xl bg-surface-base/80 border border-border-subtle overflow-auto max-h-[450px] text-[10px] font-mono text-text-main/80 select-all leading-normal whitespace-pre-wrap break-all">
                {JSON.stringify(selectedRecord, null, 2)}
              </pre>
            </div>

          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center border border-dashed border-border-subtle/50 rounded-2xl p-12 text-center text-xs text-text-main/30">
            <Database size={24} className="text-text-main/15 mb-2" />
            Выберите запись в левой панели для просмотра всех полей документа (как в консоли управления)
          </div>
        )}
      </div>

    </div>
  );
}
