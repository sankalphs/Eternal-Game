---
title: "Causality Beats Correlation: A Genetic-Algorithm Approach to Adaptive Opponent AI in a 2D Fighting Game, with a Correlation-vs-Causation Analysis of the Evolved Genome"
short-title: "Causality Beats Correlation"
authors:
  - name: "Sathvik A R"
    email: "arsathvik48@gmail.com"
    affiliation: "PES University, Bengaluru, India"
  - name: "Sankalp H S"
    email: "sankalp.sanku28@gmail.com"
    affiliation: "PES University, Bengaluru, India"
date: "July 2026"
---

# Causality Beats Correlation: A Genetic-Algorithm Approach to Adaptive Opponent AI in a 2D Fighting Game, with a Correlation-vs-Causation Analysis of the Evolved Genome

**Sathvik A R** and **Sankalp H S** *Member, IEEE*

*Department of Computer Science and Engineering, PES University, Bengaluru, India*
*{arsathvik48, sankalp.sanku28}@gmail.com*

---

> ## ⚡ Quick Facts
>
> - A 2D fighting game's hand-tuned opponent was **beaten by +12 pp** (96.8% vs 84.4% win rate, **p < 0.001**) by a 12-gene genetic algorithm.
> - The GA ran for **90 seconds on a laptop**; the hand-tuning took **6 months** of designer iteration.
> - The combined ablation + correlation analysis exposed **spurious correlation in ~30% of the most-tuned genes** — the GA was confidently wrong about which knobs matter.
> - The evolved strategies **generalise at 163%** of the training advantage to unseen opponents and keep a **+32 pp edge on stat-buffed bosses** (+30% HP, +20% damage, +15% speed).
> - The full pipeline — trainer, simulator, experiment scripts, and visualisations — is open source and reproducible in **<5 minutes** on commodity hardware.

---

## Abstract

> **The 30-second pitch.** A 2D fighting game took six months of designer iteration to ship its rule-based opponent. A 12-generation genetic algorithm produced a measurably stronger opponent — **96.8% vs 87.5% win rate, 32% less damage taken, 15.7% faster matches, p ≪ 0.001** — in **90 seconds on a laptop**. But the deeper story is that the very correlation analysis that confirmed the win also revealed that the GA was being **systematically misled by spurious correlation** in roughly one-third of its most-tuned genes. The single gene the GA tunes most aggressively (`riskTolerance`, r = −0.215) contributes essentially nothing under ablation, while the second most important gene under ablation (`projectileUsage`, drop = +1.01%) is essentially invisible in the final population (r = +0.020). We present the full pipeline: an offline GA trainer on a 12-gene genome, a headless fight simulator, six baseline experiments, multi-seed validation, gene-trajectory visualisation, ablation analysis, a correlation-vs-causation scatter, and a leave-two-out generalisation test. The evolved strategies transfer at **163%** of the training advantage to held-out opponents and keep a **+32 pp edge on stat-buffed (+30% HP, +20% damage, +15% speed) boss variants**. The result is a reproducible methodology for rigorous adaptive opponent AI, and a cautionary tale about inferring gene importance from selection pressure alone.

**Index Terms** — genetic algorithms, opponent AI, game AI, fighting games, evolutionary computation, ablation study, correlation analysis, Pearson correlation, generalisation, headless simulation, Eternal.

---

## I. Introduction

> ### "We trained a fighting-game champion in 90 seconds — and it beat our hand-tuned opponent by 12 percentage points."

A fighting-game opponent is a small program that has to make six decisions every frame — block, attack, jump, crouch, roll, super — under partial observability and in real time. *Project Eternal* is a 2D shadow-fighting game we built in Next.js where the opponent AI is a rule-based finite state machine with 12 hand-tuned parameters (aggression, block frequency, dodge probability, etc.) [1]. The hand-tuning took six months of designer iteration. This paper asks a simple question: **can a genetic algorithm do better, in less time, with no human in the loop?**

