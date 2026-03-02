import { state, worldToScreen, getObjectCentroid, getObjColor, thicknessColor, getObjectGroup } from './state.js';

const canvas = document.getElementById('main-canvas');
const ctx = canvas.getContext('2d');
const colorbarCanvas = document.getElementById('colorbar-canvas');
const cbCtx = colorbarCanvas.getContext('2d');

// ---- THEME HELPERS ----
// Read theme-aware colors at draw time so dark/light theme works correctly.
export function isLight() {
  return document.documentElement.classList.contains('light');
}

// Return the correct color string for canvas drawing based on current theme
function tc(dark, light) {
  return isLight() ? light : dark;
}

export function resizeCanvas() {
  const container = document.getElementById('canvas-container');
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight - 36;
  const cbParent = colorbarCanvas.parentElement;
  colorbarCanvas.width = Math.max(100, cbParent.clientWidth - 130);
  draw();
}

export function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = tc('#0d0f14', '#f5f7fc');
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawGrid();
  drawUncertaintyZones();
  drawRays();
  drawObjects();
  drawTitle();
  drawColorbar();
}

// ---- GRID ----
function drawGrid() {
  const zoom = state.view.zoom;
  const gridBase = 10;
  const gridSpacing = gridBase * zoom;
  const majorEvery = 5;
  const ox = canvas.width / 2 + state.view.panX;
  const oy = canvas.height / 2 + state.view.panY;

  ctx.save();
  ctx.lineWidth = 0.5;

  // Minor grid
  ctx.strokeStyle = tc('rgba(42,48,69,0.6)', 'rgba(180,186,210,0.5)');
  ctx.beginPath();
  for (let x = ((ox % gridSpacing) + gridSpacing) % gridSpacing; x < canvas.width; x += gridSpacing) {
    ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height);
  }
  for (let y = ((oy % gridSpacing) + gridSpacing) % gridSpacing; y < canvas.height; y += gridSpacing) {
    ctx.moveTo(0, y); ctx.lineTo(canvas.width, y);
  }
  ctx.stroke();

  // Major grid
  const majorSpacing = gridSpacing * majorEvery;
  ctx.strokeStyle = tc('rgba(53,64,96,0.8)', 'rgba(150,160,195,0.8)');
  ctx.beginPath();
  for (let x = ((ox % majorSpacing) + majorSpacing) % majorSpacing; x < canvas.width; x += majorSpacing) {
    ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height);
  }
  for (let y = ((oy % majorSpacing) + majorSpacing) % majorSpacing; y < canvas.height; y += majorSpacing) {
    ctx.moveTo(0, y); ctx.lineTo(canvas.width, y);
  }
  ctx.stroke();

  // Axes
  ctx.strokeStyle = tc('rgba(79,158,255,0.25)', 'rgba(26,104,208,0.2)');
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ox, 0); ctx.lineTo(ox, canvas.height);
  ctx.moveTo(0, oy); ctx.lineTo(canvas.width, oy);
  ctx.stroke();

  // Axis labels
  ctx.font = '9px JetBrains Mono, monospace';
  ctx.fillStyle = tc('rgba(90,99,128,0.7)', 'rgba(100,110,150,0.9)');
  ctx.textAlign = 'center';
  for (let x = ((ox % majorSpacing) + majorSpacing) % majorSpacing; x < canvas.width; x += majorSpacing) {
    ctx.fillText(((x - ox) / zoom).toFixed(0), x, Math.min(oy + 12, canvas.height - 2));
  }
  ctx.textAlign = 'right';
  for (let y = ((oy % majorSpacing) + majorSpacing) % majorSpacing; y < canvas.height; y += majorSpacing) {
    ctx.fillText((-(y - oy) / zoom).toFixed(0), Math.max(ox - 4, 30), y + 3);
  }
  ctx.restore();
}

// ---- UNCERTAINTY ZONES (Minkowski buffer) ----
//
// The uncertainty zone is the Minkowski sum of the shape with a disk of radius `unc`.
// For a polygon, this equals the union of:
//   - the polygon itself
//   - rectangles along each edge (offset outward by unc)
//   - semicircles at each vertex (radius unc)
//
// In canvas we achieve this by drawing:
//   - The offset polygon (each edge pushed out by unc, corners joined with arcs)
// This is the standard "stroke + fill with lineWidth=2*unc, lineJoin=round, lineCap=round" trick.

