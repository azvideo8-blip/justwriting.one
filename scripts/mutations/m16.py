import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("    if (setupInFlightRef.current || busy) return;","    if (busy) return;")
open(p,'w').write(s)
