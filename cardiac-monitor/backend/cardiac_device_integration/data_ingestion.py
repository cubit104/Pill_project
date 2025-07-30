"""
Data Ingestion Pipeline for Cardiac Device Integration

Handles the ingestion, transformation, and storage of cardiac device data
from multiple manufacturers with error handling, retry logic, and monitoring.
"""

import logging
import asyncio
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Callable
from dataclasses import dataclass
import json
from concurrent.futures import ThreadPoolExecutor
import traceback

from .api_client import DeviceAPIClient
from .data_models import DeviceReading, PatientDevice, DeviceAlert, DataValidationRules
from .authentication import AuthenticationManager

logger = logging.getLogger(__name__)


@dataclass
class IngestionConfig:
    """Configuration for data ingestion pipeline"""
    batch_size: int = 100
    retry_attempts: int = 3
    retry_delay: int = 5  # seconds
    max_workers: int = 4
    validation_enabled: bool = True
    duplicate_check_window: int = 24  # hours
    alert_threshold_violations: bool = True


@dataclass
class IngestionStats:
    """Statistics for data ingestion run"""
    start_time: datetime
    end_time: Optional[datetime] = None
    total_readings: int = 0
    successful_readings: int = 0
    failed_readings: int = 0
    duplicate_readings: int = 0
    validation_failures: int = 0
    alerts_generated: int = 0
    errors: List[str] = None
    
    def __post_init__(self):
        if self.errors is None:
            self.errors = []
    
    @property
    def duration(self) -> Optional[timedelta]:
        if self.end_time:
            return self.end_time - self.start_time
        return None
    
    @property
    def success_rate(self) -> float:
        if self.total_readings == 0:
            return 0.0
        return (self.successful_readings / self.total_readings) * 100


