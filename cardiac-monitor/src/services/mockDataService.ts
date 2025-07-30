import { Patient, CardiacDeviceReading, PacemakerReading, ICDReading } from '../types';

const mockPatients: Patient[] = [
  {
    id: 'p1',
    name: 'John Smith',
    age: 68,
    gender: 'Male',
    medicalRecordNumber: 'MR001234',
    deviceId: 'PPM-001',
    lastSeen: new Date()
  },
  {
    id: 'p2',
    name: 'Maria Garcia',
    age: 72,
    gender: 'Female',
    medicalRecordNumber: 'MR001235',
    deviceId: 'ICD-001',
    lastSeen: new Date()
  },
  {
    id: 'p3',
    name: 'Robert Johnson',
    age: 65,
    gender: 'Male',
    medicalRecordNumber: 'MR001236',
    deviceId: 'PPM-002',
    lastSeen: new Date()
  },
  {
    id: 'p4',
    name: 'Linda Davis',
    age: 74,
    gender: 'Female',
    medicalRecordNumber: 'MR001237',
    deviceId: 'ICD-002',
    lastSeen: new Date()
  },
  {
    id: 'p5',
    name: 'Michael Wilson',
    age: 69,
    gender: 'Male',
    medicalRecordNumber: 'MR001238',
    deviceId: 'PPM-003',
    lastSeen: new Date()
  }
];

function generateRandomInRange(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function generateHeartRate(): number {
  // Generate mostly normal heart rates (60-100) with occasional abnormal values
  const rand = Math.random();
  if (rand < 0.8) {
    // 80% normal range
    return Math.floor(generateRandomInRange(60, 100));
  } else if (rand < 0.9) {
    // 10% bradycardia
    return Math.floor(generateRandomInRange(40, 59));
  } else {
    // 10% tachycardia
    return Math.floor(generateRandomInRange(101, 150));
  }
}

function generateBatteryLevel(): number {
  // Generate battery levels with some aging over time
  const base = generateRandomInRange(15, 100);
  return Math.floor(base);
}

function generateDeviceStatus(): 'Normal' | 'Warning' | 'Critical' {
  const rand = Math.random();
  if (rand < 0.85) return 'Normal';
  if (rand < 0.95) return 'Warning';
  return 'Critical';
}

function generatePacemakerReading(patient: Patient): PacemakerReading {
  return {
    id: `reading_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    patientId: patient.id,
    timestamp: new Date(),
    heartRate: generateHeartRate(),
    batteryLevel: generateBatteryLevel(),
    deviceStatus: generateDeviceStatus(),
    type: 'PPM',
    leadImpedance: Math.floor(generateRandomInRange(300, 1200)),
    paceCount: Math.floor(generateRandomInRange(0, 1000)),
    senseCount: Math.floor(generateRandomInRange(0, 2000))
  };
}

function generateICDReading(patient: Patient): ICDReading {
  const rand = Math.random();
  const arrhythmiaDetected = rand < 0.1; // 10% chance of arrhythmia
  const shockEpisodes = arrhythmiaDetected && rand < 0.03 ? 1 : 0; // 3% chance of shock

  return {
    id: `reading_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    patientId: patient.id,
    timestamp: new Date(),
    heartRate: generateHeartRate(),
    batteryLevel: generateBatteryLevel(),
    deviceStatus: generateDeviceStatus(),
    type: 'ICD',
    shockEpisodes,
    arrhythmiaDetected,
    lastShockTime: shockEpisodes > 0 ? new Date() : undefined,
    therapyDelivered: shockEpisodes > 0
  };
}

export function generateMockData(existingPatients?: Patient[]): {
  patients: Patient[];
  readings: CardiacDeviceReading[];
} {
  const patients = existingPatients || mockPatients;
  const readings: CardiacDeviceReading[] = [];

  patients.forEach(patient => {
    // Generate 1-3 readings per patient
    const readingCount = Math.floor(generateRandomInRange(1, 4));
    
    for (let i = 0; i < readingCount; i++) {
      let reading: CardiacDeviceReading;
      
      if (patient.deviceId.startsWith('PPM')) {
        reading = generatePacemakerReading(patient);
      } else {
        reading = generateICDReading(patient);
      }
      
      readings.push(reading);
    }
  });

  return { patients, readings };
}

export function generateHistoricalData(patientId: string, deviceType: 'PPM' | 'ICD', days: number = 7): CardiacDeviceReading[] {
  const readings: CardiacDeviceReading[] = [];
  const patient = mockPatients.find(p => p.id === patientId);
  
  if (!patient) return readings;

  const now = new Date();
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  
  // Generate readings for the past `days` days
  for (let day = 0; day < days; day++) {
    const readingsPerDay = Math.floor(generateRandomInRange(20, 50)); // 20-50 readings per day
    
    for (let i = 0; i < readingsPerDay; i++) {
      const timestamp = new Date(now.getTime() - (day * millisecondsPerDay) + (i * millisecondsPerDay / readingsPerDay));
      
      let reading: CardiacDeviceReading;
      
      if (deviceType === 'PPM') {
        reading = {
          ...generatePacemakerReading(patient),
          timestamp
        };
      } else {
        reading = {
          ...generateICDReading(patient),
          timestamp
        };
      }
      
      readings.push(reading);
    }
  }
  
  return readings.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}