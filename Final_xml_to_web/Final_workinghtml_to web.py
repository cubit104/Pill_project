import csv
import os
import sys
import re
import shutil
import webbrowser
from pathlib import Path
from bs4 import BeautifulSoup

def extract_full_spl_document(csv_path, output_dir="complete_spl_docs"):
    """
    Extract complete SPL document with all sections and properly placed images.
    Preserves the original document structure and section order.
    """
    # Setup directories
    output_dir = Path(output_dir)
    images_dir = output_dir / "images"
    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(images_dir, exist_ok=True)
    
    # Find the CSV file
    csv_path = Path(csv_path) if csv_path else find_csv_file()
    if not csv_path or not csv_path.exists():
        print(f"CSV file not found. Please specify the correct path.")
        return False
    
    print(f"Processing CSV file: {csv_path}")
    
    # Increase CSV field size limit
    import sys
    max_int = sys.maxsize
    while True:
        try:
            csv.field_size_limit(max_int)
            break
        except OverflowError:
            max_int = int(max_int/10)
    
    docs_processed = 0
    
    # Process the CSV
    try:
        with open(csv_path, 'r', encoding='utf-8', errors='replace') as csvfile:
            csv_reader = csv.reader(csvfile)
            headers = next(csv_reader)
            
            # Find column indices
            html_index = next((i for i, h in enumerate(headers) if 'html' in h.lower()), 2)
            setid_index = next((i for i, h in enumerate(headers) if 'setid' in h.lower()), 1)
            image_index = next((i for i, h in enumerate(headers) if 'image' in h.lower()), -1)
            
            print(f"Using columns: HTML={html_index}, SetID={setid_index}, Images={image_index}")
            
            for row in csv_reader:
                if len(row) <= max(html_index, setid_index):
                    continue
                    
                setid = row[setid_index]
                html_content = row[html_index]
                
                print(f"Processing document: {setid}")
                
                # Get list of image files
                image_files = []
                if image_index >= 0 and image_index < len(row) and row[image_index]:
                    image_files = row[image_index].split(',')
                    print(f"  Found {len(image_files)} image references")
                
                # Copy images from source directories
                copy_images(image_files, images_dir)
                
                # Process the HTML content
                processed_html = process_complete_spl_document(html_content, image_files)
                
                # Save the HTML document
                document_path = output_dir / f"{setid}_complete.html"
                with open(document_path, 'w', encoding='utf-8') as f:
                    f.write(processed_html)
                
                print(f"  Complete document saved to: {document_path}")
                docs_processed += 1
        
        # Create index file
        if docs_processed > 0:
            create_index_file(output_dir)
            print(f"Processed {docs_processed} documents")
            return True
        else:
            print("No documents were processed")
            return False
            
    except Exception as e:
        print(f"Error processing CSV: {e}")
        return False

def process_complete_spl_document(html_content, image_files):
    """
    Process the SPL document HTML to ensure all sections are preserved and
    images are correctly placed.
    """
    try:
        # Parse with BeautifulSoup
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Fix image references throughout the document
        fix_image_references(soup, image_files)
        
        # Add enhanced styling for better readability
        add_document_styling(soup)
        
        # Ensure document has proper HTML structure
        ensure_proper_html_structure(soup)
        
        return str(soup)
    except Exception as e:
        print(f"Error processing HTML: {e}")
        
        # Return a basic HTML wrapper if parsing fails
        return f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>SPL Document</title>
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.5; margin: 20px; }}
        img {{ max-width: 100%; height: auto; margin: 10px 0; }}
    </style>
</head>
<body>
    {html_content}
