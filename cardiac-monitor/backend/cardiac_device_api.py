"""
Cardiac Device API Integration for Main Application

This module integrates cardiac device monitoring capabilities into the
existing pill identification application.
"""

import logging
import asyncio
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks, Query, Depends
from fastapi.responses import HTMLResponse
import json

from cardiac_device_integration import (
    AuthenticationManager,
    DataIngestionPipeline,
    BostonScientificClient,
    DeviceReading,
    PatientDevice,
    DeviceAlert,
    IngestionConfig
)
from cardiac_device_integration.data_ingestion import DatabaseConnection
from cardiac_device_integration.authentication import AuthCredentials

logger = logging.getLogger(__name__)

# Global variables for cardiac device integration
cardiac_auth_manager = None
cardiac_pipeline = None
cardiac_clients = {}

# Create router for cardiac device endpoints
cardiac_router = APIRouter(prefix="/cardiac", tags=["cardiac_devices"])


async def initialize_cardiac_integration(database_url: str):
    """Initialize cardiac device integration components"""
    global cardiac_auth_manager, cardiac_pipeline, cardiac_clients
    
    try:
        # Initialize authentication manager
        cardiac_auth_manager = AuthenticationManager()
        
        # Initialize database connection
        db_connection = DatabaseConnection(database_url)
        
        # Initialize data ingestion pipeline
        config = IngestionConfig(
            batch_size=50,
            retry_attempts=3,
            validation_enabled=True,
            alert_threshold_violations=True
        )
        cardiac_pipeline = DataIngestionPipeline(
            cardiac_auth_manager,
            db_connection,
            config
        )
        
        # Initialize pipeline
        await cardiac_pipeline.initialize()
        
        # Initialize Boston Scientific client
        bsc_client = BostonScientificClient(cardiac_auth_manager)
        cardiac_pipeline.register_api_client("boston_scientific", bsc_client)
        cardiac_clients["boston_scientific"] = bsc_client
        
        logger.info("Cardiac device integration initialized successfully")
        return True
        
    except Exception as e:
        logger.error(f"Failed to initialize cardiac device integration: {e}")
        return False


