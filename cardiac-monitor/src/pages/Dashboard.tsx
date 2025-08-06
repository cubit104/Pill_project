/*
 * OLD LEGACY DASHBOARD
 * 
 * This is the legacy cardiac device dashboard maintained for backward compatibility:
 * - Original dashboard implementation
 * - Basic patient monitoring features
 * - Uses AuthContext and DeviceDataContext
 * - Original Bootstrap-based UI
 * 
 * Location: cardiac-monitor/src/pages/Dashboard.tsx
 * Route: /dashboard-old
 * 
 * This dashboard is kept for compatibility but new features should be added to the new dashboard.
 * Consider migrating functionality to the new dashboard when possible.
 */

import React from 'react';

export default function Dashboard() {
  return (
    <div style={{ textAlign: 'center', padding: '50px', backgroundColor: '#f8f9fa' }}>
      <h1 style={{ 
        color: 'red', 
        fontSize: '3rem', 
        fontWeight: 'bold', 
        marginBottom: '30px',
        border: '3px solid red',
        padding: '20px',
        borderRadius: '10px',
        backgroundColor: '#f8d7da'
      }}>
        🔙 THIS IS THE OLD DASHBOARD 🔙
      </h1>
      <p style={{ fontSize: '1.2rem', color: '#333' }}>
        Legacy cardiac device monitoring system
      </p>
    </div>
  );
}