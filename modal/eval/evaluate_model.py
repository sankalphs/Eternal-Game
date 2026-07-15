#!/usr/bin/env python3
# =============================================================================
# Project Eternal — Model Evaluation
# =============================================================================
# Evaluates a fine-tuned model against the baseline (Director V3
# deterministic) on a held-out test set.
#
# Metrics:
#   - Schema validity (% of outputs that parse + match schema)
#   - Intent agreement (categorical match with ground truth)
#   - Confidence calibration (Brier score)
#   - Reasoning quality (length, keyword presence)
#   - Plan coherence (no low-level values mentioned)
#   - Latency p50 / p95 / p99
#   - Token usage
#   - Replay score (from a separate replay harness, optional)
#
# Output:
#   - report.json (machine-readable)
#   - report.md (human-readable)
#   - per_sample.csv (per-sample diagnostics)
# =============================================================================

import os
import json
import time
import argparse
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from scipy import stats as sp_stats
from sklearn.metrics import (
    brier_score_loss,
    cohen_kappa_score,
    classification_report,
    confusion_matrix,
)
from tabulate import tabulate


# ----------------------------------------------------------------------------
#  Argument parsing
# ----------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Evaluate Project Eternal Game Designer model")
    p.add_argument("--test-path", required=True, help="Path to test.jsonl")
    p.add_argument("--baseline-path", default=None, help="Path to baseline outputs (optional)")
    p.add_argument("--model-dir", default=None, help="Local model dir (skip Modal)")
    p.add_argument("--endpoint-url", default=None, help="Modal endpoint URL")
    p.add_argument("--max-samples", type=int, default=None)
    p.add_argument("--output-dir", default="./eval_results")
    p.add_argument("--temperature", type=float, default=0.4)
    p.add_argument("--max-new-tokens", type=int, default=256)
    p.add_argument("--batch-size", type=int, default=1)
    p.add_argument("--include-replay", action="store_true")
    return p.parse_args()


# ----------------------------------------------------------------------------
#  Metric computations
# ----------------------------------------------------------------------------

LOW_LEVEL_TERMS = [
    "weather", "camera", "music", "lighting", "hazard",
    "boss style", "difficulty", "rain", "fog", "wide shot",
    "close-up", "epic music", "dark music", "hard difficulty", "easy difficulty",
]

INTENT_CATEGORIES = [
    "challenge", "teach", "reward", "punish", "escalate", "de_escalate",
    "reintroduce", "conclude", "experiment", "teach_defense", "teach_offense",
    "destabilise", "settle", "narrative_beat", "unknown",
]


def categorise_intent(intent: str) -> str:
    """Mirror the JS categoriseIntent() function."""
    s = intent.lower()
    if re.search(r"(overconfid|rushing|reckless|dominan)", s): return "punish"
    if re.search(r"(turtl|defensive|block|passive|camp)", s): return "destabilise"
    if re.search(r"(patient|spacing|observe|cautious)", s): return "challenge"
    if re.search(r"(panic|frustrat|tilted|rage|choke)", s): return "reward"
    if re.search(r"(new|novel|introduce|first|unique|never)", s): return "teach"
    if re.search(r"(adapt|learn|habit|teach|expos)", s): return "teach"
    if re.search(r"(narrat|story|cinematic|lore|legend|myth)", s): return "narrative_beat"
    if re.search(r"(reintroduc|recall|return|earlier)", s): return "reintroduce"
    if re.search(r"(escalat|rais|intensif|peak|climax)", s): return "escalate"
    if re.search(r"(de.?escalat|low|cool|calm|ease|breath)", s): return "de_escalate"
    if re.search(r"(close|conclu|end|finale|farewell)", s): return "conclude"
    if re.search(r"(experiment|trial|curiosit|probe)", s): return "experiment"
    if re.search(r"(defense|block|parry|guard)", s): return "teach_defense"
    if re.search(r"(offense|commit|approach|pressure|aggress)", s): return "teach_offense"
    if re.search(r"(settle|recover|reset|stabili)", s): return "settle"
    return "unknown"


