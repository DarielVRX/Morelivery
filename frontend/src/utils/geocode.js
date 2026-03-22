// src/utils/geocode.js
// Único punto de verdad para reverse geocoding con Nominatim.
// Devuelve tanto el label de display como los campos estructurados.

export async function nominatimReverse(lat, lng, { apiFetch, token } = {}) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&countrycodes=mx&accept-language=es`,
      { headers: { 'Accept-Language': 'es', 'User-Agent': 'Morelivery/1.0' } }
    );
    const data = await r.json();
    const a = data.address || {};

    const postalCode = a.postcode || '';
    let coloniaRaw = a.suburb || a.neighbourhood || a.quarter || a.village || '';
    const colonias = [];

    if (!coloniaRaw && postalCode && apiFetch) {
      try {
        const result = await apiFetch(`/auth/postal/${postalCode}`, {}, token);
        if (result?.colonias?.length === 1) {
          coloniaRaw = result.colonias[0];
        } else if (result?.colonias?.length > 1) {
          colonias.push(...result.colonias);
        }
      } catch {}
    }

    const ciudadRaw = a.county || '';
    const label =
    [a.road, a.house_number, coloniaRaw || ciudadRaw, ciudadRaw].filter(Boolean).join(', ') ||
    data.display_name?.split(',').slice(0, 3).join(',') ||
    '';

    return {
      label,
      colonia:    coloniaRaw,
      ciudad:     ciudadRaw,
      estado:     a.state || '',
      postalCode,
      colonias,
    };
  } catch { return null; }
}
