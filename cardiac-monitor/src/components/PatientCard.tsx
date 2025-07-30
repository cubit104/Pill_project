import React from 'react';
import { Card, Badge, Row, Col } from 'react-bootstrap';
import { Patient, CardiacDeviceReading, Alert } from '../types';
import { getAlertColor } from '../services/alertService';

interface PatientCardProps {
  patient: Patient;
  latestReading?: CardiacDeviceReading;
  alerts: Alert[];
  onClick: () => void;
}

const PatientCard: React.FC<PatientCardProps> = ({ patient, latestReading, alerts, onClick }) => {
  const criticalAlerts = alerts.filter(alert => alert.severity === 'critical').length;
  const warningAlerts = alerts.filter(alert => alert.severity === 'warning').length;

  const getDeviceTypeDisplay = (deviceId: string) => {
    if (deviceId.startsWith('PPM')) return 'Pacemaker';
    if (deviceId.startsWith('ICD')) return 'ICD';
    return 'Unknown';
  };

  const getBatteryColor = (level: number) => {
    if (level <= 15) return 'danger';
    if (level <= 30) return 'warning';
    return 'success';
  };

  const getHeartRateColor = (heartRate: number) => {
    if (heartRate < 60 || heartRate > 100) return 'warning';
    if (heartRate < 40 || heartRate > 120) return 'danger';
    return 'success';
  };

  return (
    <Card 
      className="h-100 shadow-sm border-0 patient-card" 
      style={{ cursor: 'pointer', transition: 'all 0.2s ease' }}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.15)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
      }}
    >
      <Card.Header className="bg-white border-0 pb-0">
        <div className="d-flex justify-content-between align-items-start">
          <div>
            <h6 className="mb-1 fw-bold">{patient.name}</h6>
            <small className="text-muted">
              {patient.age} years • {patient.gender} • {patient.medicalRecordNumber}
            </small>
          </div>
          <div className="text-end">
            {criticalAlerts > 0 && (
              <Badge bg="danger" className="me-1">
                <i className="fas fa-exclamation-triangle me-1"></i>
                {criticalAlerts}
              </Badge>
            )}
            {warningAlerts > 0 && (
              <Badge bg="warning" text="dark">
                <i className="fas fa-exclamation-circle me-1"></i>
                {warningAlerts}
              </Badge>
            )}
          </div>
        </div>
      </Card.Header>

      <Card.Body className="pt-2">
        <div className="mb-3">
          <div className="d-flex justify-content-between align-items-center">
            <span className="text-muted small">Device</span>
            <Badge bg="info" className="small">
              {getDeviceTypeDisplay(patient.deviceId)}
            </Badge>
          </div>
          <small className="text-muted">{patient.deviceId}</small>
        </div>

        {latestReading && (
          <>
            <Row className="g-2 mb-3">
              <Col xs={6}>
                <div className="text-center p-2 rounded" style={{ backgroundColor: '#f8f9fa' }}>
                  <div className="d-flex align-items-center justify-content-center mb-1">
                    <i className="fas fa-heartbeat text-danger me-1"></i>
                    <small className="text-muted">Heart Rate</small>
                  </div>
                  <div className={`fw-bold text-${getHeartRateColor(latestReading.heartRate)}`}>
                    {latestReading.heartRate} bpm
                  </div>
                </div>
              </Col>
              <Col xs={6}>
                <div className="text-center p-2 rounded" style={{ backgroundColor: '#f8f9fa' }}>
                  <div className="d-flex align-items-center justify-content-center mb-1">
                    <i className="fas fa-battery-half me-1"></i>
                    <small className="text-muted">Battery</small>
                  </div>
                  <div className={`fw-bold text-${getBatteryColor(latestReading.batteryLevel)}`}>
                    {latestReading.batteryLevel}%
                  </div>
                </div>
              </Col>
            </Row>

            <div className="mb-2">
              <div className="d-flex justify-content-between align-items-center">
                <span className="text-muted small">Status</span>
                <Badge 
                  bg={latestReading.deviceStatus === 'Normal' ? 'success' : 
                      latestReading.deviceStatus === 'Warning' ? 'warning' : 'danger'}
                  className="small"
                >
                  {latestReading.deviceStatus}
                </Badge>
              </div>
            </div>

            {latestReading.type === 'PPM' && (
              <div className="small text-muted">
                Lead Impedance: {(latestReading as any).leadImpedance}Ω
              </div>
            )}

            {latestReading.type === 'ICD' && (
              <div className="small text-muted">
                {(latestReading as any).arrhythmiaDetected && (
                  <span className="text-danger">
                    <i className="fas fa-heart-broken me-1"></i>
                    Arrhythmia Detected
                  </span>
                )}
                {(latestReading as any).shockEpisodes > 0 && (
                  <div className="text-danger">
                    <i className="fas fa-bolt me-1"></i>
                    Shock Episodes: {(latestReading as any).shockEpisodes}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {!latestReading && (
          <div className="text-center text-muted py-3">
            <i className="fas fa-exclamation-triangle"></i>
            <div className="small">No recent data</div>
          </div>
        )}
      </Card.Body>

      <Card.Footer className="bg-white border-0 pt-0">
        <small className="text-muted">
          Last seen: {patient.lastSeen.toLocaleString()}
        </small>
      </Card.Footer>
    </Card>
  );
};

export default PatientCard;