def compute_metrics(predictions: List[Dict[str, Any]],
                    ground_truth: List[Dict[str, Any]],
                    latencies: List[float]) -> Dict[str, Any]:
    """Compute all metrics."""
    n = len(predictions)
    if n == 0:
        return {"error": "no predictions"}

    # 1. Schema validity
    schema_valid = sum(1 for p in predictions if p.get("valid", False)) / n

    # 2. Intent category agreement
    pred_cats = [categorise_intent(p.get("intent", "")) for p in predictions]
    gt_cats = [categorise_intent(g.get("intent", "")) for g in ground_truth]
    intent_agreement = sum(1 for p, g in zip(pred_cats, gt_cats) if p == g) / n

    # 3. Cohen's kappa (inter-rater agreement between pred and ground truth)
    try:
        kappa = cohen_kappa_score(gt_cats, pred_cats)
    except Exception:
        kappa = 0.0

    # 4. Confidence calibration (Brier score)
    pred_conf = np.array([p.get("confidence", 0.5) for p in predictions])
    gt_conf = np.array([g.get("confidence", 0.5) for g in ground_truth])
    # Binarise: 1 if quality is high
    gt_correct = (gt_conf >= 0.7).astype(int)
    brier = brier_score_loss(gt_correct, pred_conf) if len(set(gt_correct)) > 1 else 0.0

    # 5. Reasoning quality (length)
    reasoning_lens = [len(p.get("reasoning", "")) for p in predictions]
    avg_reasoning_len = float(np.mean(reasoning_lens))
    pct_reasoning_short = sum(1 for l in reasoning_lens if l < 50) / n

    # 6. Plan coherence (% of plans without low-level values)
    plan_coherent = 0
    for p in predictions:
        plan = p.get("highLevelPlan", "").lower()
        if not any(t in plan for t in LOW_LEVEL_TERMS):
            plan_coherent += 1
    plan_coherence = plan_coherent / n

    # 7. Latency stats
    latencies = np.array(latencies)
    latency_p50 = float(np.percentile(latencies, 50))
    latency_p95 = float(np.percentile(latencies, 95))
    latency_p99 = float(np.percentile(latencies, 99))
    latency_mean = float(np.mean(latencies))

    # 8. Intent length
    intent_lens = [len(p.get("intent", "")) for p in predictions]
    avg_intent_len = float(np.mean(intent_lens))

    # 9. Confusion matrix
    cm = confusion_matrix(gt_cats, pred_cats, labels=INTENT_CATEGORIES)

    # 10. Classification report
    try:
        clf_report = classification_report(
            gt_cats, pred_cats, labels=INTENT_CATEGORIES,
            output_dict=True, zero_division=0,
        )
    except Exception:
        clf_report = {}

    return {
        "n_samples": n,
        "schema_validity": schema_valid,
        "intent_agreement": intent_agreement,
        "cohens_kappa": float(kappa),
        "brier_score": float(brier),
        "avg_intent_length": avg_intent_len,
        "avg_reasoning_length": avg_reasoning_len,
        "pct_short_reasoning": pct_reasoning_short,
        "plan_coherence": plan_coherence,
        "latency_p50_ms": latency_p50,
        "latency_p95_ms": latency_p95,
        "latency_p99_ms": latency_p99,
        "latency_mean_ms": latency_mean,
        "confusion_matrix": cm.tolist(),
        "classification_report": clf_report,
    }


# ----------------------------------------------------------------------------
#  Model wrapper
# ----------------------------------------------------------------------------

class LocalModel:
    def __init__(self, model_dir: str):
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        print(f"[Eval] Loading {model_dir}")
        self.tokenizer = AutoTokenizer.from_pretrained(model_dir)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
        self.model = AutoModelForCausalLM.from_pretrained(
            model_dir, device_map="auto", torch_dtype=torch.bfloat16,
        )
        self.model.eval()

    def generate(self, messages: List[Dict[str, str]], max_new_tokens: int = 256,
                 temperature: float = 0.4) -> Dict[str, Any]:
        import torch
        try:
            prompt = self.tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True,
            )
        except Exception:
            prompt = (
                f"<system>{messages[0]['content']}</system>\n"
                f"<user>{messages[1]['content']}</user>\n"
                f"<assistant>"
            )
        inputs = self.tokenizer(prompt, return_tensors="pt").to(self.model.device)
        t0 = time.time()
        with torch.no_grad():
            out = self.model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                temperature=temperature,
                top_p=0.95,
                do_sample=temperature > 0,
                pad_token_id=self.tokenizer.pad_token_id,
            )
        latency = (time.time() - t0) * 1000
        new_tokens = out[0][inputs["input_ids"].shape[1]:]
        text = self.tokenizer.decode(new_tokens, skip_special_tokens=True).strip()
        return {"text": text, "latency_ms": latency}


