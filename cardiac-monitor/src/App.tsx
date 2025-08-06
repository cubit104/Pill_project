import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { DeviceDataProvider } from './contexts/DeviceDataContext';
import Homepage from './components/Homepage';
import Login from './pages/Login';
import DashboardNew from './cardiac-monitor/Dashboard';
import DashboardOld from './pages/Dashboard';
import ProtectedRoute from './components/ProtectedRoute';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';
import DashboardNew from './src/cardiac-monitor/Dashboard';
import DashboardOld from './src/pages/Dashboard';
function App() {
  return (
    <AuthProvider>
      <DeviceDataProvider>
        <Router>
          <div className="App">
            <Routes>
              <Route path="/" element={<Homepage />} />
              <Route path="/login" element={<Login />} />
              <Route 
                path="/dashboard" 
                element={
                  <ProtectedRoute>
                    <DashboardNew />
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="/dashboard-old" 
                element={
                  <ProtectedRoute>
                    <DashboardOld />
                  </ProtectedRoute>
                } 
              />
            </Routes>
          </div>
        </Router>
      </DeviceDataProvider>
    </AuthProvider>
  );
}

export default App;
