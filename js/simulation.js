import { state, getObjectGroup } from './state.js';

// =============================================
// RAY-GEOMETRY INTERSECTIONS
// =============================================

function rayIntersectCircle(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1, dy = y2 - y1;
  const fx = x1 - cx, fy = y1 - cy;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  const res = [];
  if (t1 >= -1e-9 && t1 <= 1 + 1e-9) res.push(Math.max(0, t1));
  if (t2 >= -1e-9 && t2 <= 1 + 1e-9 && Math.abs(t2 - t1) > 1e-9) res.push(Math.max(0, t2));
  return res;
}

function rayIntersectSegment(rx1, ry1, rx2, ry2, sx1, sy1, sx2, sy2) {
  const rdx = rx2 - rx1, rdy = ry2 - ry1;
  const sdx = sx2 - sx1, sdy = sy2 - sy1;
  const denom = rdx * sdy - rdy * sdx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((sx1 - rx1) * sdy - (sy1 - ry1) * sdx) / denom;
  const u = ((sx1 - rx1) * rdy - (sy1 - ry1) * rdx) / denom;
  if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9)
    return Math.max(0, Math.min(1, t));
  return null;
}

// =============================================
// RANDOM POINT ON POLYLINE
// =============================================
function randomPointOnPolyline(pts) {
  if (pts.length === 2) {
    const t = Math.random();
    return [pts[0][0] + t*(pts[1][0]-pts[0][0]), pts[0][1] + t*(pts[1][1]-pts[0][1])];
  }
  let total = 0;
  const lengths = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i+1][0]-pts[i][0], pts[i+1][1]-pts[i][1]);
    total += l; lengths.push(l);
  }
  let r = Math.random() * total;
  for (let i = 0; i < lengths.length; i++) {
    if (r <= lengths[i]) {
      const t = r / lengths[i];
      return [pts[i][0]+t*(pts[i+1][0]-pts[i][0]), pts[i][1]+t*(pts[i+1][1]-pts[i][1])];
    }
    r -= lengths[i];
  }
  return [...pts[pts.length-1]];
}

// =============================================
// DISPLACEMENTS PER RAY
// Each group gets one shared displacement (from group.uncertainty).
// Each object additionally gets its own displacement (from obj.parameters.uncertainty).
// Total displacement for an object = group_disp + own_disp
// =============================================
function computeGroupDisplacements() {
  const disp = {};
  for (const [gid, g] of Object.entries(state.groups)) {
    const unc = g.uncertainty || 0;
    const angle = Math.random() * Math.PI * 2;
    const mag = Math.random() * unc;
    disp[gid] = { dx: Math.cos(angle) * mag, dy: Math.sin(angle) * mag };
  }
  return disp;
}

function getObjDisplacement(name, groupDisp) {
  let dx = 0, dy = 0;

  // Group displacement (shared with all members)
  const gid = getObjectGroup(name);
  if (gid && groupDisp[gid]) {
    dx += groupDisp[gid].dx;
    dy += groupDisp[gid].dy;
  }

  // Individual displacement (independent)
  const ownUnc = state.objects[name]?.parameters?.uncertainty || 0;
  if (ownUnc > 0) {
    const angle = Math.random() * Math.PI * 2;
    const mag = Math.random() * ownUnc;
    dx += Math.cos(angle) * mag;
    dy += Math.sin(angle) * mag;
  }

  return { dx, dy };
}

// =============================================
// THICKNESS COMPUTATION
// =============================================
function computeRayThickness(x1, y1, x2, y2, groupDisp) {
  const pbDensity = state.materials.lead?.density || 11.34;
  let totalPbEquiv = 0;

  for (const [name, obj] of Object.entries(state.objects)) {
    if (obj.parameters?.type !== 'surface') continue;
    if (obj.parameters?.enabled === 'False' || obj.parameters?.enabled === false) continue;
    const mat = state.materials[obj.parameters?.material];
    if (!mat) continue;
    const ratio = mat.density / pbDensity;
    const d = getObjDisplacement(name, groupDisp);
    const geo = obj.parameters?.geometry;

    if (geo === 'circle') {
      const cx = obj.points[0][0] + d.dx;
      const cy = obj.points[0][1] + d.dy;
      const r = Math.abs(obj.points[1]);
      const ts = rayIntersectCircle(x1, y1, x2, y2, cx, cy, r);
      if (ts.length === 2) {
        const p1x = x1+ts[0]*(x2-x1), p1y = y1+ts[0]*(y2-y1);
        const p2x = x1+ts[1]*(x2-x1), p2y = y1+ts[1]*(y2-y1);
        totalPbEquiv += Math.hypot(p2x-p1x, p2y-p1y) * ratio;
      }
    } else {
      const pts = obj.points;
      if (!pts || pts.length < 3) continue;
      const tVals = [];
      for (let i = 0; i < pts.length; i++) {
        const j = (i+1) % pts.length;
        const t = rayIntersectSegment(x1, y1, x2, y2,
          pts[i][0]+d.dx, pts[i][1]+d.dy,
          pts[j][0]+d.dx, pts[j][1]+d.dy);
        if (t !== null) tVals.push(t);
      }
      tVals.sort((a,b) => a-b);
      const unique = tVals.filter((v,i,arr) => i===0 || Math.abs(v-arr[i-1])>1e-7);
      for (let i = 0; i+1 < unique.length; i+=2) {
        const p1x = x1+unique[i]*(x2-x1), p1y = y1+unique[i]*(y2-y1);
        const p2x = x1+unique[i+1]*(x2-x1), p2y = y1+unique[i+1]*(y2-y1);
        totalPbEquiv += Math.hypot(p2x-p1x, p2y-p1y) * ratio;
      }
    }
  }
  return totalPbEquiv;
}

