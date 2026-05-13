import React, { useEffect } from 'react';
import AppRoutes from './AppRoutes';
import { CaptchaModal } from './components/Captcha/CaptchaModal';
import './App.css';

const App: React.FC = () => {
  useEffect(() => {
    const savedTheme = localStorage.getItem('sb_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, []);

  return (
    <div className="APP_ROOT">
      <CaptchaModal />
      <AppRoutes />
    </div>
  );
};

export default App;