@cardiac_router.get("/", response_class=HTMLResponse)
async def cardiac_dashboard():
    """Serve the cardiac device dashboard"""
    dashboard_html = """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Cardiac Device Dashboard</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <style>
            .device-card {
                border-left: 4px solid #007bff;
                transition: all 0.3s ease;
            }
            .device-card:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 8px rgba(0,0,0,0.1);
            }
            .status-normal { border-left-color: #28a745; }
            .status-warning { border-left-color: #ffc107; }
            .status-critical { border-left-color: #dc3545; }
            .reading-value {
                font-size: 2rem;
                font-weight: bold;
                color: #007bff;
            }
            .chart-container {
                position: relative;
                height: 300px;
            }
            .alert-item {
                border-left: 4px solid #ffc107;
                background-color: #fff8db;
            }
            .alert-critical {
                border-left-color: #dc3545;
                background-color: #f8d7da;
            }
        </style>
    </head>
    <body>
        <nav class="navbar navbar-expand-lg navbar-dark bg-primary">
            <div class="container">
                <a class="navbar-brand" href="/">
                    <i class="fas fa-heartbeat me-2"></i>Cardiac Device Dashboard
                </a>
                <a class="navbar-nav ms-auto btn btn-outline-light" href="/">
                    <i class="fas fa-pills me-2"></i>Pill Identifier
                </a>
            </div>
        </nav>

        <div class="container mt-4">
            <!-- Patient Selection -->
            <div class="row mb-4">
                <div class="col-md-6">
                    <label for="patientSelect" class="form-label">Select Patient:</label>
                    <select class="form-select" id="patientSelect" onchange="loadPatientData()">
                        <option value="">Choose a patient...</option>
                        <option value="PAT001">Patient 001 - John Doe</option>
                        <option value="PAT002">Patient 002 - Jane Smith</option>
                    </select>
                </div>
                <div class="col-md-6">
                    <label class="form-label">Auto Refresh:</label>
                    <div class="form-check form-switch">
                        <input class="form-check-input" type="checkbox" id="autoRefresh" checked onchange="toggleAutoRefresh()">
                        <label class="form-check-label" for="autoRefresh">
                            Enable (30s interval)
                        </label>
                    </div>
                </div>
            </div>

            <!-- Dashboard Content -->
            <div id="dashboardContent" style="display: none;">
                <!-- Patient Devices -->
                <div class="row mb-4">
                    <div class="col-12">
                        <h3><i class="fas fa-devices me-2"></i>Patient Devices</h3>
                        <div id="devicesContainer" class="row">
                            <!-- Device cards will be populated here -->
                        </div>
                    </div>
                </div>

                <!-- Real-time Readings -->
                <div class="row mb-4">
                    <div class="col-md-6">
                        <div class="card">
                            <div class="card-header">
                                <h5><i class="fas fa-chart-line me-2"></i>Heart Rate Trend</h5>
                            </div>
                            <div class="card-body">
                                <div class="chart-container">
                                    <canvas id="heartRateChart"></canvas>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="card">
                            <div class="card-header">
                                <h5><i class="fas fa-battery-half me-2"></i>Battery Levels</h5>
                            </div>
                            <div class="card-body">
                                <div class="chart-container">
                                    <canvas id="batteryChart"></canvas>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Recent Alerts -->
                <div class="row mb-4">
                    <div class="col-12">
                        <h3><i class="fas fa-exclamation-triangle me-2"></i>Recent Alerts</h3>
                        <div id="alertsContainer">
                            <!-- Alerts will be populated here -->
                        </div>
                    </div>
                </div>
            </div>

            <!-- Loading indicator -->
            <div id="loadingIndicator" class="text-center" style="display: none;">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <p class="mt-2">Loading patient data...</p>
            </div>
        </div>

        <script>
            let selectedPatient = '';
            let autoRefreshEnabled = true;
            let refreshInterval = null;
            let heartRateChart = null;
            let batteryChart = null;

            function loadPatientData() {
                const patientId = document.getElementById('patientSelect').value;
                if (!patientId) {
                    document.getElementById('dashboardContent').style.display = 'none';
                    return;
                }

                selectedPatient = patientId;
                document.getElementById('loadingIndicator').style.display = 'block';
                document.getElementById('dashboardContent').style.display = 'none';

                // Load patient devices and data
                Promise.all([
                    loadPatientDevices(patientId),
                    loadPatientAlerts(patientId)
                ]).then(() => {
                    document.getElementById('loadingIndicator').style.display = 'none';
                    document.getElementById('dashboardContent').style.display = 'block';
                    
                    // Initialize charts
                    initializeCharts();
                    
                    // Load recent readings for charts
                    loadChartData();
                }).catch(error => {
                    console.error('Error loading patient data:', error);
                    document.getElementById('loadingIndicator').style.display = 'none';
                    alert('Error loading patient data. Please try again.');
                });
            }

            async function loadPatientDevices(patientId) {
                try {
                    const response = await fetch(`/cardiac/patients/${patientId}/devices`);
                    const devices = await response.json();
                    
                    const container = document.getElementById('devicesContainer');
                    container.innerHTML = '';

                    devices.forEach(device => {
                        const statusClass = `status-${device.status.toLowerCase()}`;
                        const deviceCard = `
                            <div class="col-md-6 mb-3">
                                <div class="card device-card ${statusClass}">
                                    <div class="card-body">
                                        <h5 class="card-title">
                                            <i class="fas fa-heart me-2"></i>${device.model}
                                        </h5>
                                        <p class="card-text">
                                            <strong>Device ID:</strong> ${device.device_id}<br>
                                            <strong>Type:</strong> ${device.device_type}<br>
                                            <strong>Status:</strong> 
                                            <span class="badge bg-${getStatusColor(device.status)}">${device.status}</span><br>
                                            <strong>Battery:</strong> ${device.battery_level}%<br>
                                            <strong>Last Communication:</strong> ${formatDateTime(device.last_communication)}
                                        </p>
                                        <button class="btn btn-primary btn-sm" onclick="viewDeviceDetails('${device.device_id}')">
                                            View Details
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `;
                        container.innerHTML += deviceCard;
                    });
                } catch (error) {
                    console.error('Error loading devices:', error);
                }
            }

            async function loadPatientAlerts(patientId) {
                try {
                    const response = await fetch(`/cardiac/patients/${patientId}/alerts`);
                    const alerts = await response.json();
                    
                    const container = document.getElementById('alertsContainer');
                    container.innerHTML = '';

                    if (alerts.length === 0) {
                        container.innerHTML = '<div class="alert alert-success">No active alerts</div>';
                        return;
                    }

                    alerts.forEach(alert => {
                        const alertClass = alert.severity === 'critical' ? 'alert-critical' : '';
                        const alertItem = `
                            <div class="alert alert-item ${alertClass} d-flex justify-content-between align-items-center">
                                <div>
                                    <h6><i class="fas fa-exclamation-circle me-2"></i>${alert.alert_type}</h6>
                                    <p class="mb-1">${alert.message}</p>
                                    <small class="text-muted">
                                        Device: ${alert.device_id} | ${formatDateTime(alert.timestamp)}
                                    </small>
                                </div>
                                <div>
                                    <span class="badge bg-${getSeverityColor(alert.severity)}">${alert.severity}</span>
                                    ${!alert.acknowledged ? 
                                        `<button class="btn btn-sm btn-outline-primary ms-2" onclick="acknowledgeAlert('${alert.alert_id}')">
                                            Acknowledge
                                        </button>` : 
                                        '<span class="text-success ms-2"><i class="fas fa-check"></i> Acknowledged</span>'
                                    }
                                </div>
                            </div>
                        `;
                        container.innerHTML += alertItem;
                    });
                } catch (error) {
                    console.error('Error loading alerts:', error);
                }
            }

            function initializeCharts() {
                // Heart Rate Chart
                const heartRateCtx = document.getElementById('heartRateChart').getContext('2d');
                heartRateChart = new Chart(heartRateCtx, {
                    type: 'line',
                    data: {
                        labels: [],
                        datasets: [{
                            label: 'Heart Rate (bpm)',
                            data: [],
                            borderColor: 'rgb(75, 192, 192)',
                            backgroundColor: 'rgba(75, 192, 192, 0.2)',
                            tension: 0.1
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            y: {
                                beginAtZero: false,
                                min: 50,
                                max: 120
                            }
                        }
                    }
                });

                // Battery Chart
                const batteryCtx = document.getElementById('batteryChart').getContext('2d');
                batteryChart = new Chart(batteryCtx, {
                    type: 'doughnut',
                    data: {
                        labels: [],
                        datasets: [{
                            data: [],
                            backgroundColor: [
                                'rgb(40, 167, 69)',
                                'rgb(255, 193, 7)',
                                'rgb(220, 53, 69)'
                            ]
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false
                    }
                });
            }

            async function loadChartData() {
                try {
                    // Load heart rate data for the last 24 hours
                    const response = await fetch(`/cardiac/patients/${selectedPatient}/readings?reading_type=heart_rate&hours=24`);
                    const readings = await response.json();
                    
                    // Update heart rate chart
                    const times = readings.map(r => new Date(r.timestamp).toLocaleTimeString());
                    const values = readings.map(r => r.value);
                    
                    heartRateChart.data.labels = times.slice(-20); // Show last 20 readings
                    heartRateChart.data.datasets[0].data = values.slice(-20);
                    heartRateChart.update();
                    
                    // Load battery data
                    const deviceResponse = await fetch(`/cardiac/patients/${selectedPatient}/devices`);
                    const devices = await deviceResponse.json();
                    
                    const batteryLabels = devices.map(d => d.model);
                    const batteryData = devices.map(d => d.battery_level);
                    
                    batteryChart.data.labels = batteryLabels;
                    batteryChart.data.datasets[0].data = batteryData;
                    batteryChart.update();
                    
                } catch (error) {
                    console.error('Error loading chart data:', error);
                }
            }

            async function acknowledgeAlert(alertId) {
                try {
                    const response = await fetch(`/cardiac/alerts/${alertId}/acknowledge`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            acknowledged_by: 'Dashboard User'
                        })
                    });
                    
                    if (response.ok) {
                        // Reload alerts
                        loadPatientAlerts(selectedPatient);
                    } else {
                        alert('Failed to acknowledge alert');
                    }
                } catch (error) {
                    console.error('Error acknowledging alert:', error);
                    alert('Error acknowledging alert');
                }
            }

            function toggleAutoRefresh() {
                autoRefreshEnabled = document.getElementById('autoRefresh').checked;
                
                if (autoRefreshEnabled && selectedPatient) {
                    refreshInterval = setInterval(() => {
                        loadChartData();
                        loadPatientAlerts(selectedPatient);
                    }, 30000); // 30 seconds
                } else if (refreshInterval) {
                    clearInterval(refreshInterval);
                    refreshInterval = null;
                }
            }

            function getStatusColor(status) {
                const colors = {
                    'normal': 'success',
                    'warning': 'warning',
                    'critical': 'danger',
                    'offline': 'secondary'
                };
                return colors[status.toLowerCase()] || 'secondary';
            }

            function getSeverityColor(severity) {
                const colors = {
                    'info': 'info',
                    'low': 'primary',
                    'medium': 'warning',
                    'high': 'danger',
                    'critical': 'danger'
                };
                return colors[severity.toLowerCase()] || 'secondary';
            }

            function formatDateTime(dateString) {
                if (!dateString) return 'N/A';
                return new Date(dateString).toLocaleString();
            }

            function viewDeviceDetails(deviceId) {
                // Implement device detail view
                alert(`Device details for ${deviceId} would be shown here`);
            }

            // Initialize auto-refresh on page load
            document.addEventListener('DOMContentLoaded', function() {
                toggleAutoRefresh();
            });
        </script>
    </body>
    </html>
    """
    return HTMLResponse(content=dashboard_html)


