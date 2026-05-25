import React from 'react';

export function StatCard({ value, label, accent }: {
  value: string | number;
  label: string;
  accent?: boolean;
}) {
  return (
    <div style={{
      flex: 1,
      padding: '14px 16px',
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${accent ? 'oklch(0.72 0.13 155 / 0.3)' : 'rgba(255,255,255,0.07)'}`,
      borderRadius: 14,
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <div style={{
        fontSize: 24,
        fontWeight: 500,
        color: accent ? 'var(--brand-primary)' : 'rgba(232,236,233,0.95)',
        lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </div>
      <div style={{
        fontSize: 11,
        color: 'rgba(74,81,77,1)',
        textTransform: 'uppercase',
        letterSpacing: '.06em',
        fontFamily: 'JetBrains Mono, monospace',
      }}>
        {label}
      </div>
    </div>
  );
}

export function SettingRow({ label, children, hint }: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div style={{
      padding: '14px 0',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}>
        <span style={{ fontSize: 14, color: 'rgba(232,236,233,0.8)' }}>
          {label}
        </span>
        {children}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: 'rgba(74,81,77,1)' }}>{hint}</div>
      )}
    </div>
  );
}
