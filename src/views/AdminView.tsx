import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Users, Database, Shield, AlertTriangle } from 'lucide-react';
import { collection, query, getDocs, limit, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { AdminUsersTable } from '../components/admin/AdminUsersTable';
import { AdminSessionsTable } from '../components/admin/AdminSessionsTable';

export function AdminView() {
  const [users, setUsers] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'sessions' | 'security'>('users');

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'users') {
        const q = query(collection(db, 'users'), limit(50));
        const snap = await getDocs(q);
        setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } else if (activeTab === 'sessions') {
        const q = query(collection(db, 'sessions'), orderBy('createdAt', 'desc'), limit(50));
        const snap = await getDocs(q);
        setSessions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }
    } catch (err) {
      console.error("Admin fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSession = async (id: string) => {
    if (!confirm('Вы уверены, что хотите удалить эту сессию?')) return;
    try {
      await deleteDoc(doc(db, 'sessions', id));
      setSessions(sessions.filter(s => s.id !== id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `sessions/${id}`);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-8 pb-20"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold dark:text-stone-100 flex items-center gap-3">
          <Shield className="text-red-500" />
          Панель управления
        </h2>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1 bg-stone-100 dark:bg-stone-900 rounded-2xl w-fit">
        <button 
          onClick={() => setActiveTab('users')}
          className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'users' ? 'bg-white dark:bg-stone-800 shadow-sm text-stone-900 dark:text-stone-100' : 'text-stone-500 hover:text-stone-700'}`}
        >
          <Users size={16} />
          Пользователи
        </button>
        <button 
          onClick={() => setActiveTab('sessions')}
          className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'sessions' ? 'bg-white dark:bg-stone-800 shadow-sm text-stone-900 dark:text-stone-100' : 'text-stone-500 hover:text-stone-700'}`}
        >
          <Database size={16} />
          Сессии
        </button>
        <button 
          onClick={() => setActiveTab('security')}
          className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'security' ? 'bg-white dark:bg-stone-800 shadow-sm text-stone-900 dark:text-stone-100' : 'text-stone-500 hover:text-stone-700'}`}
        >
          <AlertTriangle size={16} />
          Безопасность
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-10 h-10 border-4 border-stone-200 border-t-stone-900 dark:border-stone-800 dark:border-t-stone-100 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 overflow-hidden shadow-sm">
          {activeTab === 'users' && (
            <AdminUsersTable users={users} />
          )}

          {activeTab === 'sessions' && (
            <AdminSessionsTable sessions={sessions} onDelete={handleDeleteSession} />
          )}

          {activeTab === 'security' && (
            <div className="p-8 space-y-6">
              <div className="p-6 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900/30 rounded-2xl">
                <h4 className="font-bold text-emerald-800 dark:text-emerald-400 mb-2 flex items-center gap-2">
                  <Shield size={18} />
                  Активная защита
                </h4>
                <ul className="text-sm text-emerald-700 dark:text-emerald-500 space-y-1 list-disc list-inside">
                  <li>Валидация схем данных на уровне Firestore</li>
                  <li>Ограничение размера строковых полей (защита от DoS)</li>
                  <li>Строгая типизация всех входящих данных</li>
                  <li>Защита от подмены UID автора</li>
                  <li>Email-валидация через регулярные выражения</li>
                </ul>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-6 bg-stone-50 dark:bg-stone-950 rounded-2xl border border-stone-200 dark:border-stone-800">
                  <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">XSS Protection</span>
                  <p className="text-sm mt-2">React автоматически экранирует все данные, предотвращая внедрение скриптов.</p>
                </div>
                <div className="p-6 bg-stone-50 dark:bg-stone-950 rounded-2xl border border-stone-200 dark:border-stone-800">
                  <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">CSRF Protection</span>
                  <p className="text-sm mt-2">Firebase Auth использует защищенные токены и SameSite куки.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
