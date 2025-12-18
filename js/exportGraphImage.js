// js/exportGraphImage.js
(function () {
  function downloadDataUrl(dataUrl, filename) {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function getElRectRelativeTo(el, parent) {
    const r = el.getBoundingClientRect();
    const pr = parent.getBoundingClientRect();
    return {
      x: r.left - pr.left,
      y: r.top - pr.top,
      w: r.width,
      h: r.height
    };
  }

    async function svgToImage(svgEl) {
    // Clone so we don’t mutate the live chart
    const clone = svgEl.cloneNode(true);

    // 1)Brush export rules:
    // - background rects: hide (prevents black bars)
    // - extent rects: keep, and inline style so it renders consistently
    // - resize handles: hide (optional)
    clone.querySelectorAll(".brush rect.background").forEach((r) => {
    r.setAttribute("fill", "none");
    r.setAttribute("stroke", "none");
    r.setAttribute("fill-opacity", "0");
    r.setAttribute("stroke-opacity", "0");
    });

    clone.querySelectorAll(".brush rect.extent").forEach((r) => {
    // Inline a reasonable “selection” look.
    // (Tune these to match your CSS if you want exact parity.)
    r.setAttribute("fill", "rgba(255, 255, 255, 0.25)");
    r.setAttribute("stroke", "rgba(0, 0, 0,0.6)");
    r.setAttribute("stroke-width", "1");
    r.setAttribute("shape-rendering", "crispEdges");
    });

    clone.querySelectorAll(".brush .resize").forEach((g) => {
    g.setAttribute("display", "none");
    });

    // 2) Inline fonts + key styles so exported SVG matches the page
    // (External CSS won’t be applied when rasterizing)
    const pageFont = getComputedStyle(document.body).fontFamily || "sans-serif";

    // Force a baseline font on the SVG
    clone.style.fontFamily = pageFont;

    // Copy computed styles from live SVG elements -> clone elements by index
    const liveTexts = svgEl.querySelectorAll("text");
    const cloneTexts = clone.querySelectorAll("text");
    for (let i = 0; i < cloneTexts.length; i++) {
        const cs = getComputedStyle(liveTexts[i]);
        const t = cloneTexts[i];
        t.style.fontFamily = cs.fontFamily || pageFont;
        t.style.fontSize = cs.fontSize;
        t.style.fontWeight = cs.fontWeight;
        t.style.fill = cs.fill;
        t.style.opacity = cs.opacity;
    }

    const livePaths = svgEl.querySelectorAll("path, line");
    const clonePaths = clone.querySelectorAll("path, line");
    for (let i = 0; i < clonePaths.length; i++) {
        const cs = getComputedStyle(livePaths[i]);
        const p = clonePaths[i];
        // Helps preserve axis/domain colors
        p.style.stroke = cs.stroke;
        p.style.strokeWidth = cs.strokeWidth;
        p.style.fill = cs.fill;
        p.style.opacity = cs.opacity;
    }

    // 3) Bake CSS translateY for axis labels into SVG transform
    // Your CSS: text.label { transform: translateY(-12px); }
    const liveLabels = svgEl.querySelectorAll("text.label");
    const cloneLabels = clone.querySelectorAll("text.label");

    for (let i = 0; i < cloneLabels.length; i++) {
        const live = liveLabels[i];
        const t = cloneLabels[i];

        const cs = getComputedStyle(live);
        const tr = cs.transform;

        // If transform is a matrix(...) or translateY(...), extract the Y shift
        let dy = 0;

        // matrix(a,b,c,d,tx,ty)
        const m = tr && tr.startsWith("matrix(") ? tr.slice(7, -1).split(",").map(Number) : null;
        if (m && m.length === 6 && !Number.isNaN(m[5])) {
        dy = m[5];
        } else {
        // translateY(-12px) pattern (rarely returned like this, but safe)
        const ty = tr && tr.match(/translateY\(([-\d.]+)px\)/);
        if (ty) dy = parseFloat(ty[1]);
        }

        if (dy) {
        // Preserve any existing SVG transform (e.g., rotate(0))
        const existing = t.getAttribute("transform") || "";
        const baked = `translate(0,${dy}) ${existing}`.trim();
        t.setAttribute("transform", baked);

        // Remove CSS transform so we don't double-apply in some renderers
        t.style.transform = "";
        }
    }

    // Serialize
    const serializer = new XMLSerializer();
    let svgString = serializer.serializeToString(clone);

    // Ensure xmlns is present
    if (!svgString.match(/^<svg[^>]+xmlns=/)) {
        svgString = svgString.replace(
        /^<svg/,
        '<svg xmlns="http://www.w3.org/2000/svg"'
        );
    }

    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.decoding = "async";

    const p = new Promise((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = reject;
    });

    img.src = url;
    const loaded = await p;
    URL.revokeObjectURL(url);
    return loaded;
    }


  async function exportParcoordsPng() {
    const graph = document.getElementById("graph");
    if (!graph) {
      alert("Could not find #graph.");
      return;
    }

    // If collapsed, there's nothing meaningful to export
    if (graph.getBoundingClientRect().height < 5) {
      alert("Graph is collapsed; expand it before exporting.");
      return;
    }

    // Use CSS pixel size of the graph container for export framing
    const graphRect = graph.getBoundingClientRect();
    const w = Math.round(graphRect.width);
    const h = Math.round(graphRect.height);

    // High DPI export:
    // - devicePixelRatio handles retina/zoom
    // - extraScale makes it “print ready”
    const dpr = window.devicePixelRatio || 1;
    const extraScale = 2; // try 2–3
    const scale = dpr * extraScale;

    const out = document.createElement("canvas");
    out.width = Math.round(w * scale);
    out.height = Math.round(h * scale);

    const ctx = out.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    // White background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    // 1) Draw canvases in DOM order (matches stacking)
    const canvases = Array.from(graph.querySelectorAll("canvas"));
    canvases.forEach((c) => {
    const cs = getComputedStyle(c);

    // Only skip if it truly doesn't render
    if (cs.display === "none") return;

    const r = getElRectRelativeTo(c, graph);

    // Respect CSS opacity (this captures "faded" states)
    const prevAlpha = ctx.globalAlpha;
    const alpha = parseFloat(cs.opacity || "1");
    ctx.globalAlpha = Number.isFinite(alpha) ? alpha : 1;

    ctx.drawImage(c, r.x, r.y, r.w, r.h);

    ctx.globalAlpha = prevAlpha;
    });


    // 2) Draw the SVG (axes/labels) on top
    const svg = graph.querySelector("svg");
    if (svg) {
      const svgImg = await svgToImage(svg);
      const r = getElRectRelativeTo(svg, graph);
      ctx.drawImage(svgImg, r.x, r.y, r.w, r.h);
    }

    // Download
    const filename = "parallel_coordinates.png";
    downloadDataUrl(out.toDataURL("image/png"), filename);
  }

  function wireUp() {
    const btn = document.getElementById("saveImage");
    if (!btn) return;
    btn.addEventListener("click", () => {
      exportParcoordsPng().catch((err) => {
        console.error(err);
        alert("Export failed. Check console for details.");
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireUp);
  } else {
    wireUp();
  }
})();