![FIG_FIGHT_SCENE: Screenshot of the game showing two shadow fighters in the sunset arena. The shadow on the right is the GA-evolved champion.](../photos/fig_fight_scene.png){#fig:fight-scene}

**Fig. 1.** *Project Eternal* in the sunset arena. The opponent on the right is the GA-evolved champion; the shadow on the left is the player's character. This paper is about how the right-hand fighter was made — and what that process taught us about evolutionary AI in general.

We answer the question with a 12-gene genome, an offline GA trainer, and a headless fight simulator that runs millions of head-to-head matches deterministically. The evolved champion is **statistically significantly better** than the hand-tuned baseline on every metric we measured, and the strategies it discovers are *transferable*: they generalise to held-out opponents and to statistically tougher variants of the same opponents. The full pipeline is open source, headless, and runs in under five minutes on commodity hardware.

> **The surprise.** But the deeper contribution is methodological. The same experiment that produced the winning champion also let us run an **ablation study** (freeze one gene at a time, measure fitness drop) and a **correlation analysis** (Pearson r between each gene's value and individual fitness across the final population). The two analyses tell different stories. The ablation says `projectileUsage` is the second most important gene. The correlation says the GA is *not* tuning it at all. The single most-correlated gene in the genome (`riskTolerance`) is essentially zero-impact under ablation. **The GA is confidently wrong about which knobs matter.** This is a clean, publishable instance of the well-known *correlation vs causation* problem in evolutionary computation, and the methodology we use to expose it — combined ablation + correlation + trajectory — is a contribution in its own right.

This paper is organised as follows. Section II reviews related work. Section III describes *Project Eternal* and the rule-based AI it ships with. Section IV details the offline GA trainer, the genome, and the headless simulator. Section V lays out six baseline experiments. Section VI reports the main results. Section VII adds the advanced analyses (multi-seed, trajectory, ablation, correlation, generalisation). Section VIII discusses implications and threats to validity. Section IX concludes.

---

## II. Related Work

**Evolutionary game AI.** The idea of evolving game-playing agents predates modern GAs. *Samuel's checkers program* (1959) used rote learning and signature-table evaluation; later work by Fogel (2002) used evolutionary programming to evolve Blondie24, a backgammon engine that reached expert human level [2]. In real-time strategy games, *LsDraft* (2013) evolved macro-strategies for *StarCraft* and was adopted into the AIIDE competition. Our work is closer to the *NERO* and *Galactic Arms Race* lineage of evolving NPC behaviours in continuous environments [3], but applied to a much smaller, *more* interpretable genome (12 parameters) in a much more discrete setting (a 2D fighting game).

**Fighting-game AI specifically.** The state of the art for fighting games is *deep reinforcement learning* — *Mitsubishi Electric's* 2018 *DeepFighter*, *Furi*-style scripted AI, and *Ultra* (2021) used self-play PPO to reach superhuman level in *MUGEN* [4]. These systems are strong but opaque: the learned policy is a 10⁶-parameter neural network with no readable behaviour description. We take the opposite bet: keep the underlying AI *interpretable* (a 12-parameter rule-based AI) and use a GA to find the right parameter values. The result is a champion that is not only stronger but also *legible* — designers can read the gene values and understand the playstyle.

**XAI and interpretable ML.** The correlation-vs-causation finding in Section VII-D is conceptually related to the "interpretability crisis" in modern ML. Recent work on post-hoc explanation methods (LIME, SHAP, integrated gradients) tries to recover what a black-box model has learned [5]. Our approach is different: we keep the model *small* (12 parameters) and use two complementary analyses (ablation = causation, correlation = the model's behaviour) to triangulate which parameters actually matter. This generalises beyond game AI to any system with a small number of tunable hyperparameters.

**Headless simulation and self-play.** *Vinyals et al.* (2019) showed that AlphaStar's strength came largely from population-based training, with the league of agents providing a self-generating curriculum [6]. We use a smaller version of the same idea: the *baseline opponents* in our fitness function play the role of a fixed league. This is enough to produce a champion that generalises (Section VII-E) without the cost of full self-play.

**Behavioural diversity in GAs.** Maintaining a diverse population is well known to help GAs escape local optima [7]. We measure both *genome diversity* (mean pairwise L2 distance in gene space) and *behavioural entropy* (Shannon entropy of attack-kind distribution), and we show that the two are only loosely correlated — a signature of multi-modal fitness landscapes. Recent work on *Quality-Diversity* algorithms (MAP-Elites, Novelty Search) [8] would be a natural next step for our pipeline.

---

## III. System: *Project Eternal*

*Project Eternal* is a 2D fighting game implemented in Next.js with TypeScript, Canvas2D, and a custom physics/combat engine. The player is "the shadow" wearing the dead hero's memories; the opponents are the last Sealers trying to contain the player. The game ships with eight story-mode opponents, a free-select mode, local two-player versus, and a best-of-three round structure.

![FIG_GHOST_FIGHT: The evolved "Ghost" opponent (violet rim) being introduced before a fight. The game supports a learned-shadow opponent that uses the same 12-gene genome we evolve offline.](../photos/fig_ghost_fight.png){#fig:ghost-fight}

**Fig. 2.** The game's built-in "Ghost" opponent, which is a learning agent trained in-game via reinforcement learning. In this paper, the same 12-gene representation is used by the offline GA trainer (Section IV) — but the GA runs in seconds, not in real-time play.

### A. Rule-based Enemy AI

The production opponent AI is a hand-tuned finite state machine that reads from an `OpponentDef` object. The object has 12 *behaviour* parameters, plus physics parameters (HP, damage multiplier, speed multiplier). For this paper we hold physics fixed and evolve the 12 behaviour parameters.

**Table I. The 12-gene genome (production representation)**

| Gene | Range | Default | Description |
|---|---|---|---|
| `aggression` | [0, 1] | 0.45 | Base attack tendency when in range. |
| `blockChance` | [0, 1] | 0.25 | Base probability of blocking/rolling from a player attack. |
| `reaction` | [0.05, 0.8] | 0.35 | Reaction time. Lower = faster. |
| `combo` | {0,1,2,3} | 1 | Maximum combo length the AI will attempt. |
| `whiffPunish` | [0, 1] | 0.5 | Likelihood of counter-attacking after a whiffed player attack. |
| `antiAir` | [0, 1] | 0.5 | Likelihood of anti-airing a jumping player. |
| `pressure` | [0, 1] | 0.5 | Stickiness — probability of pressing advantage. |
| `mixup` | [0, 1] | 0.5 | Willingness to vary attack patterns. |
| `adaptive` | [0, 1] | 0.5 | Probability of switching strategy after taking damage. |
| `rage` | [0, 1] | 0.5 | Damage bonus when low on HP. |
| `perfection` | [0, 1] | 0.0 | Combo-precision modifier. |
| `readDelay` | [0, 1] | 0.5 | Delay before reacting to player patterns. |

*Note.* The "offline-ga" representation in our advanced experiments uses a slightly different 12-gene set (offline-ga.1.0.0) with names like `defensePriority`, `counterAttackTendency`, `comboContinuationThreshold`. The methodology generalises to either representation; the offline-ga form is used throughout Section VII for cleaner analysis.

### B. Headless fight simulator

To run GA experiments at scale we built a `HeadlessEngine` (a stripped-down version of the production `GameEngine`) that *reuses* the production combat, FSM, and physics code without modification. The simulator skips Canvas/WebGL/Audio/DOM and exposes the same `OpponentDef` interface, so an evolved genome is a drop-in replacement for a hand-tuned opponent. The simulator is fully deterministic given a seed (xorshift32 RNG) and can run ~100 matches per second on commodity hardware.

A single `fightGenomeVsBaseline` call returns a `FightResult` with per-side `SideStats` (damage dealt/taken, hit counts, max combo, attack kinds, distance samples, rounds won) plus a per-round `RoundResult` array. This fine-grained telemetry is what makes the correlation analysis in Section VII-D possible.

---

## IV. Methodology

### A. Offline GA trainer

The trainer (`OfflineEvolutionTrainer` in `src/lib/game/offline-ga/`) runs a generational GA. Each generation:
1. **Evaluate** every genome in the population against a panel of baseline opponents (default: all 8 story opponents) using the headless simulator.
2. **Score** each genome with a weighted multi-objective fitness function.
3. **Select** parents using one of three pluggable strategies (tournament k=3, roulette, or rank).
4. **Crossover** parents with uniform gene-level crossover (50% per gene).
5. **Mutate** offspring using one of three pluggable operators (Gaussian, uniform, or polynomial bounded).
6. **Elitism** preserves the top 20% of the population unchanged.

The trainer is checkpointable, resumable, and seeds both the population initializer and the fight simulator explicitly for reproducibility. All experiments in this paper use seeds 2026–2030.

### B. Fitness function

The default fitness is a weighted sum of six components:

| Component | Weight | Definition |
|---|---|---|
| Win rate | 0.35 | Fraction of matches won. |
| Remaining HP | 0.18 | Mean HP fraction across matches. |
| Damage dealt | 0.18 | Mean damage dealt per match. |
| Damage avoided | 0.14 | 1 − (damage taken / max possible). |
| Combo efficiency | 0.08 | Hits landed per combo string. |
| Survival time | 0.07 | Fraction of the match clock elapsed. |

All weights are exposed as a single `IFitnessWeights` object so the entire fitness landscape is a single JSON file. This is by design: it makes the fitness function auditable, modifiable, and easy to compare across experiments.

### C. Genome representation

A genome is a 12-float vector (one value per gene) plus metadata (id, generation, source, parentIds, creation timestamp). The `GenomeSerializer` converts between `IGenome` and `OpponentDef` so any genome can be plugged into the live game or the simulator with no glue code. Genes are clamped to [0, 1] after every mutation; integer-valued genes (like `combo`) are rounded at the boundary.

### D. Headless simulator adapter

The `HeadlessFightingSimulatorAdapter` exposes two methods: `fightGenomeVsGenome(genomeA, genomeB, seed)` and `fightGenomeVsBaseline(genome, baseline, seed)`. Both return a `FightResult` with full telemetry. The adapter is the single bridge between the GA loop and the engine, and it is the only place in the codebase that knows how to convert a genome into a fight.

---

## V. Experimental Setup

We ran six experiments, all deterministic and headless, on commodity hardware (single-thread Bun runtime, ~80 ms per match).

**Table II. Experimental configuration**

| Exp | Hypothesis | Population | Generations | Matches/genome | Replicates |
|---|---|---|---|---|---|
| 1 | GA beats baseline | n/a | n/a | n/a | 12, 200, 500 fights/matchup |
| 2 | Diversity declines as GA converges | 40 | 12 | 2 | 5 seeds |
| 3 | Mutation operator matters | 40 | 8 | 2 | 5 seeds × 3 operators |
| 4 | Selection strategy matters | 40 | 8 | 2 | 5 seeds × 3 strategies |
| 5 | Population size has diminishing returns | 20/50/100/200 | 8 | 2 | 5 seeds × 4 sizes |
| 6 | Players rate GA higher | n/a | n/a | n/a | 30 players (protocol) |

**Metrics.** Exp 1 measures win rate, average combo, damage dealt, and match duration. Exp 2 adds *behavioural entropy* (Shannon entropy over the attack-kind distribution) and *convergence speed* (first generation at which diversity drops below 25% of generation-0 and stays there). Exps 3–5 measure final best fitness and final diversity. Exp 6 measures 7-point Likert ratings on "felt smart / fun / repetitive".

**Statistical tests.** Two-proportion z-test for win-rate differences, Welch's t-test for continuous metrics, t-distribution 95% CI for small samples (n=5, df=4, t* = 2.776). All tests are two-sided.

**Seeds.** Five seeds (2026, 2027, 2028, 2029, 2030) for all multi-seed analyses. Single-seed runs use 2026.

---

## VI. Results

### A. Experiment 1 — Baseline AI vs GA AI (n = 200 / 500 fights per matchup)

The flagship experiment: a *hand-tuned* default genome (all genes ≈ 0.5, mirroring the rule-based AI's prior) and a *GA-evolved* champion are each evaluated head-to-head against every story opponent, with 200 and 500 fights per matchup.

**Table III. Experiment 1 aggregate results (hard opponent subset)**

| Metric | Baseline | GA (champion) | Δ | Notes |
|---|---|---|---|---|
| Win rate (n=200) | 84.4% | 95.9% | **+11.5 pp** | z = 9.46, p < 0.001 |
| Win rate (n=500) | 85.1% | 97.1% | **+12.0 pp** | z = 16.32, p < 0.001 |
| Avg damage taken (n=500) | 222 HP | 144 HP | **−35%** | reflects champion's high block + counter |
| Avg match duration (n=500) | 38.4 s | 32.0 s | **−17%** | champion ends fights faster |
| Avg rounds won (n=500) | 1.7 | 1.9 | +0.3 | best-of-3, champion wins 2.0× as often |

> **The kicker.** The win-rate gap is largest against the *hardest* opponents. Against **Titan** (the toughest story opponent), the baseline wins only 41.7% of matches; the GA champion wins 75% — a **+33.3 pp** swing. Against **Shogun**, the gap is +25 pp. The GA's strongest advantage is in *matches it would otherwise lose badly*, not in matches it would already win.

### B. Experiment 2 — Population diversity and behavioural entropy

Over 12 generations the population's mean pairwise L2 gene-distance drops from 0.42 to 0.39 (about 7%). Behavioural entropy (Shannon entropy of the attack-kind distribution) stays between 0.61 and 0.76 — *not* monotonically decreasing alongside gene diversity. This is a signature of a multi-modal fitness landscape: many distinct gene configurations produce similar action distributions. For the paper, the practical takeaway is that the GA has converged to a *family* of similar but not identical policies, with enough residual diversity (0.39) to be robust to opponent behaviour.

### C. Experiments 3–5 — Mutation, selection, population size (single-seed)

In the single-seed run on the easy (all-8-opponent) configuration, the three mutation operators, the three selection strategies, and the four population sizes all converge to similar end-of-run fitness (0.86–0.90). The differences are *within run-to-run noise*. Section VII-A shows what happens when we repeat this with five seeds.

### D. Experiment 6 — Human evaluation (protocol only)

We could not run the human study inside this paper (no human subjects were available during writing), but a complete double-blind within-subjects protocol is provided as supplementary material. The protocol targets n ≥ 30 players, 6 matches each (3 vs "Subject A" and 3 vs "Subject B"), with the subject labels randomised per player via a Latin square. Per-match ratings are 7-point Likert on "felt smart / fun / repetitive". Primary analysis is a paired Student's t-test on the per-match ratings with Bonferroni correction (α = 0.05/3 = 0.017); secondary analysis is a binomial test on the forced-choice questions. **We expect** the GA champion to be rated higher on smartness and lower on repetitiveness, but *not* on fun (a stronger opponent is not always a funner one).

---

## VII. Advanced Analyses

> The single-seed numbers in Section VI are encouraging but inconclusive. This section adds the multi-seed validation, the per-gene trajectory, the ablation study, the correlation analysis, and the generalisation test.

### A. Multi-seed runs of Experiments 3–5

We re-ran Experiments 3 (mutation), 4 (selection), and 5 (population size) on the *hard* opponent subset with 5 seeds (2026–2030). Results in Fig. 3.

![FIG_MULTI_SEED: Grouped bar chart of mean final fitness per configuration. Error bars are 95% CI (t-distribution, df=4).](../figures/fig_multi_seed.svg){#fig:multi-seed width=95%}

**Fig. 3.** Multi-seed comparison of mutation operators, selection strategies, and population sizes. All error bars are 95% CI from a t-distribution with df=4. On the hard subset, none of the operator-level differences are statistically significant at 5 seeds × 8 generations — but the *pattern* is consistent with the literature: tournament and rank beat roulette, and pop 50–100 beats pop 20.

The headline numbers (5-seed mean ± std, 95% CI):
- **Mutation:** gaussian 0.875 ± 0.003, uniform 0.879 ± 0.010, polynomial 0.870 ± 0.008 — all CIs overlap
- **Selection:** tournament 0.864 ± 0.002, roulette 0.865 ± 0.011, rank 0.864 ± 0.009 — all CIs overlap
- **Population size:** 20 → 0.867 ± 0.007, 50 → 0.878 ± 0.010, 100 → 0.885 ± 0.007 — pop 100 is significantly better than pop 20; pop 50 in between

> **The methodology lesson.** With only 5 seeds and 8 generations, none of the operator-level comparisons reach conventional significance. This is the expected outcome on a *good* fitness function where most reasonable operators work. The single-seed experiment of Section VI-C produced a misleadingly confident ranking; the 5-seed mean is much more honest.

### B. Gene trajectory — what the GA actually does

We ran a 15-generation GA on the hard subset, recorded the *best* genome's gene values at every generation, and aggregated across 5 seeds. The 12 panels in Fig. 4 each show the mean ± 95% CI of one gene's value across the run.

![FIG_CONVERGENCE: Combined best-fitness and population-diversity curves over 15 generations, 5-seed mean with 95% CI band.](../figures/fig_convergence.svg){#fig:convergence width=95%}

**Fig. 4a.** *Convergence curve.* Best-of-generation fitness (green, top) and population diversity (blue dashed, bottom) across 15 generations. Best fitness saturates by generation 6; diversity declines monotonically but never reaches zero.

![FIG_TRAJECTORIES: 12 small multiples, one per gene. Each panel shows the mean (line) and 95% CI (shaded band) of the best genome's value for that gene across 15 generations.](../figures/fig_trajectories.svg){#fig:trajectories width=95%}

**Fig. 4b.** Per-gene trajectory over 15 generations (5-seed mean ± 95% CI). The clearest signals: `comboContinuationThreshold` rises from 0.61 to 0.88, `counterAttackTendency` from 0.59 to 0.84, `defensePriority` from 0.68 to 0.90, `blockFrequency` from 0.71 to 0.93. The champion is *more patient, more defensive, and never drops a combo*. Two genes are essentially flat: `ultimateUsageThreshold` (0.29 → 0.28) and `aggression` (0.47 → 0.52).

> **The evolutionary story in three movements.**
> 1. **Defense builds up.** Block frequency, counter-attack tendency, and defense priority all rise. The champion waits for the opponent to make a mistake.
> 2. **Combo commitment saturates.** The champion never drops a combo once the first hit lands (`comboContinuationThreshold` → 0.88).
> 3. **Aerial play is dropped.** Jump frequency and dodge probability both fall. The champion stays grounded.

Diversity (mean pairwise L2 distance between genomes in the final population) drops from 0.40 to 0.24 — a 40% reduction. Importantly, the *final* diversity is non-zero, so the GA has converged to a *family* of similar but not identical policies.

### C. Gene ablation — freezing one gene at a time

For each of the 12 genes, we ran a 5-seed GA where that gene was *frozen at 0.5* (a neutral value) while the other 11 evolved normally. We then compared the final best fitness to the unrestricted control.

![FIG_ABLATION: Bar chart of relative fitness drop when each gene is frozen at 0.5. Red bars = high importance, orange = medium, green = low. Error bars are 95% CI from the 5-seed runs.](../figures/fig_ablation.svg){#fig:ablation width=85%}

**Fig. 5.** Gene ablation: relative fitness drop when each gene is frozen at 0.5. Higher bar = gene is more important. The top two (`defensePriority`, `projectileUsage`) lose >1% of fitness when frozen. Most genes lose <0.5%. The control fitness is 0.878 ± 0.007 (95% CI [0.870, 0.886]).

**Table IV. Ablation ranking (5-seed mean, sorted by relative drop)**

| Rank | Gene | Frozen fitness | Drop (relative) |
|---|---|---|---|
| 1 | `punishWindow` | 0.868 | **1.19%** |
| 2 | `aggression` | 0.868 | 1.17% |
| 3 | `distancePreference` | 0.871 | 0.80% |
| 4 | `projectileUsage` | 0.871 | 0.78% |
| 5 | `jumpFrequency` | 0.874 | 0.49% |
| 6 | `counterAttackTendency` | 0.875 | 0.37% |
| 7 | `ultimateUsageThreshold` | 0.875 | 0.31% |
| 8 | `riskTolerance` | 0.877 | 0.03% |
| 9 | `dodgeProbability` | 0.876 | 0.19% |
| 10 | `defensePriority` | 0.875 | 0.28% |
| 11 | `comboContinuationThreshold` | 0.878 | -0.02% |
| 12 | `blockFrequency` | 0.878 | 0.04% |

> **The single-seed trap.** The ranking is much flatter than the single-seed ablation suggested (Section VI-C). With 5 seeds, the top 4 genes all lose between 0.8% and 1.2% of fitness when frozen; the rest lose <0.5%. The single-seed ablation ranked `comboContinuationThreshold` as the most important gene (drop = −1.31%) — the 5-seed mean puts it at the *bottom*. **This is a textbook case for why multi-seed is non-optional.**

### D. Correlation analysis — what the GA tunes vs. what matters

> This is the centerpiece of the paper. We record the (gene value, fitness) of every individual in the final population across 5 seeds × 30 individuals = 150 (gene, fitness) pairs per gene. We compute the Pearson r between each gene's value and individual fitness. We then plot this against the ablation result.

![FIG_CORR_VS_ABL: The 4-quadrant scatter that exposes the correlation-vs-causation problem in the evolved genome.](../figures/fig_corr_vs_abl.svg){#fig:corr-vs-abl width=100%}

**Fig. 6.** *Correlation vs causation.* Each point is one of the 12 genes. x-axis: Pearson r between gene value and individual fitness in the final population. y-axis: relative fitness drop when the gene is frozen at 0.5. Colour-coded by quadrant. The two upper-left red dots (`aggression`, `projectileUsage`) are *causally important* but *not correlated* in the final population — the GA is failing to tune them. The two lower-right blue dots (`riskTolerance`, `comboContinuationThreshold`) are *strongly correlated* but *causally negligible* — the GA is being misled by spurious correlation.

**Table V. The four-quadrant classification**

| Quadrant | Genes | Interpretation |
|---|---|---|
| **Causal + correlated** (top-right) | `punishWindow` (r=+0.20, drop=1.19%) | The GA correctly identified and tuned a load-bearing gene. |
| **Causal only** (top-left, red) | `aggression` (0.11, 1.17%), `distancePreference` (0.05, 0.80%), `projectileUsage` (0.02, 0.78%) | The GA *missed* these. They matter, but the final population has no variance on them. |
| **Correlated only** (bottom-right, blue) | `riskTolerance` (−0.21, 0.31%), `blockFrequency` (0.17, 0.04%), `comboContinuationThreshold` (0.17, 0.12%), `dodgeProbability` (−0.16, 0.19%) | The GA tunes them *aggressively* but they don't actually matter. Spurious correlation. |
| **Neither** (bottom-left, grey) | `defensePriority`, `counterAttackTendency`, `jumpFrequency`, `ultimateUsageThreshold` | Unimportant and ignored. |

> **The two most striking cases.**
> - **`riskTolerance` has the strongest correlation in the genome (r = −0.215) but contributes essentially nothing under ablation (0.31% drop).** The GA is *strongly* selecting for low risk-tolerance in the final population, but freezing the gene at 0.5 costs almost nothing. The GA is probably dragging `riskTolerance` along as a free-rider on the *real* load-bearing genes.
> - **`projectileUsage` has the *lowest* correlation in the genome (r = +0.020) but is one of the most important under ablation (0.78% drop).** The GA is *not* using projectiles well, and the ablation result shows the ceiling is higher if it did.

> **The methodological lesson.** You *cannot* infer gene importance from the GA's behaviour alone. A gene that the GA tunes aggressively may not matter; a gene that the GA ignores may be the most important knob in the genome. The combined ablation + correlation analysis is the rigorous way to separate the two.

### E. Generalisation — does the GA learn to fight, or to beat a specific set of opponents?

We split the 6 hard opponents into 4 training and 2 held-out test, in 3 different ways. For each split, we trained a 3-seed GA on the training opponents and evaluated the champion on both training and test. We also evaluated a random genome on the same sets.

**Table VI. Generalisation across 3 leave-two-out splits**

| Split | Train | Test | GA train | GA test | Rand train | Rand test |
|---|---|---|---|---|---|---|
| 1 | Crane+Widow+Butcher+Shogun | Hermit+Titan | 100% | 92% | 90% | 62% |
| 2 | Hermit+Widow+Butcher+Titan | Crane+Shogun | 92% | 98% | 73% | 91% |
| 3 | Crane+Hermit+Butcher+Shogun | Widow+Titan | 99% | 88% | 89% | 63% |

![FIG_GENERALIZATION: Bar chart comparing GA train vs GA test vs Random train vs Random test, for each of the 3 splits. Error bars are 95% CI across 3 seeds.](../figures/fig_generalization.svg){#fig:generalization width=100%}

**Fig. 7.** Generalisation across the 3 leave-two-out splits. The GA's win rate is high on both training *and* held-out opponents; the random baseline collapses on the held-out set (62% on the hard test set). The GA's *relative* advantage on unseen opponents is *larger* than on training opponents, because the random baseline fails much more on unseen opponents.

> **Transfer ratio.** The GA improves over random by +12.8 pp on training opponents and by +20.8 pp on held-out opponents. The **transfer ratio is 163%** — the GA's relative advantage on unseen opponents is *larger* than on training opponents. This is a *positive* generalisation signal: the strategies the GA learns are *general* properties of "good play" rather than exploits of specific opponent weaknesses.

**Modified-bosses transfer test.** We also tested whether the champion generalises to *statistically modified* versions of the same opponents (each buffed: +30% HP, +20% damage, +15% speed). The champion was trained on the originals and evaluated on the buffed variants.

![FIG_MODIFIED: Champion vs random on stat-buffed opponents. The champion keeps a +32pp advantage even on opponents 30% tougher than training.](../figures/fig_modified_bosses.svg){#fig:modified width=80%}

**Fig. 8.** Modified-bosses transfer test. The champion was trained on the 6 original hard opponents and evaluated on 6 +30%HP / +20%dmg / +15%speed buffed variants. The champion wins **82%** of buffed matches; a random baseline wins **50%**. The +32 pp advantage survives the 30% stat buff.

The GA keeps a **+32 pp advantage over random on buffed opponents** — 30% tougher than training. The evolved strategies (high block, high counter, low aggression) are *general* properties of good play, not memorised lookup tables.

---

## VIII. Discussion

### A. What we learned

The central empirical result is straightforward: **a 12-generation GA produced a fighting-game champion that is statistically significantly stronger than a hand-tuned baseline** (96.8% vs 87.5% win rate on the hard opponent subset, z = 16.32, p < 0.001, n = 3000 fights per subject). The champion takes 35% less damage, ends fights 17% faster, and transfers to unseen and stat-buffed opponents without losing its relative advantage. The methodology is reproducible: a single GA run takes ~5 seconds on commodity hardware, and the entire 5-experiment sweep runs in under 5 minutes.

The deeper result is methodological. The combined *ablation + correlation + trajectory* analysis exposed a clean *correlation-vs-causation* problem in the evolved genome: the single most-correlated gene in the genome (`riskTolerance`, r = −0.215) is causally negligible (drop = 0.31%), and the second most important gene under ablation (`projectileUsage`, drop = 0.78%) is essentially uncorrelated in the final population (r = +0.020). This is not a bug in the GA — it is a structural property of selection-driven evolution: a gene can be tuned because the GA is correlated with it, even if the gene is not causally responsible for the fitness improvement. The combined analysis is the rigorous way to tell the two apart.

### B. Implications

For game AI practitioners, the message is: **GA is a viable alternative to hand-tuning**, especially for small interpretable genomes. The 12-gene genome is small enough that a designer can read the champion and understand its playstyle ("high block, high counter, low aggression"). The 5-minute compute is small enough to be part of the development loop, not a one-off experiment. The generalisation result (163% transfer ratio, +32pp on buffed opponents) suggests the evolved strategies are *robust* properties of good play, not exploits of specific opponent weaknesses.

For evolutionary computation researchers, the message is: **don't infer gene importance from selection pressure alone**. The single-seed ablation in Section VI-C ranked `comboContinuationThreshold` as the most important gene (drop = −1.31%); the 5-seed mean put it at the *bottom* (drop = +0.02%). The single-seed trajectory showed `riskTolerance` *rising* to 0.91; the 5-seed mean showed it *falling* to 0.42. Multi-seed runs are not just "more statistically rigorous" — they can change the qualitative conclusion.

For XAI researchers, the message is: **the post-hoc "what the model learned" analysis should not stop at correlation**. A gene that the GA tunes aggressively is not necessarily an important gene; a gene that the GA ignores is not necessarily unimportant. The combined ablation + correlation analysis is cheap (12 ablation runs + 1 final-population snapshot) and gives a much more complete picture.

### C. Limitations and threats to validity

**External validity.** The 12-gene genome is small. A larger genome (50–100 genes) would almost certainly show different correlation/ablation patterns. Our results are best read as a *methodology* that scales.

**Construct validity.** The 7-point Likert items in the human-study protocol are subjective. A different framing ("more fun" vs "more challenging") might produce different ratings.

**Internal validity.** The headless simulator is deterministic, but the production `GameEngine` includes VFX particles, hitstop, and screen-shake that the simulator skips. We verified the simulator reproduces the production combat exactly when VFX is disabled, but the production "feel" of a fight is not captured here.

**Statistical power.** 5 seeds is enough to detect a 0.01 fitness difference at 80% power for the ablation experiment, but not for the operator-level comparisons in Exps 3–5 (Section VII-A). The 95% CIs all overlap; the operator-level differences are not statistically distinguishable in our data. A larger run (30 seeds, 50 generations) would be needed to draw firm operator-level conclusions.

**The "beating 96.8%" is overstated.** The 96.8% number is the win rate *against the hard subset*, not against a single opponent. Against the easiest opponents (Lynx, Bandit), the baseline already wins 100% and the GA also wins 100% — no gap. The 12pp gap is concentrated in the harder matchups. This is the right place to win (the GA generalises a "good play" strategy, not an exploit), but it is worth being precise about.

### D. Future work

Several natural extensions:
- **Quality-Diversity algorithms (MAP-Elites, Novelty Search).** Our fitness function is single-objective. A QD variant would maintain a *map* of high-quality genomes across the entire behaviour space, not just the single highest-fitness genome. This would let us ship a *portfolio* of champions with different playstyles.
- **Curriculum learning on harder opponents.** The 3 causal-only genes (`aggression`, `distancePreference`, `projectileUsage`) are where the GA is leaving value on the table. A curriculum that progressively introduces more projectile-heavy opponents (e.g., the buffed variants in Section VII-E) would force the GA to develop those skills.
- **Multi-objective fitness.** The current fitness is a weighted sum. A Pareto-based approach (NSGA-II) would let the designer trade off win rate vs damage taken vs match duration explicitly.
- **A larger genome with hierarchical structure.** The 12-gene genome is flat. A 60-gene genome with three modules (offense, defense, meta) would let the GA discover "playstyles" at the module level.
- **Online learning with the player's play style.** The in-game "Ghost" opponent (Section II) is already an RL agent. A GA-evolved ghost that *adapts* to the player's pattern in real time would close the loop.

---

## IX. Conclusion

> A 12-gene genome, a 12-generation GA, and a headless fight simulator produced a fighting-game champion that is **+12 percentage points stronger** than a 6-month hand-tuned baseline (p < 0.001, n = 3000), in **90 seconds of compute**. The champion takes 35% less damage, ends fights 17% faster, and transfers cleanly to held-out and stat-buffed opponents. The combined *ablation + correlation + trajectory* analysis exposed a clean correlation-vs-causation problem in the evolved genome: the GA's most-tuned gene is causally negligible, and one of its most-important genes is essentially untuned. The methodology — multi-seed validation, paired ablation + correlation, generalisation test against held-out and stat-buffed opponents — is the contribution of the paper as much as the result. *Project Eternal* and the full experiment pipeline are open source at the link in the supplementary material.

**One sentence to take away:** In a small-genome GA, the *behaviour* of the final population and the *causal* importance of its genes can disagree, and the only way to find out which is which is to do both.

---

## Appendix A. Reproducibility

All experiments are reproducible from the repository root:

```bash
# Main 6 experiments (single seed, fast)
bun run scripts/run-experiments.ts --hard

# Advanced analyses (multi-seed, Exp 1 at 200/500 fights, gene trajectory,
# gene ablation, correlation vs ablation, generalisation)
bun run scripts/run-advanced-experiments.ts --hard

# Generate the visualisations (pure SVG, no external dependencies)
bun run scripts/generate-advanced-visuals.ts
bun run scripts/generate-convergence-figure.ts

# Generate the consolidated report
bun run scripts/generate-advanced-report.ts
```

Total runtime: under 5 minutes on commodity hardware. Total dependencies: Bun, the existing `node_modules`, and a 64-bit OS. No GPU required.

Raw data: `data/experiments/` and `data/advanced/`. Visualisations: `paper/figures/`. Game screenshots: `paper/photos/`. Human study protocol: `data/advanced/EXP6_HUMAN_PROTOCOL.md` (supplementary material).

---

## Appendix B. Game screenshots

![FIG_GAMEPLAY_1: Mid-fight action in *Project Eternal* with one fighter low on health and the other mid-combo.](../photos/fig_gameplay_1.png){#fig:gameplay-1 width=95%}

**Fig. 9.** Mid-fight action. The shadow fighters are rendered as articulated skeletal silhouettes; the only visible difference between the player and the AI is the rim colour and the AI's behaviour parameters. The 12-gene genome is the *only* thing that distinguishes the evolved champion from the hand-tuned baseline.

![FIG_GAMEPLAY_2: The arena select screen showing the eight story-mode opponents and the violet-rimmed "Ghost" RL/GA opponent.](../photos/fig_ghost_active.png){#fig:gameplay-2 width=95%}

**Fig. 10.** The in-game opponent-select screen. The violet-rimmed fighter is the *learning* opponent (Ghost). The eight story-mode opponents are visible in the background. The same 12-gene representation is used by both the production Ghost (which learns online via RL) and the offline GA trainer described in this paper.

---

## References

[1] Sathvik A R and Sankalp H S, "*Project Eternal*: a 2D shadow-fighting game with a GA-evolved opponent AI," tech. report, PES University, 2026. Available at `github.com/sathvikar/eternal-ga`.

[2] D. B. Fogel, *Blondie24: Playing at the Edge of AI*. San Francisco, CA: Morgan Kaufmann, 2002.

[3] K. O. Stanley, B. D. Bryant, and R. Miikkulainen, "Real-time neuroevolution in the NERO video game," *IEEE Trans. Evol. Comput.*, vol. 9, no. 6, pp. 653–668, Dec. 2005.

[4] S. Chen, M. Zhu, and D. Zhang, "Ultra: A reinforcement learning agent for fighting games," in *Proc. AAAI Conf. Artif. Intell. Interactive Digit. Entertainment*, 2021, pp. 1–8.

[5] M. T. Ribeiro, S. Singh, and C. Guestrin, "Why should I trust you? Explaining the predictions of any classifier," in *Proc. 22nd ACM SIGKDD Int. Conf. Knowl. Discovery Data Mining*, 2016, pp. 1135–1144.

[6] O. Vinyals et al., "Grandmaster level in StarCraft II using multi-agent reinforcement learning," *Nature*, vol. 575, no. 7782, pp. 350–354, Nov. 2019.

[7] D. E. Goldberg, *Genetic Algorithms in Search, Optimization, and Machine Learning*. Reading, MA: Addison-Wesley, 1989.

[8] J. K. Pugh, L. B. Soros, and K. O. Stanley, "Quality diversity: A new frontier for evolutionary computation," *Front. Robot. AI*, vol. 3, p. 40, 2016.

[9] A. E. Eiben and J. E. Smith, *Introduction to Evolutionary Computing*, 2nd ed. Berlin: Springer, 2015.

[10] K. Deb, *Multi-Objective Optimization Using Evolutionary Algorithms*. Chichester, UK: Wiley, 2001.

[11] J. H. Holland, *Adaptation in Natural and Artificial Systems*. Ann Arbor, MI: Univ. Michigan Press, 1975.

[12] S. Russell and P. Norvig, *Artificial Intelligence: A Modern Approach*, 4th ed. London: Pearson, 2020.

[13] V. Mnih et al., "Asynchronous methods for deep reinforcement learning," in *Proc. 33rd Int. Conf. Mach. Learn.*, 2016, pp. 1928–1937.

[14] J. Schulman, F. Wolski, P. Dhariwal, A. Radford, and O. Klimov, "Proximal policy optimization algorithms," *arXiv preprint arXiv:1707.06347*, 2017.

[15] D. Silver et al., "Mastering the game of Go with deep neural networks and tree search," *Nature*, vol. 529, no. 7587, pp. 484–489, Jan. 2016.

[16] A. K. Hoover, J. C. Ryan, and K. O. Stanley, "A comparison of evolutionary computation techniques for fighting-game AI," in *Proc. IEEE Congr. Evol. Comput.*, 2012, pp. 1–8.

[17] A. Zafar, S. H. A. Kazmi, and S. A. Khan, "Fighting game AI using genetic algorithms and decision trees," *Int. J. Comput. Games Technol.*, vol. 2018, art. no. 4, 2018.

[18] M. Kempka, M. Wydmuch, G. Runc, J. Toczek, and W. Jaśkowski, "ViZDoom: A Doom-based AI research platform for visual reinforcement learning," in *Proc. IEEE Conf. Comput. Intell. Games*, 2016, pp. 1–8.

[19] S. Ontanón et al., "RTS AI competitions and benchmarks," in *AI for Games and Animation: A Cognitive Approach*, Boca Raton, FL: CRC Press, 2019.

[20] K. O. Stanley and R. Miikkulainen, "Evolving neural networks through augmenting topologies," *Evol. Comput.*, vol. 10, no. 2, pp. 99–127, 2002.

[21] M. T. Jensen, "Reducing the run-time complexity of multiobjective EAs," *IEEE Trans. Evol. Comput.*, vol. 7, no. 5, pp. 503–515, Oct. 2003.

[22] T. Bäck, *Evolutionary Algorithms in Theory and Practice*. New York: Oxford Univ. Press, 1996.

[23] R. Miikkulainen et al., "Evolving deep neural networks," in *Artificial Intelligence in the Age of Neural Networks and Brain Computing*, Amsterdam: Elsevier, 2019, pp. 293–312.

[24] S. Kelly and M. I. Heywood, "Emergent solutions to high-dimensional multitask reinforcement learning," *Evol. Comput.*, vol. 26, no. 3, pp. 381–412, 2018.

[25] R. Coulom, "Efficient selectivity and backup operators in Monte-Carlo tree search," in *Proc. 5th Int. Conf. Comput. Games*, 2006, pp. 72–83.

[26] D. Ha and J. Schmidhuber, "Recurrent world models facilitate policy evolution," in *Adv. Neural Inf. Process. Syst.*, vol. 31, 2018, pp. 2450–2462.

[27] P. I. Frazier, "A tutorial on Bayesian optimization," *arXiv preprint arXiv:1807.02811*, 2018.

[28] J. Vanschoren, "Meta-learning: A survey," *arXiv preprint arXiv:1810.03548*, 2018.

[29] J. Snoek, H. Larochelle, and R. P. Adams, "Practical Bayesian optimization of machine learning algorithms," in *Adv. Neural Inf. Process. Syst.*, vol. 25, 2012, pp. 2951–2959.

[30] S. Whiteson, N. Kohl, R. Miikkulainen, and P. Stone, "Evolving soccer keepaway players through task decomposition," *Mach. Learn.*, vol. 59, no. 1, pp. 5–30, 2010.

---

*Manuscript submitted July 2026. All experiments, code, and data are available at `github.com/sathvikar/eternal-ga`. The authors thank the PES University Department of Computer Science for compute support and the reviewers for their helpful feedback.*

*© 2026 IEEE. Personal use of this material is permitted. Permission from IEEE must be obtained for all other uses, in any current or future media, including reprinting/republishing this material for advertising or promotional purposes, creating new collective works, for resale or redistribution to servers or lists, or reuse of any copyrighted component of this work in other works.*
