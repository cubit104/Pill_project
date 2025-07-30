"""
Cardiac Device Monitoring FastAPI Server

This is a standalone FastAPI server dedicated to cardiac device monitoring.
It provides real-time monitoring capabilities for cardiac devices from
various manufacturers including Boston Scientific.
"""

import logging
import asyncio
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
import json
import os
import sys

# Add the backend directory to Python path for imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

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

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# Create FastAPI app dedicated to cardiac monitoring
app = FastAPI(
    title="Cardiac Device Monitoring API",
    description="Real-time monitoring and management system for cardiac devices",
    version="2.0.0"
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:8000"],  # React frontend and main app
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global variables for cardiac device integration
cardiac_auth_manager = None
cardiac_pipeline = None
cardiac_clients = {}

# Database URL (can be configured via environment variable)
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres.uqdwcxizabmxwflkbfrb:Potato6200$"
    "supabase@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
)


async def initialize_cardiac_integration():
    """Initialize cardiac device integration components"""
    global cardiac_auth_manager, cardiac_pipeline, cardiac_clients
    
    try:
        # Initialize authentication manager
        cardiac_auth_manager = AuthenticationManager()
        
        # Initialize database connection
        db_connection = DatabaseConnection(DATABASE_URL)
        
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


@app.on_event("startup")
async def startup_event():
    """Initialize the cardiac device integration on startup"""
    success = await initialize_cardiac_integration()
    if success:
        logger.info("Cardiac device monitoring server started successfully")
    else:
        logger.warning("Cardiac device integration failed to initialize")


@app.get("/", response_class=HTMLResponse)
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
                <a class="navbar-nav ms-auto btn btn-outline-light" href="http://localhost:8000">
                    <i class="fas fa-pills me-2"></i>Pill Identifier
                </a>
            </div>
        </nav>

        <div class="container mt-4">
            <div class="alert alert-info">
                <h5><i class="fas fa-info-circle me-2"></i>Cardiac Device Monitoring System</h5>
                <p class="mb-0">This is the dedicated backend server for cardiac device monitoring. 
                The React frontend should be accessed at <a href="http://localhost:3000">http://localhost:3000</a> 
                for the full dashboard experience.</p>
            </div>
            
            <div class="row">
                <div class="col-md-4">
                    <div class="card">
                        <div class="card-body text-center">
                            <h5><i class="fas fa-server me-2"></i>Backend Status</h5>
                            <span class="badge bg-success">Online</span>
                        </div>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="card">
                        <div class="card-body text-center">
                            <h5><i class="fas fa-database me-2"></i>Database</h5>
                            <span class="badge bg-success">Connected</span>
                        </div>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="card">
                        <div class="card-body text-center">
                            <h5><i class="fas fa-link me-2"></i>API Endpoints</h5>
                            <a href="/docs" class="btn btn-primary btn-sm">View API Docs</a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </body>
    </html>
    """
    return HTMLResponse(content=dashboard_html)


@app.post("/credentials/{manufacturer}")
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


@app.get("/patients/{patient_id}/devices")
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


@app.get("/patients/{patient_id}/readings")
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


@app.get("/patients/{patient_id}/alerts")
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


@app.post("/alerts/{alert_id}/acknowledge")
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


@app.post("/patients/{patient_id}/ingest")
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


@app.get("/status")
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


@app.get("/health")
def health_check():
    """Health check endpoint for the cardiac monitoring system"""
    return {
        "status": "healthy",
        "service": "cardiac_monitoring",
        "version": "2.0.0",
        "timestamp": datetime.now().isoformat(),
        "database_url": DATABASE_URL.split("@")[1] if "@" in DATABASE_URL else "configured"
    }


if __name__ == "__main__":
    import uvicorn
    logger.info("Starting Cardiac Device Monitoring Server on port 8001")
    uvicorn.run(app, host="0.0.0.0", port=8001)