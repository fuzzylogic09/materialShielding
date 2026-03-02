import { state } from './state.js';

// =============================================
// JSON IMPORT WITH DETAILED ERROR REPORTING
// =============================================

/**
 * Parse and import a JSON scene. Returns { loaded: true/false, issues: [] }
 * Issues: { type: 'error'|'warning'|'info', context, message, fix }
 */
export function importFromJSON(raw) {
  const issues = [];
  let json;

  // --- Parse raw if string ---
  if (typeof raw === 'string') {
    try {
      json = JSON.parse(raw);
    } catch (e) {
      issues.push({
        type: 'error',
        context: 'JSON Syntax',
        message: `Cannot parse file: ${e.message}`,
        fix: 'Check for missing commas, unclosed brackets, or trailing commas. Use a JSON validator (e.g. jsonlint.com).'
      });
      return { loaded: false, issues };
    }
  } else {
    json = raw;
  }

  // --- Top-level structure ---
  const scene = json.scene || json;
  if (!json.scene) {
    issues.push({
      type: 'info',
      context: 'Structure',
      message: 'No top-level "scene" key found. Treating the whole file as the scene.',
      fix: 'Wrap your JSON in a { "scene": { ... } } object for best compatibility.'
    });
  }

  // --- Parameters ---
  const params = scene.parameters || {};
  if (!scene.parameters) {
    issues.push({
      type: 'warning',
      context: 'Parameters',
      message: 'No "parameters" block found. Using defaults.',
      fix: 'Add a "parameters" block with rayNumber, title, etc.'
    });
  }

  // Apply params
  if (params.title) {
    document.getElementById('sim-title').value = params.title;
    state.params.title = params.title;
  }
  const intParams = ['rayNumber', 'plotRayCount', 'batchSize'];
  const floatParams = ['minLeadLength', 'minThicknessToShow'];
  intParams.forEach(k => {
    if (params[k] !== undefined) {
      const el = document.getElementById('p-' + k);
      if (el) el.value = params[k];
      state.params[k] = params[k];
    }
  });
  floatParams.forEach(k => {
    if (params[k] !== undefined) {
      const el = document.getElementById('p-' + k === 'minThicknessToShow' ? 'p-minThickness' : 'p-' + k);
      if (el) el.value = params[k];
    }
  });
  if (params.minThicknessToShow !== undefined) {
    const el = document.getElementById('p-minThickness');
    if (el) el.value = params.minThicknessToShow;
  }

  // --- Materials ---
  let mats = null;
  if (scene.materials && typeof scene.materials === 'object' && !Array.isArray(scene.materials)) {
    mats = scene.materials;
  } else if (typeof scene.materials === 'string') {
    issues.push({
      type: 'warning',
      context: 'Materials',
      message: `"materials" is a string path ("${scene.materials}"). External material files are not supported in the browser.`,
      fix: 'Embed your material definitions directly in the JSON file as an object, e.g. "materials": { "lead": { "density": 11.34, "color": "#7b8fa0" } }'
    });
  }

  if (mats) {
    for (const [k, v] of Object.entries(mats)) {
      if (typeof v !== 'object' || v === null) {
        issues.push({
          type: 'warning',
          context: `Material "${k}"`,
          message: `Material "${k}" is not an object. Skipped.`,
          fix: `Define as: "${k}": { "density": <number>, "color": "<hex>" }`
        });
        continue;
      }
      if (v.density === undefined || isNaN(parseFloat(v.density))) {
        issues.push({
          type: 'warning',
          context: `Material "${k}"`,
          message: `Material "${k}" has no valid density. Using 1.0 g/cm³.`,
          fix: `Add "density": <number> to material "${k}".`
        });
      }
      state.materials[k] = {
        density: parseFloat(v.density) || 1.0,
        color: v.color || '#888888'
      };
    }
  }

  // --- Groups ---
  state.groups = {};
  if (scene.groups && typeof scene.groups === 'object') {
    for (const [gid, g] of Object.entries(scene.groups)) {
      if (!g.name || !Array.isArray(g.objectNames)) {
        issues.push({
          type: 'warning',
          context: `Group "${gid}"`,
          message: `Group "${gid}" is malformed (needs "name" and "objectNames" array). Skipped.`,
          fix: 'Define as: "groupId": { "name": "Group Name", "objectNames": ["obj1", "obj2"] }'
        });
        continue;
      }
      state.groups[gid] = g;
    }
  }

  // --- Objects ---
  const objects = scene.objects;
  if (!objects || typeof objects !== 'object') {
    issues.push({
      type: 'error',
      context: 'Objects',
      message: 'No "objects" block found or it is not an object.',
      fix: 'Add an "objects" block containing named object definitions.'
    });
    return { loaded: false, issues };
  }

  state.objects = {};
  let loadedCount = 0;
  let sourcesFound = 0, receptorsFound = 0;

  for (const [name, obj] of Object.entries(objects)) {
    const objIssues = validateObject(name, obj);
    issues.push(...objIssues.filter(i => i.type === 'error' || i.type === 'warning'));
    if (objIssues.some(i => i.fatal)) continue; // skip fatally broken objects

    const cleaned = JSON.parse(JSON.stringify(obj));
    if (cleaned.parameters.enabled === undefined) cleaned.parameters.enabled = 'True';
    if (cleaned.parameters.uncertainty === undefined) cleaned.parameters.uncertainty = 0;
    if (cleaned.locked === undefined) cleaned.locked = false;
    // transformX/Y: apply to points at load time if present
    const tx = parseFloat(cleaned.parameters.transformX) || 0;
    const ty = parseFloat(cleaned.parameters.transformY) || 0;
    if ((tx !== 0 || ty !== 0) && cleaned.parameters.geometry !== 'circle') {
      cleaned.points = cleaned.points.map(p => [p[0] + tx, p[1] + ty]);
      issues.push({
        type: 'info',
        context: `Object "${name}"`,
        message: `Applied transformX=${tx}, transformY=${ty} to points. These parameters have been removed.`,
        fix: ''
      });
      delete cleaned.parameters.transformX;
      delete cleaned.parameters.transformY;
    }
    state.objects[name] = cleaned;
    loadedCount++;

    const type = cleaned.parameters.type;
    if (type === 'source') sourcesFound++;
    else if (type === 'receptor') {
      if (cleaned.parameters.enabled !== 'False') receptorsFound++;
    }
  }

  // Validation warnings for simulation readiness
  if (sourcesFound === 0) {
    issues.push({
      type: 'warning',
      context: 'Simulation readiness',
      message: 'No source object found. Cannot run ray tracing.',
      fix: 'Add an object with "type": "source" to your scene.'
    });
  }
  if (receptorsFound === 0) {
    issues.push({
      type: 'warning',
      context: 'Simulation readiness',
      message: 'No enabled receptor (opening) found. Cannot run ray tracing.',
      fix: 'Add an object with "type": "receptor" and "enabled": "True".'
    });
  }

  // Warn about surface objects whose material is missing
  for (const [name, obj] of Object.entries(state.objects)) {
    if (obj.parameters.type === 'surface') {
      const mat = obj.parameters.material;
      if (!mat || !state.materials[mat]) {
        issues.push({
          type: 'warning',
          context: `Object "${name}"`,
          message: `Material "${mat || '(none)'}" not found in library. This object will contribute 0 to shielding.`,
          fix: `Define material "${mat}" in the "materials" section, or change the material of "${name}".`
        });
      }
    }
  }

  issues.push({
    type: 'info',
    context: 'Summary',
    message: `Loaded ${loadedCount} object(s) successfully.`,
    fix: ''
  });

  return { loaded: true, issues };
}

