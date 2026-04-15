import React from 'react';
import { Menu, WifiOff } from 'lucide-react';
import { User } from 'firebase/auth';
import { useLanguage } from '../../../core/i18n';
import { cn } from '../../../core/utils/utils';
import { NAV_CONFIG } from '../../../shared/lib/layoutRegistry';
import { DesktopNav } from './DesktopNav';
import { MobileMenu } from './MobileMenu';

interface ClassicNavBarProps {
  showZen: boolean;
  isConnected: boolean;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  view: 'write' | 'profile' | 'archive' | 'feed' | 'admin';
  setView: (view: 'write' | 'profile' | 'archive' | 'feed' | 'admin') => void;
  isAdmin: boolean;
  user: User;
}

export function ClassicNavBar({
  showZen,
  isConnected,
  mobileMenuOpen,
  setMobileMenuOpen,
  view,
  setView,
  isAdmin,
  user
}: ClassicNavBarProps) {
  const { t } = useLanguage();

  return (
    <>
      <nav className={cn(
        "fixed top-0 left-0 right-0 h-16 z-50 px-4 md:px-6 flex items-center justify-between transition-all duration-1000 bg-surface-base/50 backdrop-blur-xl border-b border-border-subtle",
        showZen ? "opacity-0 pointer-events-none -translate-y-4" : "opacity-100 translate-y-0"
      )}>
        {!isConnected && (
          <div className="absolute top-16 left-0 right-0 bg-red-500 text-white text-[11px] font-bold py-1 px-4 flex items-center justify-center gap-2 animate-pulse">
            <WifiOff size={12} />
            {t('common_offline')}
          </div>
        )}
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setMobileMenuOpen(true)}
            className={cn("p-2 -ml-2 text-text-main/50 hover:text-text-main", NAV_CONFIG.MOBILE_BREAKPOINT_CLASS)}
          >
            <Menu size={24} />
          </button>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xl font-black bg-text-main text-surface-base shadow-[0_0_15px_rgba(255,255,255,0.2)]">J</div>
          <span className="font-bold text-xl tracking-tight hidden lg:inline text-text-main">justwriting.one</span>
        </div>
        
        <div className={NAV_CONFIG.DESKTOP_SHOW_CLASS}>
          <DesktopNav view={view} setView={setView} isAdmin={isAdmin} user={user} />
        </div>

        {/* Mobile Header Actions */}
        <div className="flex lg:hidden items-center gap-2">
          <img src={user.photoURL || undefined} className="w-8 h-8 rounded-full border border-border-subtle" referrerPolicy="no-referrer" />
        </div>
      </nav>

      <MobileMenu 
        isOpen={mobileMenuOpen} 
        onClose={() => setMobileMenuOpen(false)} 
        view={view} 
        setView={setView} 
        isAdmin={isAdmin} 
      />
    </>
  );
}
