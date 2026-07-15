# Makefile for the IEEE LaTeX paper
# Requires: pdflatex + IEEEtran.cls (ships with TeX Live, MikTeX, MacTeX)

TARGET = eternal-ga-paper
LATEX  = pdflatex
LATEXFLAGS = -interaction=nonstopmode -halt-on-error

.PHONY: all clean pdf view

all: pdf

pdf: $(TARGET).pdf

$(TARGET).pdf: $(TARGET).tex
	$(LATEX) $(LATEXFLAGS) $(TARGET).tex
	$(LATEX) $(LATEXFLAGS) $(TARGET).tex   # second pass for cross-refs

view: $(TARGET).pdf
	$(TARGET).pdf &

clean:
	rm -f $(TARGET).aux $(TARGET).log $(TARGET).out $(TARGET).toc $(TARGET).bbl $(TARGET).blg $(TARGET).synctex.gz
	rm -f $(TARGET).pdf

mrproper: clean
	rm -f $(TARGET).pdf

.PHONY: help
help:
	@echo "make            - build the PDF"
	@echo "make pdf        - same as 'make'"
	@echo "make view       - open the PDF in the default viewer"
	@echo "make clean      - remove build artifacts"
	@echo "make mrproper   - remove the PDF too"