function drawUncertaintyZones() {
  for (const [name, obj] of Object.entries(state.objects)) {
    if (obj.parameters?.enabled === 'False' || obj.parameters?.enabled === false) continue;

    const color = getObjColor(obj, state.materials);
    const geo = obj.parameters?.geometry;
    const ownUnc = obj.parameters?.uncertainty || 0;
    const gid = getObjectGroup(name);
    const groupUnc = gid && state.groups[gid] ? (state.groups[gid].uncertainty || 0) : 0;
    const totalUnc = ownUnc + groupUnc;

    if (totalUnc <= 0) continue;

    // Convert uncertainty from world units to screen pixels
    const uncScreen = totalUnc * state.view.zoom;

    ctx.save();

    if (geo === 'circle') {
      // Circle buffer: annular ring between r and r+unc
      const sc = worldToScreen(canvas, obj.points[0][0], obj.points[0][1]);
      const rInner = Math.abs(obj.points[1]) * state.view.zoom;
      const rOuter = rInner + uncScreen;

      // Fill the annular ring using evenodd
      ctx.fillStyle = color + '25';
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, rOuter, 0, Math.PI * 2, false);
      ctx.arc(sc.x, sc.y, rInner, 0, Math.PI * 2, true); // hole
      ctx.fill('evenodd');

      // Dashed outer boundary
      ctx.strokeStyle = color + '60';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, rOuter, 0, Math.PI * 2);
      ctx.stroke();

    } else if (obj.points && obj.points.length >= 2) {
      // Minkowski buffer using an OFFSCREEN canvas.
      // Algorithm (equivalent to shapely polygon.buffer(unc)):
      //   1. On offscreen: fat-stroke the path (lineWidth=2*unc, round caps+joins)
      //      For polygons: also fill the interior → full buffered shape
      //   2. For closed polygons: erase interior on OFFSCREEN with destination-out
      //      (safe — never corrupts main canvas)
      //   3. Blit offscreen onto main canvas with globalAlpha

      const pts = obj.points;
      const screenPts = pts.map(p => worldToScreen(canvas, p[0], p[1]));
      const isClosed = pts.length > 2;

      const off = new OffscreenCanvas(canvas.width, canvas.height);
      const offCtx = off.getContext('2d');

      offCtx.fillStyle = color;
      offCtx.strokeStyle = color;
      offCtx.lineWidth = uncScreen * 2;
      offCtx.lineCap = 'round';
      offCtx.lineJoin = 'round';

      offCtx.beginPath();
      offCtx.moveTo(screenPts[0].x, screenPts[0].y);
      for (let i = 1; i < screenPts.length; i++) offCtx.lineTo(screenPts[i].x, screenPts[i].y);
      if (isClosed) offCtx.closePath();

      if (isClosed) offCtx.fill();
      offCtx.stroke();

      if (isClosed) {
        offCtx.globalCompositeOperation = 'destination-out';
        offCtx.beginPath();
        offCtx.moveTo(screenPts[0].x, screenPts[0].y);
        for (let i = 1; i < screenPts.length; i++) offCtx.lineTo(screenPts[i].x, screenPts[i].y);
        offCtx.closePath();
        offCtx.fill();
      }

      ctx.globalAlpha = 0.20;
      ctx.drawImage(off, 0, 0);

      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([4, 4]);

      if (isClosed) {
        drawExpandedBoundary(screenPts, uncScreen, true);
      } else {
        drawCapsuleOutline(screenPts[0], screenPts[screenPts.length - 1], uncScreen);
      }
    }

    ctx.restore();
  }
}

