import { state, worldToScreen, getObjectCentroid, getObjColor, thicknessColor, getObjectGroup } from './state.js';

const canvas = document.getElementById('main-canvas');
const ctx = canvas.getContext('2d');
const colorbarCanvas = document.getElementById('colorbar-canvas');
const cbCtx = colorbarCanvas.getContext('2d');

// Read a CSS variable from :root
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function isLight() {
  return document.documentElement.classList.contains('light');
}

export function resizeCanvas() {
  const container = document.getElementById('canvas-container');
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight - 36; // colorbar height
  colorbarCanvas.width = colorbarCanvas.parentElement.clientWidth - 120;
  draw();
}

export function draw() {
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = isLight() ? '#f5f7fc' : '#0d0f14';
  ctx.fillRect(0, 0, w, h);

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
  const light = isLight();

  const ox = canvas.width / 2 + state.view.panX;
  const oy = canvas.height / 2 + state.view.panY;

  ctx.save();
  ctx.lineWidth = 0.5;

  // Minor
  ctx.strokeStyle = light ? 'rgba(180,186,210,0.5)' : 'rgba(42,48,69,0.6)';
  ctx.beginPath();
  for (let x = ox % gridSpacing; x < canvas.width; x += gridSpacing) { ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); }
  for (let y = oy % gridSpacing; y < canvas.height; y += gridSpacing) { ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); }
  ctx.stroke();

  // Major
  const majorSpacing = gridSpacing * majorEvery;
  ctx.strokeStyle = light ? 'rgba(160,168,200,0.8)' : 'rgba(53,64,96,0.8)';
  ctx.beginPath();
  for (let x = ox % majorSpacing; x < canvas.width; x += majorSpacing) { ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); }
  for (let y = oy % majorSpacing; y < canvas.height; y += majorSpacing) { ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); }
  ctx.stroke();

  // Axes
  ctx.strokeStyle = light ? 'rgba(26,104,208,0.2)' : 'rgba(79,158,255,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ox, 0); ctx.lineTo(ox, canvas.height);
  ctx.moveTo(0, oy); ctx.lineTo(canvas.width, oy);
  ctx.stroke();

  // Axis labels
  ctx.font = '9px JetBrains Mono, monospace';
  ctx.fillStyle = light ? 'rgba(100,110,150,0.9)' : 'rgba(90,99,128,0.7)';
  ctx.textAlign = 'center';
  for (let x = ox % majorSpacing; x < canvas.width; x += majorSpacing) {
    const worldVal = ((x - ox) / zoom).toFixed(0);
    ctx.fillText(worldVal, x, oy + 12);
  }
  ctx.textAlign = 'right';
  for (let y = oy % majorSpacing; y < canvas.height; y += majorSpacing) {
    const worldVal = (-(y - oy) / zoom).toFixed(0);
    ctx.fillText(worldVal, ox - 4, y + 3);
  }

  ctx.restore();
}

