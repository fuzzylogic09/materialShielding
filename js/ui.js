import { state, getObjectGroup, getObjColor, screenToWorld } from './state.js';
import { canvas, draw } from './renderer.js';

// =============================================
// TAB SWITCHING
// =============================================
const TAB_NAMES = ['objects', 'props', 'calc', 'mats'];

export function switchTab(tabName) {
  document.querySelectorAll('.panel-tab').forEach((t, i) => {
    t.classList.toggle('active', TAB_NAMES[i] === tabName);
  });
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  const pane = document.getElementById('tab-' + tabName);
  if (pane) pane.classList.add('active');
}

export function switchSubTab(pane, name) {
  const container = document.getElementById(pane);
  container.querySelectorAll('.sub-tab').forEach(t => t.classList.toggle('active', t.dataset.sub === name));
  container.querySelectorAll('.sub-pane').forEach(p => p.style.display = p.dataset.pane === name ? '' : 'none');
}

// =============================================
// OBJECTS LIST
// =============================================
export function refreshUI() {
  renderObjectsList();
  renderMaterials();
  document.getElementById('s-objcount').textContent = Object.keys(state.objects).length;
}

export function renderObjectsList() {
  const list = document.getElementById('objects-list');
  if (Object.keys(state.objects).length === 0) {
    list.innerHTML = '<div class="empty-state">No objects. Load a JSON file<br>or add objects manually.</div>';
    return;
  }
  list.innerHTML = '';
  for (const [name, obj] of Object.entries(state.objects)) {
    const type = obj.parameters?.type || 'surface';
    const color = getObjColor(obj, state.materials);
    const enabled = obj.parameters?.enabled !== 'False' && obj.parameters?.enabled !== false;
    const locked = obj.locked;
    const groupId = getObjectGroup(name);

    const div = document.createElement('div');
    div.className = `obj-item ${name === state.selectedObj ? 'selected' : ''} ${!enabled ? 'disabled' : ''}`;
    div.onclick = () => { selectObject(name); switchTab('props'); };
    div.innerHTML = `
      <div class="obj-dot" style="background:${color}"></div>
      <span class="obj-name" title="${name}">${name}</span>
      ${groupId ? `<span class="group-tag">${state.groups[groupId].name}</span>` : ''}
      <span class="badge ${type}">${type.substring(0,3)}</span>
      <span class="obj-lock" title="${locked ? 'Unlock' : 'Lock'}" onclick="event.stopPropagation();window._ui.toggleLockObj('${name}')">
        ${locked ? '🔒' : '🔓'}
      </span>
    `;
    list.appendChild(div);
  }
}

export function selectObject(name) {
  state.selectedObj = name;
  renderObjectsList();
  updatePropsPanel();
  const stat = document.getElementById('s-selected-stat');
  const sel = document.getElementById('s-selected');
  if (name) { stat.style.display = ''; sel.textContent = name; }
  else { stat.style.display = 'none'; }
  draw();
}

