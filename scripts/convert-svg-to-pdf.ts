// Convert SVG figures to PDF for the LaTeX paper
// Uses Puppeteer with a headless Chromium

import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const FIG_DIR = path.resolve(process.cwd(), "paper", "figures");
const OUT_DIR = path.resolve(process.cwd(), "paper", "figures_pdf");
fs.mkdirSync(OUT_DIR, { recursive: true });

const svgs = fs.readdirSync(FIG_DIR).filter((f) => f.endsWith(".svg"));

const browser = await puppeteer.launch({ headless: "new" });
const page = await browser.newPage();

for (const svg of svgs) {
  const svgPath = path.join(FIG_DIR, svg);
  const svgContent = fs.readFileSync(svgPath, "utf-8");
  const outName = svg.replace(/\.svg$/, ".pdf");
  const outPath = path.join(OUT_DIR, outName);
  console.log(`[svg2pdf] ${svg} -> ${outName}`);

  // Wrap the SVG in a minimal HTML page
  const html = `<!DOCTYPE html><html><head><style>
    body { margin: 0; padding: 0; background: white; }
    svg { display: block; }
  </style></head><body>${svgContent}</body></html>`;

  await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 60000 });
  // The SVG is sized via viewBox. Get the bounding box of the SVG element.
  const dims = await page.evaluate(() => {
    const svg = document.querySelector("svg");
    if (!svg) return { width: 1000, height: 1000 };
    const rect = svg.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  await page.setViewport({ width: Math.ceil(dims.width), height: Math.ceil(dims.height) });
  await page.pdf({
    path: outPath,
    width: `${Math.ceil(dims.width)}px`,
    height: `${Math.ceil(dims.height)}px`,
    printBackground: true,
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
  });
}

await browser.close();
console.log(`[svg2pdf] done. PDFs in ${OUT_DIR}`);
