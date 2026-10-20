import sys
p=sys.argv[1]; s=open(p).read()
# 2.15 (0.10.3): catch (updateError) вместо if (updateError != null).
s=s.replace("""      } catch (updateError) {
        failedUuids.push(doc.uuid ?? '');
        reportError(updateError, { action: 'renameTagInAllDocs_update', docUuid: doc.uuid });
      }""","""      } catch (updateError) {
        reportError(updateError, { action: 'renameTagInAllDocs_update', docUuid: doc.uuid });
      }""")
open(p,'w').write(s)
