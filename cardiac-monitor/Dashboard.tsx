import React from 'react';
export default function Dashboard() {
  return <h1 style={{ color: 'green' }}>THIS IS THE NEW DASHBOARD</h1>;
}
import React, { useState, useMemo } from 'react';
import { 
  Container, 
  Row, 
  Col, 
  Card, 
  Table, 
  Form, 
  InputGroup, 
  Button, 
  Modal,
  Badge,
  Pagination,
  OverlayTrigger,
  Tooltip
} from 'react-bootstrap';
import { 
  PieChart, 
  Pie, 
  Cell, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer,
  Legend
} from 'recharts';
import './Dashboard.css';

// Enhanced patient interface for the new dashboard
interface Patient {
  id: string;
  name: string;
  vendor: string;
  deviceType: string;
  provider: string;
  anticoagulated: boolean;
  labels: string[];
  primarySubscriberId: string;
  modelName: string;
  status: 'active' | 'overdue' | 'inactive';
  lastContact: Date;
  age: number;
  gender: 'Male' | 'Female' | 'Other';
  diagnosis: string;
  riskLevel: 'Low' | 'Medium' | 'High';
}

// Mock patient data
const mockPatients: Patient[] = [
  {
    id: 'P001',
    name: 'John Smith',
    vendor: 'Medtronic',
    deviceType: 'Pacemaker',
    provider: 'Dr. Johnson',
    anticoagulated: true,
    labels: ['High Risk', 'Remote Monitoring'],
    primarySubscriberId: 'SUB001',
    modelName: 'Azure XT DR',
    status: 'active',
    lastContact: new Date('2024-01-15'),
    age: 68,
    gender: 'Male',
    diagnosis: 'Bradycardia',
    riskLevel: 'High'
  },
  {
    id: 'P002',
    name: 'Sarah Wilson',
    vendor: 'Boston Scientific',
    deviceType: 'ICD',
    provider: 'Dr. Martinez',
    anticoagulated: false,
    labels: ['Standard Care'],
    primarySubscriberId: 'SUB002',
    modelName: 'DYNAGEN X4',
    status: 'active',
    lastContact: new Date('2024-01-14'),
    age: 54,
    gender: 'Female',
    diagnosis: 'Ventricular Tachycardia',
    riskLevel: 'Medium'
  },
  {
    id: 'P003',
    name: 'Michael Chen',
    vendor: 'Abbott',
    deviceType: 'CRT-D',
    provider: 'Dr. Thompson',
    anticoagulated: true,
    labels: ['Heart Failure', 'Remote Monitoring'],
    primarySubscriberId: 'SUB003',
    modelName: 'Gallant HF',
    status: 'overdue',
    lastContact: new Date('2024-01-10'),
    age: 72,
    gender: 'Male',
    diagnosis: 'Heart Failure',
    riskLevel: 'High'
  },
  {
    id: 'P004',
    name: 'Emma Rodriguez',
    vendor: 'Medtronic',
    deviceType: 'Pacemaker',
    provider: 'Dr. Lee',
    anticoagulated: false,
    labels: ['Low Risk'],
    primarySubscriberId: 'SUB004',
    modelName: 'Micra AV',
    status: 'active',
    lastContact: new Date('2024-01-13'),
    age: 45,
    gender: 'Female',
    diagnosis: 'Atrial Fibrillation',
    riskLevel: 'Low'
  },
  {
    id: 'P005',
    name: 'David Brown',
    vendor: 'Boston Scientific',
    deviceType: 'ICD',
    provider: 'Dr. Johnson',
    anticoagulated: true,
    labels: ['High Risk', 'Recent Implant'],
    primarySubscriberId: 'SUB005',
    modelName: 'MOMENTUM',
    status: 'active',
    lastContact: new Date('2024-01-16'),
    age: 61,
    gender: 'Male',
    diagnosis: 'Sudden Cardiac Arrest',
    riskLevel: 'High'
  },
  {
    id: 'P006',
    name: 'Lisa Anderson',
    vendor: 'Abbott',
    deviceType: 'Pacemaker',
    provider: 'Dr. Davis',
    anticoagulated: false,
    labels: ['Standard Care'],
    primarySubscriberId: 'SUB006',
    modelName: 'Accent MRI',
    status: 'overdue',
    lastContact: new Date('2024-01-08'),
    age: 58,
    gender: 'Female',
    diagnosis: 'Sick Sinus Syndrome',
    riskLevel: 'Medium'
  }
];

