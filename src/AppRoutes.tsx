import React, { useState, useEffect, useCallback } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from 'react-router-dom';

// Import your existing components
import Dashboard from './components/UI/Administration_GUI/Dashboard';
import TermEndedLock from './components/UI/Administration_GUI/TermEndedLock';
import Community from './components/UI/Community_GUI/Community';
import Community_Dashboard from './components/UI/Community_GUI/CommunityDashboard';
import OfficialLogin from './components/buttons/Official_Login_modal';
import { API_BASE_URL } from './components/UI/api';
import { ThemeManager } from './components/UI/ThemeManager';

interface AuthContextType {
  selectedPortal: 'admin' | 'community' | null;
  setSelectedPortal: (portal: 'admin' | 'community' | null) => void;
  user: any;
  setUser: (user: any) => void;
}

export const AuthContext = React.createContext<AuthContextType | undefined>(
  undefined
);

export const usePortal = () => {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error('usePortal must be used within Router');
  }
  return context;
};

// ✅ Session Timeout Manager
const SessionManager: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const location = useLocation();

  useEffect(() => {
    if (location.pathname === '/' || location.pathname === '/officialslogin') {
      return;
    }

    let lastActivityTime = Date.now();

    const getTimeoutMs = () => {
      if (location.pathname.startsWith('/resident')) return 3000000; // 50 mins
      if (location.pathname.startsWith('/admin')) return 14400000; // 4 hours
      return 900000;
    };

    const updateActivity = () => {
      lastActivityTime = Date.now();
    };

    const intervalId = setInterval(() => {
      const elapsed = Date.now() - lastActivityTime;
      const timeout = getTimeoutMs();

      if (elapsed >= timeout) {
        const hasAdminSession = !!localStorage.getItem('admin_session');
        const hasResidentSession = !!localStorage.getItem('resident_session');

        if (hasAdminSession || hasResidentSession) {
          alert('Your session has expired due to inactivity. Please log in again.');
          onLogout();
        }
      }
    }, 30000);

    const activityEvents = [
      'mousedown',
      'mousemove',
      'keydown',
      'scroll',
      'touchstart',
    ];

    activityEvents.forEach((event) => {
      document.addEventListener(event, updateActivity, { passive: true });
    });

    return () => {
      clearInterval(intervalId);
      activityEvents.forEach((event) => {
        document.removeEventListener(event, updateActivity);
      });
    };
  }, [location.pathname, onLogout]);

  return null;
};

// 🛡️ State Synchronizer
const StateSynchronizer: React.FC<{
  user: any;
  setUser: (user: any) => void;
  setSelectedPortal: (portal: 'admin' | 'community' | null) => void;
}> = ({ user, setUser, setSelectedPortal }) => {
  const location = useLocation();

  useEffect(() => {
    const adminSession = localStorage.getItem('admin_session');
    const residentSession = localStorage.getItem('resident_session');

    if (adminSession && !user) {
      try {
        setUser(JSON.parse(adminSession));
        setSelectedPortal('admin');
      } catch {
        localStorage.removeItem('admin_session');
      }
    } else if (residentSession && !user) {
      try {
        setUser(JSON.parse(residentSession));
        setSelectedPortal('community');
      } catch {
        localStorage.removeItem('resident_session');
      }
    }
  }, [location.pathname, user, setUser, setSelectedPortal]);

  return null;
};

