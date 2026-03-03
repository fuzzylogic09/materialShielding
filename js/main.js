import { state, screenToWorld, worldToScreen, distToSegment, pointInPolygon, getObjColor } from './state.js';
import { importFromJSON } from './loader.js';
import { canvas, draw, drawRays, resizeCanvas, fitView } from './renderer.js';
import { startSimulation, stopSimulation } from './simulation.js';
import {
  refreshUI, renderObjectsList, renderMaterials, selectObject, updatePropsPanel,
  switchTab, switchSubTab, updateResultsPanel, addNewObject, toggleLockObj,
  openGroupModal, closeModal, renderGroupsModal, addGroup, deleteGroup,
  updateGroupMembers, updateGroupUncertainty, renderInlineGroups,
  updateObjParam, updateObjUncertainty, updatePoint, updateCircle, addPoint, removePoint,
  renameObject, addMaterial, deleteMaterial, onMatDensityChange, pasteCreoPoints
} from './ui.js';

// =============================================
// EXPOSE GLOBALS (for inline HTML handlers)
// =============================================
window._ui = {
  switchTab, switchSubTab, selectObject, addNewObject, toggleLockObj,
  openGroupModal, closeModal, renderGroupsModal, addGroup, deleteGroup,
  updateGroupMembers, updateGroupUncertainty, renderInlineGroups,
  updateObjParam, updateObjUncertainty, updatePoint, updateCircle, addPoint, removePoint,
  renameObject, addMaterial, deleteMaterial, onMatDensityChange, pasteCreoPoints
};
// also expose for material color inline handlers
window.state = state;
window.draw = draw;

// =============================================
// LOAD DEFAULT MATERIALS
// =============================================
async function loadDefaultMaterials() {
  try {
    const res = await fetch('./data/materials.json');
    if (!res.ok) throw new Error('fetch failed');
    const mats = await res.json();
    for (const [k, v] of Object.entries(mats)) {
      if (!state.materials[k]) state.materials[k] = v;
    }
  } catch {
    // fallback defaults already in state
    Object.assign(state.materials, {
      lead: { density: 11.34, color: '#7b8fa0' },
      tungsten: { density: 17.0, color: '#c0a060' },
      concrete: { density: 2.35, color: '#a09080' },
      steel: { density: 7.85, color: '#7090a0' },
      dummy: { density: 8.0, color: '#80b080' }
    });
  }
  renderMaterials();
}

// =============================================
// FILE LOADING
// =============================================
window.loadFile = () => document.getElementById('file-input').click();

window.onFileLoad = (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    // Reset simulation state before loading new file
    stopSimulation();
    state.lockedAll = true;
    document.getElementById('lock-all-btn').textContent = '🔒 Unlock All';
    state.simulation.rays = [];
    state.simulation.raysComputed = 0;
    setRunBtn(false);
    const progressFill = document.getElementById('progress-fill');
    if (progressFill) progressFill.style.width = '0%';
    document.getElementById('p-rays-done').textContent = '0 rays';
    document.getElementById('p-pct').textContent = '0%';
    document.getElementById('results-stats').innerHTML = '';

    const { loaded, issues } = importFromJSON(e.target.result);
    showIssues(issues);
    if (loaded) {
      refreshUI();
      renderInlineGroups();
      fitView();
      draw();
    }
  };
  reader.readAsText(file);
  event.target.value = '';
};

// =============================================
// ERROR PANEL
// =============================================
function showIssues(issues) {
  const panel = document.getElementById('error-panel');
  const body = document.getElementById('error-body');
  const count = document.getElementById('error-count');

  const errors = issues.filter(i => i.type === 'error');
  const warnings = issues.filter(i => i.type === 'warning');
  const infos = issues.filter(i => i.type === 'info');

  // Don't show if only one "summary" info
  const substantive = errors.length + warnings.length + infos.filter(i => i.context !== 'Summary').length;
  if (substantive === 0 && infos.length <= 1) return;

  count.textContent = `${errors.length} error${errors.length!==1?'s':''}, ${warnings.length} warning${warnings.length!==1?'s':''}`;

  body.innerHTML = [...errors, ...warnings, ...infos].map(issue => `
    <div class="error-item">
      <div class="error-item-type ${issue.type}">${issue.type.toUpperCase()} — ${issue.context}</div>
      <div class="error-msg">${issue.message}</div>
      ${issue.fix ? `<div class="error-fix">💡 ${issue.fix}</div>` : ''}
    </div>
  `).join('');

  panel.classList.add('open');
}

window.closeErrorPanel = () => document.getElementById('error-panel').classList.remove('open');

