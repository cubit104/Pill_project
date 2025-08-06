import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Dashboard from '../cardiac-monitor/Dashboard';

// Mock recharts since it requires canvas/SVG that might not be available in test environment
jest.mock('recharts', () => ({
  PieChart: () => <div data-testid="pie-chart" />,
  Pie: () => <div />,
  Cell: () => <div />,
  BarChart: () => <div data-testid="bar-chart" />,
  Bar: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
  Legend: () => <div />
}));

describe('Dashboard Component', () => {
  test('renders dashboard title and subtitle', () => {
    render(<Dashboard />);
    expect(screen.getByText(/Cardiac Device Dashboard/i)).toBeInTheDocument();
    expect(screen.getByText(/Monitor and manage cardiac device patients/i)).toBeInTheDocument();
  });

  test('renders all statistics cards', () => {
    render(<Dashboard />);
    expect(screen.getByText(/Total Patients/i)).toBeInTheDocument();
    expect(screen.getByText(/Active Monitoring/i)).toBeInTheDocument();
    expect(screen.getByText(/Overdue Checkups/i)).toBeInTheDocument();
    expect(screen.getByText(/Compliance Rate/i)).toBeInTheDocument();
  });

  test('displays correct patient counts', () => {
    render(<Dashboard />);
    // Should show 6 total patients based on mock data
    expect(screen.getByText('6')).toBeInTheDocument();
    // Should show patient statistics
    expect(screen.getByText(/Patient List \(6 patients\)/i)).toBeInTheDocument();
  });

  test('renders patient table with all required columns', () => {
    render(<Dashboard />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Vendor')).toBeInTheDocument();
    expect(screen.getByText('Device Type')).toBeInTheDocument();
    expect(screen.getByText('Provider')).toBeInTheDocument();
    expect(screen.getByText('Anticoagulated')).toBeInTheDocument();
    expect(screen.getByText('Labels')).toBeInTheDocument();
    expect(screen.getByText('Primary Subscriber ID')).toBeInTheDocument();
    expect(screen.getByText('Model Name')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
  });

  test('displays mock patient data in table', () => {
    render(<Dashboard />);
    // First page should show first 5 patients
    expect(screen.getByText('John Smith')).toBeInTheDocument();
    expect(screen.getByText('Sarah Wilson')).toBeInTheDocument();
    expect(screen.getByText('Michael Chen')).toBeInTheDocument();
    expect(screen.getByText('Emma Rodriguez')).toBeInTheDocument();
    expect(screen.getByText('David Brown')).toBeInTheDocument();
    // Lisa Anderson would be on page 2, so should not be visible initially
    expect(screen.queryByText('Lisa Anderson')).not.toBeInTheDocument();
  });

  test('renders search input', () => {
    render(<Dashboard />);
    expect(screen.getByPlaceholderText(/Search patients, ID, or provider/i)).toBeInTheDocument();
  });

  test('renders filter dropdowns', () => {
    render(<Dashboard />);
    expect(screen.getByDisplayValue('All Status')).toBeInTheDocument();
    expect(screen.getByDisplayValue('All Vendors')).toBeInTheDocument();
  });

  test('renders charts containers', () => {
    render(<Dashboard />);
    expect(screen.getByText(/Patient Status Distribution/i)).toBeInTheDocument();
    expect(screen.getByText(/Patients by Vendor/i)).toBeInTheDocument();
    expect(screen.getAllByTestId('responsive-container')).toHaveLength(2);
  });

  test('search functionality filters patients', () => {
    render(<Dashboard />);
    const searchInput = screen.getByPlaceholderText(/Search patients, ID, or provider/i);
    
    fireEvent.change(searchInput, { target: { value: 'John' } });
    
    expect(screen.getByText('John Smith')).toBeInTheDocument();
    // Other patients should not be visible in the first page
    expect(screen.queryByText('Sarah Wilson')).not.toBeInTheDocument();
  });

  test('status filter works correctly', () => {
    render(<Dashboard />);
    const statusFilter = screen.getByDisplayValue('All Status');
    
    fireEvent.change(statusFilter, { target: { value: 'overdue' } });
    
    // Should show overdue patients
    expect(screen.getByText('Michael Chen')).toBeInTheDocument();
    expect(screen.getByText('Lisa Anderson')).toBeInTheDocument();
  });

  test('clear filters button works', () => {
    render(<Dashboard />);
    const searchInput = screen.getByPlaceholderText(/Search patients, ID, or provider/i);
    const clearButton = screen.getByText(/Clear/i);
    
    fireEvent.change(searchInput, { target: { value: 'John' } });
    fireEvent.click(clearButton);
    
    expect(searchInput).toHaveValue('');
  });

  test('patient row click opens modal', () => {
    render(<Dashboard />);
    const patientRow = screen.getByText('John Smith').closest('tr');
    
    if (patientRow) {
      fireEvent.click(patientRow);
      expect(screen.getByText('Patient Details')).toBeInTheDocument();
    }
  });

  test('pagination shows correct information', () => {
    render(<Dashboard />);
    expect(screen.getByText(/Showing 1 to 5 of 6 patients/i)).toBeInTheDocument();
  });
});