const Dashboard: React.FC = () => {
  const [patients] = useState<Patient[]>(mockPatients);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [vendorFilter, setVendorFilter] = useState<string>('all');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  // Filter and search patients
  const filteredPatients = useMemo(() => {
    return patients.filter(patient => {
      const matchesSearch = patient.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           patient.primarySubscriberId.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           patient.provider.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus = statusFilter === 'all' || patient.status === statusFilter;
      const matchesVendor = vendorFilter === 'all' || patient.vendor === vendorFilter;
      
      return matchesSearch && matchesStatus && matchesVendor;
    });
  }, [patients, searchTerm, statusFilter, vendorFilter]);

  // Pagination
  const totalPages = Math.ceil(filteredPatients.length / itemsPerPage);
  const paginatedPatients = filteredPatients.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Statistics calculations
  const statistics = useMemo(() => {
    const totalPatients = patients.length;
    const activeCount = patients.filter(p => p.status === 'active').length;
    const overdueCount = patients.filter(p => p.status === 'overdue').length;
    const inactiveCount = patients.filter(p => p.status === 'inactive').length;

    // Status pie chart data
    const statusData = [
      { name: 'Active', value: activeCount, color: '#28a745' },
      { name: 'Overdue', value: overdueCount, color: '#dc3545' },
      { name: 'Inactive', value: inactiveCount, color: '#6c757d' }
    ].filter(item => item.value > 0);

    // Vendor bar chart data
    const vendorCounts = patients.reduce((acc, patient) => {
      acc[patient.vendor] = (acc[patient.vendor] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const vendorData = Object.entries(vendorCounts).map(([vendor, count]) => ({
      vendor,
      count,
      color: vendor === 'Medtronic' ? '#0066cc' : 
             vendor === 'Boston Scientific' ? '#ff6b35' : 
             vendor === 'Abbott' ? '#4caf50' : '#9c27b0'
    }));

    return {
      totalPatients,
      activeCount,
      overdueCount,
      inactiveCount,
      statusData,
      vendorData
    };
  }, [patients]);

  const handlePatientClick = (patient: Patient) => {
    setSelectedPatient(patient);
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setSelectedPatient(null);
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      active: 'success',
      overdue: 'danger',
      inactive: 'secondary'
    };
    return <Badge bg={variants[status] || 'secondary'}>{status.toUpperCase()}</Badge>;
  };

  const getRiskLevelBadge = (riskLevel: string) => {
    const variants: Record<string, string> = {
      Low: 'success',
      Medium: 'warning',
      High: 'danger'
    };
    return <Badge bg={variants[riskLevel] || 'secondary'}>{riskLevel}</Badge>;
  };

  const uniqueVendors = [...new Set(patients.map(p => p.vendor))];

  return (
    <div className="modern-dashboard">
      <Container fluid className="py-4">
        {/* Header */}
        <Row className="mb-4">
          <Col>
            <div className="dashboard-header">
              <h1 className="dashboard-title">
                <i className="fas fa-heartbeat me-3"></i>
                Cardiac Device Dashboard
              </h1>
              <p className="dashboard-subtitle">
                Monitor and manage cardiac device patients
              </p>
            </div>
          </Col>
        </Row>

        {/* Statistics Cards */}
        <Row className="mb-4">
          <Col lg={3} md={6} className="mb-3">
            <Card className="stat-card stat-card-primary">
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <h2 className="stat-number">{statistics.totalPatients}</h2>
                    <p className="stat-label">Total Patients</p>
                  </div>
                  <div className="stat-icon">
                    <i className="fas fa-users"></i>
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card className="stat-card stat-card-success">
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <h2 className="stat-number">{statistics.activeCount}</h2>
                    <p className="stat-label">Active Monitoring</p>
                  </div>
                  <div className="stat-icon">
                    <i className="fas fa-check-circle"></i>
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card className="stat-card stat-card-danger">
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <h2 className="stat-number">{statistics.overdueCount}</h2>
                    <p className="stat-label">Overdue Checkups</p>
                  </div>
                  <div className="stat-icon">
                    <i className="fas fa-exclamation-triangle"></i>
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card className="stat-card stat-card-warning">
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <h2 className="stat-number">{Math.round((statistics.activeCount / statistics.totalPatients) * 100)}%</h2>
                    <p className="stat-label">Compliance Rate</p>
                  </div>
                  <div className="stat-icon">
                    <i className="fas fa-chart-line"></i>
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        {/* Charts Row */}
        <Row className="mb-4">
          <Col lg={6} className="mb-3">
            <Card className="chart-card">
              <Card.Header>
                <h5 className="mb-0">
                  <i className="fas fa-chart-pie me-2"></i>
                  Patient Status Distribution
                </h5>
              </Card.Header>
              <Card.Body>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={statistics.statusData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {statistics.statusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip />
                  </PieChart>
                </ResponsiveContainer>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={6} className="mb-3">
            <Card className="chart-card">
              <Card.Header>
                <h5 className="mb-0">
                  <i className="fas fa-chart-bar me-2"></i>
                  Patients by Vendor
                </h5>
              </Card.Header>
              <Card.Body>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={statistics.vendorData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="vendor" />
                    <YAxis />
                    <RechartsTooltip />
                    <Bar dataKey="count" fill="#0066cc">
                      {statistics.vendorData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        {/* Search and Filter Controls */}
        <Row className="mb-4">
          <Col>
            <Card className="filter-card">
              <Card.Body>
                <Row className="align-items-center">
                  <Col lg={4} className="mb-3 mb-lg-0">
                    <InputGroup>
                      <InputGroup.Text>
                        <i className="fas fa-search"></i>
                      </InputGroup.Text>
                      <Form.Control
                        type="text"
                        placeholder="Search patients, ID, or provider..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                    </InputGroup>
                  </Col>
                  <Col lg={3} className="mb-3 mb-lg-0">
                    <Form.Select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                    >
                      <option value="all">All Status</option>
                      <option value="active">Active</option>
                      <option value="overdue">Overdue</option>
                      <option value="inactive">Inactive</option>
                    </Form.Select>
                  </Col>
                  <Col lg={3} className="mb-3 mb-lg-0">
                    <Form.Select
                      value={vendorFilter}
                      onChange={(e) => setVendorFilter(e.target.value)}
                    >
                      <option value="all">All Vendors</option>
                      {uniqueVendors.map(vendor => (
                        <option key={vendor} value={vendor}>{vendor}</option>
                      ))}
                    </Form.Select>
                  </Col>
                  <Col lg={2}>
                    <Button 
                      variant="outline-secondary" 
                      className="w-100"
                      onClick={() => {
                        setSearchTerm('');
                        setStatusFilter('all');
                        setVendorFilter('all');
                        setCurrentPage(1);
                      }}
                    >
                      <i className="fas fa-times me-1"></i>
                      Clear
                    </Button>
                  </Col>
                </Row>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        {/* Patient Table */}
        <Row>
          <Col>
            <Card className="table-card">
              <Card.Header className="d-flex justify-content-between align-items-center">
                <h5 className="mb-0">
                  <i className="fas fa-table me-2"></i>
                  Patient List ({filteredPatients.length} patients)
                </h5>
              </Card.Header>
              <Card.Body className="p-0">
                <div className="table-responsive">
                  <Table hover className="mb-0 patient-table">
                    <thead className="table-header">
                      <tr>
                        <th>Name</th>
                        <th>Vendor</th>
                        <th>Device Type</th>
                        <th>Provider</th>
                        <th>Anticoagulated</th>
                        <th>Labels</th>
                        <th>Primary Subscriber ID</th>
                        <th>Model Name</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedPatients.map((patient) => (
                        <tr 
                          key={patient.id} 
                          className="patient-row"
                          onClick={() => handlePatientClick(patient)}
                        >
                          <td>
                            <div className="patient-name">
                              <strong>{patient.name}</strong>
                              <br />
                              <small className="text-muted">ID: {patient.id}</small>
                            </div>
                          </td>
                          <td>{patient.vendor}</td>
                          <td>{patient.deviceType}</td>
                          <td>{patient.provider}</td>
                          <td>
                            {patient.anticoagulated ? (
                              <Badge bg="warning">Yes</Badge>
                            ) : (
                              <Badge bg="light" text="dark">No</Badge>
                            )}
                          </td>
                          <td>
                            <div className="labels-container">
                              {patient.labels.map((label, idx) => (
                                <Badge key={idx} bg="info" className="me-1 mb-1">
                                  {label}
                                </Badge>
                              ))}
                            </div>
                          </td>
                          <td>{patient.primarySubscriberId}</td>
                          <td>{patient.modelName}</td>
                          <td>
                            <div className="action-buttons">
                              <OverlayTrigger
                                placement="top"
                                overlay={<Tooltip>View Details</Tooltip>}
                              >
                                <Button 
                                  variant="outline-primary" 
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePatientClick(patient);
                                  }}
                                >
                                  <i className="fas fa-eye"></i>
                                </Button>
                              </OverlayTrigger>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </Card.Body>
              
              {/* Pagination */}
              {totalPages > 1 && (
                <Card.Footer>
                  <div className="d-flex justify-content-between align-items-center">
                    <div className="pagination-info">
                      Showing {((currentPage - 1) * itemsPerPage) + 1} to{' '}
                      {Math.min(currentPage * itemsPerPage, filteredPatients.length)} of{' '}
                      {filteredPatients.length} patients
                    </div>
                    <Pagination className="mb-0">
                      <Pagination.Prev 
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage(currentPage - 1)}
                      />
                      {[...Array(totalPages)].map((_, idx) => (
                        <Pagination.Item
                          key={idx + 1}
                          active={idx + 1 === currentPage}
                          onClick={() => setCurrentPage(idx + 1)}
                        >
                          {idx + 1}
                        </Pagination.Item>
                      ))}
                      <Pagination.Next 
                        disabled={currentPage === totalPages}
                        onClick={() => setCurrentPage(currentPage + 1)}
                      />
                    </Pagination>
                  </div>
                </Card.Footer>
              )}
            </Card>
          </Col>
        </Row>
      </Container>

      {/* Patient Detail Modal */}
      <Modal 
        show={showModal} 
        onHide={handleCloseModal} 
        size="lg"
        centered
        className="patient-modal"
      >
        <Modal.Header closeButton>
          <Modal.Title>
            <i className="fas fa-user me-2"></i>
            Patient Details
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedPatient && (
            <Row>
              <Col md={6}>
                <Card className="border-0 bg-light mb-3">
                  <Card.Header className="bg-primary text-white">
                    <h6 className="mb-0">Patient Information</h6>
                  </Card.Header>
                  <Card.Body>
                    <div className="patient-detail-grid">
                      <div className="detail-item">
                        <strong>Name:</strong> {selectedPatient.name}
                      </div>
                      <div className="detail-item">
                        <strong>Patient ID:</strong> {selectedPatient.id}
                      </div>
                      <div className="detail-item">
                        <strong>Age:</strong> {selectedPatient.age} years
                      </div>
                      <div className="detail-item">
                        <strong>Gender:</strong> {selectedPatient.gender}
                      </div>
                      <div className="detail-item">
                        <strong>Provider:</strong> {selectedPatient.provider}
                      </div>
                      <div className="detail-item">
                        <strong>Primary Subscriber ID:</strong> {selectedPatient.primarySubscriberId}
                      </div>
                      <div className="detail-item">
                        <strong>Status:</strong> {getStatusBadge(selectedPatient.status)}
                      </div>
                      <div className="detail-item">
                        <strong>Risk Level:</strong> {getRiskLevelBadge(selectedPatient.riskLevel)}
                      </div>
                    </div>
                  </Card.Body>
                </Card>
              </Col>
              <Col md={6}>
                <Card className="border-0 bg-light mb-3">
                  <Card.Header className="bg-success text-white">
                    <h6 className="mb-0">Device Information</h6>
                  </Card.Header>
                  <Card.Body>
                    <div className="patient-detail-grid">
                      <div className="detail-item">
                        <strong>Vendor:</strong> {selectedPatient.vendor}
                      </div>
                      <div className="detail-item">
                        <strong>Device Type:</strong> {selectedPatient.deviceType}
                      </div>
                      <div className="detail-item">
                        <strong>Model Name:</strong> {selectedPatient.modelName}
                      </div>
                      <div className="detail-item">
                        <strong>Anticoagulated:</strong> {selectedPatient.anticoagulated ? 'Yes' : 'No'}
                      </div>
                      <div className="detail-item">
                        <strong>Last Contact:</strong> {selectedPatient.lastContact.toLocaleDateString()}
                      </div>
                      <div className="detail-item">
                        <strong>Diagnosis:</strong> {selectedPatient.diagnosis}
                      </div>
                    </div>
                  </Card.Body>
                </Card>
                
                <Card className="border-0 bg-light">
                  <Card.Header className="bg-info text-white">
                    <h6 className="mb-0">Labels & Tags</h6>
                  </Card.Header>
                  <Card.Body>
                    <div className="labels-container">
                      {selectedPatient.labels.map((label, idx) => (
                        <Badge key={idx} bg="info" className="me-2 mb-2">
                          {label}
                        </Badge>
                      ))}
                    </div>
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
          <Button variant="primary">
            <i className="fas fa-edit me-1"></i>
            Edit Patient
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default Dashboard;
