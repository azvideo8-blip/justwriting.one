import { createContext, useContext, useState, useMemo, useCallback, ReactNode } from 'react';

interface LoginModalContextType {
  loginModalOpen: boolean;
  openLoginModal: () => void;
  closeLoginModal: () => void;
}

const LoginModalContext = createContext<LoginModalContextType>({
  loginModalOpen: false,
  openLoginModal: () => {},
  closeLoginModal: () => {},
});

export function LoginModalProvider({ children }: { children: ReactNode }) {
  const [loginModalOpen, setLoginModalOpen] = useState(false);

  const openLoginModal = useCallback(() => setLoginModalOpen(true), []);
  const closeLoginModal = useCallback(() => setLoginModalOpen(false), []);

  const value = useMemo(() => ({
    loginModalOpen,
    openLoginModal,
    closeLoginModal,
  }), [loginModalOpen, openLoginModal, closeLoginModal]);

  return (
    <LoginModalContext.Provider value={value}>
      {children}
    </LoginModalContext.Provider>
  );
}

export function useLoginModal() {
  return useContext(LoginModalContext);
}
