import React from 'react';
import { motion } from 'motion/react';
import { ChevronRight } from 'lucide-react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';

export function LoginView() {
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
            Минималистичное пространство для писателей. Пишите каждый день, отслеживайте прогресс и делитесь творчеством.
          </p>
        </div>

        <button 
          onClick={() => signInWithPopup(auth, googleProvider)}
          className="w-full flex items-center justify-center gap-3 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 py-4 rounded-xl shadow-sm hover:shadow-md hover:bg-stone-50 dark:hover:bg-stone-800 transition-all group"
        >
          <img src="https://www.google.com/favicon.ico" className="w-5 h-5" />
          <span className="font-semibold text-stone-700 dark:text-stone-200">Войти через Google</span>
          <ChevronRight size={18} className="text-stone-300 group-hover:translate-x-1 transition-transform" />
        </button>

        <p className="text-stone-400 dark:text-stone-500 text-sm">
          Никаких отвлекающих факторов. Только вы и ваши слова.
        </p>
      </motion.div>
    </div>
  );
}
