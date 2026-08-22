import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("""      draftPuts.push(draftStore.delete('guest_draft'));
      try { localStorage.removeItem(STORAGE_KEYS.GUEST_DRAFT); } catch { /* ignore */ }""","")
open(p,'w').write(s)
