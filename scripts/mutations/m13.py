import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("""    const unsub = onPasswordRecovery(() => {
      setRecoveryMode(true);""","""    const unsub = onPasswordRecovery(() => {""")
open(p,'w').write(s)