class DatabaseConnection:
    """Database connection handler for storing cardiac device data"""
    
    def __init__(self, connection_string: str):
        self.connection_string = connection_string
        self._connection = None
        
    async def connect(self):
        """Connect to database"""
        try:
            # Try to use the existing connection from main.py
            from sqlalchemy import create_engine
            self._connection = create_engine(self.connection_string)
            logger.info("Database connection established for cardiac device data")
        except Exception as e:
            logger.error(f"Failed to connect to database: {e}")
            raise
    
    async def ensure_tables_exist(self):
        """Ensure cardiac device tables exist"""
        try:
            from .data_models import (
                DEVICE_READINGS_SCHEMA, 
                PATIENT_DEVICES_SCHEMA, 
                DEVICE_ALERTS_SCHEMA
            )
            
            # Convert PostgreSQL syntax to work with existing database
            schemas = [
                DEVICE_READINGS_SCHEMA.replace("SERIAL", "INTEGER PRIMARY KEY").replace("JSONB", "JSON"),
                PATIENT_DEVICES_SCHEMA.replace("SERIAL", "INTEGER PRIMARY KEY").replace("JSONB", "JSON"),
                DEVICE_ALERTS_SCHEMA.replace("SERIAL", "INTEGER PRIMARY KEY").replace("JSONB", "JSON")
            ]
            
            if self._connection:
                with self._connection.connect() as conn:
                    for schema in schemas:
                        # Remove INDEX statements as they're not part of CREATE TABLE
                        create_table = schema.split("INDEX")[0].rstrip().rstrip(',') + "\n);"
                        try:
                            conn.execute(create_table)
                            conn.commit()
                        except Exception as e:
                            # Table might already exist
                            logger.debug(f"Table creation note: {e}")
                            
                logger.info("Cardiac device database tables ensured")
        except Exception as e:
            logger.error(f"Failed to ensure database tables: {e}")
            raise
    
    async def store_device_readings(self, readings: List[DeviceReading]) -> int:
        """Store device readings in database"""
        if not readings:
            return 0
            
        try:
            stored_count = 0
            if self._connection:
                with self._connection.connect() as conn:
                    for reading in readings:
                        # Check for duplicates
                        if not await self._is_duplicate_reading(conn, reading):
                            insert_sql = """
                            INSERT INTO device_readings 
                            (device_id, patient_id, manufacturer, reading_type, value, unit, 
                             timestamp, device_type, status, raw_data, metadata)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """
                            
                            conn.execute(insert_sql, (
                                reading.device_id,
                                reading.patient_id,
                                reading.manufacturer,
                                reading.reading_type,
                                reading.value,
                                reading.unit,
                                reading.timestamp,
                                reading.device_type.value,
                                reading.status.value,
                                json.dumps(reading.raw_data) if reading.raw_data else None,
                                json.dumps(reading.metadata) if reading.metadata else None
                            ))
                            stored_count += 1
                    
                    conn.commit()
            
            logger.info(f"Stored {stored_count} device readings")
            return stored_count
            
        except Exception as e:
            logger.error(f"Failed to store device readings: {e}")
            raise
    
    async def _is_duplicate_reading(self, conn, reading: DeviceReading) -> bool:
        """Check if reading is a duplicate"""
        try:
            check_sql = """
            SELECT COUNT(*) FROM device_readings 
            WHERE device_id = ? AND reading_type = ? AND timestamp = ?
            """
            
            result = conn.execute(check_sql, (
                reading.device_id,
                reading.reading_type,
                reading.timestamp
            ))
            
            count = result.scalar()
            return count > 0
            
        except Exception as e:
            logger.error(f"Error checking for duplicate reading: {e}")
            return False
    
    async def store_device_alerts(self, alerts: List[DeviceAlert]) -> int:
        """Store device alerts in database"""
        if not alerts:
            return 0
            
        try:
            stored_count = 0
            if self._connection:
                with self._connection.connect() as conn:
                    for alert in alerts:
                        # Check if alert already exists
                        check_sql = "SELECT COUNT(*) FROM device_alerts WHERE alert_id = ?"
                        result = conn.execute(check_sql, (alert.alert_id,))
                        
                        if result.scalar() == 0:
                            insert_sql = """
                            INSERT INTO device_alerts 
                            (alert_id, device_id, patient_id, manufacturer, alert_type, 
                             severity, message, timestamp, acknowledged, acknowledged_by, 
                             acknowledged_at, resolved, resolved_at, metadata)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """
                            
                            conn.execute(insert_sql, (
                                alert.alert_id,
                                alert.device_id,
                                alert.patient_id,
                                alert.manufacturer,
                                alert.alert_type,
                                alert.severity.value,
                                alert.message,
                                alert.timestamp,
                                alert.acknowledged,
                                alert.acknowledged_by,
                                alert.acknowledged_at,
                                alert.resolved,
                                alert.resolved_at,
                                json.dumps(alert.metadata) if alert.metadata else None
                            ))
                            stored_count += 1
                    
                    conn.commit()
            
            logger.info(f"Stored {stored_count} device alerts")
            return stored_count
            
        except Exception as e:
            logger.error(f"Failed to store device alerts: {e}")
            raise


class DataValidator:
    """Validates cardiac device data"""
    
    def __init__(self, config: IngestionConfig):
        self.config = config
        self.validation_rules = DataValidationRules()
    
    def validate_reading(self, reading: DeviceReading) -> List[str]:
        """Validate a device reading"""
        violations = []
        
        if not self.config.validation_enabled:
            return violations
        
        # Basic data validation
        if not reading.device_id:
            violations.append("Missing device_id")
        
        if not reading.patient_id:
            violations.append("Missing patient_id")
        
        if reading.value is None:
            violations.append("Missing reading value")
        
        if not reading.unit:
            violations.append("Missing unit")
        
        if not reading.timestamp:
            violations.append("Missing timestamp")
        
        # Range validation
        range_violations = self.validation_rules.validate_reading(reading)
        violations.extend(range_violations)
        
        return violations
    
    def validate_readings_batch(self, readings: List[DeviceReading]) -> Dict[str, List[str]]:
        """Validate a batch of readings"""
        validation_results = {}
        
        for i, reading in enumerate(readings):
            violations = self.validate_reading(reading)
            if violations:
                validation_results[f"reading_{i}"] = violations
        
        return validation_results


