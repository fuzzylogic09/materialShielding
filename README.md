# ShieldCalc 2D — Monte Carlo Shielding Simulator

A browser-based 2D physics ray tracing tool for computing lead-equivalent shielding thickness using Monte Carlo methods.

## 🚀 Deploy on GitHub/GitLab Pages

1. Push this folder to a GitHub repository
2. Go to **Settings → Pages** → set source to `main` branch, root `/`
3. Your app will be live at `https://<username>.github.io/<repo>/`

> **No build step required** — pure HTML/CSS/JavaScript (ES modules).

## 📁 File Structure

```
index.html              # Main HTML
css/
  style.css             # All styles
js/
  main.js               # App entry point, event wiring
  state.js              # Global state + coordinate transforms + utilities  
  loader.js             # JSON parser with detailed error reporting
  renderer.js           # Canvas drawing (grid, objects, rays, colorbar)
  simulation.js         # Monte Carlo engine (ray-geometry intersections)
  ui.js                 # UI panels (objects, properties, materials, results)
data/
  materials.json        # Default material library
```

## 📖 JSON Scene Format

```json
{
  "scene": {
    "parameters": {
      "title": "My simulation",
      "rayNumber": 5000,
      "batchSize": 100,
      "minThicknessToShow": 50.0,
      "plotRayCount": 200
    },
    "materials": {
      "lead":     { "density": 11.34, "color": "#7b8fa0" },
      "tungsten": { "density": 17.0,  "color": "#c0a060" },
      "concrete": { "density": 2.35,  "color": "#a09080" }
    },
    "groups": {
      "g_stand1": { "name": "Stand A", "objectNames": ["block1", "block2"] }
    },
    "objects": {
      "Source": {
        "parameters": { "type": "source", "uncertainty": 5 },
        "points": [[100, 30], [100, -30]]
      },
      "Opening 1": {
        "parameters": { "type": "receptor", "enabled": "True", "uncertainty": 2 },
        "points": [[-100, 5], [-100, -5]]
      },
      "lead_wall": {
        "parameters": {
          "type": "surface",
          "material": "lead",
          "enabled": "True",
          "uncertainty": 1.0
        },
        "points": [[-10, -50], [10, -50], [10, 50], [-10, 50]]
      },
      "round_collimator": {
        "parameters": {
          "type": "surface",
          "material": "tungsten",
          "enabled": "True",
          "geometry": "circle",
          "uncertainty": 0.5
        },
        "points": [[0, 0], 15.0]
      }
    }
  }
}
```

### Object types
| type | description |
|------|-------------|
| `source` | Emission line/polyline — rays start here |
| `receptor` | Detection line/polyline — rays end here |
| `surface` | Shielding material — contributes to Pb equiv thickness |

### Geometries
- **Polyline / polygon**: `"points": [[x1,y1], [x2,y2], ...]` — 2 points = line, 3+ = polygon
- **Circle**: `"geometry": "circle"`, `"points": [[cx, cy], radius]`

### Uncertainty
Each object has an `"uncertainty"` (in mm). During each Monte Carlo ray, the object is displaced by a random vector of magnitude `[0, uncertainty]` in a random direction.

Objects in the same **group** share the same displacement vector per ray.

## 🎮 Controls

| Action | How |
|--------|-----|
| Pan | Click + drag on empty canvas |
| Zoom | Mouse wheel (zoom toward cursor) |
| Select object | Click on it |
| Move object | Click + drag on object (when not locked) |
| Lock/unlock | 🔒 icon in object list, or global "Lock All" |

## ⚙️ How it works

1. A ray is emitted from a random point on a **source** line
2. It travels to a random point on a **receptor** line  
3. For each **surface** object the ray intersects, the traversed thickness is computed and converted to lead-equivalent: `t_Pb = t_real × (ρ_material / ρ_lead)`
4. All contributions are summed → total Pb-equiv thickness for that ray
5. All rays are stored; only rays **≤ threshold** are displayed (colored by thickness)

## 📊 Results

- **Minimum**: smallest Pb-equiv thickness found (worst-case ray)
- **Mean**: average over all rays
- **Below threshold**: count and % of rays that pass below the defined threshold
- **Distribution**: histogram from 0 to threshold, colored by the same colormap as the rays
