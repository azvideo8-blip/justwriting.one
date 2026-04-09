import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, Mail, Lock, UserPlus, LogIn } from 'lucide-react';
import { signInWithPopup, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { auth, googleProvider } from '../../../core/firebase/auth';

export function LoginPage() {
  const [error, setError] = useState<React.ReactNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      googleProvider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, googleProvider);
    } catch (err: unknown) {
      const firebaseError = err as { code?: string; message?: string };
      if (firebaseError.code !== 'auth/cancelled-popup-request' && firebaseError.code !== 'auth/popup-closed-by-user') {
        if (firebaseError.code === 'auth/network-request-failed') {
          setError("Ошибка сети при авторизации через Google. Проверьте интернет-соединение или настройки Authorized Domains в консоли Firebase.");
        } else {
          setError(firebaseError.message || "Произошла ошибка при входе.");
        }
      }
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
    } catch (err: unknown) {
      console.error("Email auth error:", err);
      const firebaseError = err as { code?: string; message?: string };
      let msg = firebaseError.message || "An error occurred";
      if (firebaseError.code === 'auth/user-not-found') msg = "Пользователь не найден.";
      if (firebaseError.code === 'auth/wrong-password') msg = "Неверный пароль.";
      if (firebaseError.code === 'auth/email-already-in-use') msg = "Этот email уже используется.";
      if (firebaseError.code === 'auth/weak-password') msg = "Пароль слишком простой.";
      if (firebaseError.code === 'auth/invalid-credential') msg = "Неверный email или пароль.";
      if (firebaseError.code === 'auth/operation-not-allowed') {
        msg = "Вход по Email не включен в консоли Firebase. Пожалуйста, включите провайдера 'Email/Password' в настройках Authentication.";
      }
      if (firebaseError.code === 'auth/network-request-failed') {
        msg = "Ошибка сети при попытке входа. Проверьте соединение или убедитесь, что провайдер Email включен в консоли Firebase.";
      }
      if (firebaseError.code === 'auth/internal-error') {
        msg = "Внутренняя ошибка Firebase. Убедитесь, что провайдер Email/Password включен в консоли Firebase (Authentication -> Sign-in method), или попробуйте позже.";
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center px-6 overflow-y-auto py-10 bg-surface-base">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full text-center space-y-8"
      >
        <div className="space-y-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center font-bold text-4xl mx-auto shadow-2xl bg-text-main text-surface-base border border-border-subtle font-black shadow-[0_0_30px_rgba(255,255,255,0.2)]">J</div>
          <h1 className="text-5xl font-bold tracking-tight text-text-main">justwriting.one</h1>
          <p className="text-lg leading-relaxed text-text-main/50">
            Минималистичное пространство для писателей.
          </p>
        </div>

        {error && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-4 rounded-xl flex items-center gap-3 text-sm text-left border bg-red-500/10 border-red-500/30 text-red-400"
          >
            <AlertCircle size={20} className="shrink-0" />
            <div className="break-words">{error}</div>
          </motion.div>
        )}

        <div className="p-8 rounded-3xl shadow-xl space-y-6 border bg-surface-card border-border-subtle backdrop-blur-2xl">
          <form onSubmit={handleEmailAuth} className="space-y-4">
            <div className="space-y-2 text-left">
              <label className="text-xs font-bold uppercase tracking-widest ml-1 text-text-main/50">Email</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-text-main/40" size={18} />
                <input 
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full pl-12 pr-4 py-3 rounded-xl outline-none transition-all bg-surface-base/5 border border-border-subtle text-text-main focus:ring-2 focus:ring-text-main/20 placeholder:text-text-main/20"
                />
              </div>
            </div>

            <div className="space-y-2 text-left">
              <label className="text-xs font-bold uppercase tracking-widest ml-1 text-text-main/50">Пароль</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-text-main/40" size={18} />
                <input 
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-12 pr-4 py-3 rounded-xl outline-none transition-all bg-surface-base/5 border border-border-subtle text-text-main focus:ring-2 focus:ring-text-main/20 placeholder:text-text-main/20"
                />
              </div>
            </div>

            <button 
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-xl font-bold hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 bg-text-main text-surface-base"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 rounded-full animate-spin border-surface-base/20 border-t-surface-base" />
              ) : (
                mode === 'login' ? <LogIn size={18} /> : <UserPlus size={18} />
              )}
              {mode === 'login' ? 'Войти' : 'Создать аккаунт'}
            </button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border-subtle"></div></div>
            <div className="relative flex justify-center text-xs uppercase"><span className="px-2 bg-surface-card text-text-main/40">Или</span></div>
          </div>

          <button 
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 py-4 rounded-xl shadow-sm hover:shadow-md transition-all group disabled:opacity-50 border bg-surface-base/5 border-border-subtle hover:bg-surface-base/10 text-text-main"
          >
            <img src="https://www.google.com/favicon.ico" className="w-5 h-5" />
            <span className="font-semibold text-text-main">Google</span>
          </button>

          <button 
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            className="text-sm font-medium transition-colors text-text-main/50 hover:text-text-main"
          >
            {mode === 'login' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
          </button>
        </div>

        <p className="text-sm text-text-main/40">
          Никаких отвлекающих факторов. Только вы и ваши слова.
        </p>
      </motion.div>
    </div>
  );
}
