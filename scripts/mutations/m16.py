import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("    if (setupInFlightRef.current || loading) return;","    if (loading) return;")
open(p,'w').write(s)