@cardiac_router.post("/credentials/{manufacturer}")
async def store_manufacturer_credentials(
    manufacturer: str,
    credentials: Dict[str, Any]
):
    """Store credentials for a cardiac device manufacturer"""
    global cardiac_auth_manager
    
    if not cardiac_auth_manager:
        raise HTTPException(status_code=503, detail="Cardiac integration not initialized")
    
    try:
        # Create credentials object
        auth_credentials = AuthCredentials(
            manufacturer=manufacturer,
            client_id=credentials["client_id"],
            client_secret=credentials["client_secret"],
            api_key=credentials.get("api_key"),
            environment=credentials.get("environment", "production"),
            additional_params=credentials.get("additional_params")
        )
        
        # Store credentials securely
        cardiac_auth_manager.store_credentials(auth_credentials)
        
        logger.info(f"Credentials stored for manufacturer: {manufacturer}")
        return {"message": f"Credentials stored successfully for {manufacturer}"}
        
    except Exception as e:
        logger.error(f"Failed to store credentials for {manufacturer}: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to store credentials: {e}")


@cardiac_router.get("/patients/{patient_id}/devices")
async def get_patient_devices(patient_id: str):
    """Get all cardiac devices for a patient"""
    global cardiac_pipeline
    
    if not cardiac_pipeline:
        raise HTTPException(status_code=503, detail="Cardiac integration not initialized")
    
    try:
        all_devices = []
        
        # Get devices from all registered manufacturers
        for manufacturer, client in cardiac_clients.items():
            devices = await client.get_patient_devices(patient_id)
            all_devices.extend([device.to_dict() for device in devices])
        
        logger.info(f"Retrieved {len(all_devices)} devices for patient {patient_id}")
        return all_devices
        
    except Exception as e:
        logger.error(f"Failed to get patient devices: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get patient devices: {e}")