// =============================================
// PROPERTIES PANEL
// =============================================
export function updatePropsPanel() {
  const name = state.selectedObj;
  const container = document.getElementById('prop-content');
  if (!name || !state.objects[name]) {
    container.innerHTML = '<div class="empty-state">Select an object to view<br>its properties.</div>';
    return;
  }

  const obj = state.objects[name];
  const type = obj.parameters?.type || 'surface';
  const geo = obj.parameters?.geometry || 'polyline';
  const matName = obj.parameters?.material || '';
  const enabled = obj.parameters?.enabled !== 'False' && obj.parameters?.enabled !== false;
  const uncertainty = obj.parameters?.uncertainty || 0;
  const groupId = getObjectGroup(name);

  // Area/length
  let area = '—';
  if (geo === 'circle') {
    area = (Math.PI * obj.points[1] * obj.points[1]).toFixed(1) + ' mm²';
  } else if (obj.points) {
    if (obj.points.length > 2) {
      let a = 0;
      const pts = obj.points;
      for (let i = 0; i < pts.length; i++) {
        const j = (i+1) % pts.length;
        a += pts[i][0]*pts[j][1] - pts[j][0]*pts[i][1];
      }
      area = Math.abs(a/2).toFixed(1) + ' mm²';
    } else if (obj.points.length === 2) {
      const p1 = obj.points[0], p2 = obj.points[1];
      area = Math.hypot(p2[0]-p1[0], p2[1]-p1[1]).toFixed(1) + ' mm (length)';
    }
  }

  const matOptions = Object.keys(state.materials).map(m =>
    `<option value="${m}" ${m === matName ? 'selected' : ''}>${m} (ρ=${state.materials[m].density})</option>`
  ).join('');

  let pointsHTML = '';
  if (geo === 'circle') {
    pointsHTML = `<tr><th>#</th><th>X (mm)</th><th>Y (mm)</th><th>R (mm)</th></tr>
    <tr>
      <td style="color:var(--text3);padding:4px 6px">ctr</td>
      <td><input value="${obj.points[0][0]}" onchange="window._ui.updateCircle('${name}',0,'x',this.value)"></td>
      <td><input value="${obj.points[0][1]}" onchange="window._ui.updateCircle('${name}',0,'y',this.value)"></td>
      <td><input value="${obj.points[1]}" onchange="window._ui.updateCircle('${name}',1,'r',this.value)"></td>
    </tr>`;
  } else {
    pointsHTML = `<tr><th>#</th><th>X (mm)</th><th>Y (mm)</th><th></th></tr>`;
    (obj.points || []).forEach((p, i) => {
      pointsHTML += `<tr>
        <td style="color:var(--text3);padding:4px 6px">${i+1}</td>
        <td><input value="${p[0].toFixed(3)}" onchange="window._ui.updatePoint('${name}',${i},0,this.value)"></td>
        <td><input value="${p[1].toFixed(3)}" onchange="window._ui.updatePoint('${name}',${i},1,this.value)"></td>
        <td><span style="cursor:pointer;color:var(--text3);font-size:11px;padding:2px" onclick="window._ui.removePoint('${name}',${i})">✕</span></td>
      </tr>`;
    });
  }

  container.innerHTML = `
    <div class="prop-section">
      <div class="prop-label">Identity</div>
      <div class="prop-row"><span class="prop-key">Name</span>
        <input class="prop-val" value="${name}" onchange="window._ui.renameObject('${name}',this.value)"></div>
      <div class="prop-row"><span class="prop-key">Type</span><span class="badge ${type}" style="flex:1">${type}</span></div>
      <div class="prop-row"><span class="prop-key">Geometry</span><span style="color:var(--text2);font-size:12px;flex:1">${geo}</span></div>
      <div class="prop-row"><span class="prop-key">Area/Len</span><span style="color:var(--accent3);font-family:var(--font-mono);font-size:11px;flex:1">${area}</span></div>
      <div class="prop-row"><span class="prop-key">Group</span>
        <span style="color:${groupId ? 'var(--warn)' : 'var(--text3)'};font-size:12px;flex:1">${groupId ? state.groups[groupId].name : '—'}</span>
      </div>
    </div>

    ${type === 'surface' ? `
    <div class="prop-section">
      <div class="prop-label">Material</div>
      <div class="prop-row"><span class="prop-key">Material</span>
        <select class="prop-val" onchange="window._ui.updateObjParam('${name}','material',this.value)">${matOptions}</select>
      </div>
      ${state.materials[matName] ? `
      <div class="prop-row"><span class="prop-key">Density</span>
        <span style="color:var(--accent3);font-family:var(--font-mono);font-size:11px">${state.materials[matName].density} g/cm³</span>
      </div>
      <div class="prop-row"><span class="prop-key">Pb ratio</span>
        <span style="color:var(--accent3);font-family:var(--font-mono);font-size:11px">${(state.materials[matName].density/11.34).toFixed(3)}</span>
      </div>` : ''}
    </div>` : ''}

    <div class="prop-section">
      <div class="prop-label">Settings</div>
      <div class="prop-row"><span class="prop-key">Enabled</span>
        <label class="toggle-switch">
          <input type="checkbox" ${enabled ? 'checked' : ''} onchange="window._ui.updateObjParam('${name}','enabled',this.checked?'True':'False')">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="prop-row"><span class="prop-key">Locked</span>
        <label class="toggle-switch">
          <input type="checkbox" ${obj.locked ? 'checked' : ''} onchange="window._ui.toggleLockObj('${name}')">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="prop-row"><span class="prop-key">Uncertainty</span>
        <input type="number" class="prop-val" value="${uncertainty}" step="0.1" min="0"
          onchange="window._ui.updateObjUncertainty('${name}',this.value)">
        <span style="color:var(--text3);font-size:11px;width:36px">± mm</span>
      </div>
    </div>

    <div class="prop-section">
      <div class="prop-label">Points / Geometry</div>
      <table class="points-table">${pointsHTML}</table>
      ${geo !== 'circle' ? `<button class="small-btn" style="margin-top:6px" onclick="window._ui.addPoint('${name}')">+ Add Point</button>` : ''}
    </div>
  `;
}

