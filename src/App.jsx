import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import Login from './pages/Login';
import LeadLanding from './pages/public/LeadLanding';
import OriginatorLanding from './pages/public/OriginatorLanding';
import SubscriberSignup from './pages/public/SubscriberSignup';
import Dashboard from './pages/Dashboard';
import { AuthProvider, useAuth } from './contexts/AuthContext';

import StandaloneAnalysis from './pages/StandaloneAnalysis';
import StandaloneManagement from './pages/StandaloneManagement';
import StandaloneRecharge from './pages/StandaloneRecharge';
import { UIProvider } from './contexts/UIContext';
import { BrandingProvider } from './contexts/BrandingContext';

/**
 * `/assine` e `/originador` eram dois formulários de adesão paralelos, cada um
 * criando o assinante de um jeito incompatível (status divergente, CPF ora com
 * ora sem máscara, endereço ora em jsonb ora em colunas) e nenhum deles
 * alcançável a partir do site. `/contrato` é o único caminho agora; estas rotas
 * sobrevivem só para não quebrar link antigo, repassando os parâmetros.
 */
const LegacySignupRedirect = () => {
    const location = useLocation();
    const params = new URLSearchParams(location.search);

    // O link de convite antigo mandava o id do originador em `id`.
    if (params.has('id') && !params.has('originator_id')) {
        params.set('originator_id', params.get('id'));
        params.delete('id');
    }

    const qs = params.toString();
    return <Navigate to={`/contrato${qs ? `?${qs}` : ''}`} replace />;
};

const ProtectedRoute = () => {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) {
    return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`} replace />;
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
              <Route path="/cadastro" element={<OriginatorLanding />} />
              <Route path="/cadastro-parceiro" element={<OriginatorLanding />} />
              <Route path="/contrato" element={<SubscriberSignup />} />
              <Route path="/assine" element={<LegacySignupRedirect />} />
              <Route path="/originador" element={<LegacySignupRedirect />} />
              <Route element={<ProtectedRoute />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/analisedeconta" element={<StandaloneAnalysis />} />
                <Route path="/analisedeconta/gerenciar" element={<StandaloneManagement />} />
                <Route path="/analisedeconta/recarga" element={<StandaloneRecharge />} />
              </Route>

              <Route path="/" element={<Navigate to="/analisedeconta" replace />} />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </AuthProvider>
        </BrandingProvider>
      </UIProvider>
    </BrowserRouter>
  );
}

export default App;
