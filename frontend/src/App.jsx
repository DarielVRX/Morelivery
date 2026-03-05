import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import Layout from './components/Layout';
import CustomerHome from './pages/Customer/Home';
import RestaurantDashboard from './pages/Restaurant/Dashboard';
import DriverDashboard from './pages/Driver/Dashboard';
import AdminDashboard from './pages/Admin/Dashboard';

export default function App() {
  return (
    <AuthProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<CustomerHome />} />
          <Route path="/restaurant" element={<RestaurantDashboard />} />
          <Route path="/driver" element={<DriverDashboard />} />
          <Route path="/admin" element={<AdminDashboard />} />
        </Routes>
      </Layout>
    </AuthProvider>
  );
}
