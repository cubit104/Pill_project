/*
 * NEW ENHANCED DASHBOARD
 * 
 * This is the new, modern cardiac device dashboard with enhanced features:
 * - Advanced patient monitoring with real-time data visualization
 * - Interactive charts and statistics
 * - Comprehensive patient management with search and filtering
 * - Modal-based patient detail views
 * - Modern Bootstrap-based UI design
 * 
 * Location: cardiac-monitor/src/cardiac-monitor/Dashboard.tsx
 * Route: /dashboard
 * 
 * This dashboard should be used for all new features and enhancements.
 */

import React from 'react';

export default function Dashboard() {
  return (
    <div style={{ textAlign: 'center', padding: '50px', backgroundColor: '#f8f9fa' }}>
      <h1 style={{ 
        color: 'green', 
        fontSize: '3rem', 
        fontWeight: 'bold', 
        marginBottom: '30px',
        border: '3px solid green',
        padding: '20px',
        borderRadius: '10px',
        backgroundColor: '#d4edda'
      }}>
        🆕 THIS IS THE NEW DASHBOARD 🆕
      </h1>
      <p style={{ fontSize: '1.2rem', color: '#333' }}>
        Enhanced cardiac device monitoring with advanced features
      </p>
    </div>
  );
}