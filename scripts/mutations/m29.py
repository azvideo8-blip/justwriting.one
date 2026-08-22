import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace(".eq('version', parseVersionNumber(versionId));",".eq('version', parseInt(versionId, 10));")
open(p,'w').write(s)
