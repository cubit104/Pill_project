export interface Patient {
  id: string;
  name: string;
  age: number;
  gender: 'Male' | 'Female' | 'Other';
  medicalRecordNumber: string;
  deviceId: string;
  lastSeen: Date;
}

export interface DeviceReading {
  id: string;
  patientId: string;
  timestamp: Date;
  heartRate: number;
  batteryLevel: number;
  deviceStatus: 'Normal' | 'Warning' | 'Critical';
}

export interface PacemakerReading extends DeviceReading {
  type: 'PPM';
  leadImpedance: number;
  paceCount: number;
  senseCount: number;
}

export interface ICDReading extends DeviceReading {
  type: 'ICD';
  shockEpisodes: number;
  arrhythmiaDetected: boolean;
  lastShockTime?: Date;
  therapyDelivered: boolean;
}

export type CardiacDeviceReading = PacemakerReading | ICDReading;

export interface Alert {
  id: string;
  patientId: string;
  type: 'heart_rate' | 'battery' | 'device_status' | 'arrhythmia' | 'shock';
  severity: 'normal' | 'warning' | 'critical';
  message: string;
  timestamp: Date;
  acknowledged: boolean;
}

export interface User {
  id: string;
  username: string;
  role: 'doctor' | 'nurse' | 'technician';
  isAuthenticated: boolean;
}

export interface ThresholdConfig {
  heartRateMin: number;
  heartRateMax: number;
  batteryLevelWarning: number;
  batteryLevelCritical: number;
  leadImpedanceMax: number;
}