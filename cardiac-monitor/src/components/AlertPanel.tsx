import React from 'react';
import { Card, Alert as BootstrapAlert, Button, Badge } from 'react-bootstrap';
import { Alert } from '../types';
import { getAlertColor, getAlertIcon } from '../services/alertService';

interface AlertPanelProps {
  alerts: Alert[];
  onAcknowledge: (alertId: string) => void;
  showPatientName?: boolean;
  patientNames?: { [patientId: string]: string };
}

const AlertPanel: React.FC<AlertPanelProps> = ({ 
  alerts, 
  onAcknowledge, 
  showPatientName = false,
  patientNames = {}
}) => {
  const unacknowledgedAlerts = alerts.filter(alert => !alert.acknowledged);
  const criticalAlerts = unacknowledgedAlerts.filter(alert => alert.severity === 'critical');
  const warningAlerts = unacknowledgedAlerts.filter(alert => alert.severity === 'warning');

  if (unacknowledgedAlerts.length === 0) {
    return (
      <Card className="border-0 shadow-sm">
        <Card.Header className="bg-success text-white">
          <h6 className="mb-0">
            <i className="fas fa-check-circle me-2"></i>
            All Clear
          </h6>
        </Card.Header>
        <Card.Body className="text-center py-4">
          <i className="fas fa-shield-alt text-success" style={{ fontSize: '3rem' }}></i>
          <p className="mt-3 mb-0 text-muted">No active alerts</p>
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-sm">
      <Card.Header className="bg-white border-0">
        <div className="d-flex justify-content-between align-items-center">
          <h6 className="mb-0">
            <i className="fas fa-exclamation-triangle me-2"></i>
            Active Alerts
          </h6>
          <div>
            {criticalAlerts.length > 0 && (
              <Badge bg="danger" className="me-2">
                {criticalAlerts.length} Critical
              </Badge>
            )}
            {warningAlerts.length > 0 && (
              <Badge bg="warning" text="dark">
                {warningAlerts.length} Warning
              </Badge>
            )}
          </div>
        </div>
      </Card.Header>
      <Card.Body className="p-0">
        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
          {unacknowledgedAlerts
            .sort((a, b) => {
              // Sort by severity (critical first) then by timestamp (newest first)
              if (a.severity === 'critical' && b.severity !== 'critical') return -1;
              if (a.severity !== 'critical' && b.severity === 'critical') return 1;
              return b.timestamp.getTime() - a.timestamp.getTime();
            })
            .map((alert, index) => (
              <div key={alert.id}>
                <BootstrapAlert 
                  variant={getAlertColor(alert.severity)} 
                  className="mb-0 border-0 rounded-0"
                >
                  <div className="d-flex justify-content-between align-items-start">
                    <div className="flex-grow-1">
                      <div className="d-flex align-items-center mb-2">
                        <i className={`${getAlertIcon(alert.type)} me-2`}></i>
                        <strong>
                          {alert.severity === 'critical' ? 'CRITICAL' : 'WARNING'}
                        </strong>
                        {showPatientName && patientNames[alert.patientId] && (
                          <Badge bg="secondary" className="ms-2 small">
                            {patientNames[alert.patientId]}
                          </Badge>
                        )}
                      </div>
                      <p className="mb-2">{alert.message}</p>
                      <small className="text-muted">
                        <i className="fas fa-clock me-1"></i>
                        {alert.timestamp.toLocaleString()}
                      </small>
                    </div>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => onAcknowledge(alert.id)}
                      className="ms-2"
                    >
                      <i className="fas fa-check"></i>
                    </Button>
                  </div>
                </BootstrapAlert>
                {index < unacknowledgedAlerts.length - 1 && (
                  <hr className="my-0" style={{ opacity: 0.2 }} />
                )}
              </div>
            ))}
        </div>
      </Card.Body>
    </Card>
  );
};

export default AlertPanel;