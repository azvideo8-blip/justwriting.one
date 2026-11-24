import sys
p=sys.argv[1]; s=open(p).read()
# DW-4: ключ копии при уходе выбирает мутатор черновика, а не хук.
s=s.replace("    const key = uid.startsWith('guest') ? STORAGE_KEYS.GUEST_DRAFT : STORAGE_KEYS.DRAFT(uid);\n    if (!uid.startsWith('guest') &&","    const key = STORAGE_KEYS.DRAFT(uid);\n    if (!uid.startsWith('guest') &&")
open(p,'w').write(s)
