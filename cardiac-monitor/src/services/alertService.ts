import { CardiacDeviceReading, Alert, ThresholdConfig, PacemakerReading, ICDReading } from '../types';

export function checkAlerts(readings: CardiacDeviceReading[], thresholds: ThresholdConfig): Alert[] {
  const alerts: Alert[] = [];

  readings.forEach(reading => {
    // Check heart rate alerts
    if (reading.heartRate < thresholds.heartRateMin) {
      alerts.push(createAlert(
        reading.patientId,
        'heart_rate',
        'warning',
        `Bradycardia detected: Heart rate ${reading.heartRate} bpm (below ${thresholds.heartRateMin} bpm)`,
        reading.timestamp
      ));
    } else if (reading.heartRate > thresholds.heartRateMax) {
      alerts.push(createAlert(
        reading.patientId,
        'heart_rate',
        reading.heartRate > 120 ? 'critical' : 'warning',
        `Tachycardia detected: Heart rate ${reading.heartRate} bpm (above ${thresholds.heartRateMax} bpm)`,
        reading.timestamp
      ));
    }

    // Check battery level alerts
    if (reading.batteryLevel <= thresholds.batteryLevelCritical) {
      alerts.push(createAlert(
        reading.patientId,
        'battery',
        'critical',
        `Critical battery level: ${reading.batteryLevel}% (below ${thresholds.batteryLevelCritical}%)`,
        reading.timestamp
      ));
    } else if (reading.batteryLevel <= thresholds.batteryLevelWarning) {
      alerts.push(createAlert(
        reading.patientId,
        'battery',
        'warning',
        `Low battery level: ${reading.batteryLevel}% (below ${thresholds.batteryLevelWarning}%)`,
        reading.timestamp
      ));
    }

    // Check device status alerts
    if (reading.deviceStatus === 'Critical') {
      alerts.push(createAlert(
        reading.patientId,
        'device_status',
        'critical',
        'Device is in critical status - immediate attention required',
        reading.timestamp
      ));
    } else if (reading.deviceStatus === 'Warning') {
      alerts.push(createAlert(
        reading.patientId,
        'device_status',
        'warning',
        'Device warning status detected',
        reading.timestamp
      ));
    }

    // Device-specific alerts
    if (reading.type === 'PPM') {
      const ppmReading = reading as PacemakerReading;
      if (ppmReading.leadImpedance > thresholds.leadImpedanceMax) {
        alerts.push(createAlert(
          reading.patientId,
          'device_status',
          'warning',
          `High lead impedance: ${ppmReading.leadImpedance}Ω (above ${thresholds.leadImpedanceMax}Ω)`,
          reading.timestamp
        ));
      }
    } else if (reading.type === 'ICD') {
      const icdReading = reading as ICDReading;
      if (icdReading.arrhythmiaDetected) {
        alerts.push(createAlert(
          reading.patientId,
          'arrhythmia',
          'critical',
          'Arrhythmia detected by ICD',
          reading.timestamp
        ));
      }
      if (icdReading.shockEpisodes > 0) {
        alerts.push(createAlert(
          reading.patientId,
          'shock',
          'critical',
          `ICD shock delivered - ${icdReading.shockEpisodes} episode(s)`,
          reading.timestamp
        ));
      }
    }
  });

  return alerts;
}

function createAlert(
  patientId: string,
  type: Alert['type'],
  severity: Alert['severity'],
  message: string,
  timestamp: Date
): Alert {
  return {
    id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    patientId,
    type,
    severity,
    message,
    timestamp,
    acknowledged: false
  };
}

export function getAlertColor(severity: Alert['severity']): string {
  switch (severity) {
    case 'normal':
      return 'success';
    case 'warning':
      return 'warning';
    case 'critical':
      return 'danger';
    default:
      return 'secondary';
  }
}

export function getAlertIcon(type: Alert['type']): string {
  switch (type) {
    case 'heart_rate':
      return 'fas fa-heartbeat';
    case 'battery':
      return 'fas fa-battery-quarter';
    case 'device_status':
      return 'fas fa-exclamation-triangle';
    case 'arrhythmia':
      return 'fas fa-heart-broken';
    case 'shock':
      return 'fas fa-bolt';
    default:
      return 'fas fa-info-circle';
  }
}