import React, { useState, useEffect, useCallback } from 'react';
import Login from './components/UI/Administration_GUI/Login';
import Dashboard from './components/UI/Administration_GUI/Dashboard'; 
import Community from './components/UI/Community_GUI/Community'; 
import Community_Dashboard from './components/UI/Community_GUI/CommunityDashboard'; 
import { CaptchaModal } from './components/UI/Community_GUI/CaptchaModal';
import { API_BASE_URL } from './components/UI/api'; 
import './App.css';

type AppView = 'login' | 'admin' | 'community' | 'community_dash';

const App: React.FC = () => {
  
  const [user, setUser] = useState<any>(() => {
    const savedAdmin    = localStorage.getItem('admin_session');
    const savedResident = localStorage.getItem('resident_session');
    return savedAdmin ? JSON.parse(savedAdmin) : savedResident ? JSON.parse(savedResident) : null;
  });

  const [currentView, setCurrentView] = useState<AppView>(() => {
    const savedView         = localStorage.getItem('app_current_view') as AppView | null;
    const hasAdminSession   = !!localStorage.getItem('admin_session');
    const hasResidentSession = !!localStorage.getItem('resident_session');

    if (savedView === 'community_dash' && hasResidentSession) return 'community_dash';
    if (savedView === 'admin' && hasAdminSession) return 'admin';
    if (savedView === 'community') return 'community';
    if (hasResidentSession) return 'community_dash';
    if (hasAdminSession) return 'admin';
    return 'login';
  });

  useEffect(() => {
    if (currentView === 'admin' && !user) setCurrentView('login');
    if (currentView === 'community_dash' && !user) setCurrentView('community');
  }, [currentView, user]);

  useEffect(() => {
    const savedTheme = localStorage.getItem('sb_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, []);

  useEffect(() => {
    localStorage.setItem('app_current_view', currentView);
  }, [currentView]);

  const handleLogout = useCallback(async (targetView: AppView = 'login') => {
    localStorage.removeItem('resident_session');
    localStorage.removeItem('admin_session'); 
    localStorage.removeItem('app_current_view'); 
    localStorage.removeItem('auth_token'); 
    localStorage.removeItem('user_role'); 
    localStorage.removeItem('account_id'); 
    localStorage.removeItem('profile_id'); 
    localStorage.removeItem('admin_active_tab'); 
    localStorage.removeItem('resident_active_tab');

    setUser(null); 
    setCurrentView(targetView);

    try {
      await fetch(`${API_BASE_URL}/admin/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err) {
      console.error("Failed to notify backend of logout:", err);
    }
  }, []);

  useEffect(() => {
    if (currentView === 'login') return;

    let lastActivityTime = Date.now();

    const getTimeoutMs = () => currentView === 'community' ? 900000 : 14400000;

    const updateActivity = () => { lastActivityTime = Date.now(); };

    const intervalId = setInterval(() => {
      if (Date.now() - lastActivityTime >= getTimeoutMs()) {
        if (currentView === 'admin' || currentView === 'community_dash') {
          alert("Your session has expired due to inactivity. Please log in again.");
        }
        handleLogout('login');
      }
    }, 30000);

    const activityEvents = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];
    activityEvents.forEach(e => document.addEventListener(e, updateActivity, { passive: true }));

    return () => {
      clearInterval(intervalId);
      activityEvents.forEach(e => document.removeEventListener(e, updateActivity));
    };
  }, [currentView, handleLogout]);
  
  // ✅ FIXED: Properly saves the full userData object as admin_session
  const handlePortalSelection = (target: string, userData?: any) => {
    if (userData) {
      setUser(userData);

      if (target === 'admin') {
        // userData is now the full object {username, role, profile, account_id}
        // profile.profileName = real full name, profile.position = real position
        localStorage.setItem('admin_session', JSON.stringify(userData));
      } else if (target === 'community_dash') {
        localStorage.setItem('resident_session', JSON.stringify(userData));
      }
    }
    setCurrentView(target as AppView);
  };

  const goToCommunityDashboard = (userData?: any) => {
    if (userData) {
      setUser(userData);
      localStorage.setItem('resident_session', JSON.stringify(userData));
    }
    setCurrentView('community_dash');
  };

  return (
    <div className="APP_ROOT">
      <CaptchaModal />
      
      {currentView === 'login' && (
        <Login onSelectPortal={handlePortalSelection} />
      )}
      {currentView === 'admin' && (
        <Dashboard onLogout={() => handleLogout('login')} user={user} /> 
      )}
      {currentView === 'community' && (
        <Community onExit={() => handleLogout('login')} onLoginSuccess={goToCommunityDashboard} />
      )}
      {currentView === 'community_dash' && (
        <Community_Dashboard onLogout={() => handleLogout('community')} />
      )}
    </div>
  );
};

export default App;