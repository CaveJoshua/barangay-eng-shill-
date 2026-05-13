import React, { useState, useEffect, useCallback } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from 'react-router-dom';

// Import your existing components (Login portal is intentionally removed)
import Dashboard from './components/UI/Administration_GUI/Dashboard';
import Community from './components/UI/Community_GUI/Community';
import Community_Dashboard from './components/UI/Community_GUI/CommunityDashboard';
import OfficialLogin from './components/buttons/Official_Login_modal';
import { API_BASE_URL } from './components/UI/api';

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
    // Ignore timeout logic on public pages
    if (location.pathname === '/' || location.pathname === '/officialslogin') {
      return;
    }

    let lastActivityTime = Date.now();

    const getTimeoutMs = () => {
      if (location.pathname.startsWith('/resident')) return 900000; // 15 mins
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

// 🛡️ THE FIX: State Synchronizer
// Keeps React state in sync with localStorage on every navigation.
const StateSynchronizer: React.FC<{
  user: any;
  setUser: (user: any) => void;
  setSelectedPortal: (portal: 'admin' | 'community' | null) => void;
}> = ({ user, setUser, setSelectedPortal }) => {
  const location = useLocation();

  useEffect(() => {
    const adminSession = localStorage.getItem('admin_session');
    const residentSession = localStorage.getItem('resident_session');

    // If localStorage has session data but state is null, sync it!
    if (adminSession && !user) {
      setUser(JSON.parse(adminSession));
      setSelectedPortal('admin');
    } else if (residentSession && !user) {
      setUser(JSON.parse(residentSession));
      setSelectedPortal('community');
    }
  }, [location.pathname, user, setUser, setSelectedPortal]);

  return null;
};

// ✅ Routes wrapper (must be inside Router)
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

  // ✅ Community login success
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

  // 🛡️ Helper: Get user (from state OR localStorage as fallback)
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
        
        {/* 🎯 MAIN LANDING PAGE: Community Portal */}
        <Route
          path="/"
          element={<Community onLoginSuccess={goToCommunityDashboard} />}
        />

        {/* ✅ Official Admin Login (Public) */}
        <Route path="/officialslogin" element={<OfficialLogin />} />

        {/* ✅ Admin Dashboard */}
        <Route
          path="/admin/dashboard"
          element={
            localStorage.getItem('admin_session') ? (
              <Dashboard
                onLogout={logoutAndRedirect}
                user={getAdminUser()}
              />
            ) : (
              <Navigate to="/officialslogin" replace />
            )
          }
        />

        {/* ✅ Resident Dashboard */}
        <Route
          path="/resident"
          element={
            localStorage.getItem('resident_session') ||
            localStorage.getItem('selectedPortal') === 'community' ? (
              <Community_Dashboard onLogout={logoutAndRedirect} />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />

        {/* ✅ Fallback Catch-All */}
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

  // ✅ Restore session on app load
  useEffect(() => {
    const adminSession = localStorage.getItem('admin_session');
    const residentSession = localStorage.getItem('resident_session');
    const savedPortal = localStorage.getItem('selectedPortal');

    if (adminSession) {
      setUser(JSON.parse(adminSession));
      setSelectedPortal('admin');
    } else if (residentSession) {
      setUser(JSON.parse(residentSession));
      setSelectedPortal('community');
    } else if (savedPortal) {
      setSelectedPortal(savedPortal as 'admin' | 'community');
    }

    setIsLoading(false);
  }, []);

  const handleFullLogout = useCallback(async () => {
    setUser(null);
    setSelectedPortal(null);

    // 🛡️ THE FIX: Wipe EVERYTHING from local and session storage instantly
    localStorage.clear();
    sessionStorage.clear();

    try {
      await fetch(`${API_BASE_URL}/admin/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('Failed to notify backend of logout:', err);
    }
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