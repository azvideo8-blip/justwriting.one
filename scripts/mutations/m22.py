import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("sessionStartWords: wordCount ?? state.sessionStartWords,","sessionStartWords: wordCount ?? 0,")
open(p,'w').write(s)
