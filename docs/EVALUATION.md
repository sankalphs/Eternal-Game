# EVALUATION — How to evaluate the fine-tuned model

## Overview

The evaluation harness compares the fine-tuned Game Designer (V5,
intent-aware) against the deterministic Director (V3, baseline) on
a held-out set of contexts. It produces a publication-quality
Markdown report with 9 metrics, statistical significance tests, and
bootstrap confidence intervals.

## 9 metrics

| Metric | What it measures |
|---|---|
| Replay score | Average quality of the Director plan produced by the LLM intent |
| Intent agreement | Fraction of contexts where V5 and V3 produce the same intent category |
| Player adaptation | How well the LLM intent adapts to the player's psychological state |
| Campaign diversity | Whether the LLM chooses a different boss style than the V3 baseline |
| Narrative consistency | Whether the LLM intent matches the chapter's narrative phase |
| Director confidence | The model's self-reported confidence |
| Average quality | Average quality score from the IntentQualityEngine |
| Benchmark score | Composite replay-based score |
| Statistical significance | Paired t-test p-value for V3 vs V5 |

## Run the evaluation

### Against a Modal endpoint

```bash
bun run scripts/run-evaluation.ts \
  --endpoint https://your-modal-endpoint.modal.run \
  --contexts 200 \
  --out ./eval_results
```

### Against a local model

```bash
python modal/eval/evaluate_model.py \
  --test-path ./data/intent_dataset/test.jsonl \
  --model-dir ./data/exports/eternal-game-designer/merged \
  --output-dir ./eval_results
```

### Without a model (using the mock)

```bash
bun run scripts/run-evaluation.ts --contexts 200 --out ./eval_results
```

This is useful for development. The results will be deterministic
but not informative — the mock always returns the same intent.

## Output

The evaluation produces:

```
eval_results/
├── report.md           # Human-readable Markdown
├── report.json         # Machine-readable JSON
├── per_context.csv     # Per-context details (CSV)
└── statistics.json     # Aggregate metrics
```

### report.md

A publication-quality Markdown report. It includes:

- A summary table with V3 vs V5 means, deltas, p-values, and
  statistical-significance indicators.
- Bootstrap 95% CIs for intent agreement.
- The first 10 per-context rows.

### report.json

Full machine-readable results, including per-context V3 and V5
plans, intent outputs, and translation rationales.

### per_context.csv

A flat CSV with one row per context, suitable for downstream
analysis (pandas, R, Excel).

### statistics.json

Just the aggregate metrics, no per-context data. Easy to load in
a CI/CD pipeline.

## Statistical tests

The harness uses:

- **Paired t-test** for V3 vs V5 comparison (parametric)
- **Bootstrap CI** (1000 resamples, default) for intent agreement
- **Mann-Whitney U** is available in `StatsTests.ts` for
  non-parametric comparisons (use it directly if needed)

A result is considered statistically significant when p < 0.05.
The Markdown report shows ✓ or ✗ next to each metric.

## Interpreting results

A good fine-tune should show:

- **Intent agreement > 0.5** — the LLM agrees with the V3 baseline
  on intent at least half the time.
- **Player adaptation > baseline** — the LLM adapts better to
  player state than the deterministic baseline.
- **Campaign diversity > baseline** — the LLM varies boss styles
  more.
- **Average quality > baseline** — the LLM produces higher-quality
  intent.
- **Statistical significance** — the improvement is real, not noise.

If any of these are negative, the fine-tune is not yet better than
the V3 baseline. Consider:

- More training data (target 200k+ samples).
- Longer training (more epochs).
- A bigger model (1B instead of 270M).
- Better data quality (raise `minQuality` in the exporter).

## Comparing multiple runs

The JSON report is machine-readable. You can compare multiple
runs by joining their `aggregate` blocks. A future improvement is
to add a `compare.py` script that produces a side-by-side Markdown
comparison.