export function updateObjParam(name, key, value) {
  if (!state.objects[name]) return;
  state.objects[name].parameters[key] = value;
  draw();
  renderObjectsList();
  updatePropsPanel();
}

export function updateObjUncertainty(name, value) {
  if (!state.objects[name]) return;
  state.objects[name].parameters.uncertainty = parseFloat(value) || 0;
}

export function updatePoint(name, i, axis, value) {
  if (!state.objects[name]) return;
  state.objects[name].points[i][axis] = parseFloat(value) || 0;
  draw();
}

export function updateCircle(name, idx, axis, value) {
  if (!state.objects[name]) return;
  const v = parseFloat(value) || 0;
  if (idx === 1) state.objects[name].points[1] = v;
  else if (axis === 'x') state.objects[name].points[0][0] = v;
  else state.objects[name].points[0][1] = v;
  draw();
}

export function addPoint(name) {
  if (!state.objects[name]) return;
  const pts = state.objects[name].points;
  const last = pts[pts.length - 1] || [0, 0];
  pts.push([last[0] + 10, last[1]]);
  updatePropsPanel();
  draw();
}

export function removePoint(name, i) {
  if (!state.objects[name]) return;
  if (state.objects[name].points.length <= 2) return;
  state.objects[name].points.splice(i, 1);
  updatePropsPanel();
  draw();
}

export function renameObject(oldName, newName) {
  newName = newName.trim();
  if (!newName || newName === oldName || state.objects[newName]) return;
  state.objects[newName] = state.objects[oldName];
  delete state.objects[oldName];
  state.selectedObj = newName;
  for (const g of Object.values(state.groups)) {
    const idx = g.objectNames.indexOf(oldName);
    if (idx >= 0) g.objectNames[idx] = newName;
  }
  refreshUI();
  updatePropsPanel();
  draw();
}

export function toggleLockObj(name) {
  if (!state.objects[name]) return;
  state.objects[name].locked = !state.objects[name].locked;
  renderObjectsList();
  updatePropsPanel();
}

// =============================================
// MATERIALS
// =============================================
export function renderMaterials() {
  const container = document.getElementById('materials-list');
  container.innerHTML = '';
  for (const [name, mat] of Object.entries(state.materials)) {
    const div = document.createElement('div');
    div.className = 'mat-item';
    div.innerHTML = `
      <div class="mat-header">
        <input type="color" class="mat-color-dot" value="${mat.color}" title="Color"
          oninput="state.materials['${name}'].color=this.value;draw()">
        <span class="mat-name">${name}</span>
        <span class="mat-delete" onclick="window._ui.deleteMaterial('${name}')">✕</span>
      </div>
      <div class="prop-row">
        <span class="prop-key">Density</span>
        <input type="number" class="prop-val" value="${mat.density}" step="0.01"
          onchange="state.materials['${name}'].density=parseFloat(this.value)||1;window._ui.renderMaterials()">
        <span style="color:var(--text3);font-size:11px;width:50px">g/cm³</span>
      </div>
      <div style="font-family:var(--font-mono);font-size:10px;color:var(--text3);margin-top:4px">
        Pb equiv ratio: <span style="color:var(--accent)">${(mat.density/11.34).toFixed(3)}</span>
      </div>
    `;
    container.appendChild(div);
  }
}

