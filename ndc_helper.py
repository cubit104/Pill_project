import pandas as pd

class NDCHelper:
    def __init__(self, drugs_csv='drugs.csv', ndc_csv='ndc_relationships.csv'):
        """Initialize the NDC Helper with your existing CSV files."""
        self.drugs_df = pd.read_csv(drugs_csv)
        self.ndc_df = pd.read_csv(ndc_csv)
        print(f"NDCHelper loaded {len(self.drugs_df)} drugs and {len(self.ndc_df)} NDC relationships")
    
    def find_drug_by_ndc(self, ndc9):
        """Find a drug by NDC9 code using your CSV files."""
        # Find which drug this NDC belongs to
        ndc_match = self.ndc_df[self.ndc_df['ndc9'] == ndc9]
        if ndc_match.empty:
            return None
        
        drug_id = ndc_match['drug_id'].iloc[0]
        drug = self.drugs_df[self.drugs_df['drug_id'] == drug_id]
        
        if drug.empty:
            return None
        
        # Get all related NDCs
        related = self.ndc_df[self.ndc_df['drug_id'] == drug_id]
        
        # Prepare result with all drug details
        result = drug.iloc[0].to_dict()
        result['related_ndcs'] = related['ndc9'].tolist()
        
        # Find the source/primary NDC
        source_ndcs = related[related['is_source'] == True]['ndc9'].tolist()
        result['source_ndc'] = source_ndcs[0] if source_ndcs else None
        
        return result