function validateObject(name, obj) {
  const issues = [];

  if (!obj || typeof obj !== 'object') {
    issues.push({ type: 'error', fatal: true, context: `Object "${name}"`, message: 'Object is not a valid JSON object. Skipped.', fix: '' });
    return issues;
  }

  const params = obj.parameters;
  if (!params || typeof params !== 'object') {
    issues.push({ type: 'error', fatal: true, context: `Object "${name}"`, message: 'Missing "parameters" block. Object skipped.', fix: 'Add "parameters": { "type": "..." } to the object.' });
    return issues;
  }

  const type = params.type;
  if (!['source', 'receptor', 'surface'].includes(type)) {
    issues.push({ type: 'error', fatal: true, context: `Object "${name}"`, message: `Unknown type "${type}". Must be "source", "receptor", or "surface". Skipped.`, fix: `Set "type" to one of: "source", "receptor", "surface".` });
    return issues;
  }

  const geo = params.geometry;
  const pts = obj.points;

  if (geo === 'circle') {
    if (!Array.isArray(pts) || pts.length < 2) {
      issues.push({ type: 'error', fatal: true, context: `Object "${name}"`, message: 'Circle must have points: [[cx, cy], radius]. Skipped.', fix: 'Set "points": [[x, y], radius].' });
      return issues;
    }
    if (!Array.isArray(pts[0]) || pts[0].length < 2) {
      issues.push({ type: 'error', fatal: true, context: `Object "${name}"`, message: 'Circle center must be [x, y]. Skipped.', fix: 'Set "points": [[cx, cy], radius].' });
      return issues;
    }
    if (typeof pts[1] !== 'number' || pts[1] <= 0) {
      issues.push({ type: 'warning', fatal: false, context: `Object "${name}"`, message: `Circle radius "${pts[1]}" is not a positive number. Using |${pts[1]}|.`, fix: 'Set radius to a positive number.' });
      obj.points[1] = Math.abs(parseFloat(pts[1])) || 1;
    }
  } else {
    if (!Array.isArray(pts) || pts.length < 2) {
      issues.push({ type: 'error', fatal: true, context: `Object "${name}"`, message: 'Object must have at least 2 points. Skipped.', fix: 'Add at least 2 [x, y] coordinate pairs to "points".' });
      return issues;
    }
    for (let i = 0; i < pts.length; i++) {
      if (!Array.isArray(pts[i]) || pts[i].length < 2 ||
          isNaN(parseFloat(pts[i][0])) || isNaN(parseFloat(pts[i][1]))) {
        issues.push({ type: 'error', fatal: true, context: `Object "${name}"`, message: `Point ${i} is invalid: ${JSON.stringify(pts[i])}. Skipped.`, fix: 'All points must be [x, y] number pairs.' });
        return issues;
      }
    }
  }

  if (type === 'surface' && !params.material) {
    issues.push({ type: 'warning', fatal: false, context: `Object "${name}"`, message: 'No material defined for surface object.', fix: 'Add "material": "<name>" to the parameters.' });
  }

  return issues;
}
