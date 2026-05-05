export function getFontStack(fontFamily: string): string {
  if (fontFamily === 'serif' || fontFamily === 'Lora') {
    return 'Lora, Georgia, serif';
  }
  if (fontFamily === 'mono' || fontFamily === 'JetBrains Mono') {
    return 'JetBrains Mono, monospace';
  }
  return 'Inter, system-ui, sans-serif';
}
