export interface PopularMed {
  name: string
  slug: string
  category: string
}

export const POPULAR_MEDICATIONS: PopularMed[] = [
  // Pain Relief
  { name: 'Ibuprofen', slug: 'ibuprofen', category: 'Pain Relief' },
  { name: 'Acetaminophen', slug: 'acetaminophen', category: 'Pain Relief' },
  { name: 'Naproxen', slug: 'naproxen', category: 'Pain Relief' },
  { name: 'Aspirin', slug: 'aspirin', category: 'Pain Relief' },
  { name: 'Tramadol', slug: 'tramadol', category: 'Pain Relief' },

  // Blood Pressure
  { name: 'Lisinopril', slug: 'lisinopril', category: 'Blood Pressure' },
  { name: 'Amlodipine', slug: 'amlodipine', category: 'Blood Pressure' },
  { name: 'Losartan', slug: 'losartan', category: 'Blood Pressure' },
  { name: 'Metoprolol', slug: 'metoprolol', category: 'Blood Pressure' },
  { name: 'Hydrochlorothiazide', slug: 'hydrochlorothiazide', category: 'Blood Pressure' },

  // Diabetes
  { name: 'Metformin', slug: 'metformin', category: 'Diabetes' },
  { name: 'Glipizide', slug: 'glipizide', category: 'Diabetes' },
  { name: 'Sitagliptin', slug: 'sitagliptin', category: 'Diabetes' },
  { name: 'Semaglutide', slug: 'semaglutide', category: 'Diabetes' },
  { name: 'Empagliflozin', slug: 'empagliflozin', category: 'Diabetes' },

  // Cholesterol
  { name: 'Atorvastatin', slug: 'atorvastatin', category: 'Cholesterol' },
  { name: 'Simvastatin', slug: 'simvastatin', category: 'Cholesterol' },
  { name: 'Rosuvastatin', slug: 'rosuvastatin', category: 'Cholesterol' },
  { name: 'Pravastatin', slug: 'pravastatin', category: 'Cholesterol' },

  // Mental Health
  { name: 'Sertraline', slug: 'sertraline', category: 'Mental Health' },
  { name: 'Escitalopram', slug: 'escitalopram', category: 'Mental Health' },
  { name: 'Fluoxetine', slug: 'fluoxetine', category: 'Mental Health' },
  { name: 'Bupropion', slug: 'bupropion', category: 'Mental Health' },
  { name: 'Trazodone', slug: 'trazodone', category: 'Mental Health' },
  { name: 'Alprazolam', slug: 'alprazolam', category: 'Mental Health' },

  // Antibiotics
  { name: 'Amoxicillin', slug: 'amoxicillin', category: 'Antibiotics' },
  { name: 'Azithromycin', slug: 'azithromycin', category: 'Antibiotics' },
  { name: 'Ciprofloxacin', slug: 'ciprofloxacin', category: 'Antibiotics' },
  { name: 'Doxycycline', slug: 'doxycycline', category: 'Antibiotics' },
  { name: 'Cephalexin', slug: 'cephalexin', category: 'Antibiotics' },

  // Stomach & GI
  { name: 'Omeprazole', slug: 'omeprazole', category: 'Stomach & GI' },
  { name: 'Pantoprazole', slug: 'pantoprazole', category: 'Stomach & GI' },
  { name: 'Famotidine', slug: 'famotidine', category: 'Stomach & GI' },

  // Thyroid & Hormones
  { name: 'Levothyroxine', slug: 'levothyroxine', category: 'Thyroid & Hormones' },
  { name: 'Prednisone', slug: 'prednisone', category: 'Thyroid & Hormones' },

  // Allergies
  { name: 'Loratadine', slug: 'loratadine', category: 'Allergies' },
  { name: 'Cetirizine', slug: 'cetirizine', category: 'Allergies' },
  { name: 'Diphenhydramine', slug: 'diphenhydramine', category: 'Allergies' },
  { name: 'Montelukast', slug: 'montelukast', category: 'Allergies' },

  // Sleep / Muscle
  { name: 'Cyclobenzaprine', slug: 'cyclobenzaprine', category: 'Muscle & Sleep' },
  { name: 'Zolpidem', slug: 'zolpidem', category: 'Muscle & Sleep' },
  { name: 'Melatonin', slug: 'melatonin', category: 'Muscle & Sleep' },

  // Nerve Pain
  { name: 'Gabapentin', slug: 'gabapentin', category: 'Nerve Pain' },
  { name: 'Pregabalin', slug: 'pregabalin', category: 'Nerve Pain' },

  // Urinary
  { name: 'Tamsulosin', slug: 'tamsulosin', category: 'Urinary' },
  { name: 'Finasteride', slug: 'finasteride', category: 'Urinary' },
  { name: 'Sildenafil', slug: 'sildenafil', category: 'Urinary' },

  // Blood Thinners
  { name: 'Warfarin', slug: 'warfarin', category: 'Blood Thinners' },
  { name: 'Apixaban', slug: 'apixaban', category: 'Blood Thinners' },
  { name: 'Clopidogrel', slug: 'clopidogrel', category: 'Blood Thinners' },
]