export function addMaterial() {
  const name = prompt('Material name:');
  if (!name || state.materials[name]) return;
  state.materials[name] = {
    density: 1.0,
    color: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')
  };
  renderMaterials();
}

export function deleteMaterial(name) {
  if (name === 'lead') { alert('Cannot delete "lead" — it is the reference material.'); return; }
  if (confirm(`Delete material "${name}"?`)) {
    delete state.materials[name];
    renderMaterials();
  }
}

// =============================================
// ADD NEW OBJECTS
// =============================================
export function addNewObject(type) {
  const baseName = type + '_' + Date.now().toString(36);
  const cx = screenToWorld(canvas, canvas.width / 2, canvas.height / 2);
  let obj;
  if (type === 'source') {
    obj = { parameters: { type: 'source', enabled: 'True', uncertainty: 0 }, points: [[cx.x-20, cx.y],[cx.x+20, cx.y]], locked: false };
  } else if (type === 'receptor') {
    obj = { parameters: { type: 'receptor', enabled: 'True', uncertainty: 0 }, points: [[cx.x-20, cx.y],[cx.x+20, cx.y]], locked: false };
  } else {
    const firstMat = Object.keys(state.materials)[0] || 'dummy';
    obj = {
      parameters: { type: 'surface', material: firstMat, enabled: 'True', uncertainty: 0 },
      points: [[cx.x-20,cx.y-15],[cx.x+20,cx.y-15],[cx.x+20,cx.y+15],[cx.x-20,cx.y+15]],
      locked: false
    };
  }
  state.objects[baseName] = obj;
  refreshUI();
  selectObject(baseName);
  switchTab('props');
  draw();
}

// =============================================
// GROUPS MODAL
// =============================================
export function openGroupModal() {
  renderGroupsModal();
  document.getElementById('modal-overlay').classList.add('open');
}

export function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

export function renderGroupsModal() {
  const container = document.getElementById('groups-content');
  container.innerHTML = '';
  if (Object.keys(state.groups).length === 0) {
    container.innerHTML = '<div class="empty-state">No groups defined yet.</div>';
    return;
  }
  for (const [gid, g] of Object.entries(state.groups)) {
    const objOptions = Object.keys(state.objects).map(n =>
      `<option value="${n}" ${g.objectNames.includes(n) ? 'selected' : ''}>${n}</option>`
    ).join('');
    const div = document.createElement('div');
    div.innerHTML = `
      <div class="linked-group-row">
        <span style="flex:1;font-weight:500">${g.name}</span>
        <span style="cursor:pointer;color:var(--text3)" onclick="window._ui.deleteGroup('${gid}')">✕</span>
      </div>
      <div style="padding:8px 10px 10px;background:var(--bg3);border:1px solid var(--border);border-top:none;border-radius:0 0 6px 6px;margin-bottom:10px">
        <div style="font-size:11px;color:var(--text3);margin-bottom:4px">Objects (hold Ctrl/Cmd to select multiple):</div>
        <select multiple style="width:100%;background:var(--bg4);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:4px;font-size:11px;height:80px"
          onchange="window._ui.updateGroupMembers('${gid}',this)">${objOptions}</select>
      </div>
    `;
    container.appendChild(div);
  }
}

export function addGroup() {
  const name = prompt('Group name:');
  if (!name) return;
  const gid = 'g_' + Date.now().toString(36);
  state.groups[gid] = { name, objectNames: [] };
  renderGroupsModal();
}

export function deleteGroup(gid) {
  delete state.groups[gid];
  renderGroupsModal();
  refreshUI();
}

export function updateGroupMembers(gid, select) {
  state.groups[gid].objectNames = Array.from(select.selectedOptions).map(o => o.value);
  refreshUI();
}

// =============================================
// RESULTS PANEL
// =============================================
let distCanvas = null;

