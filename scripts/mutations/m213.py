import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("  content: z.string(),\n  title: z.string().nullish(),\n  savedDocumentId: z.string().nullish(),",
            "  content: z.unknown().optional(),\n  title: z.unknown().nullish(),\n  savedDocumentId: z.unknown().nullish(),")
open(p,'w').write(s)
