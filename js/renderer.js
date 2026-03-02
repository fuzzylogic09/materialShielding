import { state, worldToScreen, getObjectCentroid, getObjColor, thicknessColor, getObjectGroup } from './state.js';

const canvas = document.getElementById('main-canvas');
const ctx = canvas.getContext('2d');
const colorbarCanvas = document.getElementById('colorbar-canvas');
const cbCtx = colorbarCanvas.getContext('2d');

export function isLight() {
  return document.documentElement.classList.contains('light');
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

  ctx.strokeStyle = light ? 'rgba(180,186,210,0.5)' : 'rgba(42,48,69,0.6)';
  ctx.beginPath();
  for (let x = ((ox % gridSpacing) + gridSpacing) % gridSpacing; x < canvas.width; x += gridSpacing) {
    ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height);
  }
  for (let y = ((oy % gridSpacing) + gridSpacing) % gridSpacing; y < canvas.height; y += gridSpacing) {
    ctx.moveTo(0, y); ctx.lineTo(canvas.width, y);
  }
  ctx.stroke();

  const majorSpacing = gridSpacing * majorEvery;
  ctx.strokeStyle = light ? 'rgba(160,168,200,0.8)' : 'rgba(53,64,96,0.8)';
  ctx.beginPath();
  for (let x = ((ox % majorSpacing) + majorSpacing) % majorSpacing; x < canvas.width; x += majorSpacing) {
    ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height);
  }
  for (let y = ((oy % majorSpacing) + majorSpacing) % majorSpacing; y < canvas.height; y += majorSpacing) {
    ctx.moveTo(0, y); ctx.lineTo(canvas.width, y);
  }
  ctx.stroke();

  ctx.strokeStyle = light ? 'rgba(26,104,208,0.2)' : 'rgba(79,158,255,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ox, 0); ctx.lineTo(ox, canvas.height);
  ctx.moveTo(0, oy); ctx.lineTo(canvas.width, oy);
  ctx.stroke();

  ctx.font = '9px JetBrains Mono, monospace';
  ctx.fillStyle = light ? 'rgba(100,110,150,0.9)' : 'rgba(90,99,128,0.7)';
  ctx.textAlign = 'center';
  for (let x = ((ox % majorSpacing) + majorSpacing) % majorSpacing; x < canvas.width; x += majorSpacing) {
    const worldVal = ((x - ox) / zoom).toFixed(0);
    ctx.fillText(worldVal, x, Math.min(oy + 12, canvas.height - 2));
  }
  ctx.textAlign = 'right';
  for (let y = ((oy % majorSpacing) + majorSpacing) % majorSpacing; y < canvas.height; y += majorSpacing) {
    const worldVal = (-(y - oy) / zoom).toFixed(0);
    ctx.fillText(worldVal, Math.max(ox - 4, 30), y + 3);
  }
  ctx.restore();
}

