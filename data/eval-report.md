# What Jason finishes: an engagement eval for the feed filter

**Bottom line.** 2,231 Reader documents labeled by how Jason engaged, and the nightly judge graded against them. Two prompt rewrites did not beat the current prompt on the held-out split, so **no prompt change ships** and nose is untouched. On feed arrivals, the filter's real job, the judge already ranks well (AUC 0.74–0.75 in every run). A balanced feed-only rerun (section 7) puts that lower: AUC 0.65 over all feed reads, 0.70 on those saved since 2025. On his hand-saves it sits at chance (0.45–0.47): they are all on-taste, and whether he finishes one depends on things the judge never sees. Prompt framing never moved feed ranking; the next gain is showing the judge more of the piece. Feeds: 19 to unsubscribe and 68 low-class YouTube channels to drop unjudged. A stricter bar for noisy feeds does not work: the judge can't find their rare great piece.

## 1. The eval set

`make eval-set` (`src/eval-set.ts --summary`) reads all four Reader locations plus highlights and writes `data/eval-set.jsonl`, one row per labeled doc with the rule that fired (`reason`) and its metrics. Snapshot 2026-11-01: 16,028 documents, 3,845 highlights.

| label | rule (strongest first) | count |
|---|---|---|
| strong_like | any highlight or doc note; or sitting in `later` and read ≥ 90% | 964 |
| like | hand-saved, read ≥ 90%, ≥ 800 words | 107 |
| dislike | opened, abandoned between 5% and 60%, last opened > 3 days ago, no highlight, note or tag of his own | 624 |
| weak_dislike | read ≥ 90% with no highlight, note or tag | 536 |

Excluded: newsletters (1,741), video and podcasts (2,830), docs under 300 words (1,774), books (95), uploads and ChatGPT shares (16), saves from the last 3 days (47). **Anything unopened is never labeled**, filter keeps and the lead's picks included: per Jason, untouched is not evidence. `pick`/`far` don't count as his tag, so a pick he opened and abandoned is a dislike.

Edge cases:
- **No move history:** "moved to later, then read" is visible only while the doc is still in `later` (9 docs).
- **Progress is scroll position:** 450 of 536 weak dislikes sit at exactly 100%, which may be "mark as read".
- **Hand-saved likes include work reading:** the 2025 job search left dozens of highlighted system-design pieces, which his Taste section rules out.
- **Abandoned is often interrupted:** many dislikes are on his questions.

Ten random rows per label (since 2025):

**strong_like** (964 total, 437 since 2025)

| title | feed | words | rule |
|---|---|---|---|
| https://newsletter.rootsofprogress.org/p/the-future-of-humanity-is-in- | progressforum.org | 3800 | engaged: 3 highlights |
| Modern trade-off Analysis for Distributed System Architecture | medium.com | 2348 | engaged: doc note |
| Are Sparse Autoencoders Useful? A Case Study in Sparse Probing | arxiv.org | 12782 | engaged: 3 highlights |
| The art of industrial leapfrogging | blog.spec.tech | 5730 | engaged: 5 highlights |
| Augmenting Long-term Memory | augmentingcognition.com | 16884 | engaged: 6 highlights |
| Why I'm long-term bullish on the Middle East | noahpinion.blog | 1921 | engaged: 1 highlights |
| The end of the age of heroes | noahpinion.blog | 3126 | engaged: 1 highlights |
| Face it: you're a crazy person | experimental-history.com | 3426 | engaged: 1 highlights |
| New horizons in healing / A map of the space | amandango.substack.com | 2793 | engaged: 2 highlights |
| Theo Von: No Offense | scrapsfromtheloft.com | 9723 | engaged: 2 highlights |

**like** (107 total, 45 since 2025)

| title | feed | words | rule |
|---|---|---|---|
| Plan A’s problem with dry tinder | newsletter.forethought.org | 2521 | hand-saved (Reader Share Sheet iOS), read to 100%, 2521 words |
| Find Your People | foundersatwork.posthaven.com | 1285 | hand-saved (Readwise web highlighter), read to 98%, 1285 words |
| Case Study: Tamera | supernuclear.substack.com | 2124 | hand-saved (Reader Share Sheet iOS), read to 98%, 2124 words |
| The Autumn of the Ayatollahs | reader.foreignaffairs.com | 4887 | hand-saved (Reader Share Sheet iOS), read to 100%, 4887 words |
| I used to be a high-performing robot | usefulfictions.substack.com | 1677 | hand-saved (Readwise web highlighter), read to 100%, 1677 words |
| Market Intermediaries: A Post-AGI Market Alignment Vision | notion.so | 3753 | hand-saved (Readwise web highlighter), read to 97%, 3753 words |
| Heuristics for lab robotics, and where its future may go | owlposting.com | 8305 | hand-saved (Reader in app link save), read to 92%, 8305 words |
| Cathie Wood’s 2026 Outlook: The US Economy Is A Coiled Spring | ark-invest.com | 3440 | hand-saved (Readwise web highlighter), read to 99%, 3440 words |
| Evaluating the Effectiveness of LLM-Evaluators (aka LLM-as-Judge) | eugeneyan.com | 9660 | hand-saved (Reader Share Sheet iOS), read to 91%, 9660 words |
| Some Good Stuff About Friendship to Read (and Watch) | julieebeck.beehiiv.com | 991 | hand-saved (Reader Share Sheet Android), read to 100%, 991 words |