// =============================================
// DETAILED INTERSECTION ANALYSIS FOR A SINGLE RAY
// Returns array of { objName, material, density, ratio, entryT, exitT,
//                    entryPt, exitPt, length, pbEquiv }
// =============================================
export function computeRayIntersections(x1, y1, x2, y2) {
  const pbDensity = state.materials.lead?.density || 11.34;
  const results = [];

  for (const [name, obj] of Object.entries(state.objects)) {
    if (obj.parameters?.type !== 'surface') continue;
    if (obj.parameters?.enabled === 'False' || obj.parameters?.enabled === false) continue;
    const mat = state.materials[obj.parameters?.material];
    const matName = obj.parameters?.material || '(unknown)';
    const density = mat?.density ?? 0;
    const ratio = mat ? density / pbDensity : 0;
    const geo = obj.parameters?.geometry;

    let segments = [];

    if (geo === 'circle') {
      const cx = obj.points[0][0], cy = obj.points[0][1];
      const r = Math.abs(obj.points[1]);
      const ts = rayIntersectCircle(x1, y1, x2, y2, cx, cy, r);
      if (ts.length === 2) segments.push([ts[0], ts[1]]);
    } else {
      const pts = obj.points;
      if (!pts || pts.length < 3) continue;
      const tVals = [];
      for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length;
        const t = rayIntersectSegment(x1, y1, x2, y2, pts[i][0], pts[i][1], pts[j][0], pts[j][1]);
        if (t !== null) tVals.push(t);
      }
      tVals.sort((a, b) => a - b);
      const unique = tVals.filter((v, i, arr) => i === 0 || Math.abs(v - arr[i - 1]) > 1e-7);
      for (let i = 0; i + 1 < unique.length; i += 2) segments.push([unique[i], unique[i + 1]]);
    }

    for (const [t0, t1] of segments) {
      const ex = x1 + t0 * (x2 - x1), ey = y1 + t0 * (y2 - y1);
      const ox2 = x1 + t1 * (x2 - x1), oy2 = y1 + t1 * (y2 - y1);
      const len = Math.hypot(ox2 - ex, oy2 - ey);
      const pbEquiv = len * ratio;
      results.push({
        objName: name, material: matName, density, ratio,
        entryT: t0, exitT: t1,
        entryPt: [ex, ey], exitPt: [ox2, oy2],
        length: len, pbEquiv
      });
    }
  }

  results.sort((a, b) => a.entryT - b.entryT);
  return results;
}

// =============================================
// SIMULATION RUNNER
// =============================================
let _batchTimer = null;
let _onUpdate = null;

export function startSimulation(onUpdate) {
  _onUpdate = onUpdate;
  state.simulation.running = true;
  state.simulation.raysComputed = 0;
  state.simulation.rays = [];

  const { sources, receptors } = getSourcesAndReceptors();
  if (!sources.length || !receptors.length) {
    state.simulation.running = false;
    return false;
  }
  scheduleBatch(sources, receptors);
  return true;
}

export function stopSimulation() {
  state.simulation.running = false;
  if (_batchTimer) clearTimeout(_batchTimer);
}

function getSourcesAndReceptors() {
  const sources = [], receptors = [];
  for (const obj of Object.values(state.objects)) {
    if (obj.parameters?.enabled === 'False' || obj.parameters?.enabled === false) continue;
    const type = obj.parameters?.type;
    if (type === 'source') sources.push(obj);
    else if (type === 'receptor') receptors.push(obj);
  }
  return { sources, receptors };
}

function scheduleBatch(sources, receptors) {
  _batchTimer = setTimeout(() => runBatch(sources, receptors), 0);
}

function runBatch(sources, receptors) {
  if (!state.simulation.running) return;

  const totalRays = parseInt(document.getElementById('p-rayNumber').value) || 1000;
  const batchSize = parseInt(document.getElementById('p-batchSize').value) || 50;

  if (state.simulation.raysComputed >= totalRays) {
    state.simulation.running = false;
    if (_onUpdate) _onUpdate(true);
    return;
  }

  const toCompute = Math.min(batchSize, totalRays - state.simulation.raysComputed);
  const groupDisp = computeGroupDisplacements();

  for (let i = 0; i < toCompute; i++) {
    const src = sources[Math.floor(Math.random()*sources.length)];
    const rec = receptors[Math.floor(Math.random()*receptors.length)];
    const p1 = randomPointOnPolyline(src.points);
    const p2 = randomPointOnPolyline(rec.points);
    const thickness = computeRayThickness(p1[0], p1[1], p2[0], p2[1], groupDisp);
    state.simulation.rays.push({ x1:p1[0], y1:p1[1], x2:p2[0], y2:p2[1], thickness });
    state.simulation.raysComputed++;
  }

  if (_onUpdate) _onUpdate(false);
  scheduleBatch(sources, receptors);
}
