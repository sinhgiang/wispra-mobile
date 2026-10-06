// The two switches of the Learned section (T-0182), as on the computer: "Learn my words" (learningEnabled)
// and "Learn my vocabulary from History" (autoLearnVocabulary). When learning is off, nothing learned is
// applied and nothing new is learned; the lists are kept. The plain Custom vocabulary keeps working.
export interface LearningSettings {
  learning: boolean;
  autoLearn: boolean;
}

export const DEFAULT_LEARNING: LearningSettings = { learning: true, autoLearn: true };

export function parseLearning(json: string | null | undefined): LearningSettings {
  if (!json) return DEFAULT_LEARNING;
  try {
    const v = JSON.parse(json) as Partial<LearningSettings> | null;
    return { learning: v?.learning !== false, autoLearn: v?.autoLearn !== false };
  } catch {
    return DEFAULT_LEARNING;
  }
}

export function serializeLearning(settings: LearningSettings): string {
  return JSON.stringify(settings);
}
