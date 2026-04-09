import React, { useState } from 'react';
import { ExportService } from '../../export/ExportService';
import { WritingDraftService } from '../../writing/services/WritingDraftService';
import { SessionService } from '../../writing/services/SessionService';
import { getDraft, Draft } from '../../../lib/db';
import { useAuthStatus } from '../../../features/auth/hooks/useAuthStatus';

export const DataTransfer: React.FC = () => {
  const { user } = useAuthStatus();
  const userId = user?.uid;
  const [loading, setLoading] = useState(false);

  const handleExportAll = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      // Fetch all sessions
      const result = await SessionService.getAllSessions(userId, 1000); // Fetch up to 1000 sessions
      ExportService.toJson(result.sessions);
      alert('All sessions exported successfully!');
    } catch (error) {
      console.error(error);
      alert('Failed to export sessions.');
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
        const sessions = JSON.parse(event.target?.result as string);
        for (const session of sessions) {
          await SessionService.saveSession({ ...session, userId });
        }
        alert('Sessions imported successfully!');
      } catch (error) {
        console.error(error);
        alert('Failed to import sessions.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="p-4 border rounded">
      <h2 className="text-lg font-bold mb-2">Data Transfer</h2>
      <button 
        onClick={handleExportAll} 
        disabled={loading}
        className="bg-blue-500 text-white p-2 rounded mr-2 disabled:opacity-50"
      >
        {loading ? 'Exporting...' : 'Export All Sessions'}
      </button>
      <input type="file" onChange={handleImport} className="p-2" />
    </div>
  );
};
