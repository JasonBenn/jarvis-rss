// Judge prompts the eval can compare. `baseline` is exactly what filter.ts ships.
import { judgePrompt, type JudgePrompt } from "./filter";

export const PROMPTS: Record<string, JudgePrompt> = {
  baseline: judgePrompt,
};
