const STADIA_KEY = import.meta.env?.VITE_STADIA_KEY || '';

function stadiaStyle(name) {
  const base = `https://tiles.stadiamaps.com/styles/${name}.json`;
  return STADIA_KEY ? `${base}?api_key=${STADIA_KEY}` : base;
}

export { STADIA_KEY };

export const STYLE_LIGHT = STADIA_KEY
? stadiaStyle('osm_bright')
: 'https://tiles.openfreemap.org/styles/bright';

export const STYLE_DARK = STADIA_KEY
? stadiaStyle('alidade_smooth_dark')
: 'https://tiles.openfreemap.org/styles/bright';

export const DEFAULT_POS = { lat: 19.70595, lng: -101.19498 };
export const MORELIA_BOUNDS = [[-101.42, 19.57], [-100.98, 19.84]];
