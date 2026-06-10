import React, { useEffect } from 'react';
import AppRoutes from './AppRoutes';
import { CaptchaModal } from './components/Captcha/CaptchaModal';
import { ThemeManager } from './components/UI/ThemeManager';
import { AuthProvider } from './context/AuthContext'; // 🛡️ INTEGRATED: Volatile RAM auth store
import './App.css';

const App: React.FC = () => {
  useEffect(() => {
    ThemeManager.restoreFromSession();
  }, []);

  return (
    <AuthProvider>
      <div className="APP_ROOT">
        <CaptchaModal />
        <AppRoutes />
      </div>
    </AuthProvider>
  );
};

export default App;