export function updateResultsPanel() {
  const rays = state.simulation.rays;
  if (!rays.length) return;

  const n = rays.length;
  const total = parseInt(document.getElementById('p-rayNumber').value) || 1000;
  const minT = parseFloat(document.getElementById('p-minThickness').value) || 0;

  // Stats
  const allThick = rays.map(r => r.thickness);
  allThick.sort((a, b) => a - b);
  const mean = allThick.reduce((a, b) => a + b, 0) / n;
  const minVal = allThick[0];
  const belowThresh = allThick.filter(v => v <= minT).length;
  const pctBelow = n > 0 ? (belowThresh / n * 100) : 0;

  // Update progress
  const pct = Math.round(state.simulation.raysComputed / total * 100);
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('p-rays-done').textContent = state.simulation.raysComputed + ' rays';
  document.getElementById('p-pct').textContent = pct + '%';

  // Stats HTML
  document.getElementById('results-stats').innerHTML = `
    <div class="result-stat">
      <div class="result-stat-label">Minimum Pb equiv</div>
      <div><span class="result-stat-val">${minVal.toFixed(2)}</span><span class="result-stat-unit">mm Pb</span></div>
    </div>
    <div class="result-stat">
      <div class="result-stat-label">Mean Pb equiv</div>
      <div><span class="result-stat-val" style="font-size:14px">${mean.toFixed(2)}</span><span class="result-stat-unit">mm Pb</span></div>
    </div>
    <div class="result-stat">
      <div class="result-stat-label">Below threshold (≤${minT} mm)</div>
      <div><span class="result-stat-val" style="color:var(--warn);font-size:14px">${belowThresh}</span><span class="result-stat-unit">rays (${pctBelow.toFixed(1)}%)</span></div>
    </div>
    <div id="dist-canvas-wrapper" class="result-stat" style="padding:8px">
      <div class="result-stat-label" style="margin-bottom:6px">Distribution (0 → ${minT > 0 ? minT.toFixed(1) : '?'} mm Pb)</div>
      <canvas id="dist-canvas" height="80"></canvas>
    </div>
  `;

  // Draw distribution
  requestAnimationFrame(() => drawDistribution(allThick, minT));
}

function drawDistribution(sorted, maxVal) {
  const c = document.getElementById('dist-canvas');
  if (!c) return;
  const parent = c.parentElement;
  c.width = parent.clientWidth - 16;
  const w = c.width, h = c.height;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  if (maxVal <= 0) {
    ctx.font = '10px JetBrains Mono';
    ctx.fillStyle = 'rgba(90,99,128,0.6)';
    ctx.textAlign = 'center';
    ctx.fillText('Set "Min Pb equiv" to show distribution', w/2, h/2);
    return;
  }

  const bins = 30;
  const counts = new Array(bins).fill(0);
  const step = maxVal / bins;

  for (const v of sorted) {
    if (v > maxVal) continue;
    const bi = Math.min(bins - 1, Math.floor(v / step));
    counts[bi]++;
  }

  const maxCount = Math.max(...counts, 1);
  const barW = w / bins;
  const padB = 18;

  // Bars
  for (let i = 0; i < bins; i++) {
    const frac = i / (bins - 1);
    const barH = ((counts[i] / maxCount) * (h - padB - 4));
    if (barH < 0.5) continue;

    // Color gradient matching the colorbar
    const r_frac = frac;
    let r, g, b;
    if (r_frac < 0.5) {
      const f = r_frac * 2;
      r = Math.round(f * 255); g = Math.round(212 + f*(204-212)); b = Math.round(170 + f*(79-170));
    } else {
      const f = (r_frac - 0.5) * 2;
      r = 255; g = Math.round(204 + f*(80-204)); b = Math.round(79 + f*(60-79));
    }
    ctx.fillStyle = `rgba(${r},${g},${b},0.7)`;
    ctx.fillRect(i * barW, h - padB - barH, barW - 1, barH);
  }

  // Axis labels
  ctx.font = '8px JetBrains Mono, monospace';
  ctx.fillStyle = 'rgba(90,99,128,0.8)';
  ctx.textAlign = 'left';  ctx.fillText('0', 0, h - 2);
  ctx.textAlign = 'center'; ctx.fillText((maxVal/2).toFixed(1), w/2, h - 2);
  ctx.textAlign = 'right'; ctx.fillText(maxVal.toFixed(1), w, h - 2);
}

export { distCanvas };
