export function getFontStack(fontFamily: string): string {
  return fontFamily === 'serif'
    ? 'Lora, Georgia, serif'
    : fontFamily === 'mono'
      ? 'JetBrains Mono, monospace'
      : 'Inter, system-ui, sans-serif';
}
