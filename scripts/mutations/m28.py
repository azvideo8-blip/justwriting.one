import sys
p=sys.argv[1]; s=open(p).read()
# D13: стирание гостевых копий — одна функция consumeGuestDraftCopies.
s=s.replace("""    await guestDb.delete('drafts', 'guest_draft');
    if (userDb !== guestDb) {""","""    if (userDb !== guestDb) {""")
s=s.replace("""  try { localStorage.removeItem(STORAGE_KEYS.GUEST_DRAFT); } catch { /* ignore */ }""","")
open(p,'w').write(s)
