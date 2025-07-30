#!/usr/bin/env python3
"""
Test script for Boston Scientific API Integration

This script tests the cardiac device integration functionality
without requiring actual API credentials.
"""

import asyncio
import logging
from datetime import datetime, timedelta
import sys
import os

# Add the project directory to Python path
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
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def test_authentication():
    """Test authentication system"""
    logger.info("=== Testing Authentication System ===")
    
    try:
        # Initialize authentication manager
        auth_manager = AuthenticationManager()
        
        # Create test credentials
        credentials = AuthCredentials(
            manufacturer="boston_scientific",
            client_id="test_client_id",
            client_secret="test_client_secret",
            api_key="test_api_key",
            environment="sandbox"
        )
        
        # Store credentials
        auth_manager.store_credentials(credentials)
        logger.info("✅ Credentials stored successfully")
        
        # Load credentials
        loaded_creds = auth_manager.credential_storage.load_credentials("boston_scientific")
        if loaded_creds and loaded_creds.client_id == "test_client_id":
            logger.info("✅ Credentials loaded successfully")
        else:
            logger.error("❌ Failed to load credentials")
            return False
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Authentication test failed: {e}")
        return False


async def test_boston_scientific_client():
    """Test Boston Scientific client"""
    logger.info("=== Testing Boston Scientific Client ===")
    
    try:
        # Initialize components
        auth_manager = AuthenticationManager()
        
        # Store test credentials
        credentials = AuthCredentials(
            manufacturer="boston_scientific",
            client_id="test_client_id",
            client_secret="test_client_secret",
            environment="sandbox"
        )
        auth_manager.store_credentials(credentials)
        
        # Initialize Boston Scientific client
        bsc_client = BostonScientificClient(auth_manager)
        
        # Test getting patient devices
        devices = await bsc_client.get_patient_devices("PAT001")
        logger.info(f"✅ Retrieved {len(devices)} devices for patient PAT001")
        
        if devices:
            device = devices[0]
            logger.info(f"   Device: {device.device_id} ({device.model})")
            
            # Test getting device readings
            end_time = datetime.utcnow()
            start_time = end_time - timedelta(hours=24)
            readings = await bsc_client.get_device_readings(device.device_id, start_time, end_time)
            logger.info(f"✅ Retrieved {len(readings)} readings for device {device.device_id}")
            
            # Test getting device alerts
            alerts = await bsc_client.get_device_alerts(device.device_id)
            logger.info(f"✅ Retrieved {len(alerts)} alerts for device {device.device_id}")
            
            # Test getting device status
            status = await bsc_client.get_device_status(device.device_id)
            logger.info(f"✅ Retrieved device status: {status.get('status', 'unknown')}")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Boston Scientific client test failed: {e}")
        return False


async def test_data_ingestion():
    """Test data ingestion pipeline"""
    logger.info("=== Testing Data Ingestion Pipeline ===")
    
    try:
        # Initialize components
        auth_manager = AuthenticationManager()
        
        # Store test credentials
        credentials = AuthCredentials(
            manufacturer="boston_scientific",
            client_id="test_client_id",
            client_secret="test_client_secret",
            environment="sandbox"
        )
        auth_manager.store_credentials(credentials)
        
        # Use SQLite for testing (simpler than PostgreSQL)
        db_connection = DatabaseConnection("sqlite:///test_cardiac_devices.db")
        
        # Initialize pipeline with test configuration
        config = IngestionConfig(
            batch_size=10,
            retry_attempts=2,
            validation_enabled=True,
            alert_threshold_violations=False  # Disable for testing
        )
        
        pipeline = DataIngestionPipeline(auth_manager, db_connection, config)
        await pipeline.initialize()
        
        # Register Boston Scientific client
        bsc_client = BostonScientificClient(auth_manager)
        pipeline.register_api_client("boston_scientific", bsc_client)
        
        # Test patient data ingestion
        stats = await pipeline.ingest_patient_data("PAT001", ["boston_scientific"])
        
        logger.info(f"✅ Ingestion completed:")
        logger.info(f"   Total readings: {stats.total_readings}")
        logger.info(f"   Successful: {stats.successful_readings}")
        logger.info(f"   Failed: {stats.failed_readings}")
        logger.info(f"   Success rate: {stats.success_rate:.1f}%")
        
        # Cleanup
        await pipeline.cleanup()
        
        return stats.success_rate > 0
        
    except Exception as e:
        logger.error(f"❌ Data ingestion test failed: {e}")
        return False


async def test_data_validation():
    """Test data validation"""
    logger.info("=== Testing Data Validation ===")
    
    try:
        from cardiac_device_integration.data_models import (
            DeviceReading, DeviceType, DeviceStatus, DataValidationRules
        )
        
        # Create test reading with normal values
        normal_reading = DeviceReading(
            device_id="TEST-001",
            patient_id="PAT001",
            manufacturer="boston_scientific",
            reading_type="heart_rate",
            value=72.0,
            unit="bpm",
            timestamp=datetime.utcnow(),
            device_type=DeviceType.PACEMAKER,
            status=DeviceStatus.NORMAL
        )
        
        # Create test reading with abnormal values
        abnormal_reading = DeviceReading(
            device_id="TEST-001",
            patient_id="PAT001",
            manufacturer="boston_scientific",
            reading_type="heart_rate",
            value=250.0,  # Abnormally high
            unit="bpm",
            timestamp=datetime.utcnow(),
            device_type=DeviceType.PACEMAKER,
            status=DeviceStatus.NORMAL
        )
        
        # Test validation
        normal_violations = DataValidationRules.validate_reading(normal_reading)
        abnormal_violations = DataValidationRules.validate_reading(abnormal_reading)
        
        logger.info(f"✅ Normal reading violations: {len(normal_violations)}")
        logger.info(f"✅ Abnormal reading violations: {len(abnormal_violations)}")
        
        if len(abnormal_violations) > 0:
            logger.info(f"   Detected violation: {abnormal_violations[0]}")
        
        return len(normal_violations) == 0 and len(abnormal_violations) > 0
        
    except Exception as e:
        logger.error(f"❌ Data validation test failed: {e}")
        return False


async def main():
    """Run all tests"""
    logger.info("🚀 Starting Boston Scientific API Integration Tests")
    
    test_results = []
    
    # Run all test functions
    test_functions = [
        ("Authentication", test_authentication),
        ("Boston Scientific Client", test_boston_scientific_client),
        ("Data Validation", test_data_validation),
        ("Data Ingestion", test_data_ingestion)
    ]
    
    for test_name, test_func in test_functions:
        try:
            result = await test_func()
            test_results.append((test_name, result))
            status = "✅ PASSED" if result else "❌ FAILED"
            logger.info(f"{status}: {test_name}")
        except Exception as e:
            test_results.append((test_name, False))
            logger.error(f"❌ FAILED: {test_name} - {e}")
        
        logger.info("-" * 50)
    
    # Summary
    passed = sum(1 for _, result in test_results if result)
    total = len(test_results)
    
    logger.info("🎯 TEST SUMMARY")
    logger.info(f"Passed: {passed}/{total}")
    logger.info(f"Success Rate: {(passed/total)*100:.1f}%")
    
    if passed == total:
        logger.info("🎉 All tests passed! Boston Scientific integration is working correctly.")
    else:
        logger.warning("⚠️ Some tests failed. Please check the logs above for details.")
    
    return passed == total


if __name__ == "__main__":
    # Run the tests
    success = asyncio.run(main())
    sys.exit(0 if success else 1)