**dislike** (624 total, 246 since 2025)

| title | feed | words | rule |
|---|---|---|---|
| Four Awakenings | overcomingbias.com | 695 | abandoned at 32%, last opened 2025-02-25 |
| Claude Opus 4.6 Escalates Things Quickly | thezvi.wordpress.com | 10185 | abandoned at 7%, last opened 2026-02-13 |
| Europe is under siege | noahpinion.blog | 3958 | abandoned at 6%, last opened 2025-12-07 |
| DeepSeek Disruption: AI, NVIDIA, and the Future of Venture Capital | elizabethyin.com | 1308 | abandoned at 17%, last opened 2025-01-30 |
| Claude Opus 5: Model Welfare | thezvi.substack.com | 7230 | abandoned at 21%, last opened 2026-07-28 |
| How technology has already changed the world in my lifetime | noahpinion.blog | 2747 | abandoned at 52%, last opened 2026-02-16 |
| March 2025 Updates | mattsclancy.substack.com | 2790 | abandoned at 35%, last opened 2025-03-18 |
| Funding for-profits with charitable dollars | manifund.substack.com | 1534 | abandoned at 48%, last opened 2026-10-03 |
| What comes next with reinforcement learning | interconnects.ai | 2772 | abandoned at 41%, last opened 2025-06-18 |
| AI Is About the Vibes Now | persuasion.community | 1828 | abandoned at 13%, last opened 2026-03-20 |

**weak_dislike** (536 total, 204 since 2025)

| title | feed | words | rule |
|---|---|---|---|
| Roundup #82: Staring in wonder at the world | noahpinion.blog | 3976 | read to 100% with no highlight, note or tag |
| Before we start on quantum | scottaaronson.blog | 1219 | read to 100% with no highlight, note or tag |
| Outcome Orientation as a Cure for Information Overload | commoncog.com | 1902 | read to 97% with no highlight, note or tag |
| Building a Space People Never Want to Leave | supernuclear.substack.com | 2795 | read to 97% with no highlight, note or tag |
| Why Silicon Valley Democrats Should Divorce California Labor Unions | x.com | 674 | read to 100% with no highlight, note or tag |
| Trump starts to break things | noahpinion.blog | 1865 | read to 100% with no highlight, note or tag |
| The U.S.-China competition is on pause | noahpinion.blog | 425 | read to 100% with no highlight, note or tag |
| Some simple lessons from China's big AI breakthrough` | noahpinion.blog | 831 | read to 100% with no highlight, note or tag |
| 🟡 Trump threatens NATO, US bombs Kharg Island in Iran, US Marine unit  | blog.sentinel-team.org | 2542 | read to 100% with no highlight, note or tag |
| It's time for Abundance to get mad | noahpinion.blog | 561 | read to 100% with no highlight, note or tag |

## 2. Baseline

`make eval P=<prompt>` (`src/eval.ts`) judges the set through the filter's own `claudeJudge`: same model, same prompt, the same 40 latest hand saves as exemplars minus any graded doc. Results go to `data/eval-runs/`, never the production ledger. The prompt calibrates against its batch, so each batch of 20 mixes 5 eval docs with 15 real unopened feed arrivals, fixed across runs. Sample: docs saved since 2025 (today's taste), stratified by label and by feed versus hand origin, giving 398; 30% are held out by a seeded hash (112 held out, 286 train). Keep means score ≥ 5; positives are strong_like + like, negatives dislike + weak_dislike ("strict" uses dislike only). **Identical runs flip 7% of keep/drop calls** and move held-out precision 0.59–0.62. Changes under ~0.03 on the full split are noise, and on the feed slices recall moved 0.66 → 0.57 between identical runs.

| split | n | P | R | F1 | AUC | P (strict) | R (strict) | F1 (strict) |
|---|---|---|---|---|---|---|---|---|
| train | 286 | 0.57 | 0.48 | 0.52 | 0.60 | 0.69 | 0.48 | 0.56 |
| holdout | 112 | 0.62 | 0.47 | 0.54 | 0.57 | 0.74 | 0.47 | 0.58 |
| all | 398 | 0.59 | 0.48 | 0.53 | 0.59 | 0.71 | 0.48 | 0.57 |
| holdout, feed arrivals | 50 | 0.38 | 0.67 | 0.48 | 0.74 | 0.60 | 0.67 | 0.63 |
| all, feed arrivals | 185 | 0.32 | 0.66 | 0.43 | 0.75 | 0.52 | 0.66 | 0.58 |
| all, hand saves | 213 | 0.78 | 0.44 | 0.56 | 0.47 | 0.79 | 0.44 | 0.56 |

Score distribution per label (count at each score 0..10, mean, share kept):

- strong_like (n=187): [6 20 19 23 26 25 29 24 12 3 0] mean 4.39, kept 50%
- like (n=19): [2 2 1 6 3 1 0 3 1 0 0] mean 3.58, kept 26%
- dislike (n=105): [4 16 18 13 13 18 10 5 6 2 0] mean 3.75, kept 39%
- weak_dislike (n=87): [4 8 19 17 11 11 13 4 0 0 0] mean 3.47, kept 32%