// ---- UNCERTAINTY ZONES ----
// Draw expanded boundary (offset) showing where an object can be due to uncertainty
function drawUncertaintyZones() {
  for (const [name, obj] of Object.entries(state.objects)) {
    if (obj.parameters?.enabled === 'False' || obj.parameters?.enabled === false) continue;
    const color = getObjColor(obj, state.materials);
    const geo = obj.parameters?.geometry;

    // Compute total uncertainty = individual + group
    const ownUnc = obj.parameters?.uncertainty || 0;
    const gid = getObjectGroup(name);
    const groupUnc = gid && state.groups[gid] ? (state.groups[gid].uncertainty || 0) : 0;
    const totalUnc = ownUnc + groupUnc;

    if (totalUnc <= 0) continue;

    const uncScreen = totalUnc * state.view.zoom;
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.fillStyle = color;

    if (geo === 'circle') {
      const sc = worldToScreen(canvas, obj.points[0][0], obj.points[0][1]);
      const rScreen = obj.points[1] * state.view.zoom;
      // Draw annular zone: circle expanded by uncertainty
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, rScreen + uncScreen, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.stroke();
    } else {
      const pts = obj.points;
      if (!pts || pts.length < 2) { ctx.restore(); continue; }
      // Offset polygon outward by uncScreen pixels (Minkowski sum approximation)
      // Method: for each vertex, move it outward along the bisector of adjacent edges
      if (pts.length === 2) {
        // Line: draw a capsule / buffered line
        const s = worldToScreen(canvas, pts[0][0], pts[0][1]);
        const e = worldToScreen(canvas, pts[1][0], pts[1][1]);
        const dx = e.x - s.x, dy = e.y - s.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        ctx.beginPath();
        ctx.moveTo(s.x + nx * uncScreen, s.y + ny * uncScreen);
        ctx.lineTo(e.x + nx * uncScreen, e.y + ny * uncScreen);
        ctx.arc(e.x, e.y, uncScreen, Math.atan2(ny, nx), Math.atan2(-ny, -nx));
        ctx.lineTo(s.x - nx * uncScreen, s.y - ny * uncScreen);
        ctx.arc(s.x, s.y, uncScreen, Math.atan2(-ny, -nx), Math.atan2(ny, nx));
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.3;
        ctx.stroke();
      } else {
        // Polygon: expand each vertex outward
        const screenPts = pts.map(p => worldToScreen(canvas, p[0], p[1]));
        const n = screenPts.length;
        const expanded = [];
        for (let i = 0; i < n; i++) {
          const prev = screenPts[(i - 1 + n) % n];
          const curr = screenPts[i];
          const next = screenPts[(i + 1) % n];
          // edge vectors
          const e1x = curr.x - prev.x, e1y = curr.y - prev.y;
          const e2x = next.x - curr.x, e2y = next.y - curr.y;
          const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
          // outward normals (for CCW polygon, left-normal of each edge is outward)
          const n1x = -e1y / l1, n1y = e1x / l1;
          const n2x = -e2y / l2, n2y = e2x / l2;
          // bisector
          const bx = n1x + n2x, by = n1y + n2y;
          const bl = Math.hypot(bx, by) || 1;
          // scale bisector so the actual expansion is uncScreen
          const dot = n1x * bx / bl + n1y * by / bl;
          const scale = dot > 0.1 ? uncScreen / dot : uncScreen * 2;
          expanded.push({ x: curr.x + bx / bl * scale, y: curr.y + by / bl * scale });
        }
        ctx.beginPath();
        ctx.moveTo(expanded[0].x, expanded[0].y);
        for (let i = 1; i < expanded.length; i++) ctx.lineTo(expanded[i].x, expanded[i].y);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.3;
        ctx.stroke();
      }
    }
    ctx.restore();
  }
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
    const col = thicknessColor(r.thickness, minT);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(e.x, e.y);
    ctx.strokeStyle = col;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  }
}

