import zipfile
import os
import csv
import shutil
import re
import base64
import uuid
import sys
from pathlib import Path
from lxml import etree

def process_zip_file(zip_path, output_dir="output"):
    """Process a zip file containing XML content and images using FDA_engine."""
    output_dir = Path(output_dir)
    images_dir = output_dir / "images"
    html_dir = output_dir / "html"
    
    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(images_dir, exist_ok=True)
    os.makedirs(html_dir, exist_ok=True)
    
    print(f"Processing zip file: {zip_path}")
    
    # List to store data for CSV
    csv_data = []
    
    # Open the zip file
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        # Extract all files to a temporary directory
        temp_dir = output_dir / "temp"
        os.makedirs(temp_dir, exist_ok=True)
        zip_ref.extractall(temp_dir)
        
        # Find the FDA_engine/spl.xsl file
        xslt_path = find_xslt_file(temp_dir)
        if not xslt_path:
            print("Looking for spl.xsl in FDA_engine directory...")
            xslt_path = Path("FDA_engine") / "spl.xsl"
            if not xslt_path.exists():
                print(f"Error: XSLT file {xslt_path} does not exist.")
                return
        
        print(f"Using XSLT file: {xslt_path}")
        
        # First scan for all image files in the ZIP
        all_image_files = scan_for_images(temp_dir, images_dir)
        print(f"Found {len(all_image_files)} total image files")
        
        # Load the XSLT transformer
        try:
            xslt_tree = etree.parse(str(xslt_path))
            transformer = etree.XSLT(xslt_tree)
            print("Successfully loaded XSLT transformer")
        except Exception as e:
            print(f"Error loading XSLT file: {e}")
            return
        
        # Process all XML files
        xml_files = list(Path(temp_dir).glob("**/*.xml"))
        print(f"Found {len(xml_files)} XML files to process")
        
        all_html_files = []
        
        for xml_path in xml_files:
            try:
                print(f"\nProcessing XML file: {xml_path.name}")
                
                # Parse XML with namespace preservation
                parser = etree.XMLParser(recover=True)
                xml_tree = etree.parse(str(xml_path), parser=parser)
                
                # Extract setid
                setid = extract_setid(xml_tree, xml_path)
                print(f"  Set ID: {setid}")
                
                # Extract embedded images from XML
                image_map = extract_images_from_xml(xml_tree, images_dir)
                print(f"  Extracted {len(image_map)} embedded images from XML")
                
                # Combine with all image files
                for img_id, img_file in all_image_files.items():
                    if img_id not in image_map:
                        image_map[img_id] = img_file
                
                print(f"  Total available images: {len(image_map)}")
                if image_map:
                    print(f"  Image IDs: {', '.join(list(image_map.keys())[:10])}{'...' if len(image_map) > 10 else ''}")
                
                # Transform XML to HTML using FDA engine XSLT
                html_content = transform_xml_to_html(xml_tree, transformer)
                
                # Post-process HTML to fix image references
                html_content = fix_image_references(html_content, image_map)
                
                # Save HTML file directly
                html_filename = f"{setid}.html"
                html_path = html_dir / html_filename
                
                with open(html_path, 'w', encoding='utf-8') as html_file:
                    html_file.write(html_content)
                
                print(f"  HTML file saved to: {html_path}")
                all_html_files.append((html_filename, setid))
                
                # Build CSV data
                image_filenames = ','.join(image_map.values())
                csv_data.append([image_filenames, setid, html_content])
                print(f"  Added entry to CSV data with {len(image_map)} images")
                
            except Exception as e:
                print(f"Error processing {xml_path}: {e}")
        
        # Create an index.html file for easy viewing
        create_index_html(html_dir, all_html_files)
    
    # Write to CSV with increased field size limit
    csv_path = output_dir / "output.csv"
    
    # Use a larger field size limit for CSV
    max_int = sys.maxsize
    while True:
        try:
            csv.field_size_limit(max_int)
            break
        except OverflowError:
            max_int = int(max_int/10)
    
    try:
        with open(csv_path, 'w', newline='', encoding='utf-8') as csvfile:
            csv_writer = csv.writer(csvfile)
            csv_writer.writerow(['image_filenames', 'setid', 'html_content'])
            csv_writer.writerows(csv_data)
        
        print(f"CSV file created at: {csv_path}")
        print(f"Total entries in CSV: {len(csv_data)}")
    except Exception as e:
        print(f"Error writing CSV file: {e}")
        print(f"Error details: {str(e)}")
    
    # Clean up temporary directory
    shutil.rmtree(temp_dir)
    print("Processing complete!")
    print(f"To view the HTML files, open {html_dir}/index.html in your browser")
    print(f"CSV file with extracted data is saved at: {csv_path}")