**Liked but scored low** (108; worst 15):

| score | label | title | feed | judge's why |
|---|---|---|---|---|
| 0 | strong_like | Hello Interview / System Design in a Hurry | hellointerview.com | Database system design interview prep; tutorial. |
| 0 | strong_like | DOE makes $3B commitment to two sustainable aviation… / Canary Media | canarymedia.com | Energy policy news about loan guarantees; news brief. |
| 0 | strong_like | Data Processing Pipelines | sre.google | Google SRE book chapter on data pipelines; technical manual. |
| 0 | strong_like | Meta’s approach to machine learning prediction robustness | engineering.fb.com | Engineering post on ad ML robustness; technical and off topic. |
| 0 | like | Get sexier | ariababu.co.uk | Appearance advice listicle; self-improvement and off his questions. |
| 0 | like | Flexy Series Hip Flexibility | readwise.io | Hip flexibility workout program; fitness how-to, not his questions. |
| 0 | strong_like | Deep Learning Interviews: Hundreds of fully solved job interview quest | arxiv.org | Interview-prep question collection; technical reference, off his taste. |
| 0 | strong_like | The Function Colour Myth | lukasa.co.uk | Programming async/await explainer; a tool tutorial with no link to his questions. |
| 1 | strong_like | Building Highly Reliable Data Pipelines at Datadog | datadoghq.com | Engineering blog on data pipelines; off all his questions. |
| 1 | strong_like | From Code to Creativity: How AI is Transforming the Software Developme | douglevin.substack.com | Generic AI-in-software overview; the kind of tool and industry piece he skips. |
| 1 | strong_like | GitHub - mercari/ml-system-design-pattern: System design patterns for  | github.com | ML engineering pattern repo; technical reference, not his questions. |
| 1 | like | Cathie Wood’s 2026 Outlook: The US Economy Is A Coiled Spring | ark-invest.com | Market outlook from Ark; market commentary. |
| 1 | strong_like | How Netflix Built a Distributed Counter for Billions of User Interacti | blog.bytebytego.com | Engineering deep-dive on Netflix counters; tool/tech tutorial, no live question. |
| 1 | strong_like | AI and the Workforce: Preparing for the Jobs of the Future | thoughtful.ai | Generic corporate blog on AI and jobs; no argument. |
| 1 | strong_like | Chinese Manufacturers Use 12 Times More Robots Than U.S. Manufacturers | itif.org | Dated 2023 policy think-tank stat on robot adoption; off his questions. |

**Disliked but scored high** (69; worst 15):

| score | label | title | feed | judge's why |
|---|---|---|---|---|
| 9 | dislike | A Group Is Its Own Worst Enemy | gwern.net | Shirky's classic on how groups sabotage themselves and what norms sustain them; feeds collective intelligence and gathering design. |
| 9 | dislike | The spiritual path is a side effect | sashachapin.substack.com | Sasha Chapin on how the spiritual path creates new problems; practice without optimization, from a writer he follows. |
| 8 | dislike | Lion's Gaze | readwise.io | Dzogchen text on rigpa and self-liberating thoughts; direct View practice from inside a tradition he reads. |
| 8 | dislike | What Popup Villages Teach Us About Permanent Ones (and Vice Versa) | supernuclear.substack.com | Popup villages vs permanent ones: how people form community and live together; fits cohousing question. |
| 8 | dislike | Viatopia | forethought.org | MacAskill on what to aim for after superintelligence; contestable thesis on power and futures, good for Church. |
| 8 | dislike | Why are we raising kids all alone? | worktopia.substack.com | Isolated parenting and chosen families ('bash'); directly serves his community, cohousing and why hanging is hard questions. |
| 8 | dislike | Uncut Gems | secondperson.dating | Great love: commitment, limits versus optionality, what intimacy asks; a contestable claim for friends. |
| 8 | dislike | The power and beauty of incrementalism | supernuclear.substack.com | Practical essay on growing a friend compound one or two neighbors a year; feeds cohousing and 'hard to hang'. |
| 7 | dislike | Rewriting the Californian Ideology | americanaffairsjournal.org | Asparouhova on tech ideology turning into community and governance movements; feeds power, egregore and collective questions. |
| 7 | dislike | There Is No Economy but Only the Debt to the Center: Money, Capital an | anthropoetics.ucla.edu | Gans-school essay on money as debt to a sacred center; deep take on power and institutions, from the humanities. |
| 7 | dislike | Four Awakenings | overcomingbias.com | Hanson on stages of awareness of institutions and cultural evolution; feeds power/egregore, a contestable thesis. |
| 7 | dislike | Import AI 431: Technological Optimism and Appropriate Fear | jack-clark.net | Jack Clark's speech on technological optimism and fear; a contestable stance on AI and power to bring to Church. |
| 7 | dislike | relationship puzzles | avabear.xyz | Ava on love in imperfect long-term partnerships; feeds the great love question, and he chose her work before. |
| 7 | weak_dislike | Building a Space People Never Want to Leave | supernuclear.substack.com | Lessons on building a space people don't leave; serves community, cohousing and why it's hard to hang. |
| 7 | weak_dislike | Slutcon, or the attractiveness of embodied authenticity | nintil.com | Embodied authenticity and self-trust in social connection; touches attunement, intimacy and trying too hard to please. |



