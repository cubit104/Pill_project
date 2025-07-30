import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from '../types';

interface AuthContextType {
  user: User | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);

  // Simple mock authentication - in a real app, this would connect to a backend
  const mockUsers = [
    { id: '1', username: 'doctor1', password: 'password123', role: 'doctor' as const },
    { id: '2', username: 'nurse1', password: 'password123', role: 'nurse' as const },
    { id: '3', username: 'tech1', password: 'password123', role: 'technician' as const },
  ];

  useEffect(() => {
    // Check for stored session
    const storedUser = localStorage.getItem('cardiac-monitor-user');
    if (storedUser) {
      try {
        const userData = JSON.parse(storedUser);
        setUser({ ...userData, isAuthenticated: true });
      } catch (error) {
        localStorage.removeItem('cardiac-monitor-user');
      }
    }
  }, []);

  const login = async (username: string, password: string): Promise<boolean> => {
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const foundUser = mockUsers.find(u => u.username === username && u.password === password);
    
    if (foundUser) {
      const authUser: User = {
        id: foundUser.id,
        username: foundUser.username,
        role: foundUser.role,
        isAuthenticated: true
      };
      
      setUser(authUser);
      localStorage.setItem('cardiac-monitor-user', JSON.stringify(authUser));
      return true;
    }
    
    return false;
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('cardiac-monitor-user');
  };

  const isAuthenticated = user?.isAuthenticated || false;

  const value = {
    user,
    login,
    logout,
    isAuthenticated
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};