def scan_for_images(base_dir, images_dir):
    """Scan for all image files and create a mapping from filenames to paths."""
    image_map = {}  # Maps potential image IDs to filenames
    image_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.tif', '.tiff']
    
    print("Scanning for image files...")
    
    for img_path in Path(base_dir).glob('**/*'):
        if img_path.is_file() and img_path.suffix.lower() in image_extensions:
            try:
                # Get the filename without extension as a potential ID
                img_id = img_path.stem
                
                # Also create a version with hyphens instead of underscores
                img_id_alt = img_id.replace('_', '-')
                
                # Create destination filename
                dest_filename = img_path.name
                dest_path = images_dir / dest_filename
                
                # Create unique name if needed
                if dest_path.exists():
                    name, ext = os.path.splitext(dest_filename)
                    dest_filename = f"{name}_{uuid.uuid4().hex[:8]}{ext}"
                    dest_path = images_dir / dest_filename
                
                # Copy the file
                shutil.copy2(img_path, dest_path)
                
                # Add both versions of ID to the map
                image_map[img_id] = dest_filename
                image_map[img_id_alt] = dest_filename
                
                print(f"  Copied image: {dest_filename} (IDs: {img_id}, {img_id_alt})")
                
            except Exception as e:
                print(f"  Error copying image {img_path}: {e}")
    
    return image_map

def find_xslt_file(base_dir):
    """Find the spl.xsl file in the extracted content or FDA_engine directory."""
    for path in Path(base_dir).glob("**/spl.xsl"):
        return path
    return None

def extract_images_from_xml(xml_tree, images_dir):
    """Extract images from XML content and create a mapping of IDs to filenames."""
    image_map = {}  # Maps image ID to filename
    
    # Define namespaces for more precise XPath queries
    namespaces = {
        'hl7': 'urn:hl7-org:v3',
        'xsi': 'http://www.w3.org/2001/XMLSchema-instance',
        'spl': 'urn:hl7-org:v3'
    }
    
    # Try with namespace first
    try:
        observation_media_elements = xml_tree.xpath("//hl7:observationMedia", namespaces=namespaces)
    except:
        # Fall back to namespace-agnostic approach
        observation_media_elements = xml_tree.xpath("//*[local-name()='observationMedia']")
    
    # Process each observationMedia element
    for element in observation_media_elements:
        try:
            # Get the ID attribute
            image_id = element.get("ID")
            if not image_id:
                continue
                
            print(f"    Found image reference ID: {image_id}")
            
            # Find the value element containing the image data
            try:
                value_elements = element.xpath("./hl7:value[@mediaType]", namespaces=namespaces)
            except:
                value_elements = element.xpath("./*[local-name()='value' and @mediaType]")
            
            if not value_elements:
                print(f"    No value element found for {image_id}")
                continue
                
            value_element = value_elements[0]
            media_type = value_element.get("mediaType", "")
            
            if "image" not in media_type.lower():
                continue
                
            # Determine file extension
            if "jpeg" in media_type.lower() or "jpg" in media_type.lower():
                ext = ".jpg"
            elif "png" in media_type.lower():
                ext = ".png"
            elif "gif" in media_type.lower():
                ext = ".gif"
            else:
                ext = ".img"
            
            # Create filename based on ID
            image_filename = f"{image_id}{ext}"
            image_path = images_dir / image_filename
            
            # Extract and save the image data
            image_data = value_element.text
            if image_data and image_data.strip():
                try:
                    # Check if we have actual data before decoding
                    image_data = image_data.strip()
                    
                    # Try to decode base64
                    decoded_data = base64.b64decode(image_data)
                    if len(decoded_data) == 0:
                        print(f"    Image {image_id} decoded to 0 bytes - skipping")
                        continue
                    
                    with open(image_path, "wb") as f:
                        f.write(decoded_data)
                    
                    # Verify the image was created and has content
                    if os.path.getsize(image_path) > 0:
                        # Add to image map
                        image_map[image_id] = image_filename
                        print(f"    Saved image: {image_filename} ({os.path.getsize(image_path)} bytes)")
                    else:
                        print(f"    Image {image_id} saved but has 0 bytes - deleting")
                        os.remove(image_path)
                except Exception as e:
                    print(f"    Error saving image {image_id}: {e}")
            else:
                print(f"    Image {image_id} has no data - skipping")
            
        except Exception as e:
            print(f"    Error processing image element: {e}")
    
    return image_map