// Draw the dashed outer boundary of a polygon buffered by `unc` pixels
// Uses the "offset each edge + arc at convex vertices" approach
function drawExpandedBoundary(pts, unc, closed) {
  const n = pts.length;
  if (n < 2) return;

  // Compute outward normals for each edge
  // We determine outward = away from centroid
  let cx = 0, cy = 0;
  pts.forEach(p => { cx += p.x; cy += p.y; });
  cx /= n; cy /= n;

  const normals = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (!closed && j === 0) break;
    const dx = pts[j].x - pts[i].x;
    const dy = pts[j].y - pts[i].y;
    const len = Math.hypot(dx, dy) || 1;
    // Two candidate normals
    let nx = -dy / len, ny = dx / len;
    // Check if this points away from centroid (use midpoint of edge)
    const mx = (pts[i].x + pts[j].x) / 2;
    const my = (pts[i].y + pts[j].y) / 2;
    if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }
    normals.push({ nx, ny });
  }

  // Offset each edge
  const offsetEdges = normals.map((n, i) => {
    const j = closed ? (i + 1) % pts.length : i + 1;
    return {
      x1: pts[i].x + n.nx * unc,
      y1: pts[i].y + n.ny * unc,
      x2: pts[j].x + n.nx * unc,
      y2: pts[j].y + n.ny * unc
    };
  });

  if (offsetEdges.length === 0) return;

  ctx.beginPath();
  ctx.moveTo(offsetEdges[0].x1, offsetEdges[0].y1);
  for (let i = 0; i < offsetEdges.length; i++) {
    const e = offsetEdges[i];
    ctx.lineTo(e.x2, e.y2);
    // Arc at convex vertex joining edge i to edge i+1
    const nextE = offsetEdges[(i + 1) % offsetEdges.length];
    if (closed || i < offsetEdges.length - 1) {
      const vi = closed ? (i + 1) % n : i + 1; // vertex index
      const vx = pts[vi].x, vy = pts[vi].y;
      const a1 = Math.atan2(e.y2 - vy, e.x2 - vx);
      const a2 = Math.atan2(nextE.y1 - vy, nextE.x1 - vx);
      // Only draw arc if it's convex (cross product determines turn direction)
      ctx.arc(vx, vy, unc, a1, a2, false);
    }
  }
  if (closed) ctx.closePath();
  ctx.stroke();
}

function drawCapsuleOutline(s, e, unc) {
  const dx = e.x - s.x, dy = e.y - s.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const a1 = Math.atan2(ny, nx);
  const a2 = Math.atan2(-ny, -nx);

  ctx.beginPath();
  ctx.moveTo(s.x + nx * unc, s.y + ny * unc);
  ctx.lineTo(e.x + nx * unc, e.y + ny * unc);
  ctx.arc(e.x, e.y, unc, a1, a2, false);
  ctx.lineTo(s.x - nx * unc, s.y - ny * unc);
  ctx.arc(s.x, s.y, unc, a2, a1, false);
  ctx.closePath();
  ctx.stroke();
}

// ---- RAYS ----
export function drawRays() {
  const rays = state.simulation.rays;
  if (!rays.length) return;
  const minT = parseFloat(document.getElementById('p-minThickness').value) || 0;
  const maxShow = parseInt(document.getElementById('p-plotRayCount').value) || 100;
  const filtered = rays.filter(r => r.thickness <= minT);
  const toShow = filtered.slice(-maxShow);
  for (const r of toShow) {
    const s = worldToScreen(canvas, r.x1, r.y1);
    const e = worldToScreen(canvas, r.x2, r.y2);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y);
    ctx.strokeStyle = thicknessColor(r.thickness, minT);
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  }
}

// ---- OBJECTS ----
function drawObjects() {
  for (const [name, obj] of Object.entries(state.objects)) {
    if (obj.parameters?.enabled === 'False' || obj.parameters?.enabled === false) continue;
    const isSelected = name === state.selectedObj;
    const isHovered = name === state.view.hoveredObj;
    const color = getObjColor(obj, state.materials);
    const type = obj.parameters?.type;
    const geo = obj.parameters?.geometry;
    const fillAlpha = isLight() ? '28' : '1a';
    const strokeAlpha = isLight() ? 'bb' : '88';

    ctx.save();
    if (isSelected) { ctx.shadowColor = color; ctx.shadowBlur = 14; }

    if (geo === 'circle') {
      const sc = worldToScreen(canvas, obj.points[0][0], obj.points[0][1]);
      const rScreen = Math.abs(obj.points[1]) * state.view.zoom;
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, rScreen, 0, Math.PI * 2);
      ctx.fillStyle = color + fillAlpha;
      ctx.fill();
      ctx.strokeStyle = isSelected ? color : (isHovered ? color + 'cc' : color + strokeAlpha);
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.stroke();
    } else {
      const pts = obj.points;
      if (!pts || pts.length < 2) { ctx.restore(); continue; }
      const screenPts = pts.map(p => worldToScreen(canvas, p[0], p[1]));
      ctx.beginPath();
      ctx.moveTo(screenPts[0].x, screenPts[0].y);
      for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i].x, screenPts[i].y);
      if (type !== 'source' && type !== 'receptor' && pts.length > 2) {
        ctx.closePath();
        ctx.fillStyle = color + fillAlpha;
        ctx.fill();
      }
      ctx.strokeStyle = isSelected ? color : (isHovered ? color + 'cc' : color + strokeAlpha);
      ctx.lineWidth = isSelected ? 2.5 : (type === 'source' || type === 'receptor') ? 2.5 : 1.5;
      ctx.stroke();
      screenPts.forEach(sp => {
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, isSelected ? 4 : 3, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      });
    }

    const centroid = getObjectCentroid(obj);
    const sc = worldToScreen(canvas, centroid.x, centroid.y);
    ctx.shadowBlur = 0;
    ctx.font = `${Math.max(9, Math.min(12, state.view.zoom * 2))}px JetBrains Mono, monospace`;
    ctx.fillStyle = isSelected ? color : color + (isLight() ? 'cc' : 'aa');
    ctx.textAlign = 'center';
    ctx.fillText(name, sc.x, sc.y - 10);
    ctx.restore();
  }
}

