import { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';

export default function CustomerHome() {
  const [restaurants, setRestaurants] = useState([]);

  useEffect(() => {
    apiFetch('/restaurants').then((data) => setRestaurants(data.restaurants)).catch(console.error);
  }, []);

  return (
    <section>
      <h2>Restaurantes disponibles</h2>
      <ul>
        {restaurants.map((restaurant) => (
          <li key={restaurant.id}>{restaurant.name} · {restaurant.category}</li>
        ))}
      </ul>
      <p>Flujo beta: el cliente crea pedido, restaurante acepta/prepara, repartidor asigna y entrega.</p>
    </section>
  );
}