// ---- UNCERTAINTY ZONES ----
// Compute signed area to determine polygon winding (positive = CCW in screen coords)
function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return a / 2;
}

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

    const uncScreen = totalUnc * state.view.zoom;
    ctx.save();

    if (geo === 'circle') {
      // Expand circle outward only — draw an annular ring between r and r+unc
      const sc = worldToScreen(canvas, obj.points[0][0], obj.points[0][1]);
      const rInner = obj.points[1] * state.view.zoom;
      const rOuter = rInner + uncScreen;

      ctx.globalAlpha = 0.18;
      ctx.fillStyle = color;
      // Draw outer circle, then punch out inner with evenOdd
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, rOuter, 0, Math.PI * 2, false);
      ctx.arc(sc.x, sc.y, rInner, 0, Math.PI * 2, true); // CW = hole
      ctx.fill('evenodd');

      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, rOuter, 0, Math.PI * 2);
      ctx.stroke();

    } else if (obj.points && obj.points.length === 2) {
      // Line / source / receptor: draw buffered capsule using canvas arc properly
      const p0 = obj.points[0], p1 = obj.points[1];
      const s = worldToScreen(canvas, p0[0], p0[1]);
      const e = worldToScreen(canvas, p1[0], p1[1]);
      const dx = e.x - s.x, dy = e.y - s.y;
      const len = Math.hypot(dx, dy) || 1;
      // Perpendicular unit normal
      const nx = -dy / len, ny = dx / len;

      // Angles for arc at end point: the arc goes from one side to the other (180°)
      // At the END point: normal outward is in direction of +dx,+dy (forward)
      // arc from angle of (+nx,+ny) going CW (clockwise) 180° to (-nx,-ny)
      const angE1 = Math.atan2(ny, nx);       // angle of normal at end (one side)
      const angE2 = Math.atan2(-ny, -nx);     // opposite side
      // At the START point: arc from (-nx,-ny) to (+nx,+ny) going CW
      const angS1 = Math.atan2(-ny, -nx);
      const angS2 = Math.atan2(ny, nx);

      ctx.globalAlpha = 0.15;
      ctx.fillStyle = color;
      ctx.beginPath();
      // Top side: s+n*unc → e+n*unc
      ctx.moveTo(s.x + nx * uncScreen, s.y + ny * uncScreen);
      ctx.lineTo(e.x + nx * uncScreen, e.y + ny * uncScreen);
      // Arc at end point (half circle on the end cap)
      ctx.arc(e.x, e.y, uncScreen, angE1, angE2, false);
      // Bottom side: e-n*unc → s-n*unc
      ctx.lineTo(s.x - nx * uncScreen, s.y - ny * uncScreen);
      // Arc at start point (half circle on the start cap)
      ctx.arc(s.x, s.y, uncScreen, angS1, angS2, false);
      ctx.closePath();
      ctx.fill();

      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.stroke();

    } else if (obj.points && obj.points.length >= 3) {
      // Polygon: expand outward using Minkowski offset
      const screenPts = obj.points.map(p => worldToScreen(canvas, p[0], p[1]));
      const n = screenPts.length;

      // Determine if polygon is CCW in screen coords (y-down)
      // For screen coords: positive signed area = CW, negative = CCW
      const area = signedArea(screenPts);
      // We want outward normals. For CW polygon (area > 0) in screen space:
      //   right-normal of edge AB = (dy, -dx) is outward
      // For CCW polygon (area < 0) in screen space:
      //   left-normal of edge AB = (-dy, dx) is outward
      const outwardSign = area > 0 ? 1 : -1;

      const expanded = [];
      for (let i = 0; i < n; i++) {
        const prev = screenPts[(i - 1 + n) % n];
        const curr = screenPts[i];
        const next = screenPts[(i + 1) % n];

        // Incoming edge vector (prev → curr)
        const e1x = curr.x - prev.x, e1y = curr.y - prev.y;
        const l1 = Math.hypot(e1x, e1y) || 1;
        // Outgoing edge vector (curr → next)
        const e2x = next.x - curr.x, e2y = next.y - curr.y;
        const l2 = Math.hypot(e2x, e2y) || 1;

        // Outward normals for each edge (scaled by outwardSign)
        const n1x = outwardSign * e1y / l1,  n1y = outwardSign * -e1x / l1;
        const n2x = outwardSign * e2y / l2,  n2y = outwardSign * -e2x / l2;

        // Bisector = average of the two outward normals
        const bx = n1x + n2x, by = n1y + n2y;
        const bl = Math.hypot(bx, by);

        if (bl < 1e-6) {
          // 180° angle — just push along normal
          expanded.push({ x: curr.x + n1x * uncScreen, y: curr.y + n1y * uncScreen });
        } else {
          // Scale bisector so perpendicular distance = uncScreen
          // dot of bisector unit with either normal gives cos(half-angle)
          const cosHalf = (n1x * bx / bl + n1y * by / bl);
          const dist = cosHalf > 0.15 ? uncScreen / cosHalf : uncScreen * 3; // cap at 3x for very sharp angles
          expanded.push({ x: curr.x + (bx / bl) * dist, y: curr.y + (by / bl) * dist });
        }
      }

      ctx.globalAlpha = 0.15;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(expanded[0].x, expanded[0].y);
      for (let i = 1; i < expanded.length; i++) ctx.lineTo(expanded[i].x, expanded[i].y);
      ctx.closePath();
      ctx.fill();

      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(expanded[0].x, expanded[0].y);
      for (let i = 1; i < expanded.length; i++) ctx.lineTo(expanded[i].x, expanded[i].y);
      ctx.closePath();
      ctx.stroke();
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
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(e.x, e.y);
    ctx.strokeStyle = thicknessColor(r.thickness, minT);
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
  const rangeX = maxX - minX || 100;
  const rangeY = maxY - minY || 100;
  const zoom = Math.min((canvas.width - margin*2)/rangeX, (canvas.height - margin*2)/rangeY);
  state.view.zoom = Math.max(0.1, Math.min(50, zoom));
  state.view.panX = -((minX+maxX)/2) * state.view.zoom;
  state.view.panY = ((minY+maxY)/2) * state.view.zoom;
  document.getElementById('s-zoom').textContent = Math.round(state.view.zoom*100) + '%';
}

export { canvas, ctx };
