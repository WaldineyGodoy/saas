import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import Login from './pages/Login';
import LeadSimulation from './pages/LeadSimulation';
import LeadSignup from './pages/LeadSignup';
import Dashboard from './pages/Dashboard';
import { AuthProvider, useAuth } from './contexts/AuthContext';

import ReferralLanding from './pages/ReferralLanding';

const ProtectedRoute = () => {
  const { user } = useAuth();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
};

import { UIProvider } from './contexts/UIContext';

function App() {
  return (
    <BrowserRouter>
      <UIProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/simulacao" element={<LeadSimulation />} />
            <Route path="/assine" element={<LeadSignup />} />
            <Route path="/originador" element={<ReferralLanding />} />

            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<Dashboard />} />
            </Route>

            <Route path="/" element={<Navigate to="/login" replace />} />
          </Routes>
        </AuthProvider>
      </UIProvider>
    </BrowserRouter>
  );
}

export default App;