// ---- OBJECTS ----
function drawObjects() {
  const light = isLight();
  for (const [name, obj] of Object.entries(state.objects)) {
    if (obj.parameters?.enabled === 'False' || obj.parameters?.enabled === false) continue;
    const isSelected = name === state.selectedObj;
    const isHovered = name === state.view.hoveredObj;
    const color = getObjColor(obj, state.materials);
    const type = obj.parameters?.type;
    const geo = obj.parameters?.geometry;

    ctx.save();
    if (isSelected) { ctx.shadowColor = color; ctx.shadowBlur = 14; }

    if (geo === 'circle') {
      const sc = worldToScreen(canvas, obj.points[0][0], obj.points[0][1]);
      const rScreen = obj.points[1] * state.view.zoom;

      ctx.beginPath();
      ctx.arc(sc.x, sc.y, rScreen, 0, Math.PI * 2);
      ctx.fillStyle = color + (light ? '30' : '1e');
      ctx.fill();
      ctx.strokeStyle = isSelected ? color : (isHovered ? color + 'cc' : color + (light ? 'aa' : '77'));
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
        ctx.fillStyle = color + (light ? '28' : '1a');
        ctx.fill();
      }

      ctx.strokeStyle = isSelected ? color : (isHovered ? color + 'cc' : color + (light ? 'bb' : '88'));
      ctx.lineWidth = isSelected ? 2.5 : (type === 'source' || type === 'receptor') ? 2.5 : 1.5;
      ctx.stroke();

      screenPts.forEach(sp => {
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, isSelected ? 4 : 3, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      });
    }

    // Label
    const centroid = getObjectCentroid(obj);
    const sc = worldToScreen(canvas, centroid.x, centroid.y);
    ctx.shadowBlur = 0;
    ctx.font = `${Math.max(9, Math.min(12, state.view.zoom * 2))}px JetBrains Mono, monospace`;
    ctx.fillStyle = isSelected ? color : color + (light ? 'cc' : 'aa');
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
  ctx.fillStyle = isLight() ? 'rgba(70,80,120,0.5)' : 'rgba(88,102,130,0.55)';
  ctx.textAlign = 'left';
  ctx.fillText(title, 10, 18);
  ctx.restore();
}

// ---- COLORBAR ----
function drawColorbar() {
  const minT = parseFloat(document.getElementById('p-minThickness')?.value) || 0;
  const w = colorbarCanvas.width;
  const h = colorbarCanvas.height;
  const light = isLight();

  cbCtx.clearRect(0, 0, w, h);

  if (minT <= 0) {
    cbCtx.fillStyle = light ? 'rgba(100,110,150,0.5)' : 'rgba(88,102,130,0.3)';
    cbCtx.font = '10px JetBrains Mono, monospace';
    cbCtx.textAlign = 'center';
    cbCtx.fillText('Set "Min Pb equiv" to display colorbar', w / 2, h / 2 + 4);
    return;
  }

  const grad = cbCtx.createLinearGradient(0, 0, w, 0);
  for (let i = 0; i <= 20; i++) {
    const frac = i / 20;
    grad.addColorStop(frac, thicknessColor(frac * minT, minT).replace('0.55', '1'));
  }
  cbCtx.fillStyle = grad;
  cbCtx.beginPath();
  cbCtx.roundRect(0, 2, w, h - 4, 6);
  cbCtx.fill();

  const ticks = 5;
  cbCtx.font = '9px JetBrains Mono, monospace';
  cbCtx.fillStyle = light ? 'rgba(30,40,70,0.9)' : 'rgba(232,234,240,0.8)';
  for (let i = 0; i <= ticks; i++) {
    const frac = i / ticks;
    const x = frac * w;
    const val = (frac * minT).toFixed(1);
    cbCtx.textAlign = i === 0 ? 'left' : i === ticks ? 'right' : 'center';
    cbCtx.fillText(val, x, h - 3);
  }
}

// ---- FIT VIEW ----
export function fitView() {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const obj of Object.values(state.objects)) {
    const geo = obj.parameters?.geometry;
    if (geo === 'circle') {
      const c = obj.points[0], r = obj.points[1];
      minX = Math.min(minX, c[0] - r); maxX = Math.max(maxX, c[0] + r);
      minY = Math.min(minY, c[1] - r); maxY = Math.max(maxY, c[1] + r);
    } else {
      (obj.points || []).forEach(p => {
        minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
        minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
      });
    }
  }
  if (!isFinite(minX)) return;
  const margin = 80;
  const rangeX = maxX - minX || 100;
  const rangeY = maxY - minY || 100;
  const zoom = Math.min((canvas.width - margin * 2) / rangeX, (canvas.height - margin * 2) / rangeY);
  state.view.zoom = Math.max(0.1, Math.min(50, zoom));
  state.view.panX = -((minX + maxX) / 2) * state.view.zoom;
  state.view.panY = ((minY + maxY) / 2) * state.view.zoom;
  document.getElementById('s-zoom').textContent = Math.round(state.view.zoom * 100) + '%';
}

export { canvas, ctx };
