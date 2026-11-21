// =========================================================================
// 1. CONSTANTS & REAL SELENOGRAPHIC LANDMARKS
// =========================================================================
export const MOON_RADIUS = 100.0;          // 3D sphere base radius
export const MOON_REAL_KM = 1737.4;        // NASA LOLA reference sphere radius (km)
export const BASE_RELIEF_UNITS = 1.35;     // Displacement units at 1.0x relief scale
export const LANDER_SCALE = 0.1;           // 20% of previous size — makes craters & mountains feel massive
export const LANDER_FOOT_OFFSET = 0.068;   // Vertical offset from lander origin to footpads (0.1x)
export const ROVER_SCALE = 0.04;           // Deployable Apollo LRV (0.4x lander scale)
export const ROVER_WHEEL_OFFSET = 0.022;   // Vertical offset from rover origin to tire contact patch
export const LUNAR_MU = 16200.0;           // Newtonian GM (g0 = 1.62 u/s² at R=100, LLO v_circ ≈ 12.4 u/s)
export const SPEED_TO_MS = 135.0;          // Maps LLO v_circ (12.42 u/s) to real lunar orbital speed (~1,677 m/s)
export const CSM_ORBIT_RADIUS = 114.0;     // Apollo 11 CSM "Columbia" equatorial parking orbit radius
export const SCAN_RANGE_UNITS = 8.5;       // ~148 km surface lidar scan range
export const SCAN_DURATION_SEC = 2.0;      // Lidar pulse duration
export const ELEV_GRID_W = 1024;           // CPU elevation grid width
export const ELEV_GRID_H = 512;            // CPU elevation grid height
export const MOON_SEG_W = 320;             // Displaced Moon mesh longitude segments
export const MOON_SEG_H = 160;             // Displaced Moon mesh latitude segments

export const LANDMARKS = [
  {
    id: 'apollo11',
    name: 'Apollo 11 — Mare Tranquillitatis',
    shortName: 'Apollo 11',
    lat: 0.674,
    lon: 23.473,
    category: 'Historic Landing',
    desc: 'Site of humanity’s first crewed lunar touchdown on July 20, 1969, by Neil Armstrong and Buzz Aldrin aboard LM Eagle.',
    science: 'Basaltic mare lavas dated to ~3.7 billion years old, rich in titanium-bearing ilmenite.'
  },
  {
    id: 'tycho',
    name: 'Tycho Crater',
    shortName: 'Tycho',
    lat: -43.31,
    lon: -11.36,
    category: 'Impact Crater',
    desc: 'A dramatic 85 km wide young impact crater in the southern highlands famous for its brilliant ejecta ray system stretching over 1,500 km.',
    science: 'Formed ~108 million years ago; features a 2 km tall central peak and fresh impact melt pools.'
  },
  {
    id: 'copernicus',
    name: 'Copernicus Crater',
    shortName: 'Copernicus',
    lat: 9.62,
    lon: -20.08,
    category: 'Impact Crater',
    desc: 'Known as the "Monarch of the Moon," Copernicus is a 93 km terraced crater surrounded by dark basaltic plains of Oceanus Procellarum.',
    science: 'Excavated deep crustal olivine from ~800 million years ago; defines the Copernican geologic period.'
  },
  {
    id: 'shackleton',
    name: 'Shackleton Crater (South Pole)',
    shortName: 'Shackleton',
    lat: -89.67,
    lon: 129.78,
    category: 'Artemis Target',
    desc: 'A 21 km crater straddling the Lunar South Pole whose rim receives near-continuous sunlight while its floor lies in permanent darkness.',
    science: 'LOLA laser reflectance and LCROSS data indicate water-ice deposits trapped in permanently shadowed regolith.'
  },
  {
    id: 'huygens',
    name: 'Mons Huygens (Montes Apenninus)',
    shortName: 'Mons Huygens',
    lat: 19.92,
    lon: -2.86,
    category: 'Lunar Mountain',
    desc: 'The tallest mountain peak on the Moon, towering ~5.5 km above the floor of Mare Imbrium along the rugged Apennine range.',
    science: 'Uplifted basin rim massif formed during the cataclysmic Imbrium impact ~3.9 billion years ago.'
  },
  {
    id: 'apollo15',
    name: 'Apollo 15 — Hadley–Apennine',
    shortName: 'Apollo 15',
    lat: 26.132,
    lon: 3.634,
    category: 'Historic Landing',
    desc: 'First mission to deploy the Lunar Roving Vehicle (LRV), exploring the sinuous Hadley Rille and the foothills of Mons Hadley Delta.',
    science: 'Recovered the 4.1-billion-year-old "Genesis Rock," a sample of primordial lunar anorthosite crust.'
  },
  {
    id: 'apollo17',
    name: 'Apollo 17 — Taurus–Littrow',
    shortName: 'Apollo 17',
    lat: 20.191,
    lon: 30.772,
    category: 'Historic Landing',
    desc: 'Deep tectonic valley on the southeastern edge of Mare Serenitatis where Harrison Schmitt—the first geologist on the Moon—explored.',
    science: 'Discovered volcanic orange pyroclastic glass beads erupted from the lunar mantle 3.64 billion years ago.'
  },
  {
    id: 'imbrium',
    name: 'Mare Imbrium Basin',
    shortName: 'Mare Imbrium',
    lat: 32.8,
    lon: -15.6,
    category: 'Lunar Mare',
    desc: 'One of the largest impact basins in the Solar System (1,145 km wide), later flooded by successive waves of dark flood basalt.',
    science: 'Exhibits a strong positive gravity anomaly (mascon) detected by lunar orbiters.'
  },
  {
    id: 'spa',
    name: 'South Pole–Aitken Basin',
    shortName: 'SPA Basin',
    lat: -53.0,
    lon: -169.0,
    category: 'Far Side Basin',
    desc: 'An ancient, colossal 2,500 km impact basin on the lunar far side—the deepest and oldest recognized impact structure on the Moon.',
    science: 'Excavated lower crustal and possibly upper mantle material, reaching depths over 8 km below mean radius.'
  },
  {
    id: 'tsiolkovskiy',
    name: 'Tsiolkovskiy Crater',
    shortName: 'Tsiolkovskiy',
    lat: -20.4,
    lon: 129.1,
    category: 'Far Side Crater',
    desc: 'A striking 184 km far-side crater with a pitch-dark basalt floor surrounding a gleaming white central peak.',
    science: 'Rare example of dark mare volcanism on the thick-crusted lunar far side.'
  }
];