// =============================================
// EXPORT JSON
// =============================================
window.exportJSON = () => {
  const exportData = {
    scene: {
      parameters: {
        rayNumber: parseInt(document.getElementById('p-rayNumber').value) || 1000,
        batchSize: parseInt(document.getElementById('p-batchSize').value) || 50,
        minThicknessToShow: parseFloat(document.getElementById('p-minThickness').value) || 0,
        plotRayCount: parseInt(document.getElementById('p-plotRayCount').value) || 100,
        title: document.getElementById('sim-title').value
      },
      materials: state.materials,
      groups: state.groups,
      objects: {}
    }
  };
  for (const [name, obj] of Object.entries(state.objects)) {
    exportData.scene.objects[name] = {
      parameters: { ...obj.parameters },
      points: JSON.parse(JSON.stringify(obj.points)),
      locked: obj.locked || false
    };
  }
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (document.getElementById('sim-title').value || 'simulation').replace(/\s+/g, '_') + '.json';
  a.click();
  URL.revokeObjectURL(url);
};

// =============================================
// SIMULATION CONTROLS
// =============================================
window.toggleSimulation = () => {
  if (state.simulation.running) {
    stopSimulation();
    setRunBtn(false);
  } else {
    clearResults();
    const ok = startSimulation((done) => {
      updateResultsPanel();
      draw(); // re-draw rays
      if (done) setRunBtn(false);
    });
    if (ok) setRunBtn(true);
    else {
      showIssues([{
        type: 'error', context: 'Simulation',
        message: 'Cannot start: need at least one enabled source and one enabled receptor.',
        fix: 'Add a source and receptor object to your scene.'
      }]);
    }
  }
};

function setRunBtn(running) {
  const btn = document.getElementById('run-btn');
  if (running) {
    btn.textContent = '⏹ Stop';
    btn.classList.remove('primary'); btn.classList.add('danger');
  } else {
    btn.textContent = '▶ Run';
    btn.classList.remove('danger'); btn.classList.add('primary');
    state.simulation.running = false;
  }
}

window.clearResults = () => {
  stopSimulation();
  setRunBtn(false);
  state.simulation.rays = [];
  state.simulation.raysComputed = 0;
  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('p-rays-done').textContent = '0 rays';
  document.getElementById('p-pct').textContent = '0%';
  document.getElementById('results-stats').innerHTML = '';
  draw();
};

// =============================================
// LOCK ALL
// =============================================
window.toggleLockAll = () => {
  state.lockedAll = !state.lockedAll;
  document.getElementById('lock-all-btn').textContent = state.lockedAll ? '🔒 Unlock All' : '🔓 Lock All';
};

// =============================================
// CANVAS MOUSE EVENTS
// =============================================
canvas.addEventListener('mousedown', onMouseDown);
canvas.addEventListener('mousemove', onMouseMove);
canvas.addEventListener('mouseup', onMouseUp);
canvas.addEventListener('wheel', onWheel, { passive: false });
canvas.addEventListener('contextmenu', e => e.preventDefault());

function getObjectAtScreen(sx, sy) {
  const wp = screenToWorld(canvas, sx, sy);
  const tol = 8 / state.view.zoom;
  for (const [name, obj] of Object.entries(state.objects)) {
    if (obj.parameters?.enabled === 'False' || obj.parameters?.enabled === false) continue;
    const geo = obj.parameters?.geometry;
    if (geo === 'circle') {
      const c = obj.points[0], r = obj.points[1];
      const dist = Math.hypot(wp.x - c[0], wp.y - c[1]);
      if (Math.abs(dist - r) < tol || dist < r) return name;
    } else {
      const pts = obj.points || [];
      for (let i = 0; i < pts.length - (pts.length > 2 ? 0 : 1); i++) {
        const j = (i + 1) % pts.length;
        if (pts.length === 2 && j === 0) break;
        if (distToSegment(wp, {x:pts[i][0],y:pts[i][1]}, {x:pts[j][0],y:pts[j][1]}) < tol) return name;
      }
      if (pts.length > 2 && pointInPolygon(wp, pts)) return name;
    }
  }
  return null;
}

function onMouseDown(e) {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  if (e.button === 0) {
    const hit = getObjectAtScreen(sx, sy);
    if (hit) {
      selectObject(hit);
      const obj = state.objects[hit];
      if (!obj.locked && !state.lockedAll) {
        state.view.isMovingObj = true;
        state.view.dragStart = { x: sx, y: sy };
        state.view.dragObjStart = JSON.parse(JSON.stringify(obj.points));
        state.view.dragObjName = hit;
        canvas.classList.add('move-tool');
      }
    } else {
      state.view.isDragging = true;
      state.view.dragStart = { x: sx, y: sy };
      state.view.panStart = { x: state.view.panX, y: state.view.panY };
      canvas.classList.add('grabbing');
      selectObject(null);
    }
  }
}

