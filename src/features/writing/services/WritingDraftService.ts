import { deleteDraft, getDraft, getDraftFromFirestore, saveToLocal, saveToFirestore, Draft } from '../../../lib/db';

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
  
  importDraft: async (userId: string, draft: Draft) => {
    const newDraft = { ...draft, userId };
    await saveToLocal(newDraft);
    await saveToFirestore(newDraft);
  },

  deleteDraft: async (userId: string) => {
    await deleteDraft(userId);
  }
};
