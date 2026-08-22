import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("      flowType: 'pkce',\n","")
open(p,'w').write(s)