@cardiac_router.get("/patients/{patient_id}/readings")
async def get_patient_readings(
    patient_id: str,
    reading_type: Optional[str] = Query(None),
    hours: int = Query(24, ge=1, le=168)  # 1 hour to 1 week
):
    """Get recent readings for a patient's devices"""
    global cardiac_clients
    
    try:
        all_readings = []
        end_time = datetime.utcnow()
        start_time = end_time - timedelta(hours=hours)
        
        # Get devices for this patient
        for manufacturer, client in cardiac_clients.items():
            devices = await client.get_patient_devices(patient_id)
            
            for device in devices:
                readings = await client.get_device_readings(device.device_id, start_time, end_time)
                
                # Filter by reading type if specified
                if reading_type:
                    readings = [r for r in readings if r.reading_type == reading_type]
                
                all_readings.extend([reading.to_dict() for reading in readings])
        
        # Sort by timestamp
        all_readings.sort(key=lambda x: x['timestamp'])
        
        logger.info(f"Retrieved {len(all_readings)} readings for patient {patient_id}")
        return all_readings
        
    except Exception as e:
        logger.error(f"Failed to get patient readings: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get patient readings: {e}")


@cardiac_router.get("/patients/{patient_id}/alerts")
async def get_patient_alerts(patient_id: str, active_only: bool = Query(True)):
    """Get alerts for a patient's devices"""
    global cardiac_clients
    
    try:
        all_alerts = []
        
        # Get devices for this patient
        for manufacturer, client in cardiac_clients.items():
            devices = await client.get_patient_devices(patient_id)
            
            for device in devices:
                alerts = await client.get_device_alerts(device.device_id)
                
                # Filter active alerts if requested
                if active_only:
                    alerts = [a for a in alerts if not a.resolved]
                
                all_alerts.extend([alert.to_dict() for alert in alerts])
        
        # Sort by timestamp (newest first)
        all_alerts.sort(key=lambda x: x['timestamp'], reverse=True)
        
        logger.info(f"Retrieved {len(all_alerts)} alerts for patient {patient_id}")
        return all_alerts
        
    except Exception as e:
        logger.error(f"Failed to get patient alerts: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get patient alerts: {e}")


