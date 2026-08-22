import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("  useEffect(() => onPasswordRecovery(() => setRecoveryMode(true)), []);",
            "  useEffect(() => onPasswordRecovery(() => {}), []);")
open(p,'w').write(s)