**What the misses say.** Most "liked but scored low" docs are hand-saved work reading the judge is right to drop under his Taste section. Most "disliked but scored high" docs are on his questions but were never finished. On feed arrivals the pattern is cleaner. He finishes first-person essays from inside a lived practice or relationship. He abandons routine takes from high-cadence columnists on AI, policy and politics, which the judge scores 5–7 because they touch "power" or "AI".

## 3. Prompt iterations

Each variant changes only the scoring guide; Fascinations.md is untouched. Variants live in `src/eval-prompts.ts`.

**v1: lived essays up, news commentary down.** The baseline guide was replaced with:

```diff
- 5-8: a thoughtful piece he would be glad to find: touches a live question, comes from a writer he follows, or is a serious essay on how to live, think or organize together. 2-4: competent but off his questions; roundups and overviews score a notch below a comparable essay, not zero.
+ What he finishes and highlights is mostly first-person essays from inside a lived practice or relationship [...]. What he opens and then abandons is mostly commentary that reacts to the news cycle: takes on AI labs, AI policy and safety debates, politics, economics and geopolitics, even when framed around power or AI. An original thesis about power still counts; a smart reaction to this week's events does not.
+ 9-10: directly feeds a live question with a real argument, from lived experience or a big original thesis [...]
+ 5-8: [...] a personal essay touching a live question, a writer he follows at their most reflective [...]. 2-4: competent but off his questions, and commentary on AI-industry news, policy fights, markets or politics however smart; roundups, weekly series and overviews score a notch below [...]
```