function drawTitle() {
  const title = state.params.title;
  if (!title) return;
  ctx.save();
  ctx.font = '11px JetBrains Mono, monospace';
  ctx.fillStyle = tc('rgba(88,102,130,0.55)', 'rgba(70,80,120,0.5)');
  ctx.textAlign = 'left';
  ctx.fillText(title, 10, 18);
  ctx.restore();
}

// ---- COLORBAR ----
function drawColorbar() {
  const minT = parseFloat(document.getElementById('p-minThickness')?.value) || 0;
  const w = colorbarCanvas.width;
  const h = colorbarCanvas.height;

  cbCtx.clearRect(0, 0, w, h);
  cbCtx.fillStyle = tc('#0d0f14', '#f5f7fc');
  cbCtx.fillRect(0, 0, w, h);

  if (minT <= 0) {
    cbCtx.fillStyle = tc('rgba(88,102,130,0.3)', 'rgba(100,110,150,0.5)');
    cbCtx.font = '10px JetBrains Mono, monospace';
    cbCtx.textAlign = 'center';
    cbCtx.fillText('Set "Min Pb equiv" to display colorbar', w / 2, h / 2 + 4);
    return;
  }

  const grad = cbCtx.createLinearGradient(0, 0, w, 0);
  for (let i = 0; i <= 20; i++) {
    grad.addColorStop(i / 20, thicknessColor(i / 20 * minT, minT).replace('0.55', '1'));
  }
  cbCtx.fillStyle = grad;
  cbCtx.beginPath();
  cbCtx.roundRect(0, 2, w, h - 4, 6);
  cbCtx.fill();

  cbCtx.font = '9px JetBrains Mono, monospace';
  cbCtx.fillStyle = tc('rgba(232,234,240,0.8)', 'rgba(30,40,70,0.9)');
  for (let i = 0; i <= 5; i++) {
    const frac = i / 5;
    cbCtx.textAlign = i === 0 ? 'left' : i === 5 ? 'right' : 'center';
    cbCtx.fillText((frac * minT).toFixed(1), frac * w, h - 3);
  }
}

// ---- FIT VIEW ----
export function fitView() {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const obj of Object.values(state.objects)) {
    if (obj.parameters?.geometry === 'circle') {
      const c = obj.points[0], r = obj.points[1];
      minX = Math.min(minX, c[0]-r); maxX = Math.max(maxX, c[0]+r);
      minY = Math.min(minY, c[1]-r); maxY = Math.max(maxY, c[1]+r);
    } else {
      (obj.points || []).forEach(p => {
        minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
        minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
      });
    }
  }
  if (!isFinite(minX)) return;
  const margin = 80;
  const zoom = Math.min((canvas.width - margin*2) / (maxX-minX || 100), (canvas.height - margin*2) / (maxY-minY || 100));
  state.view.zoom = Math.max(0.1, Math.min(50, zoom));
  state.view.panX = -((minX+maxX)/2) * state.view.zoom;
  state.view.panY = ((minY+maxY)/2) * state.view.zoom;
  document.getElementById('s-zoom').textContent = Math.round(state.view.zoom*100) + '%';
}

export { canvas, ctx };
