import sys
p=sys.argv[1]; s=open(p).read()
# AG-5 (2026-09-27): удаление источника переехало внутрь ветки «записано в аккаунт».
s=s.replace("""        await guestDb.delete('drafts', 'guest_draft');
        if (userDb !== guestDb) {""","""        if (userDb !== guestDb) {""")
s=s.replace("""        try { localStorage.removeItem(STORAGE_KEYS.GUEST_DRAFT); } catch { /* ignore */ }""","")
open(p,'w').write(s)
