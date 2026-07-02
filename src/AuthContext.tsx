import React, { createContext, useContext, useState, useEffect } from 'react';

interface AuthContextType {
  userRole: string;
  profileName: string;
  accountId: string;
  loading: boolean;
  setAuthData: (role: string, name: string, id: string) => void;
  clearAuth: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [userRole, setUserRole] = useState<string>('');
  const [profileName, setProfileName] = useState<string>('');
  const [accountId, setAccountId] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const verifySessionOnBoot = async () => {
      try {
        // 🛡️ Requests validation of the httpOnly cookie from the production backend
        const res = await fetch('https://barangay-engineer-s-hill.onrender.com/api/auth/admin/refresh', { 
          method: 'POST',
          credentials: 'include' // Crucial for cross-site cookie transit
        });
        
        if (res.ok) {
          const data = await res.json();
          // Map backend session data down to active components
          setUserRole(data.role || 'staff');

          // 🔒 Keep the persisted admin session role in sync with the server's
          // re-evaluated term. If a term lapsed mid-session, the backend now
          // reports role 'restricted'; reflect it so the lock screen appears.
          try {
            const raw = localStorage.getItem('admin_session');
            if (raw && data.role) {
              const session = JSON.parse(raw);
              if (session.role !== data.role) {
                session.role = data.role;
                if (session.profile) {
                  session.profile.term_status = data.term_status || session.profile.term_status;
                  session.profile.official_status = data.official_status || session.profile.official_status;
                }
                localStorage.setItem('admin_session', JSON.stringify(session));
              }
            }
          } catch {
            // best-effort sync; ignore parse failures
          }
        } else {
          clearAuth();
        }
      } catch (err) {
        console.error('[AUTH CONTEXT] Background session validation failed:', err);
        clearAuth();
      } finally {
        setLoading(false);
      }
    };

    verifySessionOnBoot();
  }, []);

  const setAuthData = (role: string, name: string, id: string) => {
    setUserRole(role);
    setProfileName(name);
    setAccountId(id);
  };

  const clearAuth = () => {
    setUserRole('');
    setProfileName('');
    setAccountId('');
  };

  return (
    <AuthContext.Provider value={{ userRole, profileName, accountId, loading, setAuthData, clearAuth }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be executed within the structural boundaries of an AuthProvider tree.');
  }
  return context;
};