Train precision rose 0.57 → 0.64, but held-out recall fell 0.47 → 0.37 with no precision gain: it demoted AI essays broadly, including standalone ones he highlighted (Ev Jang's "As Rocks May Think", held out; Dario on Dwarkesh, train). Rejected.

**v2: judge cadence and genre, not topic.** The baseline guide was kept, with two refinements appended:

```diff
+ Two refinements from what he actually finishes and highlights. First, personal essays from inside a lived practice or relationship [...] are the kind he highlights most: when one touches a live question it reaches 5+. Second, writers who post several times a week (newsletter columnists, weekly AI digests, reaction pieces to this week's events) are where he opens and abandons most: a routine take from them scores 3-4 even when it touches power or AI; only their occasional big standalone essay reaches 5+. A standalone essay with an original argument, about AI and power included, is judged on its argument.
```

Within noise of baseline everywhere. Rejected.

| run | held-out P | held-out R | held-out F1 | held-out AUC | feed arrivals P / R / AUC (n=185) | hand saves AUC |
|---|---|---|---|---|---|---|
| baseline | 0.62 | 0.47 | 0.54 | 0.57 | 0.32 / 0.66 / 0.75 | 0.47 |
| baseline, rerun | 0.59 | 0.46 | 0.51 | 0.56 | 0.30 / 0.57 / 0.74 | 0.45 |
| v1 | 0.61 | **0.37** | 0.46 | 0.56 | 0.37 / 0.54 / 0.74 | 0.46 |
| v2 | 0.61 | 0.46 | 0.52 | 0.55 | 0.32 / 0.60 / 0.74 | 0.46 |

**Stopped at two of four iterations.** Feed-arrival AUC (how often a like outranks a dislike) was 0.74–0.75 in all four runs. The judge sees only a title, site, author and 500-character blurb, so framing moves the threshold, not what it can tell apart. More variants would chase noise.

**Shipped prompt: none.** Production is unchanged. `claudeJudge` now takes a prompt builder; its request is verified byte-identical.

**What would move the number** (needs a go-ahead):
1. **Show the judge the opening ~400 words** (Reader returns `html_content` on request), so it can see whether a piece is an essay or a take. About 3× input tokens.
2. **Grade on feed arrivals only.** Hand-saves sit at chance whatever the prompt. There are 433 labeled feed docs since 2025, enough for the 400 cap alone.

## 4. Feed density

`src/feed-density.ts` joins the 10-27 backlog, the current Reader listing, the ledger since 10-27 and the eval labels. Arrivals, opens and stubs count from 2026-03-01 (Reader kept untouched feed docs only from then). Likes count over all time: there were only 18 feed-doc likes since March. **Stub rate** is the share of text arrivals under 300 words. Sampled to confirm: Slow Boring, Rick Rubin, Razib Khan and Ask Polly stubs are 26–270-word paywall teasers. Foreign Affairs and The Economist are 0 by design. **Density** is likes since March divided by arrivals.

**Filter keeps since 10-27: 49, opened 0.** Descriptive only: per Jason an unopened keep is not a miss, and these are at most four days old.

Top 40 feeds by arrivals (twitter.com left out because the key lumps many accounts), plus every unsubscribe candidate outside them:

| feed | sweep class | arrivals since Mar | opened | keeps since 10-27 | likes ever | dislikes | weak dislikes | stub rate | density | rec |
|---|---|---|---|---|---|---|---|---|---|---|
| persuasion.community | timeless | 344 | 3 | 2 | 0 | 2 | 2 | 0.17 | 0.000 | — |
| youtube:Dwarkesh Patel | timeless | 280 | 9 | 2 | 0 | 0 | 0 | - | 0.000 | — |
| foreignaffairs.com | timeless | 278 | 6 | 2 | 0 | 0 | 0 | 0.00 | 0.000 | — |
| youtube:TED | timeless | 202 | 3 | 0 | 0 | 0 | 0 | - | 0.000 | — |
| youtube:Andrew Huberman | timeless | 155 | 0 | 0 | 0 | 0 | 0 | - | 0.000 | — |
| astralcodexten.com | timeless | 150 | 1 | 0 | 1 | 0 | 1 | 0.31 | 0.000 | — |
| noahpinion.blog | timeless | 130 | 29 | 2 | 16 | 60 | 92 | 0.01 | 0.008 | noisy |
| construction-physics.com | timeless | 128 | 0 | 0 | 2 | 3 | 7 | 0.00 | 0.000 | noisy |
| youtube:Dry Bar Comedy | low | 109 | 4 | 0 | 0 | 0 | 0 | - | 0.000 | drop |
| youtube:Comedy Dynamics | low | 102 | 1 | 0 | 0 | 0 | 0 | - | 0.000 | drop |
| cartoonshateher.com | timeless | 100 | 0 | 1 | 0 | 0 | 0 | 0.15 | 0.000 | — |
| youtube:The Ready State | timeless | 96 | 0 | 0 | 0 | 0 | 0 | - | 0.000 | — |
| worldspiritsockpuppet.substack.com | timeless | 93 | 2 | 0 | 0 | 0 | 0 | 0.40 | 0.000 | — |
| overcomingbias.com | timeless | 88 | 15 | 1 | 9 | 23 | 53 | 0.16 | 0.000 | noisy |
| worksinprogress.news | timeless | 86 | 3 | 1 | 0 | 4 | 2 | 0.18 | 0.000 | unsubscribe |
| edwest.co.uk | timeless | 79 | 0 | 0 | 0 | 0 | 0 | 0.18 | 0.000 | — |
| slowboring.com | topical | 76 | 7 | 1 | 0 | 0 | 0 | 0.65 | 0.000 | unsubscribe |
| youtube:Don't Tell Comedy | low | 76 | 2 | 0 | 0 | 0 | 0 | - | 0.000 | drop |
| youtube:Instadailydrum | low | 76 | 1 | 0 | 0 | 0 | 0 | - | 0.000 | drop |
| writing.yaschamounk.com | timeless | 75 | 0 | 0 | 0 | 0 | 0 | 0.07 | 0.000 | — |
| avabear.xyz | timeless | 72 | 5 | 1 | 17 | 9 | 10 | 0.23 | 0.014 | keep |
| youtube:Joe Hudson | Art of Accomplishment | timeless | 71 | 4 | 1 | 0 | 0 | 0 | - | 0.000 | — |
| economicforces.xyz | timeless | 70 | 0 | 0 | 0 | 6 | 1 | 0.00 | 0.000 | unsubscribe |
| youtube:All-In Podcast | topical | 70 | 14 | 0 | 0 | 0 | 0 | - | 0.000 | — |
| youtube:The Daily Show | low | 70 | 1 | 1 | 0 | 0 | 0 | - | 0.000 | drop |
| rickrubin.substack.com | timeless | 68 | 1 | 0 | 0 | 0 | 0 | 0.71 | 0.000 | unsubscribe |
| strongtowns.org | timeless | 65 | 2 | 0 | 0 | 1 | 0 | 0.00 | 0.000 | — |
| youtube:Saturday Night Live | low | 65 | 5 | 0 | 0 | 0 | 0 | - | 0.000 | drop |
| unchartedterritories.tomaspueyo.com | timeless | 62 | 1 | 0 | 0 | 0 | 1 | 0.30 | 0.000 | — |
| youtube:Veritasium | timeless | 59 | 0 | 0 | 0 | 0 | 0 | - | 0.000 | — |
| paulkrugman.substack.com | topical | 59 | 6 | 0 | 0 | 0 | 3 | 0.26 | 0.000 | — |
| theargumentmag.com | topical | 57 | 7 | 1 | 0 | 2 | 1 | 0.24 | 0.000 | — |
| strangepilgrims.com | timeless | 57 | 0 | 0 | 0 | 0 | 0 | 0.20 | 0.000 | — |
| ethanhein.substack.com | timeless | 57 | 0 | 0 | 0 | 0 | 0 | 0.55 | 0.000 | unsubscribe |
| daveshap.substack.com | timeless | 56 | 3 | 1 | 1 | 1 | 0 | 0.13 | 0.018 | — |
| youtube:Chris Turner | low | 55 | 1 | 0 | 0 | 0 | 0 | - | 0.000 | drop |
| thebulwark.com | topical | 53 | 7 | 0 | 1 | 1 | 0 | 0.60 | 0.000 | — |
| blog.cosmos-institute.org | timeless | 51 | 5 | 1 | 1 | 1 | 0 | 0.04 | 0.020 | — |
| economist.com | topical | 51 | 9 | 2 | 3 | 3 | 32 | 0.00 | 0.000 | noisy |
| youtube:Rupert Spira | timeless | 49 | 1 | 1 | 0 | 0 | 0 | - | 0.000 | — |
| *unsubscribe candidates outside the top 40* |||||||||||
| ask-polly.com | timeless | 48 | 1 | 0 | 0 | 1 | 0 | 0.50 | 0.000 | unsubscribe |
| scottaaronson.blog | timeless | 43 | 2 | 0 | 0 | 7 | 20 | 0.15 | 0.000 | unsubscribe |
| razibkhan.com | timeless | 40 | 0 | 0 | 0 | 0 | 0 | 0.82 | 0.000 | unsubscribe |
| theculturalromantic.substack.com | timeless | 39 | 2 | 0 | 0 | 1 | 1 | 0.58 | 0.000 | unsubscribe |
| bloomberg.com | topical | 27 | 8 | 0 | 0 | 4 | 7 | 0.08 | 0.000 | unsubscribe |
| seanmcclure.substack.com | timeless | 25 | 1 | 0 | 0 | 0 | 0 | 0.64 | 0.000 | unsubscribe |
| sciencefictionspod.substack.com | timeless | 15 | 0 | 0 | 0 | 0 | 0 | 0.73 | 0.000 | unsubscribe |
| theintrinsicperspective.com | timeless | 14 | 0 | 0 | 0 | 2 | 8 | 0.00 | 0.000 | unsubscribe |
| bestofecontwitter.com | topical | 13 | 2 | 0 | 0 | 0 | 0 | 1.00 | 0.000 | unsubscribe |
| blog.sentinel-team.org | topical | 12 | 9 | 0 | 0 | 4 | 4 | 0.00 | 0.000 | unsubscribe |
| report.growsf.org | topical | 12 | 8 | 0 | 0 | 16 | 12 | 0.00 | 0.000 | unsubscribe |
| deepmind.google | topical | 9 | 0 | 0 | 0 | 4 | 5 | 0.13 | 0.000 | unsubscribe |
| news.manifold.markets | topical | 6 | 2 | 0 | 0 | 10 | 9 | 0.00 | 0.000 | unsubscribe |
| instituteforprogress.substack.com | topical | 2 | 0 | 0 | 0 | 4 | 3 | 0.00 | 0.000 | unsubscribe |

## 5. Recommendations (recommend only: nothing unsubscribed, feeds.opml untouched)

**Unsubscribe (19 still arriving): no like ever, plus evidence against, not just silence.**
- **Mostly paywall teasers:** Slow Boring (65% of items under 300 words), Rick Rubin (71%), Ethan Hein (55%), Ask Polly (50%), Razib Khan (82%), The Cultural Romantic (58%), Sean McClure (64%), Science Fictions (73%), Best of Econ Twitter (100%). If he pays for any of them, enrich it like Foreign Affairs instead.
- **Opened and dropped repeatedly:** Scott Aaronson (27 negatives), Manifold News (19), Intrinsic Perspective (10), Bloomberg (11; the key lumps Money Stuff with opinion pieces), DeepMind blog (9), Economic Forces (7), IFP (7), Works in Progress (6; the weakest call, since the judge kept "Young prudes" on 10-28).
- **His call:** GrowSF (28) and Sentinel (8) are opened 67–75% of the time and never highlighted, which looks like deliberate news reading.

**Drop without a model call (all 68 YouTube channels the sweep classed `low`):** 986 arrivals since March, 35 opened. The 15 biggest are comedy (Dry Bar, Comedy Dynamics, Don't Tell, Daily Show, SNL, Dropout, Channel 5), drumming (Instadailydrum, DRUMDEX, El Estepario, Track Star), Chris Turner, Dex Star, Corridor Crew and Bryan Johnson. He likely watches on YouTube, so no YouTube feed (Dwarkesh, TED) is cut on Reader opens alone.

**Noisy feeds (21: at least one like, at least twice as many negatives):** Noahpinion (16 likes vs 152 negatives), Overcoming Bias (9 vs 76), The Zvi (15 vs 43), Economist (3 vs 35), Stratechery (3 vs 13), Lenny's (9 vs 18), geohot (7 vs 18), Aella (9 vs 19), Construction Physics (2 vs 10), GreaterWrong (1 vs 12), Jack Clark (4 vs 11), and others no longer arriving. **I recommend against a stricter bar for them.** Of the 91 eval rows from these feeds (21 likes, 70 negatives), the baseline at threshold 5 keeps 9 likes and 24 negatives (precision 0.27). At 6 it keeps 3 and 12; at 7, 1 and 3. All four runs agree: the judge can't tell their rare great piece from the routine take, so a higher bar discards the likes first. Keep the normal threshold, or unsubscribe if the likes aren't worth the noise (his call; Noahpinion is the clearest case at 1 like per 10 negatives). Showing the judge more of the piece is the fix to try first.

**Keep:** Sasha Chapin (31 vs 16), Ava (17 vs 19), Supernuclear (9 vs 11), Useful Fictions, Commoncog, Matt Clancy. The other ~300 feeds have no labels; leave them to the judge.

### Implementing it in filter.ts

1. Add `policy: "drop"` to the 68 low-class YouTube entries in `data/feed-classes.json`, plus any unsubscribe candidate he would rather silence than cut. Set it by hand, never from a script.
2. In `run()`, a `drop` doc goes the way of a YouTube Short: `act(doc, {score: 0, why: "feed policy: drop"}, null)`, a ledgered delete with no model call. All existing guards (opened, tagged, noted, outside `feed`) still apply.
3. Test: a drop doc never reaches the judge; an opened or tagged one is untouched.

**Cost.** A 20-item batch is about 3.8k input and 1k output tokens, roughly $0.0013 per item, so dropping ~4 YouTube items a day saves well under a cent; the payoff is fewer decisions. **Missed pieces:** none observed. These channels have no like ever, and the judge kept 1 of their arrivals since 10-27 (a Daily Show interview with David Byrne).

## 6. What I could not determine

- Real reading time (Reader records scroll position only), and YouTube engagement.
- Whether highlighted work reading should count as taste.
- Whether he pays for any teaser feed.
- Fine differences on feeds: the held-out feed slice is 50 docs, and identical runs moved its recall by 0.1.

## 7. Balanced feed-only rerun

**Why.** The pooled sample in section 2 was drawn in proportion from a set skewed two ways: hand saves are mostly likes, feed arrivals mostly dislikes. Its held-out feed slice had 9 likes against 41 dislikes, so the feed numbers above are noise-dominated, and the pooled numbers mix hand-save-versus-feed with taste.

**Sample.** `bun run src/eval.ts --prompt baseline --feed-only --balanced` keeps only feed arrivals (source `Reader RSS`) and takes every feed like against an equal number of dislikes, chosen by id hash. Weak dislikes fill in only if dislikes run short, and they did not. All 240 feed likes are `strong_like` (the `like` rule needs a hand save), and all 240 negatives are `dislike`. The sample is all-time, not since 2025: after 2025 there are only 82 feed likes. Same production prompt, same 30% seeded holdout, same batch design as section 2. Likes and dislikes are 50/50 here, while the real feed is mostly dislikes, so precision on this sample overstates precision in production.

**Results, production prompt, threshold 5.**

| split | n | likes | dislikes | P | R | F1 | AUC (95% bootstrap) |
|---|---|---|---|---|---|---|---|
| train | 353 | 178 | 175 | 0.64 | 0.51 | 0.57 | 0.66 |
| holdout | 127 | 62 | 65 | 0.61 | 0.44 | 0.51 | 0.64 [0.55, 0.74] |
| all | 480 | 240 | 240 | 0.63 | 0.49 | 0.55 | 0.65 [0.60, 0.70] |
| all, saved since 2025 | 166 | 82 | 84 | 0.65 | 0.55 | 0.60 | 0.70 [0.61, 0.77] |
| all, saved before 2025 | 314 | 158 | 156 | | | | 0.63 [0.57, 0.69] |

**Run-to-run noise is partial.** The second identical run stopped after 160 of 480 docs when the API key hit its spending cap. Over those 160 docs it flipped **7 keep/drop calls (4%)**, 2 of 41 in the holdout, with a mean score change of 0.31. On those 160 docs its P/R/AUC were 0.65/0.52/0.66 against 0.63/0.49/0.65 for run 1 on all 480. No second full run exists, so the noise on the 127-doc holdout is estimated from the bootstrap, not from reruns.

**Compared with section 2.** Section 2 reported held-out P 0.62 and R 0.47 on the pooled sample, which mixes in hand saves, and AUC 0.74 on the held-out feed slice. On the balanced feed-only holdout the production prompt gets P 0.61, R 0.44 and AUC 0.64, so precision and recall barely move but feed ranking is about 0.1 weaker than reported. The old 0.74 came from 9 feed likes against 41 dislikes, with a 95% interval of 0.53–0.93. The new holdout interval is half that width. Part of the gap is taste drift: likes from before 2025 rank at 0.63 against today's Fascinations note, and those since 2025 at 0.70.

**What the misses say.** Liked feed pieces the judge drops are mostly 2022–2024 reads that today's Taste section rules out: Economist explainers, Lenny's growth tactics, AI news roundups. That fits drift, not a judge error. Disliked pieces it keeps are the same kind as in section 2: long essays squarely on his questions (Carlsmith, Chapin, Supernuclear, Hanson, Ngo) that he opened and did not finish. The judge cannot tell "abandoned" from "interrupted".

Score distribution per label (count at each score 0..10, mean, share kept):

- strong_like (n=240): [5 23 33 29 32 33 28 25 24 8 0] mean 4.48, kept 49%
- dislike (n=240): [22 32 54 43 20 24 31 6 6 2 0] mean 3.18, kept 29%

**Liked but scored low** (122; worst 15):

| score | label | title | feed | judge's why |
|---|---|---|---|---|
| 0 | strong_like | Is your money safe in American banks? | economist.com | Dated 2023 explainer on bank runs; news brief. |
| 0 | strong_like | How to determine your activation metric | lennysnewsletter.com | Product growth tactics on activation metrics; explicitly not his taste. |
| 0 | strong_like | Import AI 319: Sovereign AI; Facebook’s weights leak on torrent networ | jack-clark.net | Old Import AI technical newsletter from 2023; model and research news. |
| 0 | strong_like | How to build your PM second brain with ChatGPT | lennysnewsletter.com | ChatGPT productivity tutorial for PMs; tool how-to. |
| 0 | strong_like | Gay Arraignment | piratewires.com | Daily political news and discourse roundup. |
| 1 | strong_like | Announcing our incoming CEO | rootsofprogress.org | Organizational announcement of a new CEO; no argument. |
| 1 | strong_like | Import AI 396: $80bn on AI infrastructure; can Intel’s Gaudi chip trai | jack-clark.net | Old Import AI news digest from January 2025; infrastructure and chip news. |
| 1 | strong_like | Runaway Rents in Big American Cities | home-economics.us | Rent data in big cities; economic stats, off his questions. |
| 1 | strong_like | bookbear express gift guide 2023 | avabear.xyz | Gift guide from 2023; link list, not a live question. |
| 1 | strong_like | AI #126: Go Fund Yourself | thezvi.wordpress.com | Weekly AI news roundup on model results; news and product. |
| 1 | strong_like | Who are the Syrian Democratic Forces? | economist.com | Explainer on Syrian militia from 2023; news brief, not a deep argument about power. |
| 1 | strong_like | How to activate your investor network | lennysnewsletter.com | Fundraising tactics for founders; growth advice. |
| 1 | strong_like | Bangers | piratewires.com | Year-end 2022 hits roundup from Pirate Wires; link dump, stale. |
| 1 | strong_like | Economics Roundup #2 | thezvi.wordpress.com | 2024 economics roundup on taxes and tariffs; policy digest, stale. |
| 1 | strong_like | Why has America’s army recruitment plummeted? | economist.com | Old Economist explainer on army recruitment; news-style brief. |

**Disliked but scored high** (69; worst 15):

| score | label | title | feed | judge's why |
|---|---|---|---|---|
| 9 | dislike | Loving a world you don’t trust by Joe Carlsmith | greaterwrong.com | Carlsmith's closing essay on loving a world you don't trust. Takes on power, control, and holding stance from safety; a Church-worthy question. |
| 9 | dislike | The power and beauty of incrementalism | supernuclear.substack.com | Growing a friend compound slowly: directly serves cohousing and why it's hard to hang; a practical thesis to bring to Church. |
| 8 | dislike | Five Mildly Anti-Buddhist Essays | sashachapin.substack.com | Sasha Chapin, a practice writer he follows, challenging Buddhist memes; feeds practice-without-optimization and the View. |
| 8 | dislike | Four Awakenings | overcomingbias.com | Hanson on awakenings about social systems and cultural evolution; a contestable thesis on power and institutions. |
| 8 | dislike | Import AI 431: Technological Optimism and Appropriate Fear | jack-clark.net | Jack Clark's speech on technological optimism and appropriate fear; a serious essay on AI and power he'd bring to Church. |
| 8 | dislike | Green and golden | narrativeark.xyz | Richard Ngo's meditation on motivation; speaks to instrumental vs. intrinsic drive and FAVE, a good one to bring to a friend. |
| 8 | dislike | Viatopia | forethought.org | MacAskill's viatopia: what to aim for after superintelligence; a contestable claim to bring to Church. |
| 8 | dislike | Drawn Out: a story | thinkingcomplete.com | Richard Ngo's fiction on a Leviathan-like power, with a Job epigraph; sparks questions on power and egregores. |
| 7 | dislike | Beware Profane Priests | overcomingbias.com | Hanson on the sacred binding groups and the danger of those who profane it; feeds the egregore and church questions. |
| 7 | dislike | Rest | strangeloopcanon.com | Case for sabbaticals; speaks to pressure to perform and the instrumental mode, and how to rest well. |
| 7 | dislike | 2022 letter | danwang.co | Dan Wang's letter on state control and escape in 2022; serious essay on power and institutions. |
| 7 | dislike | Making sense of AI risk is very hard for me. I've tried to write down, | aella.substack.com | Aella on AI risk with emotions shaping her models; honest sensemaking he could bring to Church, close to emotional digestion. |
| 7 | dislike | always on your side | avabear.xyz | Ava on friendship as vulnerable, unconditional support versus romance; he saved her work and it feeds the friendship question. |
| 7 | dislike | who's afraid of a little acquisition? | yourpublicuniversalfriend.substack.com | Series on power and acquisition; bears on power and the egregore, a contestable thesis to discuss. |
| 6 | dislike | How much to charge your friends rent | supernuclear.substack.com | Money between friends and housemates touches cohousing and why hanging is hard; practical but relevant. |

**Does the prior conclusion hold?** Partly. Section 3's finding that prompt wording moves results less than run noise was not retested here: only the production prompt ran. The judge's feed ranking is weaker than the AUC of about 0.74 in section 2. It sits near 0.65 overall and 0.70 on recent reads, and the "abandoned" label stays the noisiest part of the eval. Any further judging runs on the Claude Code plan through `claude -p --no-session-persistence`, never an API key.

## Where things live

Code on main (`src/eval-set.ts`, `eval.ts`, `eval-prompts.ts`, `feed-density.ts`, tests in `eval-set.test.ts`). Data is untracked: Mac `data/`, nose `~/code/jarvis-rss-eval/data/`; `/opt/jarvis-rss` was only read.
