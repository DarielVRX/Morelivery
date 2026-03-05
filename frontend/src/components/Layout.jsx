import { Link } from 'react-router-dom';

export default function Layout({ children }) {
  return (
    <div className="container">
      <header>
        <h1>Morelivery Beta</h1>
        <nav>
          <Link to="/">Cliente</Link>
          <Link to="/restaurant">Restaurante</Link>
          <Link to="/driver">Repartidor</Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
