import React, { useState, useEffect, useCallback } from 'react';
import Login from './components/UI/Administration_GUI/Login';
import Dashboard from './components/UI/Administration_GUI/Dashboard'; 
import Community from './components/UI/Community_GUI/Community'; 
import Community_Dashboard from './components/UI/Community_GUI/Community_Dashboard'; 

// 🛡️ IMPORT THE CAPTCHA MODAL
import { CaptchaModal } from './components/UI/Community_GUI/Captcha_model';

import { API_BASE_URL } from './components/UI/api'; 
import './App.css';

type AppView = 'login' | 'admin' | 'community' | 'community_dash';

const App: React.FC = () => {
  
  // ── 1. UNIFIED USER STATE ──
  const [user, setUser] = useState<any>(() => {
    // Check both potential sessions to populate the user
    const savedAdmin = localStorage.getItem('admin_session');
    const savedResident = localStorage.getItem('resident_session');
    return savedAdmin ? JSON.parse(savedAdmin) : savedResident ? JSON.parse(savedResident) : null;
  });

  // ── 2. SECURE VIEW INITIALIZATION ──
  const [currentView, setCurrentView] = useState<AppView>(() => {
    const savedView = localStorage.getItem('app_current_view') as AppView | null;
    
    // 🛡️ THE GATEKEEPER: Prevent Ghost Pages on Refresh
    const hasAdminSession = !!localStorage.getItem('admin_session');
    const hasResidentSession = !!localStorage.getItem('resident_session');

    if (savedView === 'admin' && !hasAdminSession) {
      console.warn("Blocked unauthorized access to Admin.");
      return 'login';
    }
    if (savedView === 'community_dash' && !hasResidentSession) {
      console.warn("Blocked unauthorized access to Resident Dashboard.");
      return 'community'; // Send back to public community page
    }

    return savedView || 'login';
  });

  // ── 3. THE BOUNCER (Continuous Security Check) ──
  // If the user state ever becomes null while on a private view, kick them out.
  useEffect(() => {
    if (currentView === 'admin' && !user) {
      setCurrentView('login');
    }
    if (currentView === 'community_dash' && !user) {
      setCurrentView('community');
    }
  }, [currentView, user]);

  // ── 4. GLOBAL THEME PERSISTENCE ──
  useEffect(() => {
    const savedTheme = localStorage.getItem('sb_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, []);

  // ── 5. SYNC VIEW TO STORAGE ──
  useEffect(() => {
    localStorage.setItem('app_current_view', currentView);
  }, [currentView]);

  // ── 6. LOGOUT LOGIC (ZERO TRUST) ──
  const handleLogout = useCallback(async (targetView: AppView = 'login') => {
    
    // 🛡️ SCORCH THE EARTH FIRST: Clear storage synchronously to prevent async race conditions
    localStorage.removeItem('resident_session');
    localStorage.removeItem('admin_session'); 
    localStorage.removeItem('app_current_view'); 
    localStorage.removeItem('auth_token'); 
    localStorage.removeItem('user_role'); 
    localStorage.removeItem('account_id'); 
    localStorage.removeItem('profile_id'); 
    localStorage.removeItem('admin_active_tab'); 

    // Instantly lock down the UI
    setUser(null); 
    setCurrentView(targetView);

    // 🌐 Then tell the backend to destroy the cookie
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

  // ── 7. OPTIMIZED INACTIVITY TIMER (Dynamic per view) ──
  useEffect(() => {
    // ONLY ignore the actual login screen. Everything else gets a timeout.
    if (currentView === 'login') return;

    let lastActivityTime = Date.now();

    // ⏱️ Set different timeout rules based on where they are
    const getTimeoutMs = () => {
      if (currentView === 'community') {
        return 900000; // 15 Minutes for the public community page
      }
      return 14400000; // 4 Hours for logged-in Admin/Resident dashboards
    };

    const updateActivity = () => {
      lastActivityTime = Date.now();
    };

    const intervalId = setInterval(() => {
      if (Date.now() - lastActivityTime >= getTimeoutMs()) {
        
        // Only show the alert if they were actually logged into a secure session
        if (currentView === 'admin' || currentView === 'community_dash') {
          alert("Your session has expired due to inactivity. Please log in again.");
        }
        
        // Fire the Zero Trust logout and send them to the login gate
        handleLogout('login');
      }
    }, 30000); // Check the clock every 30 seconds

    // List of actions that count as "activity"
    const activityEvents = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];

    activityEvents.forEach((event) => {
      document.addEventListener(event, updateActivity, { passive: true });
    });

    return () => {
      clearInterval(intervalId);
      activityEvents.forEach((event) => {
        document.removeEventListener(event, updateActivity);
      });
    };
  }, [currentView, handleLogout]);
  
  // ── 8. TRANSITION HANDLERS ──
  const handlePortalSelection = (target: string, userData?: any) => {
    if (userData) {
      setUser(userData);
      // Save to appropriate storage based on target
      if (target === 'admin') {
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
      
      {/* 🛡️ THE GLOBAL SECURITY MODAL - Always Active */}
      <CaptchaModal />
      
      {currentView === 'login' && (
        <Login onSelectPortal={handlePortalSelection} />
      )}

      {currentView === 'admin' && (
        <Dashboard 
          onLogout={() => handleLogout('login')} 
          user={user} 
        /> 
      )}

      {currentView === 'community' && (
        <Community 
          onExit={() => handleLogout('login')} 
          onLoginSuccess={goToCommunityDashboard} 
        />
      )}

      {currentView === 'community_dash' && (
        <Community_Dashboard 
          onLogout={() => handleLogout('community')} 
        />
      )}

    </div>
  );
};

export default App;