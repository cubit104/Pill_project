import React from 'react';
import { Container, Row, Col, Button, Card } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import '../styles/Homepage.css';

const Homepage: React.FC = () => {
  return (
    <div className="homepage-container">
      {/* Animated ECG Background */}
      <div className="ecg-background">
        <div className="ecg-line ecg-line-1"></div>
        <div className="ecg-line ecg-line-2"></div>
        <div className="ecg-line ecg-line-3"></div>
      </div>

      {/* Floating Medical Devices */}
      <div className="floating-devices">
        <div className="device-icon device-1">
          <i className="fas fa-heart"></i>
        </div>
        <div className="device-icon device-2">
          <i className="fas fa-heartbeat"></i>
        </div>
        <div className="device-icon device-3">
          <i className="fas fa-user-md"></i>
        </div>
        <div className="device-icon device-4">
          <i className="fas fa-stethoscope"></i>
        </div>
        <div className="device-icon device-5">
          <i className="fas fa-hospital"></i>
        </div>
      </div>

      {/* Main Content */}
      <Container fluid className="homepage-content">
        <Row className="min-vh-100 align-items-center justify-content-center">
          <Col lg={8} xl={6} className="text-center">
            {/* Hero Section */}
            <div className="hero-section">
              <div className="pulsing-heart mb-4">
                <i className="fas fa-heartbeat"></i>
              </div>
              
              <h1 className="display-3 fw-bold mb-3 gradient-text">
                CardiaVue
              </h1>
              
              <h2 className="h3 text-muted mb-4">
                Advanced Cardiac Device Monitoring System
              </h2>
              
              <p className="lead text-muted mb-5">
                Professional healthcare monitoring solution for cardiac devices.
                Real-time patient data, intelligent alerts, and comprehensive analytics 
                for healthcare professionals.
              </p>

              {/* Login Button */}
              <div className="mb-5">
                <Link to="/login">
                  <Button 
                    size="lg" 
                    className="px-5 py-3 login-button"
                    style={{
                      background: 'linear-gradient(135deg, #007bff 0%, #0056b3 100%)',
                      border: 'none',
                      borderRadius: '50px',
                      boxShadow: '0 8px 25px rgba(0, 123, 255, 0.3)',
                      fontSize: '1.1rem',
                      fontWeight: '600',
                      transition: 'all 0.3s ease'
                    }}
                  >
                    <i className="fas fa-sign-in-alt me-2"></i>
                    Access Monitoring Dashboard
                  </Button>
                </Link>
              </div>
            </div>

            {/* Features Grid */}
            <Row className="g-4 features-grid">
              <Col md={4}>
                <Card className="feature-card h-100 border-0 shadow-sm">
                  <Card.Body className="text-center p-4">
                    <div className="feature-icon mb-3">
                      <i className="fas fa-tachometer-alt"></i>
                    </div>
                    <h5 className="fw-bold mb-3">Real-Time Monitoring</h5>
                    <p className="text-muted">
                      Continuous monitoring of cardiac devices with instant data updates
                    </p>
                  </Card.Body>
                </Card>
              </Col>
              
              <Col md={4}>
                <Card className="feature-card h-100 border-0 shadow-sm">
                  <Card.Body className="text-center p-4">
                    <div className="feature-icon mb-3">
                      <i className="fas fa-exclamation-triangle"></i>
                    </div>
                    <h5 className="fw-bold mb-3">Intelligent Alerts</h5>
                    <p className="text-muted">
                      Smart alerting system for critical events and device anomalies
                    </p>
                  </Card.Body>
                </Card>
              </Col>
              
              <Col md={4}>
                <Card className="feature-card h-100 border-0 shadow-sm">
                  <Card.Body className="text-center p-4">
                    <div className="feature-icon mb-3">
                      <i className="fas fa-chart-line"></i>
                    </div>
                    <h5 className="fw-bold mb-3">Advanced Analytics</h5>
                    <p className="text-muted">
                      Comprehensive data analysis and trend visualization tools
                    </p>
                  </Card.Body>
                </Card>
              </Col>
            </Row>
          </Col>
        </Row>
      </Container>

      {/* Footer */}
      <footer className="homepage-footer py-4">
        <Container>
          <Row>
            <Col className="text-center">
              <p className="mb-0 text-muted">
                &copy; 2024 CardiaVue - Professional Cardiac Device Monitoring
              </p>
            </Col>
          </Row>
        </Container>
      </footer>
    </div>
  );
};

export default Homepage;