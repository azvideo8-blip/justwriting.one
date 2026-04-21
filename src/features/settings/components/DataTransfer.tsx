import React, { useState } from 'react';
import { z } from 'zod';
import { writeBatch, doc, collection } from 'firebase/firestore';
import { db } from '../../../core/firebase/firestore';
import { reportError } from '../../../core/errors/reportError';
import { ExportService } from '../../export/ExportService';
import { SessionService } from '../../writing/services/SessionService';
import { useAuthStatus } from '../../../features/auth/hooks/useAuthStatus';
import { useToast } from '../../../shared/components/Toast';
import { useLanguage } from '../../../core/i18n';

const importSchema = z.array(z.object({
  content: z.string().min(1).max(50000),
  title: z.string().max(200).optional(),
  duration: z.number().min(0),
  wordCount: z.number().min(0).optional(),
  isPublic: z.boolean().optional(),
  isAnonymous: z.boolean().optional(),
  tags: z.array(z.string().max(30)).max(10).optional(),
  createdAt: z.any().optional(),
  wpm: z.number().min(0).optional(),
})).max(100); // максимум 100 сессий за раз

export const DataTransfer: React.FC = () => {
  const { user } = useAuthStatus();
  const userId = user?.uid;
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();
  const { t } = useLanguage();

  const handleExportAll = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      // Fetch all sessions
      const result = await SessionService.getAllSessions(userId, 1000); // Fetch up to 1000 sessions
      ExportService.toJson(result.sessions);
      showToast(t('data_export_success'), 'success');
    } catch (error) {
      console.error(error);
      showToast(t('data_export_error'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !userId) return;
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const raw = event.target?.result as string;
        const json = JSON.parse(raw);
        const parsed = importSchema.safeParse(json);

        if (!parsed.success) {
          console.error('Import validation failed:', parsed.error);
          showToast(t('data_import_invalid'), 'error');
          return;
        }

        // Батч-запись вместо sequential saves:
        const batch = writeBatch(db);
        const sessionsRef = collection(db, 'sessions');

        for (const session of parsed.data) {
          const ref = doc(sessionsRef);
          batch.set(ref, {
            ...session,
            userId,
            createdAt: session.createdAt || new Date(),
          });
        }

        await batch.commit();
        showToast(t('data_import_success'), 'success');
      } catch (error) {
        console.error('Import failed:', error);
        reportError(error as Error, { context: 'data_transfer_import' });
        showToast(t('data_import_error'), 'error');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="p-4 border rounded">
      <h2 className="text-lg font-bold mb-2">{t('settings_data_section')}</h2>
      <button 
        onClick={handleExportAll} 
        disabled={loading}
        className="bg-text-main text-surface-base p-2 rounded-2xl mr-2 disabled:opacity-50"
      >
        {loading ? t('common_loading') : t('data_export_all')}
      </button>
      <input type="file" onChange={handleImport} className="p-2" />
    </div>
  );
};
