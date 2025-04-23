import pandas as pd
import json
import re

# File paths - update these to match your file locations
input_csv_path = 'Final_structured_combined_with_image_filename.csv'  # Your original CSV
drugs_output_path = 'drugs.csv'  # New drugs CSV
ndc_output_path = 'ndc_relationships.csv'  # New NDC relationships CSV

print("Loading original CSV file...")
# Load your original CSV
df = pd.read_csv(input_csv_path)

# Initialize lists to hold our new data
drugs = []
ndc_relationships = []
drug_id = 1  # Starting ID for drugs
processed_medicines = set()  # To track which medicines we've already processed

print("Processing data rows...")
# Process each row in the original dataset
for idx, row in df.iterrows():
    try:
        # Skip if we've already processed this medicine
        medicine_name = row['medicine_name']
        if medicine_name in processed_medicines:
            continue
            
        # Add this medicine to processed set
        processed_medicines.add(medicine_name)
        
        # Extract drug information
        drug_info = {
            'drug_id': drug_id,
            'medicine_name': medicine_name,
            'rxcui': row.get('rxcui', ''),
            'spl_strength': row.get('spl_strength', ''),
            'spl_ingredients': row.get('spl_ingredients', ''),
            'form': row.get('splshape_text', ''),
            'color': row.get('splcolor_text', '')
            # Add other relevant columns as needed
        }
        
        # Look for NDC data in columns
        found_ndcs = False
        
        # Try to find complex NDC structures (JSON-like arrays)
        for col in df.columns:
            if isinstance(row[col], str) and row[col].startswith('[{') and '@sourceNdc9' in row[col]:
                try:
                    # Clean the JSON-like string (replace single quotes with double quotes)
                    json_str = row[col].replace("'", '"')
                    ndc_data = json.loads(json_str)
                    
                    # Extract source NDC
                    source_ndc = ndc_data[0].get('@sourceNdc9', '')
                    if source_ndc:
                        ndc_relationships.append({
                            'drug_id': drug_id,
                            'ndc9': source_ndc,
                            'is_source': True
                        })
                    
                    # Extract related NDCs
                    related_ndcs = ndc_data[0].get('ndc9', [])
                    for ndc in related_ndcs:
                        ndc_relationships.append({
                            'drug_id': drug_id,
                            'ndc9': ndc,
                            'is_source': False
                        })
                    
                    found_ndcs = True
                    break  # Found NDC data, no need to check other columns
                except Exception as e:
                    print(f"Warning: Couldn't parse NDC JSON in row {idx}, column {col}: {e}")
        
        # If no complex NDCs found, look for simple NDC9 column
        if not found_ndcs and 'ndc9' in df.columns and pd.notna(row['ndc9']):
            ndc_relationships.append({
                'drug_id': drug_id,
                'ndc9': row['ndc9'],
                'is_source': True  # Assume it's a source NDC
            })
        
        # Add the drug to our list
        drugs.append(drug_info)
        
        # Increment drug_id for next drug
        drug_id += 1
        
        if idx % 100 == 0:
            print(f"Processed {idx} rows...")
            
    except Exception as e:
        print(f"Error processing row {idx}: {e}")

# Create DataFrames
print("Creating DataFrames...")
drugs_df = pd.DataFrame(drugs)
ndc_df = pd.DataFrame(ndc_relationships)

# Save to CSV files
print(f"Saving {len(drugs_df)} drugs to {drugs_output_path}...")
drugs_df.to_csv(drugs_output_path, index=False)

print(f"Saving {len(ndc_df)} NDC relationships to {ndc_output_path}...")
ndc_df.to_csv(ndc_output_path, index=False)

print("Done! Files created successfully.")