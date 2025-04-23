import re
import pandas as pd

class NDCHandler:
    """Complete NDC handling solution - normalization, lookup, and search"""
    
    def __init__(self, drugs_csv_path='drugs.csv', ndc_csv_path='ndc_relationships.csv'):
        """Initialize with paths to the CSV files"""
        print(f"Loading NDC data from {ndc_csv_path} and {drugs_csv_path}")
        self.drugs_df = pd.read_csv(drugs_csv_path)
        self.ndc_df = pd.read_csv(ndc_csv_path)
        print(f"Loaded {len(self.drugs_df)} drugs and {len(self.ndc_df)} NDC relationships")
    
    def normalize_ndc(self, ndc_input):
        """Normalize NDC codes to standard format"""
        if not ndc_input:
            return None
            
        # Remove all non-alphanumeric characters
        clean_ndc = re.sub(r'[^0-9]', '', ndc_input)
        
        # Handle 11-digit NDC (5-4-2 format)
        if len(clean_ndc) == 11:
            return f"{clean_ndc[0:5]}-{clean_ndc[5:9]}-{clean_ndc[9:]}"
        
        # Handle 10-digit NDC (convert to 11-digit)
        elif len(clean_ndc) == 10:
            # 10-digit is usually 4-4-2 format, convert to 5-4-2
            return f"0{clean_ndc[0:4]}-{clean_ndc[4:8]}-{clean_ndc[8:]}"
        
        # Handle 9-digit NDC (4-4-1 or 5-3-1 or 5-4 formats)
        elif len(clean_ndc) == 9:
            # Most common is 5-4 format (no product code)
            return f"{clean_ndc[0:5]}-{clean_ndc[5:]}"
        
        # Return original with dashes if we can't determine format
        else:
            return ndc_input
    
    def get_all_ndc_formats(self, ndc):
        """Returns all possible formats for a given NDC"""
        normalized = self.normalize_ndc(ndc)
        if not normalized:
            return []
            
        clean = re.sub(r'[^0-9]', '', normalized)
        
        formats = []
        # Add normalized version with dashes
        formats.append(normalized)
        
        # Add version without dashes
        formats.append(clean)
        
        # Add HIPAA standard format if possible (11-digit)
        if len(clean) in [9, 10, 11]:
            if len(clean) == 9:
                hipaa = f"00{clean[0:5]}0{clean[5:9]}"
            elif len(clean) == 10:
                hipaa = f"0{clean}"
            else:
                hipaa = clean
            
            # Add hyphenated HIPAA standard
            hipaa_dashed = f"{hipaa[0:5]}-{hipaa[5:9]}-{hipaa[9:]}"
            formats.append(hipaa_dashed)
            formats.append(hipaa)
        
        return list(set(formats))  # Remove duplicates
    
    def find_drug_by_ndc(self, ndc_code):
        """Find a drug by NDC code, handles normalization automatically"""
        normalized_ndc = self.normalize_ndc(ndc_code)
        clean_ndc = re.sub(r'[^0-9]', '', normalized_ndc)
        
        # Try to find a match with or without dashes
        ndc_match = self.ndc_df[
            (self.ndc_df['ndc9'].str.replace('-', '') == clean_ndc) | 
            (self.ndc_df['ndc9'] == normalized_ndc)
        ]
        
        if ndc_match.empty:
            return None
            
        drug_id = ndc_match['drug_id'].iloc[0]
        drug = self.drugs_df[self.drugs_df['drug_id'] == drug_id]
        
        if drug.empty:
            return None
        
        # Get all related NDCs
        related_ndcs = self.ndc_df[self.ndc_df['drug_id'] == drug_id]['ndc9'].tolist()
        source_ndcs = self.ndc_df[(self.ndc_df['drug_id'] == drug_id) & (self.ndc_df['is_source'] == True)]['ndc9'].tolist()
        source_ndc = source_ndcs[0] if source_ndcs else None
        
        # Prepare result
        result = drug.iloc[0].to_dict()
        result['related_ndcs'] = related_ndcs
        result['source_ndc'] = source_ndc
        
        return result
    
    def get_ndc_suggestions(self, partial_ndc, limit=10):
        """Get NDC suggestions based on partial input"""
        if not partial_ndc or len(partial_ndc) < 2:
            return []
            
        # Clean the input for matching
        clean_partial = re.sub(r'[^0-9-]', '', partial_ndc).lower()
        
        matches = []
        # If user entered dashes, respect that format in search
        if '-' in clean_partial:
            # Find any NDC that starts with this pattern
            matching_ndcs = self.ndc_df[self.ndc_df['ndc9'].str.lower().str.startswith(clean_partial)]
            matches = matching_ndcs['ndc9'].drop_duplicates().head(limit).tolist()
        else:
            # For non-dashed input, remove dashes from the database values for comparison
            temp_df = self.ndc_df.copy()
            temp_df['ndc_clean'] = temp_df['ndc9'].str.replace('-', '')
            matching_ndcs = temp_df[temp_df['ndc_clean'].str.startswith(clean_partial)]
            matches = matching_ndcs['ndc9'].drop_duplicates().head(limit).tolist()
        
        return matches
    
    def search_drugs_by_ndc(self, ndc_code, page=1, per_page=25, color=None, shape=None):
        """Search for drugs by NDC with pagination and filtering"""
        normalized_ndc = self.normalize_ndc(ndc_code)
        clean_ndc = re.sub(r'[^0-9]', '', normalized_ndc)
        
        # Try to find a match with or without dashes
        ndc_matches = self.ndc_df[
            (self.ndc_df['ndc9'].str.replace('-', '') == clean_ndc) | 
            (self.ndc_df['ndc9'] == normalized_ndc)
        ]
        
        if ndc_matches.empty:
            return {
                'results': [], 
                'page': page, 
                'total_pages': 0
            }
        
        # Get drug_ids from matches
        drug_ids = ndc_matches['drug_id'].unique()
        
        # Get all drugs with these IDs
        drug_results = self.drugs_df[self.drugs_df['drug_id'].isin(drug_ids)].copy()
        
        # Apply filters if provided
        if color:
            drug_results = drug_results[drug_results['color'].str.lower() == color.lower()]
        if shape:
            drug_results = drug_results[drug_results['form'].str.lower() == shape.lower()]
            
        # Add all related NDCs to each drug
        for idx, row in drug_results.iterrows():
            related_ndcs = self.ndc_df[self.ndc_df['drug_id'] == row['drug_id']]['ndc9'].tolist()
            drug_results.at[idx, 'related_ndcs'] = related_ndcs
        
        # Calculate pagination
        total = len(drug_results)
        start_idx = (page - 1) * per_page
        end_idx = start_idx + per_page
        
        paginated_results = drug_results.iloc[start_idx:end_idx].to_dict('records')
        total_pages = (total + per_page - 1) // per_page
        
        return {
            'results': paginated_results, 
            'page': page, 
            'total_pages': total_pages
        }