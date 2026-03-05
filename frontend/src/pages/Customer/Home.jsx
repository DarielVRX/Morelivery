import { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';

export default function CustomerHome() {
  const [restaurants, setRestaurants] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch('/restaurants')
      .then((data) => setRestaurants(data.restaurants))
      .catch(() => setError('No se pudo cargar restaurantes. Verifica API y CORS.'));
  }, []);

  return (
    <section>
      <h2>Página principal (cliente)</h2>
      <p>
        Debe mostrar restaurantes abiertos, tiempos estimados y CTA de pedido. En esta beta ya lista restaurantes y
        comunica el flujo operativo end-to-end.
      </p>

      <div className="grid-cards">
        <article className="card">
          <h3>1) Descubrir</h3>
          <p>El cliente explora restaurantes disponibles y su menú.</p>
        </article>
        <article className="card">
          <h3>2) Pedir</h3>
          <p>Crea un pedido seguro y recibe estados en tiempo real.</p>
        </article>
        <article className="card">
          <h3>3) Recibir</h3>
          <p>Ve estado aproximado del repartidor hasta entrega.</p>
        </article>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <h3>Restaurantes disponibles</h3>
      <ul>
        {restaurants.map((restaurant) => (
          <li key={restaurant.id}>
            <strong>{restaurant.name}</strong> · {restaurant.category} · {restaurant.is_open ? 'Abierto' : 'Cerrado'}
          </li>
        ))}
      </ul>
    </section>
  );
}
