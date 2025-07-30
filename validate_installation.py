#!/usr/bin/env python3
"""
Installation validation script for Pill Project
Run this after installation to verify all dependencies are working
"""

import sys
import importlib

def test_import(module_name, package_name=None):
    """Test if a module can be imported"""
    try:
        importlib.import_module(module_name)
        print(f"✓ {package_name or module_name}")
        return True
    except ImportError as e:
        print(f"✗ {package_name or module_name}: {e}")
        return False

def main():
    print("Pill Project - Installation Validation")
    print("=" * 40)
    
    required_modules = [
        ("fastapi", "FastAPI"),
        ("uvicorn", "Uvicorn"),
        ("pandas", "Pandas"),
        ("sqlalchemy", "SQLAlchemy"),
        ("psycopg2", "psycopg2-binary"),
        ("requests", "Requests"),
        ("httpx", "HTTPX"),
        ("pydantic", "Pydantic"),
    ]
    
    optional_modules = [
        ("aiohttp", "aiohttp (optional)"),
    ]
    
    print("\nTesting required dependencies:")
    required_ok = all(test_import(module, name) for module, name in required_modules)
    
    print("\nTesting optional dependencies:")
    for module, name in optional_modules:
        test_import(module, name)
    
    print("\nTesting main application:")
    try:
        from main import app
        print("✓ Main application imports successfully")
        app_ok = True
    except Exception as e:
        print(f"✗ Main application: {e}")
        app_ok = False
    
    print("\n" + "=" * 40)
    if required_ok and app_ok:
        print("✓ Installation validation PASSED")
        print("You can now run: python main.py")
        return 0
    else:
        print("✗ Installation validation FAILED")
        print("Please check the installation instructions in README.md")
        return 1

if __name__ == "__main__":
    sys.exit(main())