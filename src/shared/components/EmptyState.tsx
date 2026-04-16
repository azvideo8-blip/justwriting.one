import { motion } from 'motion/react';
import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-16 px-6 text-center space-y-4"
    >
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-surface-card text-text-main/30">
        <Icon size={28} />
      </div>
      <h3 className="text-lg font-bold text-text-main/70">{title}</h3>
      {description && (
        <p className="text-sm text-text-main/40 max-w-sm">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-2 px-6 py-2.5 rounded-2xl bg-text-main text-surface-base font-bold text-sm hover:opacity-90 transition-all"
        >
          {action.label}
        </button>
      )}
    </motion.div>
  );
}
