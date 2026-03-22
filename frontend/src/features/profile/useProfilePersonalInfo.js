import { useState } from 'react';

import { apiFetch } from '../../api/client';

function buildInitialStreet(user) {
  const savedAddress = user?.address && user.address !== 'address-pending' ? user.address : '';
  const hasStructured = Boolean(user?.calle || user?.numero);

  return {
    savedAddress,
    hasStructured,
    calle: user?.calle || (hasStructured ? '' : savedAddress
      .replace(/,\s*\d{5}\s*$/, '')
      .replace(/,\s*[^,]+$/, '')
      .replace(/,\s*[^,]+$/, '')
      .replace(/,\s*[^,]+$/, '')
      .replace(/\s+\d+[a-zA-Z]?\s*$/, '')
      .trim()),
    numero: user?.numero || (hasStructured ? '' : savedAddress.match(/\s+(\d+[a-zA-Z]?)\s*(?:,|$)/)?.[1] || ''),
  };
}

export function useProfilePersonalInfo({ token, user, patchUser }) {
  const initialStreet = buildInitialStreet(user);
  const [alias, setAlias] = useState(user?.alias || user?.display_name || user?.full_name || '');
  const [calle, setCalle] = useState(initialStreet.calle);
  const [numero, setNumero] = useState(initialStreet.numero);
  const [profileMsg, setProfileMsg] = useState('');
  const [profileErr, setProfileErr] = useState(false);
  const [postalCode, setPostalCode] = useState(user?.postal_code || '');
  const [estado, setEstado] = useState(user?.estado || '');
  const [ciudad, setCiudad] = useState(user?.ciudad || '');
  const [colonia, setColonia] = useState(user?.colonia || '');
  const [coloniasList, setColoniasList] = useState([]);
  const [homeLat, setHomeLat] = useState(user?.home_lat ?? null);
  const [homeLng, setHomeLng] = useState(user?.home_lng ?? null);

  async function saveProfile() {
    if (!alias.trim()) {
      setProfileMsg('El nombre no puede estar vacío');
      setProfileErr(true);
      return;
    }

    try {
      const streetAddress = [calle.trim(), numero.trim()].filter(Boolean).join(' ');
      let finalAddress = streetAddress;
      if (colonia && ciudad && estado) {
        finalAddress = finalAddress || [colonia, ciudad, estado].filter(Boolean).join(', ');
      }

      const data = await apiFetch('/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: alias.trim(),
          address: finalAddress || undefined,
          postalCode: postalCode || undefined,
          colonia: colonia || undefined,
          estado: estado || undefined,
          ciudad: ciudad || undefined,
          homeLat: homeLat ?? undefined,
          homeLng: homeLng ?? undefined,
        }),
      }, token);

      patchUser({
        alias: data.profile.alias ?? data.profile.displayName,
        full_name: data.profile.alias ?? data.profile.displayName,
        address: data.profile.address,
        colonia: data.profile.colonia,
        estado: data.profile.estado,
        ciudad: data.profile.ciudad,
        home_lat: data.profile.home_lat,
        home_lng: data.profile.home_lng,
      });

      const newAlias = data.profile.alias ?? data.profile.displayName;
      if (newAlias) setAlias(newAlias);
      if (data.profile.address) {
        const saved = data.profile.address;
        setCalle(saved.replace(/\s+\d+[a-zA-Z]?\s*$/, '').trim());
        setNumero(saved.match(/\s+(\d+[a-zA-Z]?)\s*$/)?.[1] || '');
      }
      if (data.profile.home_lat) setHomeLat(data.profile.home_lat);
      if (data.profile.home_lng) setHomeLng(data.profile.home_lng);
      setProfileMsg('Perfil actualizado');
      setProfileErr(false);
    } catch (error) {
      setProfileMsg(error.message);
      setProfileErr(true);
    }
  }

  return {
    alias,
    setAlias,
    calle,
    setCalle,
    numero,
    setNumero,
    profileMsg,
    profileErr,
    postalCode,
    setPostalCode,
    estado,
    setEstado,
    ciudad,
    setCiudad,
    colonia,
    setColonia,
    coloniasList,
    setColoniasList,
    homeLat,
    setHomeLat,
    homeLng,
    setHomeLng,
    saveProfile,
  };
}
