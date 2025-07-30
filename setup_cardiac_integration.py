#!/usr/bin/env python3
"""
Setup script for Boston Scientific API Integration

This script initializes the cardiac device integration with test credentials
and verifies the system is working correctly.
"""

import asyncio
import requests
import json
import logging
from typing import Dict, Any

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BASE_URL = "http://localhost:8000"

async def setup_test_credentials():
    """Set up test credentials for Boston Scientific"""
    
    credentials = {
        "client_id": "test_bsc_client_12345",
        "client_secret": "test_bsc_secret_67890",
        "api_key": "test_bsc_api_key_abcdef",
        "environment": "sandbox",
        "additional_params": {
            "region": "us-east-1",
            "version": "v1"
        }
    }
    
    try:
        response = requests.post(
            f"{BASE_URL}/cardiac/credentials/boston_scientific",
            json=credentials,
            timeout=10
        )
        
        if response.status_code == 200:
            logger.info("✅ Test credentials stored successfully")
            return True
        else:
            logger.error(f"❌ Failed to store credentials: {response.status_code} - {response.text}")
            return False
            
    except requests.exceptions.ConnectionError:
        logger.error("❌ Cannot connect to server. Please ensure the server is running on http://localhost:8000")
        return False
    except Exception as e:
        logger.error(f"❌ Error storing credentials: {e}")
        return False

def check_integration_status():
    """Check the status of cardiac device integration"""
    
    try:
        response = requests.get(f"{BASE_URL}/cardiac/status", timeout=10)
        
        if response.status_code == 200:
            status = response.json()
            logger.info("📊 Integration Status:")
            logger.info(f"   Initialized: {status.get('initialized', False)}")
            logger.info(f"   Auth Manager Active: {status.get('auth_manager_active', False)}")
            logger.info(f"   Pipeline Active: {status.get('pipeline_active', False)}")
            logger.info(f"   Registered Manufacturers: {status.get('registered_manufacturers', [])}")
            logger.info(f"   Stored Credentials: {status.get('stored_credentials', [])}")
            return status.get('initialized', False)
        else:
            logger.error(f"❌ Failed to get status: {response.status_code}")
            return False
            
    except requests.exceptions.ConnectionError:
        logger.error("❌ Cannot connect to server")
        return False
    except Exception as e:
        logger.error(f"❌ Error checking status: {e}")
        return False

def test_patient_devices():
    """Test getting patient devices"""
    
    try:
        # Test patient PAT001
        response = requests.get(f"{BASE_URL}/cardiac/patients/PAT001/devices", timeout=10)
        
        if response.status_code == 200:
            devices = response.json()
            logger.info(f"✅ Retrieved {len(devices)} devices for patient PAT001")
            
            for device in devices:
                logger.info(f"   Device: {device.get('device_id')} ({device.get('model')})")
                logger.info(f"   Type: {device.get('device_type')} | Status: {device.get('status')}")
                logger.info(f"   Battery: {device.get('battery_level')}%")
            
            return len(devices) > 0
        else:
            logger.error(f"❌ Failed to get devices: {response.status_code}")
            return False
            
    except Exception as e:
        logger.error(f"❌ Error getting devices: {e}")
        return False

def test_patient_readings():
    """Test getting patient readings"""
    
    try:
        # Test patient PAT001 readings
        response = requests.get(
            f"{BASE_URL}/cardiac/patients/PAT001/readings?reading_type=heart_rate&hours=24", 
            timeout=10
        )
        
        if response.status_code == 200:
            readings = response.json()
            logger.info(f"✅ Retrieved {len(readings)} heart rate readings for patient PAT001")
            
            if readings:
                latest = readings[-1]
                logger.info(f"   Latest reading: {latest.get('value')} {latest.get('unit')} at {latest.get('timestamp')}")
            
            return len(readings) > 0
        else:
            logger.error(f"❌ Failed to get readings: {response.status_code}")
            return False
            
    except Exception as e:
        logger.error(f"❌ Error getting readings: {e}")
        return False

def test_patient_alerts():
    """Test getting patient alerts"""
    
    try:
        # Test patient PAT001 alerts
        response = requests.get(f"{BASE_URL}/cardiac/patients/PAT001/alerts", timeout=10)
        
        if response.status_code == 200:
            alerts = response.json()
            logger.info(f"✅ Retrieved {len(alerts)} alerts for patient PAT001")
            
            for alert in alerts:
                logger.info(f"   Alert: {alert.get('alert_type')} | Severity: {alert.get('severity')}")
                logger.info(f"   Message: {alert.get('message')}")
            
            return True  # Alerts might be empty, which is OK
        else:
            logger.error(f"❌ Failed to get alerts: {response.status_code}")
            return False
            
    except Exception as e:
        logger.error(f"❌ Error getting alerts: {e}")
        return False

def trigger_data_ingestion():
    """Trigger manual data ingestion"""
    
    try:
        response = requests.post(f"{BASE_URL}/cardiac/patients/PAT001/ingest", timeout=10)
        
        if response.status_code == 200:
            result = response.json()
            logger.info(f"✅ Data ingestion triggered: {result.get('message')}")
            return True
        else:
            logger.error(f"❌ Failed to trigger ingestion: {response.status_code}")
            return False
            
    except Exception as e:
        logger.error(f"❌ Error triggering ingestion: {e}")
        return False

def main():
    """Main setup and test function"""
    
    logger.info("🚀 Boston Scientific Integration Setup and Test")
    logger.info("=" * 60)
    
    # Check if server is running
    try:
        response = requests.get(f"{BASE_URL}/health", timeout=5)
        logger.info(f"✅ Server is running (status: {response.status_code})")
    except:
        logger.error("❌ Server is not running. Please start the server with: python main.py")
        return False
    
    test_results = []
    
    # Run all tests
    tests = [
        ("Integration Status Check", check_integration_status),
        ("Store Test Credentials", setup_test_credentials),
        ("Get Patient Devices", test_patient_devices),
        ("Get Patient Readings", test_patient_readings),
        ("Get Patient Alerts", test_patient_alerts),
        ("Trigger Data Ingestion", trigger_data_ingestion),
    ]
    
    for test_name, test_func in tests:
        logger.info(f"\n🔍 {test_name}")
        try:
            result = test_func()
            test_results.append((test_name, result))
            status = "✅ PASSED" if result else "❌ FAILED"
            logger.info(f"{status}: {test_name}")
        except Exception as e:
            test_results.append((test_name, False))
            logger.error(f"❌ FAILED: {test_name} - {e}")
        
        logger.info("-" * 40)
    
    # Summary
    passed = sum(1 for _, result in test_results if result)
    total = len(test_results)
    
    logger.info(f"\n🎯 SETUP SUMMARY")
    logger.info(f"Passed: {passed}/{total}")
    logger.info(f"Success Rate: {(passed/total)*100:.1f}%")
    
    if passed == total:
        logger.info("🎉 All tests passed! Boston Scientific integration is ready.")
        logger.info("\n📱 You can now access:")
        logger.info(f"   - Main App: {BASE_URL}/")
        logger.info(f"   - Cardiac Dashboard: {BASE_URL}/cardiac/")
        logger.info(f"   - API Status: {BASE_URL}/cardiac/status")
    else:
        logger.warning("⚠️ Some tests failed. Please check the logs above for details.")
    
    return passed == total

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)