import { deleteDraft, getDraft, getDraftFromFirestore } from '../../../lib/db';

export const WritingDraftService = {
  loadDraft: async (userId: string) => {
    const [localDraft, cloudDraft] = await Promise.all([getDraft(userId), getDraftFromFirestore(userId)]);
    
    let draftToLoad = null;

    if (localDraft && cloudDraft) {
      draftToLoad = localDraft.updatedAt > cloudDraft.updatedAt ? localDraft : cloudDraft;
    } else {
      draftToLoad = localDraft || cloudDraft;
    }

    return draftToLoad;
  },
  
  deleteDraft: async (userId: string) => {
    await deleteDraft(userId);
  }
};
