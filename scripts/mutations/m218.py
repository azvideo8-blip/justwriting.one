import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("userId: hashUid(uid) });","userId: uid });")
open(p,'w').write(s)
