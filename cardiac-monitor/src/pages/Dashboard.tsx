import React, { useState } from 'react';
import { Container, Row, Col, Navbar, Nav, Button, Modal, Card } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { useDeviceData } from '../contexts/DeviceDataContext';
import PatientCard from '../components/PatientCard';
import AlertPanel from '../components/AlertPanel';
import HeartRateChart from '../components/HeartRateChart';
import { Patient, CardiacDeviceReading } from '../types';
import { generateHistoricalData } from '../services/mockDataService';

const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const { 
    patients, 
    readings, 
    alerts, 
    acknowledgeAlert, 
    getLatestReadingForPatient, 
    getAlertsForPatient 
  } = useDeviceData();

  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [showPatientModal, setShowPatientModal] = useState(false);
  const [historicalData, setHistoricalData] = useState<CardiacDeviceReading[]>([]);

  const handlePatientClick = (patient: Patient) => {
    setSelectedPatient(patient);
    
    // Generate historical data for the chart
    const deviceType = patient.deviceId.startsWith('PPM') ? 'PPM' : 'ICD';
    const historical = generateHistoricalData(patient.id, deviceType, 1); // Last 1 day
    setHistoricalData(historical);
    
    setShowPatientModal(true);
  };

  const handleCloseModal = () => {
    setShowPatientModal(false);
    setSelectedPatient(null);
    setHistoricalData([]);
  };

  const allAlerts = alerts.filter(alert => !alert.acknowledged);
  const patientNames = patients.reduce((acc, patient) => {
    acc[patient.id] = patient.name;
    return acc;
  }, {} as { [key: string]: string });

  const criticalPatients = patients.filter(patient => {
    const patientAlerts = getAlertsForPatient(patient.id);
    return patientAlerts.some(alert => alert.severity === 'critical');
  });

  const warningPatients = patients.filter(patient => {
    const patientAlerts = getAlertsForPatient(patient.id);
    return patientAlerts.some(alert => alert.severity === 'warning') && 
           !patientAlerts.some(alert => alert.severity === 'critical');
  });

  const normalPatients = patients.filter(patient => {
    const patientAlerts = getAlertsForPatient(patient.id);
    return patientAlerts.length === 0;
  });

  return (
    <>
      <Navbar bg="primary" variant="dark" className="shadow-sm">
        <Container fluid>
          <Navbar.Brand>
            <i className="fas fa-heartbeat me-2"></i>
            Cardiac Device Monitor
          </Navbar.Brand>
          <Nav className="me-auto">
            <Nav.Link active>
              <i className="fas fa-tachometer-alt me-1"></i>
              Dashboard
            </Nav.Link>
          </Nav>
          <Nav>
            <Navbar.Text className="me-3">
              Welcome, <strong>{user?.username}</strong> ({user?.role})
            </Navbar.Text>
            <Button variant="outline-light" size="sm" onClick={logout}>
              <i className="fas fa-sign-out-alt me-1"></i>
              Logout
            </Button>
          </Nav>
        </Container>
      </Navbar>

      <Container fluid className="py-4">
        <Row className="mb-4">
          <Col>
            <div className="d-flex justify-content-between align-items-center">
              <h2 className="mb-0">Patient Monitoring Dashboard</h2>
              <div className="d-flex gap-2">
                <div className="text-center">
                  <div className="badge bg-danger fs-6">{criticalPatients.length}</div>
                  <div className="small text-muted">Critical</div>
                </div>
                <div className="text-center">
                  <div className="badge bg-warning text-dark fs-6">{warningPatients.length}</div>
                  <div className="small text-muted">Warning</div>
                </div>
                <div className="text-center">
                  <div className="badge bg-success fs-6">{normalPatients.length}</div>
                  <div className="small text-muted">Normal</div>
                </div>
              </div>
            </div>
          </Col>
        </Row>

        <Row>
          <Col lg={8}>
            <Card className="border-0 shadow-sm mb-4">
              <Card.Header className="bg-white border-0">
                <h5 className="mb-0">
                  <i className="fas fa-users me-2"></i>
                  Patients ({patients.length})
                </h5>
              </Card.Header>
              <Card.Body>
                <Row className="g-3">
                  {/* Critical patients first */}
                  {criticalPatients.map(patient => (
                    <Col md={6} xl={4} key={patient.id}>
                      <PatientCard
                        patient={patient}
                        latestReading={getLatestReadingForPatient(patient.id)}
                        alerts={getAlertsForPatient(patient.id)}
                        onClick={() => handlePatientClick(patient)}
                      />
                    </Col>
                  ))}
                  
                  {/* Warning patients */}
                  {warningPatients.map(patient => (
                    <Col md={6} xl={4} key={patient.id}>
                      <PatientCard
                        patient={patient}
                        latestReading={getLatestReadingForPatient(patient.id)}
                        alerts={getAlertsForPatient(patient.id)}
                        onClick={() => handlePatientClick(patient)}
                      />
                    </Col>
                  ))}
                  
                  {/* Normal patients */}
                  {normalPatients.map(patient => (
                    <Col md={6} xl={4} key={patient.id}>
                      <PatientCard
                        patient={patient}
                        latestReading={getLatestReadingForPatient(patient.id)}
                        alerts={getAlertsForPatient(patient.id)}
                        onClick={() => handlePatientClick(patient)}
                      />
                    </Col>
                  ))}
                </Row>
              </Card.Body>
            </Card>
          </Col>

          <Col lg={4}>
            <AlertPanel
              alerts={allAlerts}
              onAcknowledge={acknowledgeAlert}
              showPatientName={true}
              patientNames={patientNames}
            />
          </Col>
        </Row>
      </Container>

      {/* Patient Detail Modal */}
      <Modal 
        show={showPatientModal} 
        onHide={handleCloseModal} 
        size="lg"
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>
            <i className="fas fa-user me-2"></i>
            {selectedPatient?.name}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedPatient && (
            <Row>
              <Col md={6}>
                <Card className="border-0 bg-light mb-3">
                  <Card.Body>
                    <h6 className="mb-3">Patient Information</h6>
                    <div className="mb-2">
                      <strong>Age:</strong> {selectedPatient.age} years
                    </div>
                    <div className="mb-2">
                      <strong>Gender:</strong> {selectedPatient.gender}
                    </div>
                    <div className="mb-2">
                      <strong>MRN:</strong> {selectedPatient.medicalRecordNumber}
                    </div>
                    <div className="mb-2">
                      <strong>Device:</strong> {selectedPatient.deviceId}
                    </div>
                    <div>
                      <strong>Last Seen:</strong> {selectedPatient.lastSeen.toLocaleString()}
                    </div>
                  </Card.Body>
                </Card>

                <AlertPanel
                  alerts={getAlertsForPatient(selectedPatient.id)}
                  onAcknowledge={acknowledgeAlert}
                />
              </Col>
              <Col md={6}>
                <Card className="border-0 bg-light">
                  <Card.Body>
                    <h6 className="mb-3">Recent Trends (24h)</h6>
                    <HeartRateChart readings={historicalData} height={250} />
                  </Card.Body>
                </Card>
              </Col>
            </Row>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleCloseModal}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default Dashboard;