def transform_xml_to_html(xml_tree, transformer):
    """Transform XML to HTML using FDA engine XSLT transformer."""
    try:
        # Apply the XSLT transformation
        result = transformer(xml_tree)
        
        # Convert the result to HTML
        html_content = etree.tostring(result, method='html', encoding='unicode', pretty_print=True)
        print("  Successfully transformed XML to HTML using FDA engine")
        
        # Add doctype and html/head elements if missing
        if "<!DOCTYPE" not in html_content:
            html_content = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body {{ font-family: Arial, sans-serif; margin: 20px; }}
        img {{ max-width: 100%; height: auto; margin: 10px 0; }}
        .spl-inserted-image {{ max-width: 300px; display: block; margin: 10px 0; }}
    </style>
</head>
<body>
    {html_content}
</body>
</html>"""
        
        return html_content
    except Exception as e:
        print(f"  Error during XSLT transformation: {e}")
        print("  Falling back to simple XML to string conversion")
        # Fallback to a simple conversion if XSLT fails
        return f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Failed Transformation</title>
</head>
<body>
    <h1>XSLT Transformation Failed</h1>
    <pre>{etree.tostring(xml_tree, encoding='unicode', pretty_print=True)}</pre>
</body>
</html>"""

def fix_image_references(html_content, image_map):
    """Fix image references in HTML content to point to the extracted images."""
    # Check if any image references need to be fixed
    if not image_map:
        return html_content
    
    print("  Fixing image references in HTML")
    
    # Create a comprehensive regex for image IDs
    # This will match any standalone occurrence of the image IDs
    image_id_pattern = r'(>|\s|\()(' + '|'.join([re.escape(img_id) for img_id in image_map.keys()]) + r')(\s|<|\)|$)'
    
    # Modify HTML content directly with regex
    modified_html = html_content
    
    # Replace renderMultiMedia references if present
    for img_id, img_file in image_map.items():
        pattern1 = f'referencedObject="{img_id}"'
        replacement1 = f'referencedObject="{img_id}"><img src="../images/{img_file}" alt="Image {img_id}" class="spl-image"'
        modified_html = modified_html.replace(pattern1, replacement1)
        
        # Also try with single quotes
        pattern1b = f"referencedObject='{img_id}'"
        replacement1b = f"referencedObject='{img_id}'><img src='../images/{img_file}' alt='Image {img_id}' class='spl-image'"
        modified_html = modified_html.replace(pattern1b, replacement1b)
    
    # Replace text occurrences of image IDs using the compiled pattern
    def replace_image_id(match):
        prefix = match.group(1)
        img_id = match.group(2)
        suffix = match.group(3)
        
        # Only replace if the ID is actually in our map
        if img_id in image_map:
            img_file = image_map[img_id]
            return f'{prefix}<img src="../images/{img_file}" alt="Image {img_id}" class="spl-inserted-image" style="max-width:300px; display:block; margin:10px 0;">{suffix}'
        else:
            return match.group(0)
    
    modified_html = re.sub(image_id_pattern, replace_image_id, modified_html)
    
    return modified_html

def extract_setid(xml_tree, xml_path):
    """Extract a setid from the XML using multiple approaches."""
    # Try specific namespaces
    namespaces = {
        'hl7': 'urn:hl7-org:v3',
        'xsi': 'http://www.w3.org/2001/XMLSchema-instance',
        'spl': 'urn:hl7-org:v3'
    }
    
    # First try with namespace
    try:
        setid_elements = xml_tree.xpath("//hl7:setId", namespaces=namespaces)
        if setid_elements and setid_elements[0].get("root"):
            return setid_elements[0].get("root")
    except:
        pass
        
    # Try with local-name (no namespace)
    setid_elements = xml_tree.xpath("//*[local-name()='setId']")
    if setid_elements and setid_elements[0].get("root"):
        return setid_elements[0].get("root")
    
    # Try document ID
    id_elements = xml_tree.xpath("//*[local-name()='id']")
    if id_elements and id_elements[0].get("root"):
        return id_elements[0].get("root")
    
    # Use the filename as a last resort
    return Path(xml_path).stem

