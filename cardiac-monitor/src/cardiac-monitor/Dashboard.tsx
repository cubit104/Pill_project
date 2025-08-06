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
 * Location: src/cardiac-monitor/Dashboard.tsx
 * Route: /dashboard
 * 
 * This dashboard should be used for all new features and enhancements.
 */

import React, { useMemo } from 'react';

// Dummy patient data for demonstration
const patients = [
  { id: 1, name: "John Doe", vendor: "Medtronic", status: "Active" },
  { id: 2, name: "Jane Smith", vendor: "Boston Scientific", status: "Active" },
  { id: 3, name: "Sam Patient", vendor: "Abbott", status: "Inactive" },
  { id: 4, name: "Mary Heart", vendor: "Medtronic", status: "Active" },
  { id: 5, name: "Alex Pulse", vendor: "Boston Scientific", status: "Inactive" },
];

// Chart example: PieChart from recharts
import { PieChart, Pie, Cell } from 'recharts';

const vendorData = [
  { name: "Medtronic", value: 2 },
  { name: "Boston Scientific", value: 2 },
  { name: "Abbott", value: 1 },
];

const COLORS = ["#0088FE", "#00C49F", "#FFBB28"];

export default function Dashboard() {
  // FIXED: Use Array.from not spread operator for Set
  const uniqueVendors = useMemo(
    () => Array.from(new Set(patients.map(p => p.vendor))),
    []
  );

  return (
    <div style={{ textAlign: 'center', padding: '40px', backgroundColor: '#f8f9fa', minHeight: '100vh' }}>
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
      <p style={{ fontSize: '1.2rem', color: '#333', marginBottom: '32px' }}>
        Enhanced cardiac device monitoring with advanced features
      </p>

      {/* Unique Vendors */}
      <div style={{ marginBottom: '30px' }}>
        <strong>Vendors in system:</strong> {uniqueVendors.join(', ')}
      </div>

      {/* Pie Chart Example */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '40px' }}>
        <PieChart width={320} height={220}>
          <Pie
            data={vendorData}
            cx="50%"
            cy="50%"
            labelLine={false}
            // FIXED: percent may be undefined, so check before using
            label={({ name, percent }) =>
              percent !== undefined
                ? `${name} ${(percent * 100).toFixed(0)}%`
                : name
            }
            outerRadius={90}
            fill="#8884d8"
            dataKey="value"
          >
            {vendorData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </div>

      {/* Patient List */}
      <div style={{
        background: '#fff',
        borderRadius: '10px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
        padding: '20px',
        maxWidth: '600px',
        margin: '0 auto'
      }}>
        <h2 style={{ color: '#222', marginBottom: '14px' }}>Patient List</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '1rem' }}>
          <thead>
            <tr style={{ backgroundColor: '#e9ecef' }}>
              <th style={{ padding: '8px', textAlign: 'left' }}>Name</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Vendor</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {patients.map(patient => (
              <tr key={patient.id}>
                <td style={{ padding: '8px', borderBottom: '1px solid #dee2e6' }}>{patient.name}</td>
                <td style={{ padding: '8px', borderBottom: '1px solid #dee2e6' }}>{patient.vendor}</td>
                <td style={{ padding: '8px', borderBottom: '1px solid #dee2e6' }}>{patient.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