// ✅ Routes wrapper
const RoutesWithLogout: React.FC<{
  user: any;
  selectedPortal: 'admin' | 'community' | null;
  setUser: (user: any) => void;
  setSelectedPortal: (portal: 'admin' | 'community' | null) => void;
  handleFullLogout: () => void;
}> = ({
  user,
  setUser,
  setSelectedPortal,
  handleFullLogout,
}) => {
  const navigate = useNavigate();

  const logoutAndRedirect = useCallback(() => {
    handleFullLogout();
    navigate('/', { replace: true });
  }, [handleFullLogout, navigate]);

  const goToCommunityDashboard = useCallback(
    (userData?: any) => {
      if (userData) {
        setUser(userData);
        localStorage.setItem('resident_session', JSON.stringify(userData));
      }
      setSelectedPortal('community');
      localStorage.setItem('selectedPortal', 'community');
      navigate('/resident', { replace: true });
    },
    [navigate, setUser, setSelectedPortal]
  );

  const getAdminUser = () => {
    if (user) return user;
    const session = localStorage.getItem('admin_session');
    return session ? JSON.parse(session) : null;
  };

  return (
    <>
      <SessionManager onLogout={logoutAndRedirect} />
      <StateSynchronizer
        user={user}
        setUser={setUser}
        setSelectedPortal={setSelectedPortal}
      />
      <Routes>
        
        <Route
          path="/"
          element={<Community onLoginSuccess={goToCommunityDashboard} />}
        />

        <Route path="/officialslogin" element={<OfficialLogin />} />

        {/* 🛡️ ADDED /* SO NESTED VIEWS SURVIVE REFRESH */}
        <Route
          path="/admin/dashboard/*"
          element={
            localStorage.getItem('admin_session') ? (
              // 🔒 Non-Active status → role downgraded to 'restricted' → show the
              // locked notice instead of the dashboard (backend also 403s every admin call).
              getAdminUser()?.role === 'restricted' ? (
                <TermEndedLock onLogout={logoutAndRedirect} user={getAdminUser()} />
              ) : (
                <Dashboard
                  onLogout={logoutAndRedirect}
                  user={getAdminUser()}
                />
              )
            ) : (
              <Navigate to="/officialslogin" replace />
            )
          }
        />

        {/* 🛡️ ADDED /* SO NESTED VIEWS (Documents/Incidents) SURVIVE REFRESH */}
        <Route
          path="/resident/*"
          element={
            localStorage.getItem('resident_session') ? (
              <Community_Dashboard onLogout={logoutAndRedirect} />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
};

const AppRoutes = () => {
  const [selectedPortal, setSelectedPortal] = useState<
    'admin' | 'community' | null
  >(null);
  const [user, setUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const adminSession = localStorage.getItem('admin_session');
    const residentSession = localStorage.getItem('resident_session');
    const savedPortal = localStorage.getItem('selectedPortal');

    if (adminSession) {
      try { setUser(JSON.parse(adminSession)); setSelectedPortal('admin'); }
      catch { localStorage.removeItem('admin_session'); }
    } else if (residentSession) {
      try { setUser(JSON.parse(residentSession)); setSelectedPortal('community'); }
      catch { localStorage.removeItem('resident_session'); }
    } else if (savedPortal) {
      setSelectedPortal(savedPortal as 'admin' | 'community');
    }

    ThemeManager.restoreFromSession();
    setIsLoading(false);
  }, []);

  const handleFullLogout = useCallback(async () => {
    setUser(null);
    setSelectedPortal(null);

    localStorage.clear();
    sessionStorage.clear();

    ThemeManager.resetAll();

    await Promise.allSettled([
      fetch(`${API_BASE_URL}/admin/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      }),
      fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      }),
    ]);
  }, []);

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          backgroundColor: '#f9fafb',
        }}
      >
        <div
          style={{
            fontSize: '18px',
            color: '#666',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px',
          }}
        >
          <i
            className="fas fa-spinner fa-spin"
            style={{ fontSize: '32px' }}
          ></i>
          Loading...
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider
      value={{ selectedPortal, setSelectedPortal, user, setUser }}
    >
      <Router>
        <RoutesWithLogout
          user={user}
          selectedPortal={selectedPortal}
          setUser={setUser}
          setSelectedPortal={setSelectedPortal}
          handleFullLogout={handleFullLogout}
        />
      </Router>
    </AuthContext.Provider>
  );
};

export default AppRoutes;