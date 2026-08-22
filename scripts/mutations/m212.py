import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("      wordsByDate[key] = (wordsByDate[key] || 0) + (s.sessionWordsAdded || s.wordCount || 0);",
            "      wordsByDate[key] = (wordsByDate[key] || 0) + (s.wordCount || 0);")
open(p,'w').write(s)
