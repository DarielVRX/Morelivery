// src/utils/geocode.js
// Único punto de verdad para reverse geocoding con Nominatim.
// Devuelve tanto el label de display como los campos estructurados.

export async function nominatimReverse(lat, lng) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&countrycodes=mx&accept-language=es`,
      { headers: { 'Accept-Language': 'es', 'User-Agent': 'Morelivery/1.0' } }
    );
    const data = await r.json();
    const a = data.address || {};

    // En Morelia: centros de ciudad → a.city, periféria → a.village para colonia
    const coloniaRaw = a.suburb || a.neighbourhood || a.quarter || a.city_district || a.village || '';
    const ciudadRaw  = a.city || a.county || 'Morelia';

    const label =
      [a.road, a.house_number, coloniaRaw, ciudadRaw].filter(Boolean).join(', ') ||
      data.display_name?.split(',').slice(0, 3).join(',') ||
      '';

    return {
      label,
      colonia:    coloniaRaw,
      ciudad:     ciudadRaw,
      estado:     a.state || 'Michoacán',
      postalCode: a.postcode || '',
    };
  } catch {
    return null;
  }
}
