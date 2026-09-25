import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("[uid, chargedDay, kind],", "[uid, today(), kind],")
open(p,'w').write(s)
