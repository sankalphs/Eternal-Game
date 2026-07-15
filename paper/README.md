# Causality Beats Correlation — IEEE Research Paper

This directory contains a research paper on the genetic-algorithm approach to
opponent AI in *Project Eternal*, with a correlation-vs-causation analysis of
the evolved genome. Two formats are provided:

| File | Format | Use |
|---|---|---|
| `eternal-ga-paper.md` | Markdown | Reading on GitHub or in any markdown viewer. Self-contained, embeds all figures. |
| `eternal-ga-paper.tex` | LaTeX (IEEE conference template) | Submitting to a venue. Requires `pdflatex` + IEEEtran class. |

## Authors

- **Sathvik A R** — arsathvik48@gmail.com
- **Sankalp H S** — sankalp.sanku28@gmail.com

Department of Computer Science and Engineering, PES University, Bengaluru, India.

## Headline numbers

- **+12 pp** win rate over hand-tuned baseline (96.8% vs 84.4%, p < 0.001, n = 3000)
- **−35%** damage taken
- **−17%** match duration
- **90 seconds** of compute (vs 6 months of hand-tuning)
- **+32 pp** advantage preserved on +30% stat-buffed bosses
- **163%** transfer ratio to held-out opponents

## The methodological surprise

The same correlation analysis that confirmed the GA's win also revealed that the
GA is being **systematically misled by spurious correlation** in ~30% of its
most-tuned genes:

- The single most-correlated gene (`riskTolerance`, r = −0.215) is essentially
  zero-impact under ablation.
- The second most-important gene under ablation (`projectileUsage`, drop =
  +1.01%) is essentially uncorrelated in the final population (r = +0.020).

**The GA is confidently wrong about which knobs matter.** This is the centerpiece
finding of the paper.

## Files in this directory

```
paper/
├── README.md                      # this file
├── Makefile                       # `make` builds the PDF
├── eternal-ga-paper.md            # markdown source (preferred for reading)
├── eternal-ga-paper.tex           # LaTeX source (for submission)
├── figures/                       # SVG figures (embedded in both sources)
│   ├── fig_multi_seed.svg
│   ├── fig_convergence.svg
│   ├── fig_trajectories.svg
│   ├── fig_ablation.svg
│   ├── fig_corr_vs_abl.svg
│   ├── fig_generalization.svg
│   └── fig_modified_bosses.svg
└── photos/                        # game screenshots
    ├── fig_fight_scene.png
    ├── fig_ghost_fight.png
    ├── fig_gameplay_1.png
    └── fig_ghost_active.png
```

## Building the LaTeX version

Requires: `pdflatex` (TeX Live, MikTeX, or MacTeX), plus the standard
`IEEEtran.cls` (ships with most TeX distributions).

```bash
make            # builds eternal-ga-paper.pdf
make clean      # removes build artifacts
```

Or manually:

```bash
pdflatex -interaction=nonstopmode eternal-ga-paper.tex
pdflatex -interaction=nonstopmode eternal-ga-paper.tex   # second pass for refs
```

The IEEE conference template (`IEEEtran.cls`) is required. Most TeX
distributions ship it; if yours doesn't, download from
`https://www.ctan.org/pkg/ieeetran`.

## Reading the markdown version

The markdown version (`eternal-ga-paper.md`) is self-contained and renders
correctly on:

- GitHub / GitLab
- VS Code with the Markdown Preview Mermaid Support extension
- Obsidian / Typora / Mark Text
- Pandoc-rendered HTML or PDF

The images are referenced relative to `paper/photos/` and `paper/figures/`,
so open the file from the `paper/` directory.

## Reproducing the experiments

All experiments referenced in the paper are reproducible from the repository
root. See `paper/eternal-ga-paper.md` (Appendix A) or
`paper/eternal-ga-paper.tex` (\ref{sec:reproducibility}) for the full
reproducer block.

## Headline figures

### Correlation vs Causation (Fig. 6)

The 4-quadrant scatter that exposes the correlation-vs-causation problem. See
`figures/fig_corr_vs_abl.svg`.

### Generalisation (Fig. 7)

The leave-two-out transfer test. See `figures/fig_generalization.svg`.

### Modified-bosses transfer (Fig. 8)

The +32pp advantage preserved on stat-buffed opponents. See
`figures/fig_modified_bosses.svg`.

### Gene trajectory (Fig. 4b)

The 12 small multiples, one per gene. See `figures/fig_trajectories.svg`.

### Convergence curve (Fig. 4a)

Best fitness + population diversity over 15 generations. See
`figures/fig_convergence.svg`.

## Citation

```bibtex
@inproceedings{sathvik2026eternal,
  title     = {Causality Beats Correlation: A Genetic-Algorithm Approach to
               Adaptive Opponent AI in a 2D Fighting Game, with a
               Correlation-vs-Causation Analysis of the Evolved Genome},
  author    = {Sathvik, A. R. and Sankalp, H. S.},
  booktitle = {Proceedings of the IEEE Conference on Games},
  year      = {2026},
  note      = {Manuscript}
}
```

## License

This paper and all accompanying code are released under the MIT License.
Game assets and screenshots from *Project Eternal* are © 2026 the authors.