</body>
</html>"""

def fix_image_references(soup, image_files):
    """Fix all image references in the document."""
    # 1. Fix existing img tags
    for img in soup.find_all('img'):
        src = img.get('src', '')
        if src:
            # Fix the path
            if '../images/' in src:
                img['src'] = src.replace('../images/', 'images/')
            elif not src.startswith('images/'):
                filename = Path(src).name
                img['src'] = f'images/{filename}'
                
            # Add styling
            img['style'] = "max-width: 100%; display: block; margin: 10px 0;"
    
    # 2. Look for image references in text (like "push-plunger", "syringe-in-cup", etc.)
    for image_file in image_files:
        img_id = Path(image_file).stem
        
        # Skip very short IDs to avoid false positives
        if len(img_id) < 4:
            continue
            
        # Find text nodes that might contain image references
        text_nodes = soup.find_all(text=lambda text: text and img_id in text)
        
        for text in text_nodes:
            if text.parent.name not in ['script', 'style']:
                try:
                    # Create new image tag
                    new_img = soup.new_tag('img')
                    new_img['src'] = f'images/{image_file}'
                    new_img['alt'] = f'Image {img_id}'
                    new_img['class'] = 'inserted-image'
                    new_img['style'] = "display: block; margin: 10px 0; max-width: 100%;"
                    
                    # Replace the text reference with the image
                    parent = text.parent
                    if parent:
                        # Split text and replace the image ID with the image tag
                        new_content = []
                        parts = text.split(img_id)
                        
                        if len(parts) > 1:
                            # Insert first part of text
                            new_content.append(parts[0])
                            
                            # Insert image
                            new_content.append(new_img)
                            
                            # Insert remaining text
                            if len(parts) > 1:
                                new_content.append(''.join(parts[1:]))
                                
                            # Replace the text node
                            text.replace_with('')
                            
                            # Add each element in order
                            for i, item in enumerate(new_content):
                                if isinstance(item, str):
                                    if i == 0:
                                        parent.insert(0, item)
                                    else:
                                        parent.append(item)
                                else:
                                    parent.append(item)
                except Exception as e:
                    print(f"  Error inserting image {img_id}: {e}")

def add_document_styling(soup):
    """Add enhanced styling to the SPL document."""
    # Create or find head
    if not soup.head:
        head = soup.new_tag('head')
        if soup.html:
            soup.html.insert(0, head)
        else:
            html = soup.new_tag('html')
            html.append(head)
            soup.append(html)
    
    # Add style
    style = soup.new_tag('style')
    style.string = """
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            margin: 20px auto;
            max-width: 1100px;
            color: #333;
            padding: 0 20px;
        }
        
        h1, h2, h3, h4 {
            color: #2c3e50;
            margin-top: 1.5em;
            margin-bottom: 0.5em;
        }
        
        h1 {
            font-size: 26px;
            border-bottom: 1px solid #eee;
            padding-bottom: 10px;
        }
        
        h2 {
            font-size: 22px;
            border-bottom: 1px solid #f0f0f0;
            padding-bottom: 5px;
        }
        
        h3 {
            font-size: 18px;
        }
        
        table {
            border-collapse: collapse;
            width: 100%;
            margin: 20px 0;
        }
        
        th, td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
        }
        
        th {
            background-color: #f2f2f2;
        }
        
        img {
            max-width: 100%;
            height: auto;
            display: block;
            margin: 15px 0;
        }
        
        .warning-box {
            background-color: #fff3cd;
            padding: 15px;
            border-left: 5px solid #ffc107;
            margin: 20px 0;
        }
        
        .section {
            margin-bottom: 30px;
        }
        
        .highlight {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 4px;
            margin: 20px 0;
        }
        
        .boxed-warning {
            border: 2px solid #dc3545;
            padding: 10px;
            margin: 15px 0;
        }
        
        /* Print-friendly styles */
        @media print {
            body { font-size: 12pt; }
            h1 { font-size: 18pt; }
            h2 { font-size: 16pt; }
            h3 { font-size: 14pt; }
            img { max-width: 500px; }
            @page { margin: 2cm; }
        }
    """
    
    # Add the style tag
    soup.head.append(style)
    
    # Add a title if missing
    if not soup.title:
        title = soup.new_tag('title')
        title.string = "SPL Document"
        soup.head.append(title)

def ensure_proper_html_structure(soup):
    """Ensure the document has proper HTML structure."""
    # Make sure we have html, head, and body
    if not soup.html:
        new_html = soup.new_tag('html')
        for tag in list(soup.children):
            new_html.append(tag.extract())
        soup.append(new_html)
        
    if not soup.body and soup.html:
        body = soup.new_tag('body')
        for tag in list(soup.html.children):
            if tag.name not in ['head', 'meta', 'title', 'style', 'link', 'script']:
                body.append(tag.extract())
        soup.html.append(body)
    
    # Add meta tag for responsive design
    if soup.head:
        if not soup.head.find('meta', attrs={'name': 'viewport'}):
            meta = soup.new_tag('meta')
            meta['name'] = 'viewport'
            meta['content'] = 'width=device-width, initial-scale=1.0'
            soup.head.insert(0, meta)

def copy_images(image_files, images_dir):
    """Copy images from potential source directories to the output directory."""
    # Potential source directories
    source_dirs = [
        Path("output/images"),
        Path("images"),
        Path("./images"),
        Path("../images"),
        Path("./output/images"),
    ]
    
    # Add parent directories of the current directory
    current_dir = Path.cwd()
    for parent in [current_dir, current_dir.parent]:
        source_dirs.append(parent / "images")
        source_dirs.append(parent / "output" / "images")
    
    images_copied = 0
    
    # Try to copy each image file
    for img_file in image_files:
        img_file = img_file.strip()
        copied = False
        
        for source_dir in source_dirs:
            if source_dir.exists() and source_dir.is_dir():
                source_path = source_dir / img_file
                if source_path.exists():
                    target_path = images_dir / img_file
                    try:
                        shutil.copy2(source_path, target_path)
                        images_copied += 1
                        copied = True
                        break
                    except Exception as e:
                        print(f"  Error copying {img_file}: {e}")
        
        if not copied:
            print(f"  Could not find source for image: {img_file}")
    
    print(f"  Copied {images_copied} out of {len(image_files)} images")

def create_index_file(output_dir):
    """Create an index.html file for the extracted documents."""
    output_dir = Path(output_dir)
    doc_files = list(output_dir.glob("*_complete.html"))
    
    if not doc_files:
        print("No document files found to index.")
        return
    
    index_path = output_dir / "index.html"
    with open(index_path, 'w', encoding='utf-8') as f:
        f.write("""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Complete SPL Documents</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            margin: 0 auto;
            max-width: 1000px;
            padding: 20px;
            color: #333;
        }
        h1 {
            color: #2c3e50;
            border-bottom: 1px solid #eee;
            padding-bottom: 10px;
            margin-bottom: 30px;
        }
        ul {
            list-style-type: none;
            padding: 0;
        }
        li {
            margin: 15px 0;
            padding: 15px;
            background-color: #f8f9fa;
            border-radius: 4px;
            transition: background-color 0.3s;
        }
        li:hover {
            background-color: #e9ecef;
        }
        a {
            color: #007bff;
            text-decoration: none;
            display: block;
            font-size: 18px;
        }
        a:hover {
            text-decoration: underline;
        }
        .info-box {
            background-color: #d1ecf1;
            padding: 15px;
            border-radius: 4px;
            margin-bottom: 30px;
        }
        .instructions {
            margin-top: 40px;
            padding: 20px;
            background-color: #f8f9fa;
            border-radius: 4px;
        }
    </style>
