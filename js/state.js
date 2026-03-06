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
  selectedRay: null,   // { ray, intersections } — set when user clicks a ray
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
