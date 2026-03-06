/* ===== Projection ===== */
const W = 1200, H = 600;
const project = (lon, lat) => [(lon + 180) / 360 * W, (90 - lat) / 180 * H];

/* ===== DOM ===== */
const svg = document.getElementById("svg");
const cameraG = document.getElementById("camera");
const layer = document.getElementById("layer");
const picked = document.getElementById("picked");
const zv = document.getElementById("zv");

/* ===== Graticule ===== */
function makeGraticule(step = 30) {
  let d = "";
  for (let lon = -180; lon <= 180; lon += step) {
    const [x0, y0] = project(lon, -90), [x1, y1] = project(lon, 90);
    d += `M${x0.toFixed(2)} ${y0.toFixed(2)} L${x1.toFixed(2)} ${y1.toFixed(2)} `;
  }
  for (let lat = -90; lat <= 90; lat += step) {
    const [x0, y0] = project(-180, lat), [x1, y1] = project(180, lat);
    d += `M${x0.toFixed(2)} ${y0.toFixed(2)} L${x1.toFixed(2)} ${y1.toFixed(2)} `;
  }
  return d;
}
document.getElementById("grat").setAttribute("d", makeGraticule(30));

/* ===== Smooth Camera ===== */
let cam = { x: 0, y: 0, k: 1 };
let tgt = { x: 0, y: 0, k: 1 };
let raf = 0;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function renderNow() {
  cameraG.setAttribute("transform", `translate(${cam.x},${cam.y}) scale(${cam.k})`);
  zv.textContent = cam.k.toFixed(2);
}
function tick() {
  raf = 0;
  const ease = 0.18;

  cam.x = lerp(cam.x, tgt.x, ease);
  cam.y = lerp(cam.y, tgt.y, ease);
  cam.k = lerp(cam.k, tgt.k, ease);

  renderNow();

  if (Math.abs(cam.x - tgt.x) > 0.05 || Math.abs(cam.y - tgt.y) > 0.05 || Math.abs(cam.k - tgt.k) > 0.0005) {
    requestRender();
  }
}
function requestRender() {
  if (!raf) raf = requestAnimationFrame(tick);
}
renderNow();

/* ===== Pan Drag ===== */
let dragging = false, moved = false, lastX = 0, lastY = 0;

svg.addEventListener("pointerdown", (e) => {
  dragging = true;
  moved = false;
  lastX = e.clientX;
  lastY = e.clientY;
  svg.setPointerCapture(e.pointerId);
});
svg.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;

  if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;

  tgt.x += dx;
  tgt.y += dy;
  requestRender();
});
svg.addEventListener("pointerup", () => {
  dragging = false;
  setTimeout(() => (moved = false), 0);
});
svg.addEventListener("pointercancel", () => (dragging = false));

/* ===== Wheel Zoom (correct around cursor) ===== */
svg.addEventListener(
  "wheel",
  (ev) => {
    ev.preventDefault();

    const pt = svg.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;

    const svgInv = svg.getScreenCTM().inverse();
    const pSvg = pt.matrixTransform(svgInv); // mouse in svg coords

    const camInv = cameraG.getScreenCTM().inverse();
    const pWorld = pt.matrixTransform(camInv); // mouse in world coords

    const z = Math.exp(-ev.deltaY * 0.0015);
    const newK = clamp(tgt.k * z, 0.6, 20);

    tgt.k = newK;
    tgt.x = pSvg.x - pWorld.x * newK;
    tgt.y = pSvg.y - pWorld.y * newK;

    requestRender();
  },
  { passive: false }
);

document.getElementById("resetBtn").addEventListener("click", () => {
  tgt = { x: 0, y: 0, k: 1 };
  cam = { ...tgt };
  renderNow();
});

/* ===== TopoJSON decode (minimal) ===== */
function decodeArcs(topology) {
  const { transform, arcs } = topology;
  const scale = transform ? transform.scale : [1, 1];
  const translate = transform ? transform.translate : [0, 0];

  return arcs.map((arc) => {
    let x = 0,
      y = 0;
    const pts = [];
    for (const [dx, dy] of arc) {
      x += dx;
      y += dy;
      pts.push([x * scale[0] + translate[0], y * scale[1] + translate[1]]);
    }
    return pts;
  });
}
function arcPts(decoded, i) {
  if (i >= 0) return decoded[i];
  return decoded[~i].slice().reverse();
}
function stitch(decoded, ringArcs) {
  const ring = [];
  for (let i = 0; i < ringArcs.length; i++) {
    const seg = arcPts(decoded, ringArcs[i]);
    ring.push(...(i ? seg.slice(1) : seg));
  }
  return ring;
}
function geomToPath(decoded, g) {
  const ringsToD = (rings) =>
    rings
      .map((r) => {
        let d = "";
        for (let i = 0; i < r.length; i++) {
          const [lon, lat] = r[i];
          const [x, y] = project(lon, lat);
          d += (i ? "L" : "M") + x.toFixed(2) + " " + y.toFixed(2) + " ";
        }
        return d + "Z";
      })
      .join(" ");

  if (g.type === "Polygon") return ringsToD(g.arcs.map((r) => stitch(decoded, r)));
  if (g.type === "MultiPolygon")
    return g.arcs.map((poly) => ringsToD(poly.map((r) => stitch(decoded, r)))).join(" ");
  return "";
}

/* ===== Draw Countries ===== */
let selected = null;

async function main() {
  const url = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
  const topo = await (await fetch(url, { cache: "force-cache" })).json();

  const obj = topo.objects.countries;
  const decoded = decodeArcs(topo);

  for (const g of obj.geometries) {
    const d = geomToPath(decoded, g);
    if (!d) continue;

    const outline = document.createElementNS("http://www.w3.org/2000/svg", "path");
    outline.setAttribute("class", "outline");
    outline.setAttribute("fill-rule", "evenodd");
    outline.setAttribute("d", d);
    layer.appendChild(outline);

    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("class", "country");
    p.setAttribute("fill-rule", "evenodd");
    p.setAttribute("d", d);

    const name = (g.properties && (g.properties.name || g.properties.ADMIN || g.properties.NAME)) || "Unknown";
    p.dataset.name = name;

    p.addEventListener("click", (ev) => {
      if (moved) return;
      ev.stopPropagation();
      if (selected) selected.classList.remove("selected");
      selected = p;
      p.classList.add("selected");
      picked.textContent = name;
    });

    layer.appendChild(p);
  }
}

svg.addEventListener("click", () => {
  if (moved) return;
  if (selected) selected.classList.remove("selected");
  selected = null;
  picked.textContent = "—";
});

main().catch((e) => {
  console.error(e);
  picked.textContent = "خطأ تحميل الخريطة";
});
