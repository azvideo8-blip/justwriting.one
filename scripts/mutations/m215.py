import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("""      if (updateError != null) {
        failedUuids.push(doc.uuid ?? '');
        reportError(updateError, { action: 'renameTagInAllDocs_update', docUuid: doc.uuid });
      }""","""      if (updateError != null) {
        reportError(updateError, { action: 'renameTagInAllDocs_update', docUuid: doc.uuid });
      }""")
open(p,'w').write(s)