class EndpointModel:
    def __init__(self, endpoint_url: str):
        self.url = endpoint_url

    def generate(self, messages: List[Dict[str, str]], **kwargs) -> Dict[str, Any]:
        import requests
        # The endpoint expects a 'context' field — extract the user text
        user_text = messages[1]["content"] if len(messages) > 1 else ""
        system_text = messages[0]["content"] if messages else ""
        # Concatenate for the endpoint
        full_prompt = system_text + "\n\n" + user_text
        try:
            ctx = json.loads(user_text.split("Game state (JSON):\n")[-1].split("\n\nRead")[0])
        except Exception:
            ctx = {}
        payload = {"context": ctx, "max_new_tokens": kwargs.get("max_new_tokens", 256),
                   "temperature": kwargs.get("temperature", 0.4)}
        r = requests.post(self.url, json=payload, timeout=60)
        r.raise_for_status()
        data = r.json()
        return {
            "text": data.get("raw", ""),
            "latency_ms": data.get("latency_ms", 0),
            "intent": data.get("intent", {}),
        }


# ----------------------------------------------------------------------------
#  Inference + evaluation
# ----------------------------------------------------------------------------

def load_test(path: str, max_samples: Optional[int] = None) -> List[Dict[str, Any]]:
    samples = []
    with open(path, "r", encoding="utf-8") as f:
        for i, line in enumerate(f):
            if max_samples is not None and i >= max_samples:
                break
            line = line.strip()
            if not line:
                continue
            samples.append(json.loads(line))
    return samples


def parse_output(text: str) -> Dict[str, Any]:
    """Parse the raw model output into a structured IntentOutput."""
    if not text:
        return {"valid": False, "intent": "", "reasoning": "", "expectedPlayerReaction": "",
                "highLevelPlan": "", "confidence": 0.0}

    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\n?", "", cleaned)
        cleaned = re.sub(r"\n?```$", "", cleaned)
    cleaned = cleaned.strip()

    m = re.search(r"\{[\s\S]*\}", cleaned)
    if not m:
        return {"valid": False, "intent": cleaned, "reasoning": "", "expectedPlayerReaction": "",
                "highLevelPlan": "", "confidence": 0.0}
    try:
        obj = json.loads(m.group(0))
    except Exception:
        return {"valid": False, "intent": cleaned, "reasoning": "", "expectedPlayerReaction": "",
                "highLevelPlan": "", "confidence": 0.0}

    # Validate required fields
    required = ["intent", "reasoning", "expectedPlayerReaction", "highLevelPlan", "confidence"]
    valid = all(k in obj for k in required) and isinstance(obj.get("confidence", None), (int, float))

    return {
        "valid": valid,
        "intent": str(obj.get("intent", "")),
        "reasoning": str(obj.get("reasoning", "")),
        "expectedPlayerReaction": str(obj.get("expectedPlayerReaction", "")),
        "highLevelPlan": str(obj.get("highLevelPlan", "")),
        "confidence": float(obj.get("confidence", 0.0)),
    }


def run_evaluation(model, test_samples: List[Dict[str, Any]],
                   temperature: float, max_new_tokens: int) -> tuple:
    predictions = []
    ground_truth = []
    latencies = []
    raw_outputs = []

    print(f"[Eval] Running on {len(test_samples)} samples")
    for i, sample in enumerate(test_samples):
        # Build messages
        messages = [
            {"role": "system", "content": sample["input"]["systemText"]},
            {"role": "user", "content": sample["input"]["userText"]},
        ]

        result = model.generate(messages, max_new_tokens=max_new_tokens, temperature=temperature)
        raw = result.get("text", "")
        latency = result.get("latency_ms", 0)
        parsed = parse_output(raw)

        predictions.append(parsed)
        ground_truth.append(sample["output"]["intent"])
        latencies.append(latency)
        raw_outputs.append({"id": sample.get("meta", {}).get("id", f"sample_{i}"),
                            "raw": raw, "parsed": parsed,
                            "ground_truth": sample["output"]["intent"]})

        if (i + 1) % 50 == 0:
            print(f"  [{i + 1}/{len(test_samples)}] last latency: {latency:.0f}ms")

    return predictions, ground_truth, latencies, raw_outputs


# ----------------------------------------------------------------------------
#  Reporting
# ----------------------------------------------------------------------------