@cardiac_router.post("/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: str, data: Dict[str, str]):
    """Acknowledge a device alert"""
    global cardiac_clients
    
    try:
        acknowledged_by = data.get("acknowledged_by", "Unknown")
        
        # Try to acknowledge with all manufacturers (alert_id should indicate which one)
        for manufacturer, client in cardiac_clients.items():
            try:
                success = await client.acknowledge_alert(alert_id, acknowledged_by)
                if success:
                    logger.info(f"Alert {alert_id} acknowledged by {acknowledged_by}")
                    return {"message": "Alert acknowledged successfully"}
            except Exception as e:
                # Continue to next manufacturer
                logger.debug(f"Failed to acknowledge with {manufacturer}: {e}")
                continue
        
        raise HTTPException(status_code=404, detail="Alert not found or could not be acknowledged")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to acknowledge alert: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to acknowledge alert: {e}")


@cardiac_router.post("/patients/{patient_id}/ingest")
async def trigger_data_ingestion(patient_id: str, background_tasks: BackgroundTasks):
    """Trigger manual data ingestion for a patient"""
    global cardiac_pipeline
    
    if not cardiac_pipeline:
        raise HTTPException(status_code=503, detail="Cardiac integration not initialized")
    
    # Run ingestion in background
    background_tasks.add_task(run_patient_ingestion, patient_id)
    
    return {"message": f"Data ingestion started for patient {patient_id}"}


async def run_patient_ingestion(patient_id: str):
    """Run data ingestion for a specific patient"""
    try:
        stats = await cardiac_pipeline.ingest_patient_data(patient_id)
        logger.info(f"Ingestion completed for patient {patient_id}: {stats.success_rate:.1f}% success rate")
    except Exception as e:
        logger.error(f"Data ingestion failed for patient {patient_id}: {e}")


@cardiac_router.get("/status")
async def get_integration_status():
    """Get status of cardiac device integration"""
    global cardiac_auth_manager, cardiac_pipeline, cardiac_clients
    
    status = {
        "initialized": cardiac_auth_manager is not None and cardiac_pipeline is not None,
        "auth_manager_active": cardiac_auth_manager is not None,
        "pipeline_active": cardiac_pipeline is not None,
        "registered_manufacturers": list(cardiac_clients.keys()),
        "stored_credentials": []
    }
    
    if cardiac_auth_manager:
        status["stored_credentials"] = cardiac_auth_manager.get_stored_manufacturers()
    
    return status