function onMouseMove(e) {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const wp = screenToWorld(canvas, sx, sy);
  document.getElementById('s-x').textContent = wp.x.toFixed(1);
  document.getElementById('s-y').textContent = wp.y.toFixed(1);

  if (state.view.isMovingObj && state.view.dragStart) {
    const dx = (sx - state.view.dragStart.x) / state.view.zoom;
    const dy = -(sy - state.view.dragStart.y) / state.view.zoom;
    const name = state.view.dragObjName;
    const obj = state.objects[name];
    const origPts = state.view.dragObjStart;
    const geo = obj.parameters?.geometry;

    if (geo === 'circle') {
      obj.points = [[origPts[0][0] + dx, origPts[0][1] + dy], origPts[1]];
    } else {
      obj.points = origPts.map(p => [p[0] + dx, p[1] + dy]);
    }

    // Move group members
    const gid = state.view.dragGroupId;
    if (!state.view.dragGroupStarts) {
      state.view.dragGroupId = null;
      // Get group of this object
      for (const [gId, g] of Object.entries(state.groups)) {
        if (g.objectNames.includes(name)) {
          state.view.dragGroupId = gId;
          state.view.dragGroupStarts = {};
          for (const gn of g.objectNames) {
            if (gn !== name && state.objects[gn]) {
              state.view.dragGroupStarts[gn] = JSON.parse(JSON.stringify(state.objects[gn].points));
            }
          }
          break;
        }
      }
    }
    if (state.view.dragGroupId && state.view.dragGroupStarts) {
      for (const [gn, ogp] of Object.entries(state.view.dragGroupStarts)) {
        const go = state.objects[gn];
        if (!go) continue;
        if (go.parameters?.geometry === 'circle') {
          go.points = [[ogp[0][0] + dx, ogp[0][1] + dy], ogp[1]];
        } else {
          go.points = ogp.map(p => [p[0] + dx, p[1] + dy]);
        }
      }
    }

    updatePropsPanel();
    draw();
    return;
  }

  if (state.view.isDragging && state.view.dragStart) {
    state.view.panX = state.view.panStart.x + (sx - state.view.dragStart.x);
    state.view.panY = state.view.panStart.y + (sy - state.view.dragStart.y);
    draw();
    return;
  }

  const hit = getObjectAtScreen(sx, sy);
  if (hit !== state.view.hoveredObj) {
    state.view.hoveredObj = hit;
    draw();
  }
}

function onMouseUp() {
  state.view.isDragging = false;
  state.view.isMovingObj = false;
  state.view.dragGroupStarts = null;
  state.view.dragGroupId = null;
  canvas.classList.remove('grabbing', 'move-tool');
}

function onWheel(e) {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const old = state.view.zoom;
  state.view.zoom = Math.max(0.01, Math.min(200, state.view.zoom * factor));
  const dx = sx - canvas.width / 2 - state.view.panX;
  const dy = sy - canvas.height / 2 - state.view.panY;
  state.view.panX -= dx * (state.view.zoom / old - 1);
  state.view.panY -= dy * (state.view.zoom / old - 1);
  document.getElementById('s-zoom').textContent = Math.round(state.view.zoom * 100) + '%';
  draw();
}

// =============================================
// PARAM CHANGE → REDRAW (display only)
// =============================================
const minThicknessSlider = document.getElementById('p-minThickness');
const minThicknessLabel = document.getElementById('p-minThickness-label');

function syncSlider() {
  const val = parseFloat(minThicknessSlider.value) || 0;
  minThicknessLabel.textContent = val.toFixed(1) + ' mm Pb';
  draw();
  updateResultsPanel();
}
if (minThicknessSlider) {
  minThicknessSlider.addEventListener('input', syncSlider);
}

const plotRayCountEl = document.getElementById('p-plotRayCount');
if (plotRayCountEl) plotRayCountEl.addEventListener('input', () => { draw(); updateResultsPanel(); });

// Clamp ray count between 1000 and 1000000
const rayNumberEl = document.getElementById('p-rayNumber');
if (rayNumberEl) {
  rayNumberEl.addEventListener('change', () => {
    let v = parseInt(rayNumberEl.value) || 1000;
    v = Math.max(1000, Math.min(1000000, v));
    rayNumberEl.value = v;
  });
}

document.getElementById('sim-title').addEventListener('input', e => {
  state.params.title = e.target.value;
  draw();
});

// =============================================
// INIT
// =============================================
window.addEventListener('resize', resizeCanvas);

async function init() {
  await loadDefaultMaterials();

  // Load example scene
  const { loaded, issues } = importFromJSON({
    scene: {
      parameters: { title: 'Dummy test', rayNumber: 1000, plotRayCount: 100 },
      objects: {
        'Opening 1': { parameters: { type: 'receptor', enabled: 'True', uncertainty: 2 }, points: [[-100.0, 5.0], [-100.0, -5.0]] },
        'Opening 2': { parameters: { type: 'receptor', enabled: 'False', uncertainty: 2 }, points: [[-90.0, 40.0], [-100.0, 30.0]] },
        'Source': { parameters: { type: 'source', uncertainty: 5 }, points: [[100.0, 30.0], [100.0, -30.0]] },
        'circular_block': { parameters: { enabled: 'True', type: 'surface', material: 'dummy', uncertainty: 10.0, geometry: 'circle' }, points: [[0.0, 0.0], 20.0] },
        'rectangular_block': { parameters: { type: 'surface', material: 'dummy', enabled: 'True', uncertainty: 0.0 }, points: [[-50, 20.0], [-50.0, 40.0], [-10.0, 40.0], [-45.0, 20.0]] }
      },
      groups: {}
    }
  });

  refreshUI();
  renderInlineGroups();
  resizeCanvas();
  fitView();
  draw();
}

init();