def create_index_html(html_dir, html_files):
    """Create an index.html file that lists all processed files and provides image debugging."""
    index_path = html_dir / "index.html"
    
    # Create HTML content
    html_content = """<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>DailyMed SPL Viewer</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            max-width: 1200px;
            margin: 0 auto;
        }
        h1 {
            color: #2c3e50;
            border-bottom: 1px solid #eee;
            padding-bottom: 10px;
        }
        ul {
            list-style-type: none;
            padding: 0;
        }
        li {
            margin: 10px 0;
            padding: 10px;
            background-color: #f8f9fa;
            border-radius: 4px;
        }
        li:hover {
            background-color: #e9ecef;
        }
        a {
            color: #007bff;
            text-decoration: none;
            display: block;
            padding: 5px 0;
        }
        a:hover {
            text-decoration: underline;
        }
        .image-check {
            margin-top: 20px;
            padding: 15px;
            background-color: #f8f9fa;
            border: 1px solid #ddd;
            border-radius: 4px;
        }
        .images {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-top: 10px;
        }
        .image-item {
            border: 1px solid #ddd;
            padding: 5px;
            text-align: center;
        }
        .image-item img {
            max-width: 150px;
            max-height: 150px;
        }
        button {
            background-color: #007bff;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
        }
        button:hover {
            background-color: #0069d9;
        }
        #status {
            margin-top: 10px;
            padding: 10px;
            background-color: #e9ecef;
        }
        pre {
            background-color: #f8f9fa;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            overflow: auto;
        }
    </style>
</head>
<body>
    <h1>DailyMed SPL Viewer</h1>
    
    <p>The following files were extracted from the DailyMed SPL data:</p>
    
    <ul>
"""
    
    # Add links to each HTML file
    for filename, setid in html_files:
        html_content += f'        <li><a href="{filename}">{setid}</a></li>\n'
    
    # Add image debugging tools
    html_content += """    </ul>
    
    <div class="image-check">
        <h2>Image Debugging</h2>
        <p>This section helps you debug image display issues.</p>
        
        <h3>1. Check Available Images</h3>
        <button id="checkImagesBtn">Check Available Images</button>
        <div id="status"></div>
        <div class="images" id="imagesContainer"></div>
        
        <h3>2. Fix CSS for Viewing</h3>
        <p>If images aren't displaying properly in the HTML files, use this CSS fix:</p>
        <pre>
/* Add this to the top of any HTML file */
&lt;style&gt;
img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 10px 0;
}
.spl-inserted-image {
  border: 1px solid #ddd;
  padding: 5px;
}
&lt;/style&gt;
</pre>
        
        <h3>3. View Image References</h3>
        <p>Common image IDs in this document:</p>
        <ul id="imageIds">
            <li>push-plunger</li>
            <li>syringe-in-cup</li>
            <li>capsule-child-upright</li>
            <li>5mL-cup</li>
            <li>stir-liquid</li>
            <li>clean-syringe</li>
        </ul>
    </div>
    
    <script>
        document.getElementById('checkImagesBtn').addEventListener('click', function() {
            const statusDiv = document.getElementById('status');
            const imagesContainer = document.getElementById('imagesContainer');
            
            statusDiv.textContent = 'Checking for images...';
            imagesContainer.innerHTML = '';
            
            // Common IDs from the document
            const commonIds = [
                'push-plunger', 'syringe-in-cup', 'capsule-child-upright',
                '5mL-cup', 'stir-liquid', 'clean-syringe'
            ];
            
            // Extensions to check
            const extensions = ['.jpg', '.jpeg', '.png', '.gif', '.svg'];
            
            let foundImages = 0;
            
            // Test for images with common IDs and extensions
            commonIds.forEach(id => {
                extensions.forEach(ext => {
                    const img = new Image();
                    const filename = `../images/${id}${ext}`;
                    
                    img.onload = function() {
                        foundImages++;
                        statusDiv.textContent = `Found ${foundImages} images`;
                        
                        const imageItem = document.createElement('div');
                        imageItem.className = 'image-item';
                        
                        const imageElement = document.createElement('img');
                        imageElement.src = filename;
                        imageElement.alt = id;
                        
                        const imageTitle = document.createElement('div');
                        imageTitle.textContent = id + ext;
                        
                        imageItem.appendChild(imageElement);
                        imageItem.appendChild(imageTitle);
                        imagesContainer.appendChild(imageItem);
                    };
                    
                    img.src = filename;
                });
            });
            
            // If no images found after a timeout, show message
            setTimeout(() => {
                if (foundImages === 0) {
                    statusDiv.textContent = 'No images found with common IDs. Check path issues or missing images.';
                    
                    // Add debugging info
                    const debugInfo = document.createElement('pre');
                    debugInfo.textContent = 
                        'Debug tips:\\n' +
                        '1. Make sure images/ directory exists next to the HTML files\\n' +
                        '2. Check if images have the expected IDs as filenames\\n' +
                        '3. Try accessing ../images/[id].jpg directly\\n' +
                        '4. Consider using a local web server for better path handling';
                    
                    statusDiv.appendChild(debugInfo);
                }
            }, 2000);
        });
    </script>
</body>
</html>
"""

    # Write the index.html file
    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(html_content)
    
    print(f"Created index.html at {index_path}")

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        zip_file = sys.argv[1]
        output_dir = sys.argv[2] if len(sys.argv) > 2 else "output"
        process_zip_file(zip_file, output_dir)
    else:
        print("Usage: python spl_extractor_complete.py <zip_file> [output_directory]")
