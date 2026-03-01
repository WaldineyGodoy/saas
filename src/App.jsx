import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import Login from './pages/Login';
import LeadLanding from './pages/public/LeadLanding';
import OriginatorLanding from './pages/public/OriginatorLanding';
import SubscriberSignup from './pages/public/SubscriberSignup';
import LeadSignup from './pages/LeadSignup';
import Dashboard from './pages/Dashboard';
import { AuthProvider, useAuth } from './contexts/AuthContext';

import ReferralLanding from './pages/ReferralLanding';
import { UIProvider } from './contexts/UIContext';
import { BrandingProvider } from './contexts/BrandingContext';

const ProtectedRoute = () => {
  const { user } = useAuth();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
};

function App() {
  return (
    <BrowserRouter>
      <UIProvider>
        <BrandingProvider>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/simulacao" element={<LeadLanding />} />
              <Route path="/cadastro-parceiro" element={<OriginatorLanding />} />
              <Route path="/assine" element={<LeadSignup />} />
              <Route path="/originador" element={<ReferralLanding />} />
              <Route path="/contrato" element={<SubscriberSignup />} />

              <Route element={<ProtectedRoute />}>
                <Route path="/dashboard" element={<Dashboard />} />
              </Route>

              <Route path="/" element={<Navigate to="/login" replace />} />
            </Routes>
          </AuthProvider>
        </BrandingProvider>
      </UIProvider>
    </BrowserRouter>
  );
}

export default App;
