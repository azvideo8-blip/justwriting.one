import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("""  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('doc-version-saved', { detail: { documentId } }));
  }""","")
open(p,'w').write(s)
