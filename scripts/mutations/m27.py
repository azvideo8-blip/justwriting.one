import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("""          const isGuest = user.uid.startsWith('guest');
          const key = isGuest ? STORAGE_KEYS.GUEST_DRAFT : `draft-${user.uid}`;""","""          const key = `draft-${user.uid}`;""")
s=s.replace("          if (!isGuest && getEncryptionEnabled(user.uid)) {","          if (getEncryptionEnabled(user.uid)) {")
open(p,'w').write(s)