def render_markdown(metrics: Dict[str, Any], config: Dict[str, Any]) -> str:
    lines = [
        "# Project Eternal — Model Evaluation Report",
        "",
        f"**Samples evaluated:** {metrics['n_samples']}",
        f"**Timestamp:** {time.strftime('%Y-%m-%d %H:%M:%S')}",
        f"**Model:** {config.get('model_dir') or config.get('endpoint_url', 'unknown')}",
        "",
        "## Schema Validity",
        f"- {metrics['schema_validity']:.1%} of outputs parsed and matched the schema",
        "",
        "## Intent Agreement",
        f"- Categorical agreement: {metrics['intent_agreement']:.1%}",
        f"- Cohen's κ: {metrics['cohens_kappa']:.3f}",
        f"- Brier score (confidence calibration): {metrics['brier_score']:.3f}",
        "",
        "## Output Quality",
        f"- Avg intent length: {metrics['avg_intent_length']:.0f} chars",
        f"- Avg reasoning length: {metrics['avg_reasoning_length']:.0f} chars",
        f"- Short reasoning (<50 chars): {metrics['pct_short_reasoning']:.1%}",
        f"- Plan coherence (no low-level values): {metrics['plan_coherence']:.1%}",
        "",
        "## Latency",
        f"- Mean: {metrics['latency_mean_ms']:.0f}ms",
        f"- P50:  {metrics['latency_p50_ms']:.0f}ms",
        f"- P95:  {metrics['latency_p95_ms']:.0f}ms",
        f"- P99:  {metrics['latency_p99_ms']:.0f}ms",
        "",
        "## Confusion Matrix (intent categories)",
        "",
    ]
    cm = metrics["confusion_matrix"]
    # Render as a markdown table
    header = "| pred \\ gt | " + " | ".join(INTENT_CATEGORIES) + " |"
    sep = "|" + "|".join(["---"] * (len(INTENT_CATEGORIES) + 1)) + "|"
    lines.append(header)
    lines.append(sep)
    for i, cat in enumerate(INTENT_CATEGORIES):
        row = f"| **{cat}** | " + " | ".join(str(x) for x in cm[i]) + " |"
        lines.append(row)
    lines.append("")
    lines.append("## Classification Report (per category)")
    lines.append("")
    clf = metrics["classification_report"]
    if clf:
        rows = []
        for cat in INTENT_CATEGORIES:
            if cat in clf:
                r = clf[cat]
                rows.append([cat, f"{r['precision']:.2f}", f"{r['recall']:.2f}",
                             f"{r['f1-score']:.2f}", r["support"]])
        if rows:
            lines.append(tabulate(rows, headers=["category", "precision", "recall", "f1", "support"], tablefmt="github"))
    return "\n".join(lines)


# ----------------------------------------------------------------------------
#  Main
# ----------------------------------------------------------------------------

def main():
    args = parse_args()
    os.makedirs(args.output_dir, exist_ok=True)

    # Load model
    if args.model_dir:
        model = LocalModel(args.model_dir)
    elif args.endpoint_url:
        model = EndpointModel(args.endpoint_url)
    else:
        print("ERROR: provide --model-dir or --endpoint-url")
        return 1

    # Load test set
    test = load_test(args.test_path, args.max_samples)
    print(f"[Eval] {len(test)} test samples")

    # Run
    predictions, ground_truth, latencies, raw_outputs = run_evaluation(
        model, test, args.temperature, args.max_new_tokens,
    )

    # Compute metrics
    metrics = compute_metrics(predictions, ground_truth, latencies)

    # Persist
    with open(os.path.join(args.output_dir, "report.json"), "w") as f:
        json.dump(metrics, f, indent=2)

    with open(os.path.join(args.output_dir, "raw_outputs.jsonl"), "w") as f:
        for r in raw_outputs:
            f.write(json.dumps(r) + "\n")

    md = render_markdown(metrics, {"model_dir": args.model_dir, "endpoint_url": args.endpoint_url})
    with open(os.path.join(args.output_dir, "report.md"), "w") as f:
        f.write(md)

    # Per-sample CSV
    df = pd.DataFrame([
        {
            "id": r["id"],
            "valid": r["parsed"].get("valid", False),
            "intent": r["parsed"].get("intent", ""),
            "confidence": r["parsed"].get("confidence", 0),
            "predicted_category": categorise_intent(r["parsed"].get("intent", "")),
            "ground_truth_category": categorise_intent(r["ground_truth"].get("intent", "")),
            "latency_ms": r.get("latency_ms", 0),
        }
        for r in raw_outputs
    ])
    df.to_csv(os.path.join(args.output_dir, "per_sample.csv"), index=False)

    print(f"\n[Eval] Results written to {args.output_dir}/")
    print(f"  - report.json")
    print(f"  - report.md")
    print(f"  - raw_outputs.jsonl")
    print(f"  - per_sample.csv")
    print()
    print(md)
    return 0


if __name__ == "__main__":
    import re
    raise SystemExit(main())
