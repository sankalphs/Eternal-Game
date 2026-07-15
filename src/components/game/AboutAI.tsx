"use client";

// ============================================================================
// ABOUT THE AI
//
// Plain-English explainer of the whole AI stack, accessible from the main
// menu. Designed to be read by someone who has never seen the codebase.
// ============================================================================

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export interface AboutAIProps {
  onClose: () => void;
}

export function AboutAI({ onClose }: AboutAIProps) {
  return (
    <div
      data-testid="about-ai"
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md overflow-y-auto"
    >
      <div className="max-w-3xl mx-auto p-6 sm:p-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-fuchsia-400/60 tracking-[0.4em] text-[10px] mb-1">SYSTEM MANUAL</p>
            <h1 className="text-3xl sm:text-4xl font-black text-white tracking-wide">
              About the AI
            </h1>
          </div>
          <Button
            variant="outline"
            onClick={onClose}
            className="border-white/20 text-white hover:bg-white/10"
          >
            Close
          </Button>
        </div>

        <div className="space-y-4 text-zinc-300 text-sm leading-relaxed">
          <p>
            <strong className="text-white">You are the Shadow.</strong> Every opponent you face is
            controlled by a <em>genome</em> — twelve numbers that determine how aggressive the
            enemy is, how fast it reacts, how likely it is to block, and so on. Those twelve
            numbers were not written by a human. They were <strong className="text-fuchsia-300">evolved</strong>.
          </p>

          <Card className="bg-zinc-950/85 border-fuchsia-400/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge className="bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-400/30">Layer 1</Badge>
                <h2 className="text-white font-bold tracking-wide">The Genetic Algorithm</h2>
              </div>
              <p className="mb-2">
                A genetic algorithm is a search process that mimics natural selection. We start
                with a population of random genomes, have them fight each other, keep the winners,
                mutate and crossover the losers, and repeat.
              </p>
              <p className="mb-2">
                For this project, we used <strong className="text-white">two methods</strong>:
              </p>
              <ol className="list-decimal list-inside space-y-1.5 ml-1 text-zinc-300">
                <li>
                  <strong className="text-white">Round-robin tournament.</strong> Every genome
                  fights every other genome exactly once. The genome with the best W/L record
                  wins. This produced the v2 frozen library (9 genomes, 36 matches).
                </li>
                <li>
                  <strong className="text-white">King-of-the-hill with a 3/3 gate.</strong> The
                  current king fights a queue of 100 mutants. Winner stays, loser goes to the
                  back. After 100 matches, the king is frozen and must win{" "}
                  <strong className="text-emerald-300">3 out of 3</strong> against the original
                  Widow. If it fails, 20 fresh mutants are injected and the cycle repeats. Only
                  genomes that pass the 3/3 gate are exported as the champion.
                </li>
              </ol>
              <p className="mt-3 text-zinc-400 text-xs">
                The winning genome is saved to <code className="text-fuchsia-200">ChampionGenome.json</code>{" "}
                and applied to the enemy every time you fight. That is who you are fighting.
              </p>
            </CardContent>
          </Card>

          <Card className="bg-zinc-950/85 border-sky-400/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge className="bg-sky-500/20 text-sky-200 border-sky-400/30">Layer 2</Badge>
                <h2 className="text-white font-bold tracking-wide">The LLM Game Designer</h2>
              </div>
              <p className="mb-2">
                A separate, larger model — a fine-tuned <strong className="text-white">gemma-3-270m</strong> —
                was trained to plan fights. It was given 94,000 examples of fight situations and
                asked to produce a JSON <em>IntentOutput</em>: an intent, a reasoning, a
                high-level plan, and a confidence score.
              </p>
              <p className="mb-2">
                <strong className="text-white">Crucially, the LLM is not active during gameplay.</strong>{" "}
                It does not decide what your opponent does frame-by-frame. The runtime game is
                fully deterministic once a Director plan and a genome are loaded.
              </p>
              <p>
                What the LLM <em>does</em> do: it generates the high-level design — what kind of
                fight this should be, what mood, and what hazards. A second component
                called the <strong className="text-sky-300">Director</strong> (V3) reads that
                intent and turns it into concrete gameplay values. The LLM is the &quot;why&quot;;
                the Director is the &quot;how&quot;.
              </p>
            </CardContent>
          </Card>

          <Card className="bg-zinc-950/85 border-emerald-400/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge className="bg-emerald-500/20 text-emerald-200 border-emerald-400/30">Transparency</Badge>
                <h2 className="text-white font-bold tracking-wide">What You Can See</h2>
              </div>
              <p className="mb-2">While fighting, two on-screen widgets make the AI 100% transparent:</p>
              <ul className="list-disc list-inside space-y-1 ml-1">
                <li>
                  <strong className="text-white">AI Genome HUD</strong> — the twelve genes of the
                  enemy currently being fought, plus a live badge of the AI&apos;s current mode
                  (approach, block, punish, rage, etc.) and the next attack it is queuing.
                </li>
                <li>
                  <strong className="text-white">AI Decision Ticker</strong> — a scrolling log of
                  every meaningful state change the AI makes, with timestamps.
                </li>
              </ul>
              <p className="mt-3">
                Open the <strong className="text-fuchsia-300">AI INSIGHTS</strong> panel from the
                menu to see the full GA training report, the LLM dataset statistics, and the
                current champion genome with each gene explained in plain English.
              </p>
            </CardContent>
          </Card>

          <div className="text-center pt-2 text-zinc-500 text-[10px] tracking-widest">
            DETERMINISTIC ENGINE · GENOME-DRIVEN ENEMY AI · LLM-ASSISTED DESIGN
          </div>
        </div>
      </div>
    </div>
  );
}

export default AboutAI;
