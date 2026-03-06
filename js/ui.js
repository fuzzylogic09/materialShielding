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
  renderInlineGroups();
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
  if (name) { stat.style.display = ''; document.getElementById('s-selected').textContent = name; }
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
  const ownUnc = obj.parameters?.uncertainty || 0;
  const groupId = getObjectGroup(name);
  const groupUnc = groupId ? (state.groups[groupId].uncertainty || 0) : 0;
  const totalUnc = ownUnc + groupUnc;

  // Area/length
  let area = '—';
  if (geo === 'circle') {
    area = (Math.PI * obj.points[1] * obj.points[1]).toFixed(1) + ' mm²';
  } else if (obj.points) {
    if (obj.points.length > 2) {
      let a = 0; const pts = obj.points;
      for (let i = 0; i < pts.length; i++) {
        const j = (i+1)%pts.length;
        a += pts[i][0]*pts[j][1] - pts[j][0]*pts[i][1];
      }
      area = Math.abs(a/2).toFixed(1) + ' mm²';
    } else if (obj.points.length === 2) {
      const p1=obj.points[0],p2=obj.points[1];
      area = Math.hypot(p2[0]-p1[0],p2[1]-p1[1]).toFixed(1) + ' mm (length)';
    }
  }

  const matOptions = Object.keys(state.materials).map(m =>
    `<option value="${m}" ${m===matName?'selected':''}>${m} (ρ=${state.materials[m].density})</option>`
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
    (obj.points||[]).forEach((p,i) => {
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
        <span style="color:${groupId?'var(--warn)':'var(--text3)'};font-size:12px;flex:1">${groupId ? state.groups[groupId].name : '—'}</span>
      </div>
      <div class="prop-row" style="margin-top:6px">
        <button class="small-btn" style="color:var(--warn);border-color:var(--warn);background:rgba(255,123,79,0.08)" onclick="window._ui.deleteObject('${name}')">🗑 Delete Object</button>
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
        <span style="color:var(--accent3);font-family:var(--font-mono);font-size:11px">${(state.materials[matName].density/(state.materials.lead?.density||11.3)).toFixed(3)}</span>
      </div>` : ''}
    </div>` : ''}

    <div class="prop-section">
      <div class="prop-label">Settings</div>
      <div class="prop-row"><span class="prop-key">Enabled</span>
        <label class="toggle-switch">
          <input type="checkbox" ${enabled?'checked':''} onchange="window._ui.updateObjParam('${name}','enabled',this.checked?'True':'False')">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="prop-row"><span class="prop-key">Locked</span>
        <label class="toggle-switch">
          <input type="checkbox" ${obj.locked?'checked':''} onchange="window._ui.toggleLockObj('${name}')">
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>

    <div class="prop-section">
      <div class="prop-label">Uncertainty</div>
      <div class="prop-row"><span class="prop-key">Own ± </span>
        <input type="number" class="prop-val" value="${ownUnc}" step="0.1" min="0"
          onchange="window._ui.updateObjUncertainty('${name}',this.value)">
        <span style="color:var(--text3);font-size:11px;width:36px">mm</span>
      </div>
      ${groupId ? `
      <div class="prop-row"><span class="prop-key">Group ±</span>
        <span style="color:var(--warn);font-family:var(--font-mono);font-size:11px;flex:1">${groupUnc} mm <span style="color:var(--text3)">(shared)</span></span>
      </div>
      <div class="prop-row"><span class="prop-key">Total ±</span>
        <span style="color:var(--accent3);font-family:var(--font-mono);font-size:11px;flex:1">${totalUnc.toFixed(2)} mm</span>
      </div>` : ''}
      <div style="font-size:11px;color:var(--text3);line-height:1.6;margin-top:4px">
        Object displaces by a random vector within ± Own uncertainty per ray. If in a group, group displacement is applied first (shared with all group members).
      </div>
    </div>

    <div class="prop-section">
      <div class="prop-label">Points / Geometry</div>
      <table class="points-table">${pointsHTML}</table>
      ${geo !== 'circle' ? `
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
        <button class="small-btn" onclick="window._ui.addPoint('${name}')">+ Add Point</button>
        <button class="small-btn accent" title="Paste XYZ coordinates from Creo clipboard (X,Y,Z per line — X and Z are used)" onclick="window._ui.pasteCreoPoints('${name}')">📋 Paste from Creo</button>
      </div>
      <div style="font-size:10px;color:var(--text3);line-height:1.5;margin-top:6px">
        Creo format: one number per line (X, Y, Z repeating). X and Z values are imported as the 2D X and Y coordinates.
      </div>` : ''}
    </div>
  `;
}

export function updateObjParam(name, key, value) {
  if (!state.objects[name]) return;
  state.objects[name].parameters[key] = value;
  draw(); renderObjectsList(); updatePropsPanel();
}

export function updateObjUncertainty(name, value) {
  if (!state.objects[name]) return;
  state.objects[name].parameters.uncertainty = parseFloat(value) || 0;
  draw();
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
  const last = pts[pts.length-1] || [0,0];
  pts.push([last[0]+10, last[1]]);
  updatePropsPanel(); draw();
}

export function removePoint(name, i) {
  if (!state.objects[name]) return;
  if (state.objects[name].points.length <= 2) return;
  state.objects[name].points.splice(i, 1);
  updatePropsPanel(); draw();
}

export async function pasteCreoPoints(name) {
  if (!state.objects[name]) return;
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch (e) {
    alert('Clipboard access denied.\nPlease allow clipboard access in your browser, or paste the text manually into the browser console and call window._ui.parseCreoText(name, text).');
    return;
  }
  const pts = parseCreoXYZ(text);
  if (!pts || pts.length === 0) {
    alert('No valid Creo XYZ coordinates found in clipboard.\nExpected: one number per line, groups of 3 (X, Y, Z). X and Z are used as 2D coordinates.');
    return;
  }
  state.objects[name].points = pts;
  updatePropsPanel();
  draw();
}

// Parse Creo XYZ clipboard text: one number per line, groups of 3.
// Returns array of [X, Z] pairs (ignoring Y = index 1).
function parseCreoXYZ(text) {
  const nums = text.trim().split(/[\r\n]+/)
    .map(l => l.trim())
    .filter(l => l !== '' && !isNaN(parseFloat(l)))
    .map(l => parseFloat(l));
  if (nums.length < 6 || nums.length % 3 !== 0) {
    // Try to recover partial data — drop trailing incomplete group
    const usable = nums.slice(0, Math.floor(nums.length / 3) * 3);
    if (usable.length < 6) return null;
    const pts = [];
    for (let i = 0; i < usable.length; i += 3) pts.push([usable[i], usable[i + 2]]);
    return pts;
  }
  const pts = [];
  for (let i = 0; i < nums.length; i += 3) pts.push([nums[i], nums[i + 2]]);
  return pts;
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
  refreshUI(); updatePropsPanel(); draw();
}

export function toggleLockObj(name) {
  if (!state.objects[name]) return;
  state.objects[name].locked = !state.objects[name].locked;
  renderObjectsList(); updatePropsPanel();
}

export function deleteObject(name) {
  if (!state.objects[name]) return;
  if (!confirm(`Delete "${name}"?`)) return;
  // Remove from any groups
  for (const g of Object.values(state.groups)) {
    const idx = g.objectNames.indexOf(name);
    if (idx >= 0) g.objectNames.splice(idx, 1);
  }
  delete state.objects[name];
  state.selectedObj = null;
  document.getElementById('s-selected-stat').style.display = 'none';
  refreshUI();
  updatePropsPanel();
  draw();
}


// =============================================
// MATERIALS  — live update of Pb ratio
// =============================================
export function renderMaterials() {
  const container = document.getElementById('materials-list');
  container.innerHTML = '';
  for (const [name, mat] of Object.entries(state.materials)) {
    const div = document.createElement('div');
    div.className = 'mat-item';
    div.dataset.matname = name;
    div.innerHTML = `
      <div class="mat-header">
        <input type="color" class="mat-color-dot" value="${mat.color}" title="Color"
          oninput="state.materials['${name}'].color=this.value; draw()">
        <span class="mat-name">${name}</span>
        <span class="mat-delete" onclick="window._ui.deleteMaterial('${name}')">✕</span>
      </div>
      <div class="prop-row" style="flex-wrap:wrap;gap:4px">
        <span class="prop-key">Density</span>
        <input type="number" class="prop-val mat-density-input" value="${mat.density}" step="0.01"
          oninput="window._ui.onMatDensityChange('${name}', this)" style="min-width:60px">
        <span style="color:var(--text3);font-size:11px;white-space:nowrap">g/cm³</span>
      </div>
      <div class="prop-row" style="margin-top:0">
        <span class="prop-key">Pb ratio</span>
        <span class="mat-pb-ratio" style="color:var(--accent);font-family:var(--font-mono);font-size:11px">
          ${(mat.density/(state.materials.lead?.density||11.3)).toFixed(3)}
        </span>
      </div>
    `;
    container.appendChild(div);
  }
}

export function onMatDensityChange(name, input) {
  const val = parseFloat(input.value) || 0;
  state.materials[name].density = val;
  const pbDensity = state.materials.lead?.density || 11.3;

  // If lead density changed, re-render all materials to update every ratio
  if (name === 'lead') {
    renderMaterials();
    updatePropsPanel();
    draw();
    return;
  }

  // Update only the pb ratio span in the same mat-item, live
  const item = input.closest('.mat-item');
  if (item) {
    const ratioEl = item.querySelector('.mat-pb-ratio');
    if (ratioEl) ratioEl.textContent = (val / pbDensity).toFixed(3);  // ← use pbDensity
  }
  draw();
}

export function addMaterial() {
  const name = prompt('Material name:');
  if (!name || state.materials[name]) return;
  state.materials[name] = {
    density: 1.0,
    color: '#' + Math.floor(Math.random()*0xffffff).toString(16).padStart(6,'0')
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
  const cx = screenToWorld(canvas, canvas.width/2, canvas.height/2);
  let obj;
  if (type === 'source') {
    obj = { parameters:{type:'source',enabled:'True',uncertainty:0}, points:[[cx.x-20,cx.y],[cx.x+20,cx.y]], locked:false };
  } else if (type === 'receptor') {
    obj = { parameters:{type:'receptor',enabled:'True',uncertainty:0}, points:[[cx.x-20,cx.y],[cx.x+20,cx.y]], locked:false };
  } else {
    const firstMat = Object.keys(state.materials)[0] || 'dummy';
    obj = {
      parameters:{type:'surface',material:firstMat,enabled:'True',uncertainty:0},
      points:[[cx.x-20,cx.y-15],[cx.x+20,cx.y-15],[cx.x+20,cx.y+15],[cx.x-20,cx.y+15]],
      locked:false
    };
  }
  state.objects[baseName] = obj;
  refreshUI(); selectObject(baseName); switchTab('props'); draw();
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
    // Build object options: exclude objects already in OTHER groups
    const objOptions = Object.keys(state.objects).map(n => {
      const existingGid = getObjectGroup(n);
      const inThisGroup = g.objectNames.includes(n);
      const inOtherGroup = existingGid && existingGid !== gid;
      const label = inOtherGroup ? `${n} (in ${state.groups[existingGid].name})` : n;
      return `<option value="${n}" ${inThisGroup?'selected':''} ${inOtherGroup?'disabled style="opacity:0.4"':''}>${label}</option>`;
    }).join('');

    const div = document.createElement('div');
    div.innerHTML = `
      <div class="linked-group-row">
        <span style="flex:1;font-weight:500">${g.name}</span>
        <span style="cursor:pointer;color:var(--text3);padding:4px" onclick="window._ui.deleteGroup('${gid}')">✕</span>
      </div>
      <div style="padding:10px;background:var(--bg3);border:1px solid var(--border);border-top:none;border-radius:0 0 8px 8px;margin-bottom:12px">
        <div class="prop-row" style="margin-bottom:8px">
          <span class="prop-key">Group ± </span>
          <input type="number" class="prop-val" value="${g.uncertainty||0}" step="0.1" min="0"
            style="max-width:80px"
            oninput="window._ui.updateGroupUncertainty('${gid}',this.value)">
          <span style="color:var(--text3);font-size:11px;white-space:nowrap">mm (shared displacement)</span>
        </div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:6px">Objects (hold Ctrl/Cmd for multiple; greyed = in another group):</div>
        <select multiple style="width:100%;background:var(--bg4);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:4px;font-size:11px;height:90px"
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
  state.groups[gid] = { name, objectNames: [], uncertainty: 0 };
  renderGroupsModal();
  renderInlineGroups();
}

// Inline groups panel (in Objects tab — always visible)
export function renderInlineGroups() {
  const container = document.getElementById('inline-groups-list');
  if (!container) return;
  if (Object.keys(state.groups).length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:10px 8px;font-size:11px">No groups yet.</div>';
    return;
  }
  container.innerHTML = '';
  for (const [gid, g] of Object.entries(state.groups)) {
    const div = document.createElement('div');
    div.className = 'param-group';
    div.style.marginBottom = '8px';
    div.style.padding = '9px 10px';
    // Count members
    const members = g.objectNames.filter(n => state.objects[n]);
    // Build member options for multi-select
    const objOptions = Object.keys(state.objects).map(n => {
      const existingGid = getObjectGroup(n);
      const inThis = g.objectNames.includes(n);
      const inOther = existingGid && existingGid !== gid;
      const label = inOther ? n + ' (other group)' : n;
      return `<option value="${n}" ${inThis?'selected':''} ${inOther?'disabled':''}>${label}</option>`;
    }).join('');

    div.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
        <span style="font-size:12px;font-weight:600;color:var(--warn);flex:1">${g.name}</span>
        <span style="font-size:10px;color:var(--text3)">${members.length} obj</span>
        <span style="cursor:pointer;color:var(--text3);font-size:12px;padding:2px" onclick="window._ui.deleteGroup('${gid}')">✕</span>
      </div>
      <div class="prop-row" style="margin-bottom:6px">
        <span class="prop-key" style="width:70px">Group ±</span>
        <input type="number" class="prop-val" value="${g.uncertainty||0}" step="0.1" min="0"
          style="max-width:70px"
          oninput="window._ui.updateGroupUncertainty('${gid}',this.value)">
        <span style="color:var(--text3);font-size:11px;white-space:nowrap;margin-left:4px">mm</span>
      </div>
      <div style="font-size:10px;color:var(--text3);margin-bottom:4px">Members (Ctrl/Cmd for multi-select):</div>
      <select multiple style="width:100%;background:var(--bg4);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:3px;font-size:11px;height:64px"
        onchange="window._ui.updateGroupMembers('${gid}',this)">${objOptions}</select>
    `;
    container.appendChild(div);
  }
}

export function deleteGroup(gid) {
  delete state.groups[gid];
  renderGroupsModal(); refreshUI(); renderInlineGroups();
}

export function updateGroupMembers(gid, select) {
  // Prevent adding objects that are in OTHER groups
  const selected = Array.from(select.selectedOptions).map(o => o.value);
  const conflicts = [];
  for (const n of selected) {
    const existingGid = getObjectGroup(n);
    if (existingGid && existingGid !== gid) {
      conflicts.push(`"${n}" is already in group "${state.groups[existingGid].name}"`);
    }
  }
  if (conflicts.length) {
    alert('Cannot add:\n' + conflicts.join('\n') + '\n\nRemove from the other group first.');
    renderGroupsModal(); // reset selection
    return;
  }
  state.groups[gid].objectNames = selected;
  refreshUI();
  renderInlineGroups();
  updatePropsPanel();
  draw();
}

export function updateGroupUncertainty(gid, value) {
  if (!state.groups[gid]) return;
  state.groups[gid].uncertainty = parseFloat(value) || 0;
  updatePropsPanel();
  draw();
}


// =============================================
// RESULTS PANEL
// =============================================
export function updateResultsPanel() {
  const rays = state.simulation.rays;
  if (!rays.length) return;

  const n = rays.length;
  const total = parseInt(document.getElementById('p-rayNumber').value) || 1000;
  const minT = parseFloat(document.getElementById('p-minThickness').value) || 0;

  const allThick = rays.map(r => r.thickness).sort((a,b) => a-b);
  const mean = allThick.reduce((a,b) => a+b, 0) / n;
  const minVal = allThick[0];
  const belowThresh = allThick.filter(v => v <= minT).length;
  const pctBelow = (belowThresh / n * 100);

  const pct = Math.round(state.simulation.raysComputed / total * 100);
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('p-rays-done').textContent = state.simulation.raysComputed + ' rays';
  document.getElementById('p-pct').textContent = pct + '%';

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
      <div class="result-stat-label" style="margin-bottom:6px">Distribution (0 → ${minT>0?minT.toFixed(1):'?'} mm Pb)</div>
      <canvas id="dist-canvas" height="80"></canvas>
    </div>
  `;

  requestAnimationFrame(() => drawDistribution(allThick, minT));
}

function drawDistribution(sorted, maxVal) {
  const c = document.getElementById('dist-canvas');
  if (!c) return;
  const parent = c.parentElement;
  c.width = parent.clientWidth - 16;
  const w = c.width, h = c.height;
  const ctx = c.getContext('2d');
  const light = document.documentElement.classList.contains('light');
  ctx.clearRect(0, 0, w, h);

  if (maxVal <= 0) {
    ctx.font = '10px JetBrains Mono';
    ctx.fillStyle = light ? 'rgba(100,110,150,0.7)' : 'rgba(90,99,128,0.6)';
    ctx.textAlign = 'center';
    ctx.fillText('Set "Min Pb equiv" to show distribution', w/2, h/2);
    return;
  }

  const bins = 30;
  const counts = new Array(bins).fill(0);
  const step = maxVal / bins;
  for (const v of sorted) {
    if (v > maxVal) continue;
    counts[Math.min(bins-1, Math.floor(v/step))]++;
  }
  const maxCount = Math.max(...counts, 1);
  const barW = w / bins;
  const padB = 18;

  for (let i = 0; i < bins; i++) {
    const frac = i / (bins-1);
    const barH = counts[i] / maxCount * (h - padB - 4);
    if (barH < 0.5) continue;
    let r2, g2, b2;
    if (frac < 0.5) {
      const f = frac*2;
      r2 = Math.round(f*255); g2 = Math.round(212+f*(204-212)); b2 = Math.round(170+f*(79-170));
    } else {
      const f = (frac-0.5)*2;
      r2 = 255; g2 = Math.round(204+f*(80-204)); b2 = Math.round(79+f*(60-79));
    }
    ctx.fillStyle = `rgba(${r2},${g2},${b2},${light?0.85:0.7})`;
    ctx.fillRect(i*barW, h-padB-barH, barW-1, barH);
  }

  ctx.font = '8px JetBrains Mono, monospace';
  ctx.fillStyle = light ? 'rgba(80,90,130,0.9)' : 'rgba(90,99,128,0.8)';
  ctx.textAlign = 'left';  ctx.fillText('0', 0, h-2);
  ctx.textAlign = 'center'; ctx.fillText((maxVal/2).toFixed(1), w/2, h-2);
  ctx.textAlign = 'right'; ctx.fillText(maxVal.toFixed(1), w, h-2);
}

// =============================================
// RAY DETAIL PANEL
// =============================================
export function showRayDetail(ray, intersections) {
  // Switch to calc tab, ray sub-tab
  switchTab('calc');
  switchSubTab('tab-calc', 'ray');

  const rayLen = Math.hypot(ray.x2 - ray.x1, ray.y2 - ray.y1);
  const totalPb = intersections.reduce((s, seg) => s + seg.pbEquiv, 0);

  let html = `
    <div class="param-group" style="margin-bottom:10px">
      <div class="param-group-title">📍 Ray Info</div>
      <div class="prop-row"><span class="prop-key">Start</span><span class="prop-val" style="font-family:var(--font-mono);font-size:10px">(${ray.x1.toFixed(2)}, ${ray.y1.toFixed(2)})</span></div>
      <div class="prop-row"><span class="prop-key">End</span><span class="prop-val" style="font-family:var(--font-mono);font-size:10px">(${ray.x2.toFixed(2)}, ${ray.y2.toFixed(2)})</span></div>
      <div class="prop-row"><span class="prop-key">Total length</span><span class="prop-val" style="font-family:var(--font-mono);font-size:10px">${rayLen.toFixed(2)} mm</span></div>
      <div class="prop-row"><span class="prop-key">Total Pb equiv</span><span class="prop-val" style="font-family:var(--font-mono);font-size:10px;color:${totalPb>0?'var(--accent)':'var(--text3)'}">${totalPb.toFixed(3)} mm Pb</span></div>
    </div>`;

  if (intersections.length === 0) {
    html += `<div class="empty-state" style="padding:12px 8px">No surface intersections on this ray.</div>`;
  } else {
    html += `<div class="param-group-title" style="margin-bottom:6px">🔬 Intersections (${intersections.length})</div>`;
    intersections.forEach((seg, idx) => {
      const matColor = window.state?.materials?.[seg.material]?.color || '#ff7b4f';
      html += `
        <div class="param-group" style="border-left:3px solid ${matColor};padding-left:8px;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
            <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${matColor};flex-shrink:0"></span>
            <span style="font-size:11px;font-weight:600;color:var(--text)">${seg.objName}</span>
          </div>
          <div class="prop-row"><span class="prop-key">Material</span><span class="prop-val" style="font-size:10px;font-family:var(--font-mono)">${seg.material}</span></div>
          <div class="prop-row"><span class="prop-key">Density</span><span class="prop-val" style="font-size:10px;font-family:var(--font-mono)">${seg.density.toFixed(3)} g/cm³</span></div>
          <div class="prop-row"><span class="prop-key">ρ / ρ(Pb)</span><span class="prop-val" style="font-size:10px;font-family:var(--font-mono)">×${seg.ratio.toFixed(4)}</span></div>
          <div class="prop-row"><span class="prop-key">Entry</span><span class="prop-val" style="font-size:10px;font-family:var(--font-mono)">(${seg.entryPt[0].toFixed(2)}, ${seg.entryPt[1].toFixed(2)})</span></div>
          <div class="prop-row"><span class="prop-key">Exit</span><span class="prop-val" style="font-size:10px;font-family:var(--font-mono)">(${seg.exitPt[0].toFixed(2)}, ${seg.exitPt[1].toFixed(2)})</span></div>
          <div class="prop-row"><span class="prop-key">Path length</span><span class="prop-val" style="font-size:10px;font-family:var(--font-mono)">${seg.length.toFixed(3)} mm</span></div>
          <div class="prop-row" style="border-top:1px solid var(--border);padding-top:4px;margin-top:2px">
            <span class="prop-key" style="color:var(--text2)">Pb equiv</span>
            <span class="prop-val" style="font-size:11px;font-weight:700;font-family:var(--font-mono);color:${matColor}">${seg.pbEquiv.toFixed(3)} mm</span>
          </div>
        </div>`;
    });
  }

  const pane = document.querySelector('#tab-calc .sub-pane[data-pane="ray"]');
  if (pane) pane.innerHTML = html;
}

export function clearRayDetail() {
  switchSubTab('tab-calc', 'sim');
  const pane = document.querySelector('#tab-calc .sub-pane[data-pane="ray"]');
  if (pane) pane.innerHTML = '<div class="empty-state">Click a ray to see details.</div>';
}

export { };