class DataIngestionPipeline:
    """Main data ingestion pipeline"""
    
    def __init__(
        self, 
        auth_manager: AuthenticationManager,
        database_connection: DatabaseConnection,
        config: IngestionConfig = None
    ):
        self.auth_manager = auth_manager
        self.database = database_connection
        self.config = config or IngestionConfig()
        self.validator = DataValidator(self.config)
        self._api_clients: Dict[str, DeviceAPIClient] = {}
        self._executor = ThreadPoolExecutor(max_workers=self.config.max_workers)
        
    def register_api_client(self, manufacturer: str, client: DeviceAPIClient):
        """Register API client for a manufacturer"""
        self._api_clients[manufacturer] = client
        logger.info(f"API client registered for manufacturer: {manufacturer}")
    
    async def initialize(self):
        """Initialize the pipeline"""
        await self.database.connect()
        await self.database.ensure_tables_exist()
        logger.info("Data ingestion pipeline initialized")
    
    async def ingest_patient_data(self, patient_id: str, manufacturers: List[str] = None) -> IngestionStats:
        """Ingest all data for a specific patient"""
        stats = IngestionStats(start_time=datetime.utcnow())
        
        try:
            # Use all registered manufacturers if none specified
            if manufacturers is None:
                manufacturers = list(self._api_clients.keys())
            
            # Get all devices for this patient across manufacturers
            all_devices = []
            for manufacturer in manufacturers:
                if manufacturer in self._api_clients:
                    try:
                        client = self._api_clients[manufacturer]
                        devices = await client.get_patient_devices(patient_id)
                        all_devices.extend(devices)
                        logger.info(f"Found {len(devices)} devices for patient {patient_id} from {manufacturer}")
                    except Exception as e:
                        error_msg = f"Failed to get devices for patient {patient_id} from {manufacturer}: {e}"
                        logger.error(error_msg)
                        stats.errors.append(error_msg)
            
            # Ingest recent readings for each device
            for device in all_devices:
                device_stats = await self._ingest_device_data(device)
                stats.total_readings += device_stats.total_readings
                stats.successful_readings += device_stats.successful_readings
                stats.failed_readings += device_stats.failed_readings
                stats.duplicate_readings += device_stats.duplicate_readings
                stats.validation_failures += device_stats.validation_failures
                stats.alerts_generated += device_stats.alerts_generated
                stats.errors.extend(device_stats.errors)
            
        except Exception as e:
            error_msg = f"Failed to ingest patient data: {e}"
            logger.error(error_msg)
            stats.errors.append(error_msg)
        
        stats.end_time = datetime.utcnow()
        logger.info(f"Patient data ingestion completed for {patient_id}: {stats.success_rate:.1f}% success rate")
        return stats
    
    async def _ingest_device_data(self, device: PatientDevice) -> IngestionStats:
        """Ingest data for a specific device"""
        stats = IngestionStats(start_time=datetime.utcnow())
        
        try:
            client = self._api_clients.get(device.manufacturer)
            if not client:
                error_msg = f"No API client registered for manufacturer: {device.manufacturer}"
                logger.error(error_msg)
                stats.errors.append(error_msg)
                return stats
            
            # Get recent readings (last 24 hours by default)
            readings = await client.get_recent_readings(device.device_id, hours=24)
            stats.total_readings = len(readings)
            
            if readings:
                # Validate readings
                validation_results = self.validator.validate_readings_batch(readings)
                stats.validation_failures = len(validation_results)
                
                if validation_results:
                    logger.warning(f"Validation failures for device {device.device_id}: {validation_results}")
                
                # Filter out readings with validation failures if strict validation is enabled
                if self.config.validation_enabled and validation_results:
                    valid_readings = []
                    for i, reading in enumerate(readings):
                        if f"reading_{i}" not in validation_results:
                            valid_readings.append(reading)
                    readings = valid_readings
                
                # Store readings in batches
                stored_count = await self.database.store_device_readings(readings)
                stats.successful_readings = stored_count
                stats.duplicate_readings = len(readings) - stored_count
                
                # Generate alerts for out-of-range values
                if self.config.alert_threshold_violations:
                    alerts = self._generate_threshold_alerts(readings, device)
                    if alerts:
                        await self.database.store_device_alerts(alerts)
                        stats.alerts_generated = len(alerts)
            
            # Get and store device alerts
            device_alerts = await client.get_device_alerts(device.device_id)
            if device_alerts:
                stored_alerts = await self.database.store_device_alerts(device_alerts)
                stats.alerts_generated += stored_alerts
                
        except Exception as e:
            error_msg = f"Failed to ingest data for device {device.device_id}: {e}"
            logger.error(error_msg)
            logger.error(traceback.format_exc())
            stats.errors.append(error_msg)
            stats.failed_readings = stats.total_readings
        
        stats.end_time = datetime.utcnow()
        return stats
    
    def _generate_threshold_alerts(self, readings: List[DeviceReading], device: PatientDevice) -> List[DeviceAlert]:
        """Generate alerts for readings that violate thresholds"""
        from .data_models import DeviceAlert, AlertSeverity
        import uuid
        
        alerts = []
        
        for reading in readings:
            violations = self.validator.validation_rules.validate_reading(reading)
            
            for violation in violations:
                if "above normal range" in violation or "below normal range" in violation:
                    severity = AlertSeverity.HIGH if "Critical" in violation else AlertSeverity.MEDIUM
                    
                    alert = DeviceAlert(
                        alert_id=str(uuid.uuid4()),
                        device_id=device.device_id,
                        patient_id=device.patient_id,
                        manufacturer=device.manufacturer,
                        alert_type="threshold_violation",
                        severity=severity,
                        message=f"Threshold violation detected: {violation}",
                        timestamp=reading.timestamp,
                        metadata={
                            "reading_type": reading.reading_type,
                            "reading_value": reading.value,
                            "reading_unit": reading.unit,
                            "violation_details": violation
                        }
                    )
                    alerts.append(alert)
        
        return alerts
    
    async def run_continuous_ingestion(self, patient_ids: List[str], interval_minutes: int = 60):
        """Run continuous data ingestion for specified patients"""
        logger.info(f"Starting continuous ingestion for {len(patient_ids)} patients, interval: {interval_minutes} minutes")
        
        while True:
            try:
                start_time = datetime.utcnow()
                
                # Ingest data for all patients
                total_stats = IngestionStats(start_time=start_time)
                
                for patient_id in patient_ids:
                    patient_stats = await self.ingest_patient_data(patient_id)
                    
                    # Aggregate stats
                    total_stats.total_readings += patient_stats.total_readings
                    total_stats.successful_readings += patient_stats.successful_readings
                    total_stats.failed_readings += patient_stats.failed_readings
                    total_stats.duplicate_readings += patient_stats.duplicate_readings
                    total_stats.validation_failures += patient_stats.validation_failures
                    total_stats.alerts_generated += patient_stats.alerts_generated
                    total_stats.errors.extend(patient_stats.errors)
                
                total_stats.end_time = datetime.utcnow()
                
                logger.info(
                    f"Continuous ingestion cycle completed: "
                    f"{total_stats.successful_readings}/{total_stats.total_readings} readings, "
                    f"{total_stats.alerts_generated} alerts, "
                    f"{len(total_stats.errors)} errors"
                )
                
                # Wait for next interval
                await asyncio.sleep(interval_minutes * 60)
                
            except KeyboardInterrupt:
                logger.info("Continuous ingestion stopped by user")
                break
            except Exception as e:
                logger.error(f"Error in continuous ingestion cycle: {e}")
                # Wait before retrying
                await asyncio.sleep(60)
    
    async def cleanup(self):
        """Cleanup resources"""
        if self._executor:
            self._executor.shutdown(wait=True)
        
        for client in self._api_clients.values():
            if hasattr(client, 'close'):
                await client.close()
        
        logger.info("Data ingestion pipeline cleaned up")