import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("""export function vectorScore01(raw: number): number {
  return Math.max(0, raw);
}""","""export function vectorScore01(raw: number): number {
  return Math.min(1, Math.max(0, raw) * 20);
}""")
open(p,'w').write(s)
