// Judge prompts the eval can compare. `baseline` is exactly what filter.ts ships.
import { judgePrompt, makeJudgePrompt, type JudgePrompt } from "./filter";

const JUDGE = "Scoring guide. Judge the piece, not the blurb: feed blurbs are short, so infer from title, author and source.";

// v1: what he finishes and highlights is first-person writing from inside a lived practice;
// what he opens and abandons is commentary on the news cycle, even about power or AI.
const V1 = `${JUDGE} What he finishes and highlights is mostly first-person essays from inside a lived practice or relationship: a writer working through their own inner life, friendship, love, community or spiritual path and naming what they found. What he opens and then abandons is mostly commentary that reacts to the news cycle: takes on AI labs, AI policy and safety debates, politics, economics and geopolitics, even when framed around power or AI. An original thesis about power still counts; a smart reaction to this week's events does not. 9-10: directly feeds a live question with a real argument, from lived experience or a big original thesis; he would bring it to Church. 5-8: a thoughtful piece he would be glad to find: a personal essay touching a live question, a writer he follows at their most reflective, or a serious essay on how to live, think or organize together. 2-4: competent but off his questions, and commentary on AI-industry news, policy fights, markets or politics however smart; roundups, weekly series and overviews score a notch below a comparable essay, not zero. 0-1: news, promo, product, short-form, or noise.`;

export const PROMPTS: Record<string, JudgePrompt> = {
  baseline: judgePrompt,
  "baseline-rerun": judgePrompt,
  v1: makeJudgePrompt(V1),
};
