import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ChevronRight, AlertCircle } from 'lucide-react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';

export function LoginView() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      // На мобильных устройствах всплывающие окна часто блокируются.
      // Мы используем signInWithPopup, так как это стандарт для среды AI Studio.
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      if (err.code === 'auth/cancelled-popup-request' || err.code === 'auth/popup-closed-by-user') {
        return;
      }
      console.error("Login error:", err);
      setError(err.message || "Произошла ошибка при входе. Пожалуйста, попробуйте еще раз.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-stone-50 dark:bg-stone-950 px-6">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full text-center space-y-8"
      >
        <div className="space-y-4">
          <div className="w-16 h-16 bg-stone-900 dark:bg-stone-100 rounded-2xl flex items-center justify-center text-white dark:text-stone-900 font-bold text-4xl mx-auto shadow-2xl">J</div>
          <h1 className="text-5xl font-bold tracking-tight dark:text-stone-100">JustWrite.io</h1>
          <p className="text-stone-500 dark:text-stone-400 text-lg leading-relaxed">
            Минималистичное пространство для писателей.
          </p>
        </div>

        {error && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-xl flex items-center gap-3 text-red-600 dark:text-red-400 text-sm text-left"
          >
            <AlertCircle size={20} className="shrink-0" />
            <p>{error}</p>
          </motion.div>
        )}

        <button 
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 py-4 rounded-xl shadow-sm hover:shadow-md hover:bg-stone-50 dark:hover:bg-stone-800 transition-all group disabled:opacity-50"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-stone-300 border-t-stone-900 dark:border-stone-700 dark:border-t-stone-100 rounded-full animate-spin" />
          ) : (
            <img src="https://www.google.com/favicon.ico" className="w-5 h-5" />
          )}
          <span className="font-semibold text-stone-700 dark:text-stone-200">
            {loading ? 'Вход...' : 'Войти через Google'}
          </span>
          {!loading && <ChevronRight size={18} className="text-stone-300 group-hover:translate-x-1 transition-transform" />}
        </button>

        <p className="text-stone-400 dark:text-stone-500 text-sm">
          Никаких отвлекающих факторов. Только вы и ваши слова.
        </p>
      </motion.div>
    </div>
  );
}
