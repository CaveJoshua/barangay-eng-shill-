import React, { useEffect } from 'react';
import AppRoutes from './AppRoutes';
import { CaptchaModal } from './components/Captcha/CaptchaModal';
import { ThemeManager } from './components/UI/ThemeManager';
import './App.css';

const App: React.FC = () => {
  useEffect(() => {
    ThemeManager.restoreFromSession();
  }, []);

  return (
    <div className="APP_ROOT">
      <CaptchaModal />
      <AppRoutes />
    </div>
  );
};

export default App;