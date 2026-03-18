import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronRight, AlertCircle, Mail, Lock, UserPlus, LogIn } from 'lucide-react';
import { signInWithPopup, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';

export function LoginView() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
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

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Пожалуйста, заполните все поля.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (mode === 'register') {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      console.error("Email auth error:", err);
      let msg = err.message;
      if (err.code === 'auth/user-not-found') msg = "Пользователь не найден.";
      if (err.code === 'auth/wrong-password') msg = "Неверный пароль.";
      if (err.code === 'auth/email-already-in-use') msg = "Этот email уже используется.";
      if (err.code === 'auth/weak-password') msg = "Пароль слишком простой.";
      if (err.code === 'auth/invalid-credential') msg = "Неверный email или пароль.";
      if (err.code === 'auth/operation-not-allowed') {
        msg = "Вход по Email не включен в консоли Firebase. Пожалуйста, включите провайдера 'Email/Password' в настройках Authentication.";
      }
      if (err.code === 'auth/network-request-failed') {
        msg = "Ошибка сети при попытке входа. Проверьте соединение или убедитесь, что провайдер Email включен в консоли Firebase.";
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-stone-50 dark:bg-stone-950 px-6 overflow-y-auto py-10">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full text-center space-y-8"
      >
        <div className="space-y-4">
          <div className="w-16 h-16 bg-stone-900 dark:bg-stone-100 rounded-2xl flex items-center justify-center text-white dark:text-stone-900 font-bold text-4xl mx-auto shadow-2xl">J</div>
          <h1 className="text-5xl font-bold tracking-tight dark:text-stone-100">justwriting.one</h1>
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
            <p className="break-words">{error}</p>
          </motion.div>
        )}

        <div className="bg-white dark:bg-stone-900 p-8 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-xl space-y-6">
          <form onSubmit={handleEmailAuth} className="space-y-4">
            <div className="space-y-2 text-left">
              <label className="text-xs font-bold text-stone-400 uppercase tracking-widest ml-1">Email</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                <input 
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full pl-12 pr-4 py-3 bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 rounded-xl focus:ring-2 focus:ring-stone-900 dark:focus:ring-stone-100 outline-none transition-all dark:text-stone-100"
                />
              </div>
            </div>

            <div className="space-y-2 text-left">
              <label className="text-xs font-bold text-stone-400 uppercase tracking-widest ml-1">Пароль</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                <input 
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-12 pr-4 py-3 bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 rounded-xl focus:ring-2 focus:ring-stone-900 dark:focus:ring-stone-100 outline-none transition-all dark:text-stone-100"
                />
              </div>
            </div>

            <button 
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 py-4 rounded-xl font-bold hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-stone-300 border-t-white dark:border-stone-700 dark:border-t-stone-900 rounded-full animate-spin" />
              ) : (
                mode === 'login' ? <LogIn size={18} /> : <UserPlus size={18} />
              )}
              {mode === 'login' ? 'Войти' : 'Создать аккаунт'}
            </button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-stone-100 dark:border-stone-800"></div></div>
            <div className="relative flex justify-center text-xs uppercase"><span className="bg-white dark:bg-stone-900 px-2 text-stone-400">Или</span></div>
          </div>

          <button 
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 py-4 rounded-xl shadow-sm hover:shadow-md hover:bg-stone-50 dark:hover:bg-stone-800 transition-all group disabled:opacity-50"
          >
            <img src="https://www.google.com/favicon.ico" className="w-5 h-5" />
            <span className="font-semibold text-stone-700 dark:text-stone-200">Google</span>
          </button>

          <button 
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            className="text-sm font-medium text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 transition-colors"
          >
            {mode === 'login' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
          </button>
        </div>

        <p className="text-stone-400 dark:text-stone-500 text-sm">
          Никаких отвлекающих факторов. Только вы и ваши слова.
        </p>
      </motion.div>
    </div>
  );
}
