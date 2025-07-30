import React, { createContext, useContext, useState, useEffect } from 'react';
import { Patient, CardiacDeviceReading, Alert, ThresholdConfig } from '../types';
import { generateMockData } from '../services/mockDataService';
import { checkAlerts } from '../services/alertService';

interface DeviceDataContextType {
  patients: Patient[];
  readings: CardiacDeviceReading[];
  alerts: Alert[];
  thresholds: ThresholdConfig;
  updateThresholds: (newThresholds: ThresholdConfig) => void;
  acknowledgeAlert: (alertId: string) => void;
  getLatestReadingForPatient: (patientId: string) => CardiacDeviceReading | undefined;
  getAlertsForPatient: (patientId: string) => Alert[];
}

const DeviceDataContext = createContext<DeviceDataContextType | undefined>(undefined);

export const useDeviceData = () => {
  const context = useContext(DeviceDataContext);
  if (context === undefined) {
    throw new Error('useDeviceData must be used within a DeviceDataProvider');
  }
  return context;
};

interface DeviceDataProviderProps {
  children: React.ReactNode;
}

export const DeviceDataProvider: React.FC<DeviceDataProviderProps> = ({ children }) => {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [readings, setReadings] = useState<CardiacDeviceReading[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [thresholds, setThresholds] = useState<ThresholdConfig>({
    heartRateMin: 60,
    heartRateMax: 100,
    batteryLevelWarning: 30,
    batteryLevelCritical: 15,
    leadImpedanceMax: 1000
  });

  // Initialize with mock data
  useEffect(() => {
    const mockData = generateMockData();
    setPatients(mockData.patients);
    setReadings(mockData.readings);
  }, []);

  // Generate new readings periodically and check for alerts
  useEffect(() => {
    if (patients.length === 0) return;

    const interval = setInterval(() => {
      const newReadings = generateMockData(patients).readings;
      setReadings(prev => {
        // Keep only the last 100 readings per patient to avoid memory issues
        const combined = [...prev, ...newReadings];
        const patientReadings = new Map<string, CardiacDeviceReading[]>();
        
        combined.forEach(reading => {
          if (!patientReadings.has(reading.patientId)) {
            patientReadings.set(reading.patientId, []);
          }
          patientReadings.get(reading.patientId)!.push(reading);
        });

        const trimmed: CardiacDeviceReading[] = [];
        patientReadings.forEach(readings => {
          const sorted = readings.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
          trimmed.push(...sorted.slice(0, 100));
        });

        // Check for new alerts
        const newAlerts = checkAlerts(newReadings, thresholds);
        if (newAlerts.length > 0) {
          setAlerts(prev => [...prev, ...newAlerts]);
        }

        return trimmed;
      });
    }, 5000); // Update every 5 seconds

    return () => clearInterval(interval);
  }, [patients, thresholds]);

  const updateThresholds = (newThresholds: ThresholdConfig) => {
    setThresholds(newThresholds);
  };

  const acknowledgeAlert = (alertId: string) => {
    setAlerts(prev => prev.map(alert => 
      alert.id === alertId ? { ...alert, acknowledged: true } : alert
    ));
  };

  const getLatestReadingForPatient = (patientId: string): CardiacDeviceReading | undefined => {
    const patientReadings = readings
      .filter(reading => reading.patientId === patientId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    
    return patientReadings[0];
  };

  const getAlertsForPatient = (patientId: string): Alert[] => {
    return alerts
      .filter(alert => alert.patientId === patientId && !alert.acknowledged)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  };

  const value = {
    patients,
    readings,
    alerts,
    thresholds,
    updateThresholds,
    acknowledgeAlert,
    getLatestReadingForPatient,
    getAlertsForPatient
  };

  return (
    <DeviceDataContext.Provider value={value}>
      {children}
    </DeviceDataContext.Provider>
  );
};