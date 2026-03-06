// =============================================
// STATE
// =============================================
export const state = {
  objects: {},
  materials: {},
  params: {
    rayNumber: 1000,
    batchSize: 50,
    minThicknessToShow: 0,
    plotRayCount: 100,
    title: 'New Simulation'
  },
  groups: {},
  selectedObj: null,
  selectedRay: null,   // { ray, segments } — ray clicked by user
  lockedAll: false,
  simulation: {
    running: false,
    rays: [],        // all computed rays stored
    raysComputed: 0,
    animFrame: null,
    batchTimer: null
  },
  view: {
    panX: 0, panY: 0, zoom: 1,
    isDragging: false,
    dragStart: null,
    dragObjStart: null,
    isMovingObj: false,
    hoveredObj: null,
    dragGroupStarts: null
  }
};

// =============================================
// COORDINATE TRANSFORMS
// =============================================
export function worldToScreen(canvas, x, y) {
  return {
    x: canvas.width / 2 + state.view.panX + x * state.view.zoom,
    y: canvas.height / 2 + state.view.panY - y * state.view.zoom
  };
}

export function screenToWorld(canvas, sx, sy) {
  return {
    x: (sx - canvas.width / 2 - state.view.panX) / state.view.zoom,
    y: -(sy - canvas.height / 2 - state.view.panY) / state.view.zoom
  };
}

// =============================================
// GEOMETRY HELPERS
// =============================================
export function getObjectCentroid(obj) {
  const geo = obj.parameters?.geometry;
  if (geo === 'circle') return { x: obj.points[0][0], y: obj.points[0][1] };
  const pts = obj.points || [];
  if (!pts.length) return { x: 0, y: 0 };
  let cx = 0, cy = 0;
  pts.forEach(p => { cx += p[0]; cy += p[1]; });
  return { x: cx / pts.length, y: cy / pts.length };
}

export function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

export function pointInPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1];
    const xj = pts[j][0], yj = pts[j][1];
    if (((yi > p.y) !== (yj > p.y)) &&
        (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

export function getObjectGroup(name) {
  for (const [gid, g] of Object.entries(state.groups)) {
    if (g.objectNames.includes(name)) return gid;
  }
  return null;
}

export function getObjColor(obj, materials) {
  const type = obj.parameters?.type;
  if (type === 'source') return '#00d4aa';
  if (type === 'receptor') return '#4f9eff';
  const matName = obj.parameters?.material;
  if (matName && materials[matName]) return materials[matName].color;
  return '#ff7b4f';
}

// =============================================
// RAY DETAIL — per-surface intersection breakdown
// =============================================
function _rayIntersectCircle(x1,y1,x2,y2,cx,cy,r) {
  const dx=x2-x1,dy=y2-y1,fx=x1-cx,fy=y1-cy;
  const a=dx*dx+dy*dy,b=2*(fx*dx+fy*dy),c=fx*fx+fy*fy-r*r;
  const disc=b*b-4*a*c; if(disc<0) return [];
  const sq=Math.sqrt(disc);
  const t1=(-b-sq)/(2*a), t2=(-b+sq)/(2*a);
  const res=[];
  if(t1>=-1e-9&&t1<=1+1e-9) res.push(Math.max(0,t1));
  if(t2>=-1e-9&&t2<=1+1e-9&&Math.abs(t2-t1)>1e-9) res.push(Math.max(0,t2));
  return res;
}
function _rayIntersectSegment(rx1,ry1,rx2,ry2,sx1,sy1,sx2,sy2) {
  const rdx=rx2-rx1,rdy=ry2-ry1,sdx=sx2-sx1,sdy=sy2-sy1;
  const denom=rdx*sdy-rdy*sdx; if(Math.abs(denom)<1e-12) return null;
  const t=((sx1-rx1)*sdy-(sy1-ry1)*sdx)/denom;
  const u=((sx1-rx1)*rdy-(sy1-ry1)*rdx)/denom;
  if(t>=-1e-9&&t<=1+1e-9&&u>=-1e-9&&u<=1+1e-9) return Math.max(0,Math.min(1,t));
  return null;
}

export function computeRayDetail(ray) {
  const { x1,y1,x2,y2 } = ray;
  const pbDensity = state.materials.lead?.density || 11.34;
  const totalLen = Math.hypot(x2-x1, y2-y1);
  const segments = [];

  for (const [name, obj] of Object.entries(state.objects)) {
    if (obj.parameters?.type !== 'surface') continue;
    if (obj.parameters?.enabled === 'False' || obj.parameters?.enabled === false) continue;
    const matName = obj.parameters?.material;
    const mat = state.materials[matName];
    if (!mat) continue;
    const ratio = mat.density / pbDensity;
    const geo = obj.parameters?.geometry;

    if (geo === 'circle') {
      const cx=obj.points[0][0], cy=obj.points[0][1], r=Math.abs(obj.points[1]);
      const ts = _rayIntersectCircle(x1,y1,x2,y2,cx,cy,r);
      if (ts.length === 2) {
        const p1 = { x: x1+ts[0]*(x2-x1), y: y1+ts[0]*(y2-y1) };
        const p2 = { x: x1+ts[1]*(x2-x1), y: y1+ts[1]*(y2-y1) };
        const len = Math.hypot(p2.x-p1.x, p2.y-p1.y);
        segments.push({ name, matName, density: mat.density, ratio, length: len, pbEquiv: len*ratio, p1, p2 });
      }
    } else {
      const pts = obj.points;
      if (!pts || pts.length < 3) continue;
      const tVals = [];
      for (let i=0; i<pts.length; i++) {
        const j=(i+1)%pts.length;
        const t = _rayIntersectSegment(x1,y1,x2,y2, pts[i][0],pts[i][1], pts[j][0],pts[j][1]);
        if (t !== null) tVals.push(t);
      }
      tVals.sort((a,b)=>a-b);
      const unique = tVals.filter((v,i,arr)=>i===0||Math.abs(v-arr[i-1])>1e-7);
      for (let i=0; i+1<unique.length; i+=2) {
        const p1 = { x: x1+unique[i]*(x2-x1),   y: y1+unique[i]*(y2-y1) };
        const p2 = { x: x1+unique[i+1]*(x2-x1), y: y1+unique[i+1]*(y2-y1) };
        const len = Math.hypot(p2.x-p1.x, p2.y-p1.y);
        segments.push({ name, matName, density: mat.density, ratio, length: len, pbEquiv: len*ratio, p1, p2 });
      }
    }
  }
  segments.sort((a,b) => Math.hypot(a.p1.x-x1,a.p1.y-y1) - Math.hypot(b.p1.x-x1,b.p1.y-y1));
  return { ray, totalLen, totalPbEquiv: segments.reduce((s,g)=>s+g.pbEquiv,0), segments };
}

// =============================================
// COLORMAP  (green → yellow → red)
// =============================================
export function thicknessColor(t, maxT) {
  if (maxT <= 0) return 'rgba(79,158,255,0.5)';
  const frac = Math.min(1, t / maxT);
  // green(0,212,170) -> yellow(255,204,79) -> red(255,80,60)
  let r, g, b;
  if (frac < 0.5) {
    const f = frac * 2;
    r = Math.round(0 + f * 255);
    g = Math.round(212 + f * (204 - 212));
    b = Math.round(170 + f * (79 - 170));
  } else {
    const f = (frac - 0.5) * 2;
    r = 255;
    g = Math.round(204 + f * (80 - 204));
    b = Math.round(79 + f * (60 - 79));
  }
  return `rgba(${r},${g},${b},0.55)`;
}