</head>
<body>
    <h1>Complete SPL Documents with Images</h1>
    
    <div class="info-box">
        <p><strong>Documents Ready for Viewing</strong></p>
        <p>The documents below contain the complete content from the SPL files with all sections preserved and images properly placed.</p>
    </div>
    
    <ul>
""")
        
        for doc_file in doc_files:
            doc_id = doc_file.stem.split('_')[0]
            f.write(f'        <li><a href="{doc_file.name}">{doc_id}</a></li>\n')
            
        f.write("""    </ul>
    
    <div class="instructions">
        <h2>How to View These Documents</h2>
        <p>Click on any document above to view the complete SPL content.</p>
        <p>Images should appear inline where they are referenced in the document.</p>
        <p>These documents preserve the original structure of the SPL files, including all sections.</p>
    </div>
</body>
</html>""")
    
    print(f"\nIndex file created at: {index_path}")
    
    # Try to open in browser
    try:
        webbrowser.open(str(index_path))
    except:
        print("Could not automatically open browser. Please open the index file manually.")

def find_csv_file():
    """Search for CSV files in common locations."""
    possible_locations = [
        Path("output/output.csv"),
        Path("output.csv"),
        Path("./output.csv"),
        Path("./output/output.csv"),
    ]
    
    # Search current directory and subdirectories
    current_dir = Path.cwd()
    csv_files = list(current_dir.glob("**/*.csv"))
    possible_locations.extend(csv_files)
    
    # Check each location
    for loc in possible_locations:
        if loc.exists():
            print(f"Found CSV file: {loc}")
            return loc
    
    return None

if __name__ == "__main__":
    csv_path = sys.argv[1] if len(sys.argv) > 1 else None
    output_dir = "complete_spl_docs"
    extract_full_spl_document(csv_path, output_dir)