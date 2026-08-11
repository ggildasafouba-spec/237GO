import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import Rides from './pages/Rides';
import Deliveries from './pages/Deliveries';
import Drivers from './pages/Drivers';
import Merchants from './pages/Merchants';
import Finance from './pages/Finance';
import Settings from './pages/Settings';
import Login from './pages/Login';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('admin_token');
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Layout>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/users" element={<Users />} />
                  <Route path="/rides" element={<Rides />} />
                  <Route path="/deliveries" element={<Deliveries />} />
                  <Route path="/drivers" element={<Drivers />} />
                  <Route path="/merchants" element={<Merchants />} />
                  <Route path="/finance" element={<Finance />} />
                  <Route path="/settings" element={<Settings />} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
